// Turn a folder of raw dumps into one summary object. Every section is optional:
// a dump that is missing or in an unknown vendor format yields null, never a crash.
import fs from 'node:fs';
import path from 'node:path';

const HOUR = 3600;
const round = (n, d = 1) => (n == null || !isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

// "21h 23m 47s 205ms" or "+1m15s770ms" -> seconds
export function dur(s) {
  if (!s) return 0;
  let t = 0;
  for (const m of s.matchAll(/(\d+)\s*(ms|d|h|m|s)/g)) t += +m[1] * { d: 86400, h: 3600, m: 60, s: 1, ms: 0.001 }[m[2]];
  return t;
}

function safe(fn) { try { return fn(); } catch { return null; } }

function packages(read) {
  const uid2pkg = new Map();
  for (const m of read('packages.txt').matchAll(/package:(\S+) uid:(\d+)/g)) if (!uid2pkg.has(+m[2])) uid2pkg.set(+m[2], m[1]);
  const third = new Set([...read('packages3.txt').matchAll(/package:(\S+)/g)].map(m => m[1]));
  const name = tok => {
    const m = /^u(\d+)a(\d+)$/.exec(tok);
    // An app in a work profile or Secure Folder is a separate copy; USB access cannot list or change it.
    if (m && +m[1] > 0) return `${uid2pkg.get(10000 + +m[2]) || tok} (other profile)`;
    if (m) return uid2pkg.get(10000 + +m[2]) || tok;
    if (tok === '1000') return 'android';
    if (tok === '0') return 'kernel';
    if (/^\d+$/.test(tok) && +tok >= 100000) return `${uid2pkg.get(+tok % 100000) || tok} (other profile)`;
    return /^\d+$/.test(tok) ? (uid2pkg.get(+tok) || tok) : tok;
  };
  return { uid2pkg, third, name };
}

function device(read) {
  const p = Object.fromEntries(read('props.txt').split('\n').filter(l => l.includes('=')).map(l => l.split(/=(.*)/s).slice(0, 2).map(x => x.trim())));
  return {
    manufacturer: p['ro.product.manufacturer'] || null, brand: p['ro.product.brand'] || null,
    model: p['ro.product.model'] || null, android: p['ro.build.version.release'] || null,
    sdk: +p['ro.build.version.sdk'] || null,
  };
}

function settings(read) {
  const o = {};
  for (const l of read('settings.txt').split('\n')) {
    const m = /^(\w+) (\w+)=(.*)$/.exec(l.trim());
    if (m) o[m[2]] = m[3] === 'null' || m[3] === '' ? null : m[3];
  }
  return o;
}

// Apps the user can hold back: stopped from running in the background, or in Android's restricted group
// (Samsung's deep sleep, or Android restricting an app that is rarely used). Third-party apps only.
function restrictions(read, third) {
  const bg = read('bgrestricted.txt'), sb = read('standby.txt');
  if (!bg.trim() && !sb.trim()) return null;   // older checkups and phones that refuse both
  const ok = p => third.has(p);
  return {
    background: bg.split('\n').map(l => l.trim()).filter(l => /^[\w.]+$/.test(l) && ok(l)).sort(),
    restricted: [...sb.matchAll(/^\s*([\w.]+): (\d+)\s*$/gm)].filter(m => +m[2] === 45 && ok(m[1])).map(m => m[1]).sort(),
  };
}

function battery(bat, bs) {
  const num = re => { const m = re.exec(bat); return m ? +m[1] : null; };
  const level = num(/\n\s*level: (\d+)/), scale = num(/\n\s*scale: (\d+)/) || 100;
  const counter = num(/\n\s*Charge counter: (\d+)/);
  const temp = num(/\n\s*temperature: (-?\d+)/);
  const cap = /Capacity: (\d+), Rated: \d+, Typical: (\d+)/.exec(bs) || /Capacity: (\d+)/.exec(bs);
  const design = cap ? +(cap[2] || cap[1]) : null;
  const pct = level != null ? level / scale * 100 : null;
  // Charge counter divided by level is noisy near empty, so only trust it above 20%.
  const measured = counter && pct >= 20 ? counter / pct * 100 / 1000 : null;
  const asoc = num(/mSavedBatteryAsoc: \[(\d+)\]/);       // Samsung only
  const health = asoc ?? (measured && design ? Math.min(100, measured / design * 100) : null);
  return {
    levelPct: round(pct, 0), designMah: design, measuredFullMah: round(measured, 0),
    healthPct: round(health, 0), healthSource: asoc != null ? 'vendor' : health != null ? 'measured' : null,
    temperatureC: temp != null ? round(temp / 10) : null,
  };
}

function windowStats(bs) {
  const g = re => { const m = re.exec(bs); return m ? m[1] : null; };
  const n = re => { const v = g(re); return v == null ? null : +v; };
  const total = /Time on battery: (.+?) \([\d.]+%\) realtime, (.+?) \([\d.]+%\) uptime/.exec(bs);
  if (!total) return null;
  const off = /Time on battery screen off: (.+?) \([\d.]+%\) realtime, (.+?) \([\d.]+%\) uptime/.exec(bs);
  const onSec = dur(g(/\n\s*Screen on: (.+?) \(/));
  const realtime = dur(total[1]), uptime = dur(total[2]);
  const offSec = off ? dur(off[1]) : Math.max(0, realtime - onSec);
  const offAwake = off ? dur(off[2]) : null;
  const start = g(/Start clock time: ([\d-]+)/);
  const lo = n(/Amount discharged \(lower bound\): (\d+)/), hi = n(/Amount discharged \(upper bound\): (\d+)/);
  return {
    startedAt: start ? start.replace(/^(\d+-\d+-\d+)-(\d+)-(\d+)-(\d+).*/, '$1T$2:$3:$4') : null,
    hoursOnBattery: round(realtime / HOUR), screenOnHours: round(onSec / HOUR), screenOffHours: round(offSec / HOUR),
    dischargedPct: lo != null ? round((lo + (hi ?? lo)) / 2, 0) : null,
    dischargedScreenOnPct: n(/Amount discharged while screen on: (\d+)/),
    dischargedScreenOffPct: n(/Amount discharged while screen off: (\d+)/),
    awakeWhileOffPct: offAwake != null && offSec > 0 ? round(offAwake / offSec * 100, 0) : null,
    lightDozeHours: round(dur(g(/Idle mode light time: (.+?) \(/)) / HOUR),
    deepDozeHours: round(dur(g(/Idle mode full time: (.+?) \(/)) / HOUR),
    drainMah: n(/actual drain: ([\d.]+)/),
  };
}

function estimatedApps(bs, pk) {
  const rows = [...bs.matchAll(/\n  UID (\S+): ([\d.]+)/g)].map(m => ({ app: pk.name(m[1]), mah: round(+m[2], 0) }));
  return rows.filter(r => r.mah >= 1).sort((a, b) => b.mah - a.mah).slice(0, 12);
}

const WAKE_GROUPS = [
  ['Bluetooth', /uart|bluetooth|\bbt[_-]|hci/i], ['Mobile network', /modem|glink|qmi|rmnet|ipa\b|ipc_router|mhi/i],
  ['Wi-Fi', /wlan|wifi|wcnss|bcmdhd|cnss/i], ['Stylus', /epen|wacom|stylus/i],
  ['App timers and alarms', /timerfd|rtc|alarm/i], ['Charger or USB', /usb|charg|pmic|typec/i],
  ['Fingerprint or touch', /fingerprint|fpc|touch|goodix/i], ['Sensors', /sensor|ssc|adsp|slpi/i],
];
function wakeups(bs) {
  const sec = (bs.split('All wakeup reasons:')[1] || '').split('\n\n')[0];
  const groups = new Map();
  for (const m of sec.matchAll(/Wakeup reason (.+): (\S.*?) \((\d+) times\)/g)) {
    const label = (WAKE_GROUPS.find(([, re]) => re.test(m[1])) || ['Other'])[0];
    const g = groups.get(label) || { source: label, count: 0, minutes: 0 };
    g.count += +m[3]; g.minutes += dur(m[2]) / 60;
    groups.set(label, g);
  }
  return [...groups.values()].map(g => ({ ...g, minutes: round(g.minutes, 0) })).sort((a, b) => b.count - a.count);
}

// Walk the history: average current by screen state and foreground app, plus the level curve.
// Handles absolute timestamps (Samsung: "11-12 00:27:58.261 100 ...") and AOSP relative ones ("+1h02m03s456ms (2) 085 ...").
const SHORT_PLUG_SEC = 600;
function history(file, design) {
  if (!fs.existsSync(file)) return null;
  const acc = new Map();
  const add = (k, dt, cur) => { const a = acc.get(k) || [0, 0]; a[0] += dt; a[1] += dt * cur; acc.set(k, a); };
  const levels = [], screens = [];
  let scr = false, top = null, cur = null, last = null, plug = false, recharged = false, plugAt = null, plugLevel = null, t0 = null, lastLevel = null, scrStart = null, year = new Date().getFullYear(), samples = 0;
  // Screen-off time per hour of the day (phone clock): [seconds, mA·seconds measured, % of battery dropped, seconds with a current reading].
  // Absolute stamps are the phone clock already; relative ones count from the RESET:TIME line.
  const byHour = Array.from({ length: 24 }, () => [0, 0, 0, 0]);
  let resetClock = null, relative = false;
  const hourOf = t => { const c = relative ? (resetClock == null ? null : resetClock + t) : t; return c == null ? null : Math.floor(((c % 86400) + 86400) % 86400 / HOUR); };
  const re = /^\s+(?:(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)\.(\d+)|\+?((?:\d+(?:ms|[dhms]))+))\s+(?:\(\d+\)\s+)?(\d{3})(?:\s|$)(.*)/;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const reset = /RESET:TIME: (\d{4})-(\d\d)-(\d\d)-(\d\d)-(\d\d)-(\d\d)/.exec(line);
    if (reset) { year = +reset[1]; resetClock = Date.UTC(year, +reset[2] - 1, +reset[3], +reset[4], +reset[5], +reset[6]) / 1000; }
    const m = re.exec(line);
    if (!m) continue;
    let t = m[1] ? Date.UTC(year, +m[1] - 1, +m[2], +m[3], +m[4], +m[5], +m[6].slice(0, 3)) / 1000 : dur(m[7]);
    // The stamps carry no year: a jump back of months means the period crossed New Year.
    if (m[1] && last != null && t < last - 180 * 86400) { year++; t = Date.UTC(year, +m[1] - 1, +m[2], +m[3], +m[4], +m[5], +m[6].slice(0, 3)) / 1000; }
    if (t0 == null) { t0 = t; relative = !m[1]; }
    const dt = last != null ? t - last : 0;
    if (cur != null && !plug && dt > 0 && dt < 600) {
      add(scr ? 'on' : 'off', dt, cur);
      if (scr && top) add('app:' + top, dt, cur);
    }
    const hr = last != null ? hourOf(last) : null;
    if (hr != null && !scr && !plug && !recharged && dt > 0 && dt < 600) { byHour[hr][0] += dt; if (cur != null) { byHour[hr][1] += dt * cur; byHour[hr][3] += dt; } }
    last = t;
    const rest = m[9], level = +m[8];
    const c = /\bcurrent=(-?\d+)/.exec(rest);
    if (c) { samples++; cur = +c[1] < 0 ? -c[1] : null; }
    const p = /\bplug=(\w+)/.exec(rest);
    // The curve ends at the first recharge. Plugging in for a checkup is not one: a connection of up to
    // SHORT_PLUG_SEC that raised the level by at most 1% leaves the period going.
    if (p) {
      const now = p[1] !== 'none';
      if (now && !plug) { plugAt = t; plugLevel = lastLevel ?? level; }
      if (!now && plug && plugAt != null && levels.length > 1 && (t - plugAt > SHORT_PLUG_SEC || level - plugLevel > 1)) recharged = true;
      plug = now;
    }
    if (/(^|\s)\+screen(\s|$)/.test(rest) && !scr) { scr = true; scrStart = t; }
    if (/(^|\s)-screen(\s|$)/.test(rest) && scr) { scr = false; if (scrStart != null) screens.push([round((scrStart - t0) / HOUR, 2), round((t - t0) / HOUR, 2)]); }
    const tp = /\+top=\w+:"([^"]+)"/.exec(rest);
    if (tp) top = tp[1];
    if (level !== lastLevel && !plug && !recharged) {
      if (lastLevel != null && level < lastLevel && !scr) { const h2 = hourOf(t); if (h2 != null) byHour[h2][2] += lastLevel - level; }
      levels.push([round((t - t0) / HOUR, 2), level]); lastLevel = level;
    }
  }
  if (t0 == null) return null;
  if (scr && scrStart != null) screens.push([round((scrStart - t0) / HOUR, 2), round((last - t0) / HOUR, 2)]);
  const avg = k => { const a = acc.get(k); return a && a[0] > 600 ? { ma: round(a[1] / a[0], 0), hours: round(a[0] / HOUR) } : null; };
  const apps = [...acc].filter(([k, a]) => k.startsWith('app:') && a[0] > 120)
    .map(([k, a]) => ({ app: k.slice(4), minutes: round(a[0] / 60, 0), ma: round(a[1] / a[0], 0), mah: round(a[1] / HOUR, 0) }))
    .sort((a, b) => b.mah - a.mah).slice(0, 10);
  // Keep the level curve small: at most ~120 points.
  const step = Math.ceil(levels.length / 120);
  return {
    hasCurrent: samples > 20, screenOn: avg('on'), screenOff: avg('off'), apps,
    levels: levels.filter((_, i) => i % step === 0 || i === levels.length - 1), screenSpans: screens.filter(s => s[1] - s[0] >= 0.02),
    spanHours: round((last - t0) / HOUR), designMah: design,
    offByHour: byHour.map(([s, mas, pct, sc]) => [Math.round(s), samples > 20 ? Math.round(mas) : null, pct, Math.round(sc)]),
  };
}

function usage(us) {
  let ev = [];
  for (const m of us.matchAll(/\n\s+time="([\d\- :]+)" type=(\w+)(?: package=(\S+))?/g)) ev.push([Date.parse(m[1].replace(' ', 'T') + 'Z') / 1000, m[2], m[3]]);
  if (!ev.length) return null;
  // The dump repeats events in several buckets; keep the first contiguous run.
  const out = [];
  for (const e of ev) { if (out.length && out[out.length - 1][0] - e[0] > HOUR) break; out.push(e); }
  ev = out.sort((a, b) => a[0] - b[0]);
  const iv = []; let on = null;
  for (const [t, ty] of ev) {
    if (ty === 'SCREEN_INTERACTIVE') on = on ?? t;
    else if (ty === 'SCREEN_NON_INTERACTIVE' && on != null) { iv.push([on, t]); on = null; }
  }
  const clip = (a, b) => iv.reduce((s, [x, y]) => s + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);
  const fg = new Map(), fgs = new Map(), noti = new Map(), cur = {}, svc = {};
  for (const [t, ty, p] of ev) {
    if (ty === 'ACTIVITY_RESUMED') cur[p] = t;
    else if ((ty === 'ACTIVITY_PAUSED' || ty === 'ACTIVITY_STOPPED') && cur[p] != null) { fg.set(p, (fg.get(p) || 0) + clip(cur[p], t)); delete cur[p]; }
    else if (ty === 'FOREGROUND_SERVICE_START') svc[p] = t;
    else if (ty === 'FOREGROUND_SERVICE_STOP' && svc[p] != null) { fgs.set(p, (fgs.get(p) || 0) + t - svc[p]); delete svc[p]; }
    else if (ty === 'NOTIFICATION_INTERRUPTION') noti.set(p, (noti.get(p) || 0) + 1);
  }
  const end = ev[ev.length - 1][0];
  for (const [p, t] of Object.entries(svc)) fgs.set(p, (fgs.get(p) || 0) + end - t);   // still running
  const top = (map, key, f, min, n = 8) => [...map].map(([app, v]) => ({ app, [key]: f(v) })).filter(r => r[key] >= min).sort((a, b) => b[key] - a[key]).slice(0, n);
  return {
    hoursCovered: round((end - ev[0][0]) / HOUR),
    screenOnHours: round(iv.reduce((s, [a, b]) => s + b - a, 0) / HOUR), sessions: iv.length,
    foregroundApps: top(fg, 'minutes', v => round(v / 60, 0), 5),
    foregroundServices: top(fgs, 'hours', v => round(v / HOUR), 0.5),
    notifications: top(noti, 'count', v => v, 10),
  };
}

function alarms(al, upHours) {
  const s = al.slice(al.indexOf('  Alarm Stats:'));
  const by = new Map();
  for (const m of s.matchAll(/\n  (?:u\d+a\d+|\d+):(\S+) \+[\w.]+ running, (\d+) wakeups:/g)) by.set(m[1], (by.get(m[1]) || 0) + +m[2]);
  return [...by].map(([app, wakeups]) => ({ app, wakeups, perHour: upHours ? round(wakeups / upHours) : null }))
    .filter(r => r.wakeups >= 20).sort((a, b) => b.wakeups - a.wakeups).slice(0, 12);
}

// Bluetooth scan time per app, counted only inside the checkup period [from, to] (phone-local seconds).
function btScans(bt, year, from, to) {
  const tot = new Map();
  // The records carry no year: one that would lie well after the period belongs to the year before.
  const ts = s => { const m = /(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)/.exec(s); const at = y => Date.UTC(y, +m[1] - 1, +m[2], +m[3], +m[4], +m[5]) / 1000; return to != null && at(year) > to + 30 * 86400 ? at(year - 1) : at(year); };
  for (const m of bt.matchAll(/AppRecord\((\d\d-\d\d [\d:.]+) ~ (\d\d-\d\d [\d:.]+), id=\d+, appName=(\S+?)(?:\[|,)/g)) {
    const a = Math.max(ts(m[1]), from ?? -Infinity), b = Math.min(ts(m[2]), to ?? Infinity);
    if (b > a) tot.set(m[3], (tot.get(m[3]) || 0) + b - a);
  }
  return [...tot].map(([app, s]) => ({ app, hours: round(s / HOUR) })).filter(r => r.hours >= 0.2).sort((a, b) => b.hours - a.hours).slice(0, 8);
}

function sensors(sn, pk) {
  const out = [];
  for (const blk of sn.split('Connection Number:').slice(1)) {
    const l = /\n\s+(\S.*?) \| WakeLockRefCount \d+ \| uid (\d+)/.exec(blk);
    if (!l) continue;
    const app = pk.name(l[2]);
    if (!pk.third.has(app)) continue;
    const s = /\n\s+(.*?) 0x[0-9a-f]+ \|/.exec(blk), d = /Active Duration: (\S+)/.exec(blk);
    const [hh, mm] = d ? d[1].split(':').map(Number) : [0, 0];
    out.push({ app, sensor: s ? s[1].trim().replace(/\s+(Non-)?wakeup$/i, '') : 'unknown', activeMinutes: hh * 60 + mm });
  }
  return out;
}

function location(loc, pk) {
  const out = [];
  for (const m of loc.matchAll(/\n\s+(\d+)\/(\S+?)\/\w+ (?:\{bg\} )?Request\[(?:@\S+ )?(\w+)/g)) {
    const app = m[2].replace(/\[.*$/, '');
    if (m[3] !== 'PASSIVE' && pk.third.has(app)) out.push({ app, accuracy: m[3] });
  }
  return out;
}

export function summarize(rawDir, takenAt = new Date().toISOString()) {
  const read = f => { try { return fs.readFileSync(path.join(rawDir, f), 'utf8').replace(/\r\n/g, '\n'); } catch { return ''; } };
  const bs = read('batterystats.txt'), bat = read('battery.txt');
  const pk = packages(read);
  const upHours = safe(() => +read('uptime.txt').trim().split(/\s+/)[0] / HOUR) || null;
  const b = safe(() => battery(bat, bs)) || {};
  const w = safe(() => windowStats(bs));
  const h = safe(() => history(path.join(rawDir, 'history.txt'), b.designMah));
  const year = +takenAt.slice(0, 4);

  // Idle drain in % of a full battery per hour. Measured current when the phone records it,
  // otherwise the percentage Android attributes to screen-off time.
  let idle = null;
  if (h?.hasCurrent && h.screenOff && b.designMah) idle = { pctPerHour: round(h.screenOff.ma / b.designMah * 100, 2), ma: h.screenOff.ma, hours: h.screenOff.hours, method: 'measured current' };
  else if (w?.dischargedScreenOffPct != null && w.screenOffHours >= 1) idle = { pctPerHour: round(w.dischargedScreenOffPct / w.screenOffHours, 2), ma: null, hours: w.screenOffHours, method: 'percent while screen off' };
  let active = null;
  if (h?.hasCurrent && h.screenOn && b.designMah) active = { pctPerHour: round(h.screenOn.ma / b.designMah * 100, 1), ma: h.screenOn.ma, hours: h.screenOn.hours };
  else if (w?.dischargedScreenOnPct != null && w.screenOnHours >= 0.5) active = { pctPerHour: round(w.dischargedScreenOnPct / w.screenOnHours, 1), ma: null, hours: w.screenOnHours };

  return {
    version: 4, takenAt, device: device(read), battery: b, window: w,
    rebootedInWindow: upHours != null && w ? upHours < w.hoursOnBattery - 0.2 : null, uptimeHours: round(upHours),
    hoursPerCharge: w?.dischargedPct >= 5 ? round(w.hoursOnBattery / w.dischargedPct * 100) : null,
    idle, active,
    levels: h?.levels || [], screenSpans: h?.screenSpans || [], offByHour: h?.offByHour || null,
    screenApps: h?.apps?.length ? h.apps : null,
    estimatedApps: safe(() => estimatedApps(bs, pk)) || [],
    wakeups: safe(() => wakeups(bs)) || [],
    usage: safe(() => usage(read('usagestats.txt'))),
    alarms: safe(() => alarms(read('alarm.txt'), upHours)) || [],
    btScans: safe(() => { const from = w?.startedAt ? Date.parse(w.startedAt + 'Z') / 1000 : null; return btScans(read('bt.txt'), year, from, from != null ? from + w.hoursOnBattery * HOUR : null); }) || [],
    sensors: safe(() => sensors(read('sensor.txt'), pk)) || [],
    location: safe(() => location(read('loc.txt'), pk)) || [],
    settings: settings(read),
    restrictions: safe(() => restrictions(read, pk.third)),
    thirdPartyApps: [...pk.third].sort(),
  };
}
