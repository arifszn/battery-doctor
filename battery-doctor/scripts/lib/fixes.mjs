// The only changes this skill can make on a phone. Each one is reversible or harmless,
// is logged with the previous value, and is read back to confirm it took.
import fs from 'node:fs';
import path from 'node:path';
import { shell } from './adb.mjs';

// key -> [namespace, value that saves battery]
export const SETTINGS = {
  ble_scan_always_enabled: ['global', '0'],
  wifi_scan_always_enabled: ['global', '0'],
  doze_always_on: ['secure', '0'],
};
export const ACTIONS = ['restrict-background', 'force-stop', 'setting'];
const PKG = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;

const logFile = dir => path.join(dir, 'changes.json');
export const readLog = dir => { try { return JSON.parse(fs.readFileSync(logFile(dir), 'utf8')); } catch { return []; } };
const writeLog = (dir, log) => fs.writeFileSync(logFile(dir), JSON.stringify(log, null, 2));

function run(bin, serial, cmd) {
  const r = shell(bin, serial, cmd);
  if (!r.ok || /^(Error|Exception|Security)|SecurityException/m.test(r.out + r.err)) throw new Error(`The phone refused: ${(r.out + ' ' + r.err).trim().split('\n')[0]}`);
  return r.out.trim();
}

function checkPackage(bin, serial, pkg) {
  if (!PKG.test(pkg)) throw new Error(`"${pkg}" is not a valid package name.`);
  const third = run(bin, serial, 'pm list packages -3 --user 0').split('\n').map(l => l.replace('package:', '').trim());
  if (!third.includes(pkg)) throw new Error(`${pkg} is not an app the user installed. System apps are never changed.`);
}

const bgMode = (bin, serial, pkg) => {
  const m = /RUN_ANY_IN_BACKGROUND: (\w+)/.exec(run(bin, serial, `cmd appops get ${pkg} RUN_ANY_IN_BACKGROUND`));
  return m ? m[1] : 'default';
};
const getSetting = (bin, serial, ns, key) => run(bin, serial, `settings get ${ns} ${key}`);

export function apply(bin, serial, dir, action, target) {
  const log = readLog(dir);
  const entry = { id: log.length + 1, at: new Date().toISOString(), action, target, previous: null, value: null, verified: false, undoneAt: null };
  if (action === 'restrict-background') {
    checkPackage(bin, serial, target);
    entry.previous = bgMode(bin, serial, target); entry.value = 'ignore';
    run(bin, serial, `cmd appops set ${target} RUN_ANY_IN_BACKGROUND ignore`);
    entry.verified = bgMode(bin, serial, target) === 'ignore';
  } else if (action === 'force-stop') {
    checkPackage(bin, serial, target);
    run(bin, serial, `am force-stop ${target}`);
    entry.value = 'stopped'; entry.verified = run(bin, serial, `pidof ${target} || echo none`) === 'none';
  } else if (action === 'setting') {
    const s = SETTINGS[target];
    if (!s) throw new Error(`"${target}" is not a setting this tool may change. Allowed: ${Object.keys(SETTINGS).join(', ')}.`);
    entry.previous = getSetting(bin, serial, s[0], target); entry.value = s[1];
    run(bin, serial, `settings put ${s[0]} ${target} ${s[1]}`);
    entry.verified = getSetting(bin, serial, s[0], target) === s[1];
  } else throw new Error(`Unknown action "${action}". Allowed: ${ACTIONS.join(', ')}.`);
  log.push(entry); writeLog(dir, log);
  return entry;
}

export function undo(bin, serial, dir, id) {
  const log = readLog(dir);
  const entry = log.find(e => e.id === id);
  if (!entry) throw new Error(`No change with id ${id}.`);
  if (entry.undoneAt) throw new Error(`Change ${id} was already undone.`);
  if (entry.action === 'restrict-background') {
    const mode = entry.previous === 'default' ? 'default' : entry.previous;
    run(bin, serial, `cmd appops set ${entry.target} RUN_ANY_IN_BACKGROUND ${mode}`);
    if (bgMode(bin, serial, entry.target) === 'ignore') throw new Error('The phone still reports the app as restricted.');
  } else if (entry.action === 'setting') {
    const [ns] = SETTINGS[entry.target];
    run(bin, serial, entry.previous === 'null' ? `settings delete ${ns} ${entry.target}` : `settings put ${ns} ${entry.target} ${entry.previous}`);
    if (getSetting(bin, serial, ns, entry.target) !== entry.previous) throw new Error('The phone did not restore the previous value.');
  } else throw new Error('Closing an app has nothing to undo. Open the app to start it again.');
  entry.undoneAt = new Date().toISOString(); writeLog(dir, log);
  return entry;
}
