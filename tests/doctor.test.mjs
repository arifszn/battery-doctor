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
const { evaluate, quality, fixList, screenTime } = await import('../battery-doctor/scripts/lib/rules.mjs');
const { buildReport, reportData } = await import('../battery-doctor/scripts/lib/report.mjs');
const { apply, undo, note, readLog, recordPhoneChanges } = await import('../battery-doctor/scripts/lib/fixes.mjs');
const { sameHours, phoneChanges } = await import('../battery-doctor/scripts/lib/compare.mjs');
const { unzip } = await import('../battery-doctor/scripts/lib/adb.mjs');
const { readPlan } = await import('../battery-doctor/scripts/lib/plan.mjs');

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

test('screen time per charge is scaled from the period and withheld when too short', () => {
  assert.equal(screenTime({ window: { screenOnHours: 7.2, dischargedPct: 89 } }), 8.1);
  assert.equal(screenTime({ window: { screenOnHours: 0.5, dischargedPct: 40 } }), null);
  assert.equal(screenTime({ window: { screenOnHours: 3, dischargedPct: 10 } }), null);
  assert.equal(screenTime({ window: null }), null);
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
  seed(dir, '2026-11-04T10-00-00', { idleMa: 90, start: '2026-11-04-08-00-00' });   // same charge period as the next one: only the latest counts
  seed(dir, '2026-11-04T12-00-00', { idleMa: 60, start: '2026-11-04-08-00-00' });
  fs.writeFileSync(path.join(dir, 'checkups', '2026-11-04T12-00-00', 'findings.json'), JSON.stringify({ headline: 'Idle drain <b>halved</b>.', appNames: { 'com.example.video': 'Video' } }));
  const data = reportData(dir);
  assert.equal(data.checkups.length, 2);
  assert.equal(data.checkups[1].idle.pctPerHour, 1.2);
  assert.equal(data.checkups[0].thirdPartyApps, undefined);
  const html = fs.readFileSync(buildReport(dir), 'utf8');
  assert.ok(!html.includes('__REPORT_DATA__') && !html.includes('__FONT_BASE64__'));
  assert.ok(html.includes('\\u003cb>halved'), 'agent text must not be able to close the script tag');
  assert.ok(html.includes('Copy "Apply fix ${label}"') && !/fetch\(|XMLHttpRequest|WebSocket/.test(html), 'fix buttons only copy a request; the page sends nothing anywhere');
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

test('a note records a hand fix without a phone, and undo removes it', () => {
  const dir = path.join(home, 'note-phone'); fs.mkdirSync(dir, { recursive: true });
  const e = note(dir, '  Put Maps into\ndeep sleep  ');
  assert.deepEqual([e.action, e.target, e.verified], ['note', 'Put Maps into deep sleep', true]);
  assert.throws(() => note(dir, '   '));
  assert.ok(undo(null, null, dir, e.id).undoneAt);
  assert.equal(readLog(dir).length, 1);
});

test('the plan is read from the phone folder, cleaned, shown without a phone and escaped in the report', () => {
  const dir = path.join(home, 'plan-phone');
  seed(dir, '2026-11-03T12-00-00', { idleMa: 150 });
  const doctor = (...a) => spawnSync(process.execPath, [path.join(scripts, 'doctor.mjs'), ...a, `--dir=${dir}`], { encoding: 'utf8', env: { ...process.env, ADB: 'no-such-adb' } });
  assert.match(doctor('plan').stdout, /No plan saved/);
  assert.equal(reportData(dir).plan, null);
  fs.writeFileSync(path.join(dir, 'plan.json'), '{ not json');
  assert.equal(readPlan(dir), null, 'a broken plan never stops a checkup');
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify({
    testing: 'Maps <b>stopped</b>\nin the background', nextCheckup: { after: '14 Nov 2026' },
    decide: ['Keep the watch?', 42, ''], notDoing: [{ what: 'Restricting Telegram', why: 'messages arrive late' }, { why: 'no what' }],
  }));
  const p = readPlan(dir);
  assert.equal(p.testing, 'Maps <b>stopped</b> in the background');
  assert.deepEqual([p.nextCheckup, p.decide, p.investigate, p.notDoing.length], [{ after: '14 Nov 2026', how: null }, ['Keep the watch?'], [], 1]);
  const r = doctor('plan');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Testing: Maps <b>stopped<\/b> in the background/);
  assert.match(r.stdout, /Next checkup: after 14 Nov 2026/);
  assert.match(r.stdout, /Not doing: Restricting Telegram \(messages arrive late\)/);
  const html = fs.readFileSync(buildReport(dir), 'utf8');
  assert.ok(html.includes('\\u003cb>stopped'), 'plan text must not be able to close the script tag');
});

test('screen-off time is split by hour of the day, and two checkups compare over the hours both cover', () => {
  for (const style of ['samsung', 'aosp']) {
    const s = summarize(writeDumps(tmpDir(), fakeDumps({ style, idleMa: 150 })), AT);
    const off = s.offByHour.reduce((t, h) => t + h[0], 0) / 3600;
    assert.ok(Math.abs(off - 6) < 0.1, `${style}: 6 h screen off, got ${off}`);
    assert.deepEqual(s.offByHour.map((h, i) => h[0] ? i : null).filter(x => x != null), [8, 9, 10, 11, 12, 13], `${style}: screen off 08:00-14:00`);
  }
  const before = summarize(writeDumps(tmpDir(), fakeDumps({ idleMa: 150 })), AT);
  const after = summarize(writeDumps(tmpDir(), fakeDumps({ idleMa: 60 })), AT);
  const c = sameHours(before, after);
  assert.equal(c.label, '08:00-14:00');
  assert.deepEqual([c.before, c.after, c.method], [3, 1.2, 'measured current']);
  const pct = sameHours(...['aosp', 'aosp'].map((style, i) => summarize(writeDumps(tmpDir(), fakeDumps({ style, idleMa: [150, 60][i] })), AT)));
  assert.equal(pct.method, 'percent while screen off');
  assert.ok(pct.before > pct.after);
  const short = summarize(writeDumps(tmpDir(), fakeDumps({ hours: 6, screenOnHours: 4 })), AT);   // 2 h screen off
  assert.equal(sameHours(before, short), null, 'too few shared hours is no comparison');
  assert.equal(sameHours({ ...before, offByHour: undefined }, after), null);
});

test('changes made on the phone between checkups are found, and the ones this tool made are left out', () => {
  const at = (s, iso) => ({ ...s, takenAt: iso });
  const a = at(summarize(writeDumps(tmpDir(), fakeDumps({ bleScan: '1', background: [] })), AT), '2026-11-03T12:00:00.000Z');
  const b = at(summarize(writeDumps(tmpDir(), fakeDumps({ bleScan: '0', background: ['com.example.chat', 'com.google.android.gms'], restricted: ['com.example.tracker'] })), AT), '2026-11-04T12:00:00.000Z');
  assert.deepEqual(b.restrictions, { background: ['com.example.chat'], restricted: ['com.example.tracker'] }, 'system apps are left out');
  const found = phoneChanges(a, b, [], p => ({ 'com.example.chat': 'Chat' })[p] || p);
  assert.deepEqual(found.map(x => x.text), [
    'Background Bluetooth scanning was turned off',
    'Chat was stopped from running in the background',
    'com.example.tracker was put in deep sleep, or restricted by Android as rarely used']);
  const quiet = { ...b, restrictions: { ...b.restrictions, restricted: ['com.example.tracker', 'com.example.unused'] } };
  assert.ok(!phoneChanges(a, quiet, []).some(x => x.target === 'com.example.unused'), 'an app absent from the battery figures moving into the restricted group is not reported');
  const byTool = [{ at: '2026-11-04T09:00:00.000Z', action: 'setting', target: 'ble_scan_always_enabled' }, { at: '2026-11-02T09:00:00.000Z', action: 'restrict-background', target: 'com.example.chat' }];
  assert.deepEqual(phoneChanges(a, b, byTool).map(x => x.key), ['background:com.example.chat:on', 'restricted:com.example.tracker:on'], 'a change logged between the checkups explains itself; an older one does not');
  assert.deepEqual(phoneChanges(a, { ...b, restrictions: null }, []).length, 1, 'no restriction data, only settings compared');
  const dir = path.join(home, 'phone-change'); fs.mkdirSync(dir, { recursive: true });
  assert.equal(recordPhoneChanges(dir, found, b.takenAt).length, 3);
  assert.equal(recordPhoneChanges(dir, found, b.takenAt).length, 0, 'the same finding is logged once');
  const e = readLog(dir)[0];
  assert.deepEqual([e.action, e.at, e.verified], ['phone', b.takenAt, true]);
  assert.ok(undo(null, null, dir, e.id).undoneAt, 'a finding is a record and can be removed without a phone');
});

test('a checkup saved by an older version is read again from its raw dumps', () => {
  const dir = path.join(home, 'old-phone');
  seed(dir, '2026-11-03T12-00-00', { idleMa: 150 });
  const file = path.join(dir, 'checkups', '2026-11-03T12-00-00', 'summary.json');
  const { offByHour, restrictions, ...old } = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...old, version: 1 }));
  assert.ok(reportData(dir).checkups[0].offByHour);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, 5);
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
if (cmd === 'pm list packages -3 --user 0') out = (st.installed || ['com.example.tracker', 'com.example.video']).map(p => 'package:' + p).join('\\n');
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

  // the same change twice is refused while the phone still has it
  const d = apply(bin, 'SERIAL', log, 'setting', 'wifi_scan_always_enabled');
  assert.throws(() => apply(bin, 'SERIAL', log, 'setting', 'wifi_scan_always_enabled'), /already in place/);
  // turned back on by hand on the phone: applying again is allowed and closes the old entry
  fs.writeFileSync(state, JSON.stringify({ ...phone(), settings: { 'global wifi_scan_always_enabled': '1' } }));
  const e = apply(bin, 'SERIAL', log, 'setting', 'wifi_scan_always_enabled');
  assert.equal(readLog(log).find(x => x.id === d.id).undoneBy, 'phone');
  assert.equal(e.verified, true);

  // undoing a restriction on an app that was uninstalled since does not fail
  const f = apply(bin, 'SERIAL', log, 'restrict-background', 'com.example.video');
  fs.writeFileSync(state, JSON.stringify({ ...phone(), installed: ['com.example.tracker'] }));
  assert.match(undo(bin, 'SERIAL', log, f.id).note, /no longer installed/);
});

