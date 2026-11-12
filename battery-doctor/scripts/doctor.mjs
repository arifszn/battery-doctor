#!/usr/bin/env node
// battery-doctor: check an Android phone's battery drain over USB. Needs Node 18+, nothing else.
//   node doctor.mjs status            is adb here, is a phone connected and authorized
//   node doctor.mjs guide             open the picture guide for turning on USB debugging
//   node doctor.mjs get-adb           download Google's adb (only after the user agrees)
//   node doctor.mjs check             take a checkup, print the summary, build the report
//   node doctor.mjs report            rebuild the HTML report from saved checkups
//   node doctor.mjs fixes             list the numbered fixes (F1, F2, ...) of the latest checkup
//   node doctor.mjs apply <action> <target> --yes     make one confirmed change
//   node doctor.mjs note "<text>"      record a change the user made by hand, so the report marks it
//   node doctor.mjs undo <id|all>     reverse a change
//   node doctor.mjs changes           list changes made so far
//   node doctor.mjs plan              show the saved plan: what the next checkup tests, when, what is open
import fs from 'node:fs';
import path from 'node:path';
import { HOME, DOWNLOAD_URL, findAdb, downloadAdb, devices, shell } from './lib/adb.mjs';
import { collect } from './lib/collect.mjs';
import { summarize } from './lib/parse.mjs';
import { evaluate, quality, fixList, screenTime } from './lib/rules.mjs';
import { apply, undo, note, readLog, ACTIONS, SETTINGS } from './lib/fixes.mjs';
import { buildReport, loadCheckups, openInBrowser, ASSETS } from './lib/report.mjs';
import { readPlan, planFile, planLines } from './lib/plan.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter(a => a.startsWith('--')));
const args = rest.filter(a => !a.startsWith('--'));
const opt = name => { const a = rest.find(x => x.startsWith(`--${name}=`)); return a ? a.split('=').slice(1).join('=') : null; };
const say = (...a) => console.log(...a);
const fail = msg => { console.error(`ERROR: ${msg}`); process.exit(1); };

function needAdb() {
  const bin = findAdb();
  if (!bin) fail(`adb is not installed. Ask the user for permission, then run: node doctor.mjs get-adb\n(downloads Google's official Android platform-tools from ${DOWNLOAD_URL} into ${path.join(HOME, 'tools')})`);
  return bin;
}

function needDevice(bin) {
  const want = opt('serial');
  const list = devices(bin).filter(d => want || !d.serial.startsWith('emulator-'));   // an emulator is not the user's phone
  const ready = list.filter(d => d.state === 'device' && (!want || d.serial === want));
  if (ready.length === 1) return ready[0].serial;
  if (ready.length > 1) fail(`${ready.length} phones are connected. Unplug the others or pass --serial=<one of: ${ready.map(d => d.serial).join(', ')}>.`);
  if (list.some(d => d.state === 'unauthorized')) fail('The phone is connected but has not allowed this computer. Unlock the phone and tap Allow on the "Allow USB debugging?" prompt. If no prompt shows, unplug and plug the cable in again.');
  if (list.length) fail(`The phone is connected but not ready (state: ${list[0].state}). Unplug it, plug it in again and unlock it.`);
  fail('No phone found. See references/setup-phone.md: enable Developer options and USB debugging, connect with a data cable, unlock the phone and tap Allow.');
}

