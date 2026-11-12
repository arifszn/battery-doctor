import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fakeDumps, tmpDir, writeDumps } from './lib/fake-phone.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const scripts = path.join(root, 'battery-doctor', 'scripts');
const home = tmpDir();
process.env.BATTERY_DOCTOR_HOME = home;       // must be set before the modules load
const { summarize, dur } = await import('../battery-doctor/scripts/lib/parse.mjs');
const { evaluate, quality, fixList } = await import('../battery-doctor/scripts/lib/rules.mjs');
const { buildReport, reportData } = await import('../battery-doctor/scripts/lib/report.mjs');
const { apply, undo, readLog } = await import('../battery-doctor/scripts/lib/fixes.mjs');
const { unzip } = await import('../battery-doctor/scripts/lib/adb.mjs');

const AT = '2026-11-03T12:00:00.000Z';

test('durations', () => {
  assert.equal(dur('21h 23m 47s 205ms'), 21 * 3600 + 23 * 60 + 47.205);
  assert.equal(dur('+1m15s770ms'), 75.77);
});

test('samsung-style dumps: idle drain from measured current', () => {
  const s = summarize(writeDumps(tmpDir(), fakeDumps({ style: 'samsung', idleMa: 150, activeMa: 500 })), AT);
  assert.equal(s.device.model, 'SM-TEST');
  assert.equal(s.idle.method, 'measured current');
  assert.equal(s.idle.ma, 150);
  assert.equal(s.idle.pctPerHour, 3);
  assert.equal(s.active.ma, 500);
  assert.equal(s.battery.healthPct, 91);
  assert.equal(s.window.hoursOnBattery, 10);
  assert.equal(s.window.deepDozeHours, 0);
  assert.equal(s.screenApps[0].app, 'com.example.video');
  assert.ok(s.levels.length > 10 && s.screenSpans.length === 1);
});

test('aosp-style dumps: relative timestamps, idle drain from percent', () => {
  const s = summarize(writeDumps(tmpDir(), fakeDumps({ style: 'aosp', idleMa: 100, activeMa: 400 })), AT);
  assert.equal(s.device.manufacturer, 'Google');
  assert.equal(s.idle.method, 'percent while screen off');
  assert.equal(s.idle.pctPerHour, 2);          // 6 h at 100 mA of 5000 mAh = 12%, over 6 h
  assert.equal(s.screenApps, null);
  assert.equal(s.estimatedApps[0].app, 'com.example.video');
  assert.ok(s.levels.length > 10);
  assert.equal(s.battery.healthSource, 'measured');
});

test('empty or unknown dumps do not crash', () => {
  const s = summarize(writeDumps(tmpDir(), { 'battery.txt': 'garbage', 'batterystats.txt': '' }), AT);
  assert.equal(s.window, null);
  assert.equal(s.idle, null);
  assert.equal(quality(s).ok, false);
  assert.deepEqual(evaluate(s), []);
});

test('windows line endings parse the same', () => {
  const dumps = fakeDumps();
  const crlf = Object.fromEntries(Object.entries(dumps).map(([k, v]) => [k, v.replace(/\n/g, '\r\n')]));
  const a = summarize(writeDumps(tmpDir(), dumps), AT), b = summarize(writeDumps(tmpDir(), crlf), AT);
  assert.deepEqual(b, a);
});

test('rules flag the planted problems and only offer fixes for installed apps', () => {
  const s = summarize(writeDumps(tmpDir(), fakeDumps()), AT);
  const flags = evaluate(s), ids = flags.map(f => f.id);
  for (const id of ['idle-drain', 'no-deep-sleep', 'awake-while-off', 'frequent-wakeups', 'app-wakeups:com.example.tracker',
    'bt-scan:com.example.tracker', 'always-running:com.example.tracker', 'sensor:com.example.tracker', 'location:com.example.tracker',
    'notifications:com.example.chat', 'setting:ble_scan_always_enabled']) assert.ok(ids.includes(id), `missing ${id}`);
  assert.equal(flags[0].severity, 'high');
  assert.ok(!ids.some(id => id.includes('com.google.android.gms') || id.endsWith(':android')));
  assert.ok(!ids.includes('setting:wifi_scan_always_enabled'));
  assert.equal(quality(s).ok, true);
});