test('a period that crosses New Year keeps its timeline', () => {
  const dumps = fakeDumps(), shifted = { ...dumps };
  // move the 10 hours from 3 Nov 08:00 to 31 Dec 20:00, so they end on 1 Jan 06:00
  shifted['history.txt'] = dumps['history.txt'].replace(/^(\s+)11-03 (\d\d):/gm, (_, sp, hh) => { const h = +hh + 12; return `${sp}${h >= 24 ? '01-01' : '12-31'} ${String(h % 24).padStart(2, '0')}:`; });
  assert.notEqual(shifted['history.txt'], dumps['history.txt']);
  const a = summarize(writeDumps(tmpDir(), dumps), AT), b = summarize(writeDumps(tmpDir(), shifted), '2027-01-01T07:00:00.000Z');
  assert.deepEqual(b.idle, a.idle);
  assert.deepEqual(b.levels, a.levels);
});

test('plugging in for a checkup does not end the period, a recharge does', () => {
  const dumps = fakeDumps();
  const lines = dumps['history.txt'].split('\n');
  const at = hhmm => lines.findIndex(l => l.includes(`11-03 ${hhmm}:00.000`));
  const lvl = +lines[at('10:00')].trim().split(/\s+/)[2];
  // a connection from 10:00:30 to 10:05:30 (or 11:00:30) that leaves the level as it was (or adds 20%)
  const withPlug = (until, rise) => {
    const out = [...lines];
    out.splice(at(until) + 1, 0, `  11-03 ${until}:30.000 ${String(lvl + rise).padStart(3, '0')} status=discharging plug=none`);
    out.splice(at('10:00') + 1, 0, `  11-03 10:00:30.000 ${String(lvl).padStart(3, '0')} status=charging plug=usb`);
    return { ...dumps, 'history.txt': out.join('\n') };
  };
  const base = summarize(writeDumps(tmpDir(), dumps), AT);
  const brief = summarize(writeDumps(tmpDir(), withPlug('10:05', 0)), AT);
  const charged = summarize(writeDumps(tmpDir(), withPlug('11:00', 20)), AT);
  const end = s => s.levels[s.levels.length - 1][0];
  assert.equal(end(brief), end(base));
  assert.ok(end(charged) <= 2.01, `curve should stop at the recharge, ended at ${end(charged)} h`);
  const off = s => s.offByHour.reduce((a, x) => a + x[0], 0);
  assert.ok(off(brief) > off(charged));
});