function deviceDir(bin, serial) {
  const model = shell(bin, serial, 'getprop ro.product.model').out.trim() || 'phone';
  const dir = path.join(HOME, `${model}-${serial.slice(-4)}`.replace(/[^A-Za-z0-9_-]+/g, '_'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const pct = n => (n == null ? 'unknown' : `${n}%`);
function printSummary(s, flagsList, q, prev) {
  const d = s.device, b = s.battery, w = s.window;
  say(`# Checkup ${s.takenAt.slice(0, 16).replace('T', ' ')} UTC`);
  say(`Phone: ${[d.manufacturer, d.model].filter(Boolean).join(' ') || 'unknown'}, Android ${d.android ?? '?'}`);
  say(`Battery: ${pct(b.levelPct)} now, health ${pct(b.healthPct)}${b.healthSource ? ` (${b.healthSource})` : ''}, ${b.temperatureC ?? '?'} °C`);
  if (w) {
    say(`\n## Since the last full charge (${w.startedAt ? w.startedAt.replace('T', ' ') + ' phone time' : 'start unknown'})`);
    say(`- On battery ${w.hoursOnBattery} h, used ${pct(w.dischargedPct)}: screen on ${w.screenOnHours} h, screen off ${w.screenOffHours} h`);
    const st = screenTime(s);
    if (st != null) say(`- Screen time from a full charge: about ${st} h (this period: ${w.screenOnHours} h of screen, ${pct(w.dischargedPct)} of the battery used, idle time included)`);
    if (s.hoursPerCharge) say(`- At this rate a full charge lasts about ${s.hoursPerCharge} h`);
    if (s.idle) say(`- Idle drain (screen off): ${s.idle.pctPerHour}% per hour${s.idle.ma ? ` (${s.idle.ma} mA)` : ''}, healthy is under 1%. Method: ${s.idle.method}`);
    if (s.active) say(`- Screen-on drain: ${s.active.pctPerHour}% per hour${s.active.ma ? ` (${s.active.ma} mA)` : ''}`);
    say(`- Sleep: deep ${w.deepDozeHours} h, light ${w.lightDozeHours} h, awake ${pct(w.awakeWhileOffPct)} of screen-off time`);
  }
  if (!q.ok) { say('\n## NOT ENOUGH DATA'); q.reasons.forEach(r => say(`- ${r}`)); }
  if (prev?.idle && s.idle) {
    const a = screenTime(prev), b2 = screenTime(s);
    const diff = Math.round((s.idle.pctPerHour - prev.idle.pctPerHour) / prev.idle.pctPerHour * 100);
    say(`\n## Compared with the checkup on ${prev.takenAt.slice(0, 10)}`);
    if (a != null && b2 != null) say(`- Screen time from a full charge: ${a} h -> ${b2} h`);
    say(`- Idle drain: ${prev.idle.pctPerHour}% -> ${s.idle.pctPerHour}% per hour (${diff > 0 ? '+' : ''}${diff}%)`);
    if (prev.hoursPerCharge && s.hoursPerCharge) say(`- Hours per charge: ${prev.hoursPerCharge} -> ${s.hoursPerCharge}`);
    say(`- Screen-off hours compared: ${prev.window?.screenOffHours} then, ${w?.screenOffHours} now. A period with a night in it idles lower than a daytime one.`);
  }
  const list = (title, rows, f) => { if (rows?.length) { say(`\n## ${title}`); rows.forEach(r => say(`- ${f(r)}`)); } };
  list('Battery used on screen, by app', s.screenApps?.slice(0, 6), a => `${a.app}: ${a.minutes} min, ${a.mah} mAh`);
  if (!s.screenApps) list('Battery used by app (Android estimate)', s.estimatedApps.slice(0, 6), a => `${a.app}: ${a.mah} mAh`);
  list('What wakes the phone', s.wakeups.slice(0, 6), g => `${g.source}: ${g.count} times`);
  say(`\n## Problems found (${flagsList.length})`);
  if (!flagsList.length) say('- None above the thresholds.');
  const num = new Map(fixList(flagsList).map(x => [x.id, x.n]));   // same numbering as the report
  for (const f of flagsList) {
    say(`- [${f.severity}] ${f.id}: ${f.title}. ${f.detail}`);
    for (const x of f.fixes) say(`    fix F${num.get(x.id)} (${x.kind}) ${x.id}: ${x.title}. Cost: ${x.tradeoff}`);
  }
}

// The phone's data folder: --dir, the only one saved, or the connected phone's.
function pickDir() {
  const given = opt('dir');
  if (given) return given;
  const bin = findAdb();
  const dirs = fs.existsSync(HOME) ? fs.readdirSync(HOME).map(n => path.join(HOME, n)).filter(p => fs.existsSync(path.join(p, 'checkups'))) : [];
  if (dirs.length === 1) return dirs[0];
  if (bin && devices(bin).some(d => d.state === 'device')) return deviceDir(bin, needDevice(bin));
  fail(dirs.length ? `Several phones have checkups. Pass --dir=<one of: ${dirs.join(', ')}>.` : 'No checkups yet. Run "node doctor.mjs check" first.');
}

// The phone's plan, printed so a new session starts from it.
function printPlan(dir) {
  const plan = readPlan(dir);
  if (!plan) return false;
  say(`\n## Plan (${planFile(dir)})`);
  planLines(plan).forEach(l => say(l));
  const last = loadCheckups(dir).pop()?.summary.takenAt;
  if (last && last > plan.updatedAt) say('- The latest checkup is newer than this plan. Update the plan.');
  return true;
}
function savedPlans() {
  if (!fs.existsSync(HOME)) return;
  for (const n of fs.readdirSync(HOME)) { const d = path.join(HOME, n); if (fs.existsSync(path.join(d, 'checkups'))) printPlan(d); }
}

const commands = {
  status() {
    const bin = findAdb();
    say(`node: ${process.version}`);
    say(`data folder: ${HOME}`);
    if (!bin) { say('adb: NOT INSTALLED'); say(`next: ask the user, then run "node doctor.mjs get-adb" (downloads ${DOWNLOAD_URL})`); return savedPlans(); }
    say(`adb: ${bin}`);
    const list = devices(bin);
    if (!list.length) { say('phone: NOT FOUND'); say('next: run "node doctor.mjs guide" to show the user the picture guide, and follow references/setup-phone.md'); return savedPlans(); }
    for (const d of list) {
      if (d.state !== 'device') { say(`phone: ${d.serial} is ${d.state.toUpperCase()}`); say('next: unlock the phone and tap Allow on the USB debugging prompt'); continue; }
      const p = k => shell(bin, d.serial, `getprop ${k}`).out.trim();
      say(`phone: READY ${p('ro.product.manufacturer')} ${p('ro.product.model')}, Android ${p('ro.build.version.release')} (serial ${d.serial})`);
      const dir = deviceDir(bin, d.serial);
      say(`checkups saved: ${loadCheckups(dir).length}, changes made: ${readLog(dir).filter(e => !e.undoneAt).length}`);
      printPlan(dir);
    }
  },

  guide() {
    const file = path.join(ASSETS, 'setup-guide.html');
    say(`guide: ${file}`);
    if (!flags.has('--no-open')) openInBrowser(file);
  },

  async 'get-adb'() {
    if (findAdb()) return say(`adb is already available: ${findAdb()}`);
    say(`Downloading ${DOWNLOAD_URL} ...`);
    say(`adb installed: ${await downloadAdb()}`);
  },

  async check() {
    const bin = needAdb(), serial = needDevice(bin), dir = deviceDir(bin, serial);
    const takenAt = new Date().toISOString();
    const cdir = path.join(dir, 'checkups', takenAt.replace(/[:.]/g, '-').slice(0, 19));
    const before = loadCheckups(dir);
    const raw = await collect(bin, serial, cdir, m => console.error(`  ${m}`));
    const s = summarize(raw, takenAt);
    fs.writeFileSync(path.join(cdir, 'summary.json'), JSON.stringify(s, null, 2));
    const q = quality(s), fl = evaluate(s);
    const same = before.filter(c => s.window?.startedAt && c.summary.window?.startedAt === s.window.startedAt).pop()?.summary;
    printSummary(s, fl, q, before.filter(c => c.summary.window?.startedAt !== s.window?.startedAt).pop()?.summary);
    if (same) say(`\n## SAME CHARGE PERIOD as the checkup on ${same.takenAt.slice(0, 16).replace('T', ' ')} UTC\n- ${same.window.hoursOnBattery === s.window.hoursOnBattery ? 'Nothing new was measured: the phone has not been used on battery since then.' : 'This checkup covers more of the same period.'} It replaces that checkup in the report. A new period starts once the phone is charged and used on battery again.`);
    const plan = readPlan(dir);
    if (plan) { say('\n## PLAN before this checkup'); planLines(plan).forEach(l => say(l)); say(`- Update ${planFile(dir)} with what comes next (format in references/report.md).`); }
    const out = buildReport(dir);
    say(`\ncheckup folder: ${cdir}`);
    say(`report: ${out}`);
    say(`to add explanations to the report, write ${path.join(cdir, 'findings.json')} (format in references/report.md) and run "node doctor.mjs report"`);
  },

  report() {
    const out = buildReport(pickDir());
    say(`report: ${out}`);
    if (!flags.has('--no-open')) openInBrowser(out);
  },

  fixes() {
    const dir = pickDir(), last = loadCheckups(dir).pop();
    if (!last) fail('No checkups yet. Run "node doctor.mjs check" first.');
    const list = fixList(evaluate(last.summary), last.findings);
    // a setting still reported as on after it was turned off has been changed back on the phone
    const done = new Set(readLog(dir).filter(e => e.verified && !e.undoneAt && e.action !== 'force-stop' && !(e.action === 'setting' && last.summary.takenAt > e.at)).map(e => `${e.action}:${e.target}`));
    say(`# Fixes from the checkup of ${last.summary.takenAt.slice(0, 16).replace('T', ' ')} UTC`);
    if (!list.length) say('- None.');
    for (const x of list) {
      say(`- F${x.n} (${x.kind}) ${x.id}: ${x.title}.${x.tradeoff ? ` Cost: ${x.tradeoff}` : ''}${done.has(x.id) ? ' ALREADY APPLIED.' : ''}`);
      (x.steps || []).forEach((t, i) => say(`    ${i + 1}. ${t}`));
    }
  },

  apply() {
    const [action, target] = args;
    if (!ACTIONS.includes(action) || !target) fail(`Usage: node doctor.mjs apply <${ACTIONS.join('|')}> <app package or setting> --yes\nSettings allowed: ${Object.keys(SETTINGS).join(', ')}`);
    if (!flags.has('--yes')) fail('Not applied. Show the user this exact change and what it costs them. Run again with --yes only after they agree to this specific change.');
    const bin = needAdb(), serial = needDevice(bin), dir = deviceDir(bin, serial);
    const e = apply(bin, serial, dir, action, target);
    say(`change ${e.id}: ${action} ${target} -> ${e.value} (was ${e.previous ?? 'n/a'})`);
    say(e.verified ? 'verified on the phone: yes' : 'verified on the phone: NO. The phone did not confirm the change. Tell the user it may not have taken.');
    if (action !== 'force-stop') say(`undo with: node doctor.mjs undo ${e.id}`);
    if (loadCheckups(dir).length) buildReport(dir);
  },

  note() {
    const dir = pickDir(), e = note(dir, args.join(' '));
    say(`change ${e.id} noted: ${e.target}`);
    say(`remove the note with: node doctor.mjs undo ${e.id}`);
    if (loadCheckups(dir).length) buildReport(dir);
  },

  undo() {
    const all = args[0] === 'all';
    // a note is only a record, so removing one needs no phone
    const noteOnly = !all && readLog(pickDir()).find(e => e.id === +args[0])?.action === 'note';
    const bin = noteOnly ? null : needAdb(), serial = noteOnly ? null : needDevice(bin), dir = noteOnly ? pickDir() : deviceDir(bin, serial);
    const ids = all ? readLog(dir).filter(e => !e.undoneAt && e.action !== 'force-stop' && e.action !== 'note').map(e => e.id).reverse() : [+args[0]];
    if (!ids.length || ids.some(isNaN)) fail('Usage: node doctor.mjs undo <id|all>. Run "node doctor.mjs changes" to see the ids.');
    let failed = 0;
    for (const id of ids) {
      try { const e = undo(bin, serial, dir, id); say(e.action === 'note' ? `note ${e.id} removed: ${e.target}` : e.note ? `undone ${e.id}: ${e.note}` : `undone ${e.id}: ${e.action} ${e.target} is back to ${e.previous}`); }
      catch (err) { failed++; say(`NOT undone ${id}: ${err.message}`); }   // one failure must not block the rest
    }
    if (loadCheckups(dir).length) buildReport(dir);
    if (failed) process.exitCode = 1;
  },

  plan() {
    const dir = pickDir();
    if (!printPlan(dir)) say(`No plan saved. Write ${planFile(dir)} (format in references/report.md).`);
  },

  changes() {
    const log = readLog(pickDir());
    if (!log.length) return say('No changes have been made to this phone.');
    for (const e of log) say(`${e.id}. ${e.at.slice(0, 16).replace('T', ' ')} ${e.action === 'note' ? `done by hand: ${e.target}` : `${e.action} ${e.target}: ${e.previous ?? 'n/a'} -> ${e.value}`}${e.undoneAt ? ' (undone)' : ''}${e.verified ? '' : ' (not verified)'}`);
  },
};

if (!commands[cmd]) { say(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 13).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(cmd ? 1 : 0); }
try { await commands[cmd](); } catch (e) { fail(e.message); }