test('fix numbers count each fix once, and manual fixes carry steps', () => {
  const flags = evaluate(summarize(writeDumps(tmpDir(), fakeDumps()), AT));
  const all = flags.flatMap(f => f.fixes), list = fixList(flags, { manual: [{ title: 'By hand', steps: ['One'] }] });
  assert.ok(all.length > new Set(all.map(x => x.id)).size, 'the fake phone repeats a fix');
  assert.equal(list.length, new Set(all.map(x => x.id)).size + 1);
  assert.deepEqual(list.map(x => x.n), list.map((_, i) => i + 1));
  assert.equal(list[list.length - 1].id, 'manual:By hand');
  for (const x of list) if (x.kind === 'manual') assert.ok(x.steps?.length, `no steps for ${x.id}`);
});

test('a short checkup is reported as not enough data', () => {
  const s = summarize(writeDumps(tmpDir(), fakeDumps({ hours: 2, screenOnHours: 1 })), AT);
  assert.equal(quality(s).ok, false);
});

function seed(dir, id, opts) {
  const raw = writeDumps(path.join(dir, 'checkups', id, 'raw'), fakeDumps(opts));
  fs.writeFileSync(path.join(dir, 'checkups', id, 'summary.json'), JSON.stringify(summarize(raw, id.replace(/T(\d\d)-(\d\d)-(\d\d)/, 'T$1:$2:$3') + '.000Z')));
}