test('long periods and battery saver are pointed out', () => {
  const s = summarize(writeDumps(tmpDir(), fakeDumps()), AT);
  const ids = x => evaluate(x).map(f => f.id);
  assert.ok(!ids(s).includes('long-period') && !ids(s).includes('battery-saver'));
  assert.ok(ids({ ...s, window: { ...s.window, hoursOnBattery: 60 } }).includes('long-period'));
  assert.ok(ids({ ...s, settings: { ...s.settings, low_power: '1' } }).includes('battery-saver'));
});

test('a start clock that was set again later gives way to the earliest clock in the history', () => {
  const d = fakeDumps({ style: 'aosp', idleMa: 100, activeMa: 400 });
  d['batterystats.txt'] = d['batterystats.txt'].replace('Start clock time: 2026-11-03-08-00-00', 'Start clock time: 2026-11-03-17-50-00');
  d['history.txt'] = d['history.txt'].replace('0 (15) RESET:TIME: 2026-11-03-08-00-00', '0 (24) TIME: 2026-11-03-08-00-00');
  const s = summarize(writeDumps(tmpDir(), d), AT);
  assert.equal(s.window.startedAt, '2026-11-03T08:00:00');
  assert.equal(s.window.startFrom, 'history');
  assert.ok(s.offByHour[9][0] > 0);            // hours of the day still resolve without a RESET line
  const same = summarize(writeDumps(tmpDir(), fakeDumps({ style: 'aosp' })), AT);
  assert.equal(same.window.startedAt, '2026-11-03T08:00:00');
  assert.equal(same.window.startFrom, undefined);
});

test('battery health falls back to the capacity Android learned when the charge counter gives nothing', () => {
  const d = fakeDumps({ style: 'aosp' });
  d['battery.txt'] = d['battery.txt'].replace(/level: \d+/, 'level: 4');
  d['batterystats.txt'] = d['batterystats.txt'].replace('Capacity: 5000, Rated: 4855, Typical: 5000,', 'Capacity: 4910,')
    .replace('Statistics since last charge:', '  Estimated battery capacity: 5000 mAh\n  Last learned battery capacity: 4910 mAh\nStatistics since last charge:');
  const s = summarize(writeDumps(tmpDir(), d), AT);
  assert.equal(s.battery.designMah, 5000);
  assert.equal(s.battery.healthPct, 98);
  assert.equal(s.battery.healthSource, 'learned');
  d['batterystats.txt'] = d['batterystats.txt'].replace('Last learned battery capacity: 4910', 'Last learned battery capacity: 1000');
  assert.equal(summarize(writeDumps(tmpDir(), d), AT).battery.healthPct, null);   // a placeholder is not a measurement
});
