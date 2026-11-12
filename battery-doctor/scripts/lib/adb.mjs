// Find, download and run adb. No dependencies.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

export const HOME = process.env.BATTERY_DOCTOR_HOME || path.join(os.homedir(), 'battery-doctor');
const EXE = process.platform === 'win32' ? 'adb.exe' : 'adb';
const TOOLS = path.join(HOME, 'tools');
const LOCAL_ADB = path.join(TOOLS, 'platform-tools', EXE);
const PLATFORM = { darwin: 'darwin', linux: 'linux', win32: 'windows' }[process.platform];
export const DOWNLOAD_URL = `https://dl.google.com/android/repository/platform-tools-latest-${PLATFORM}.zip`;

function works(bin) {
  try { return spawnSync(bin, ['version'], { encoding: 'utf8', timeout: 20000 }).status === 0; } catch { return false; }
}

// Order: $ADB, the copy this skill downloaded, then PATH.
export function findAdb() {
  for (const bin of [process.env.ADB, LOCAL_ADB, 'adb']) if (bin && works(bin)) return bin;
  return null;
}

// Minimal zip reader (stored + deflate), enough for Google's platform-tools archive.
export function unzip(buf, dest) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Downloaded file is not a zip archive.');
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const mode = buf.readUInt32LE(p + 38) >>> 16, local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    const out = path.resolve(dest, name);
    if (!out.startsWith(path.resolve(dest) + path.sep)) throw new Error(`Unsafe path in archive: ${name}`);
    if (name.endsWith('/')) { fs.mkdirSync(out, { recursive: true }); continue; }
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, method === 0 ? raw : zlib.inflateRawSync(raw));
    if (process.platform !== 'win32') fs.chmodSync(out, (mode & 0o111) ? 0o755 : 0o644);
  }
}

export async function downloadAdb() {
  if (!PLATFORM) throw new Error(`No adb download for platform ${process.platform}. Install adb yourself and set ADB=/path/to/adb.`);
  const res = await fetch(DOWNLOAD_URL);
  if (!res.ok) throw new Error(`Download failed (${res.status}) from ${DOWNLOAD_URL}`);
  fs.mkdirSync(TOOLS, { recursive: true });
  unzip(Buffer.from(await res.arrayBuffer()), TOOLS);
  if (!works(LOCAL_ADB)) throw new Error(`adb was downloaded to ${LOCAL_ADB} but does not run.`);
  return LOCAL_ADB;
}

// Run adb and return stdout as text. `serial` picks the device when several are attached.
export function adb(bin, args, { serial, timeout = 120000 } = {}) {
  const r = spawnSync(bin, [...(serial ? ['-s', serial] : []), ...args],
    { encoding: 'utf8', timeout, maxBuffer: 512 * 1024 * 1024, windowsHide: true });
  if (r.error) throw r.error;
  return { ok: r.status === 0, out: (r.stdout || '').replace(/\r\n/g, '\n'), err: (r.stderr || '').trim() };
}

export const shell = (bin, serial, cmd, opts) => adb(bin, ['shell', cmd], { serial, ...opts });

// Stream a shell command's output straight to a file (dumps can be tens of MB).
export function shellToFile(bin, serial, cmd, file) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [...(serial ? ['-s', serial] : []), 'shell', cmd], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const out = fs.createWriteStream(file);
    child.stdout.pipe(out);
    const timer = setTimeout(() => child.kill(), 180000);
    child.on('error', reject);
    out.on('finish', () => { clearTimeout(timer); resolve(fs.statSync(file).size); });
  });
}

// [{serial, state}] where state is device | unauthorized | offline | ...
export function devices(bin) {
  const { out } = adb(bin, ['devices']);
  return out.split('\n').slice(1).map(l => l.trim().split(/\s+/)).filter(a => a.length >= 2 && a[0])
    .map(([serial, state]) => ({ serial, state }));
}