test('report is one self-contained file built from every checkup', () => {
  const dir = path.join(home, 'report-phone');
  seed(dir, '2026-11-03T12-00-00', { idleMa: 150 });
  seed(dir, '2026-11-04T12-00-00', { idleMa: 60 });
  fs.writeFileSync(path.join(dir, 'checkups', '2026-11-04T12-00-00', 'findings.json'), JSON.stringify({ headline: 'Idle drain <b>halved</b>.', appNames: { 'com.example.video': 'Video' } }));
  const data = reportData(dir);
  assert.equal(data.checkups.length, 2);
  assert.equal(data.checkups[1].idle.pctPerHour, 1.2);
  assert.equal(data.checkups[0].thirdPartyApps, undefined);
  const html = fs.readFileSync(buildReport(dir), 'utf8');
  assert.ok(!html.includes('__REPORT_DATA__') && !html.includes('__FONT_BASE64__'));
  assert.ok(html.includes('\\u003cb>halved'), 'agent text must not be able to close the script tag');
  const external = [...html.matchAll(/(?:src|href)\s*=\s*["']?(https?:[^"'\s>]+)/g)].map(m => m[1]);
  assert.deepEqual(external, [], 'the report must not load anything from the network');
  assert.ok(!/url\(\s*["']?https?:/.test(html));
});

test('unzip extracts stored and deflated entries and rejects path traversal', () => {
  const zip = entries => {
    const locals = [], centrals = []; let offset = 0;
    for (const [name, data, deflate] of entries) {
      const n = Buffer.from(name), body = deflate ? zlib.deflateRawSync(data) : data;
      const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(deflate ? 8 : 0, 8); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
      const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(deflate ? 8 : 0, 10); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE((0o100755 << 16) >>> 0, 38); ch.writeUInt32LE(offset, 42);
      locals.push(lh, n, body); centrals.push(ch, n); offset += 30 + n.length + body.length;
    }
    const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cd, end]);
  };
  const dest = tmpDir();
  unzip(zip([['platform-tools/adb', Buffer.from('stored'), false], ['platform-tools/NOTICE.txt', Buffer.from('deflated '.repeat(50)), true]]), dest);
  assert.equal(fs.readFileSync(path.join(dest, 'platform-tools', 'adb'), 'utf8'), 'stored');
  assert.equal(fs.readFileSync(path.join(dest, 'platform-tools', 'NOTICE.txt'), 'utf8'), 'deflated '.repeat(50));
  assert.throws(() => unzip(zip([['../evil', Buffer.from('x'), false]]), dest), /Unsafe path/);
});

test('apply without --yes changes nothing and exits with an error', () => {
  const r = spawnSync(process.execPath, [path.join(scripts, 'doctor.mjs'), 'apply', 'setting', 'wifi_scan_always_enabled'], { encoding: 'utf8', env: { ...process.env, ADB: 'no-such-adb' } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Not applied/);
});

// A scripted stand-in for adb. It keeps phone state in a JSON file. Unix only: Windows cannot spawn a script directly.
test('apply, verify and undo against a fake phone', { skip: process.platform === 'win32' }, () => {
  const dir = tmpDir(), state = path.join(dir, 'state.json'), bin = path.join(dir, 'adb');
  fs.writeFileSync(state, JSON.stringify({ ops: {}, settings: { 'global wifi_scan_always_enabled': '1' }, running: ['com.example.tracker'] }));
  fs.writeFileSync(bin, `#!/usr/bin/env node
const fs = require('fs'); const st = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, 'utf8'));
const cmd = process.argv.slice(2).filter(a => a !== '-s' && a !== 'SERIAL').slice(1).join(' ');
let m, out = '';
if (cmd === 'pm list packages -3 --user 0') out = 'package:com.example.tracker\\npackage:com.example.video';
else if ((m = /^cmd appops get (\\S+) RUN_ANY_IN_BACKGROUND$/.exec(cmd))) out = st.ops[m[1]] ? 'RUN_ANY_IN_BACKGROUND: ' + st.ops[m[1]] : 'No operations.\\nDefault mode: allow';
else if ((m = /^cmd appops set (\\S+) RUN_ANY_IN_BACKGROUND (\\w+)$/.exec(cmd))) { if (m[2] === 'default') delete st.ops[m[1]]; else st.ops[m[1]] = m[2]; }
else if ((m = /^am force-stop (\\S+)$/.exec(cmd))) st.running = st.running.filter(p => p !== m[1]);
else if ((m = /^pidof (\\S+) \\|\\| echo none$/.exec(cmd))) out = st.running.includes(m[1]) ? '1234' : 'none';
else if ((m = /^settings get (\\w+ \\w+)$/.exec(cmd))) out = st.settings[m[1]] ?? 'null';
else if ((m = /^settings put (\\w+ \\w+) (\\S+)$/.exec(cmd))) st.settings[m[1]] = m[2];
else if ((m = /^settings delete (\\w+ \\w+)$/.exec(cmd))) delete st.settings[m[1]];
else { console.error('unexpected: ' + cmd); process.exit(1); }
fs.writeFileSync(${JSON.stringify(state)}, JSON.stringify(st)); console.log(out);
`, { mode: 0o755 });
  const phone = () => JSON.parse(fs.readFileSync(state, 'utf8'));
  const log = path.join(dir, 'phone'); fs.mkdirSync(log);

  const a = apply(bin, 'SERIAL', log, 'restrict-background', 'com.example.tracker');
  assert.deepEqual([a.previous, a.value, a.verified], ['default', 'ignore', true]);
  assert.equal(phone().ops['com.example.tracker'], 'ignore');

  const b = apply(bin, 'SERIAL', log, 'setting', 'wifi_scan_always_enabled');
  assert.deepEqual([b.previous, b.value, b.verified], ['1', '0', true]);

  const c = apply(bin, 'SERIAL', log, 'force-stop', 'com.example.tracker');
  assert.equal(c.verified, true);
  assert.deepEqual(phone().running, []);

  assert.throws(() => apply(bin, 'SERIAL', log, 'restrict-background', 'com.google.android.gms'), /not an app the user installed/);
  assert.throws(() => apply(bin, 'SERIAL', log, 'restrict-background', 'x; rm -rf /'), /not a valid package/);
  assert.throws(() => apply(bin, 'SERIAL', log, 'setting', 'airplane_mode_on'), /not a setting this tool may change/);
  assert.throws(() => apply(bin, 'SERIAL', log, 'uninstall', 'com.example.tracker'), /Unknown action/);
  assert.equal(readLog(log).length, 3);

  undo(bin, 'SERIAL', log, a.id); undo(bin, 'SERIAL', log, b.id);
  assert.equal(phone().ops['com.example.tracker'], undefined);
  assert.equal(phone().settings['global wifi_scan_always_enabled'], '1');
  assert.throws(() => undo(bin, 'SERIAL', log, a.id), /already undone/);
  assert.throws(() => undo(bin, 'SERIAL', log, c.id), /nothing to undo/);
  assert.equal(readLog(log).filter(e => e.undoneAt).length, 2);
});
