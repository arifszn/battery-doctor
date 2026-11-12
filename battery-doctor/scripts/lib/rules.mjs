// Fixed thresholds that decide what counts as a problem. The agent explains and ranks; it does not decide.
// The thresholds are heuristics from field use, documented in references/reading-results.md.

export const LIMITS = {
  minHours: 4, minDischargedPct: 15,          // below this a checkup is too short to judge
  minScreenHours: 1,                          // screen-on time below this is too little to scale up to a full charge
  minIdleHours: 6,                            // screen-off time below this gives only a rough idle figure
  idleOk: 1.0, idleHigh: 2.0,                 // % of a full battery per hour with the screen off
  awakeWhileOffPct: 20,                       // share of screen-off time the phone was not asleep
  wakeupsPerIdleHour: 60, wakeAwakeShare: 0.05, // per hardware source: count per idle hour, or share of idle time spent awake
  alarmWakeupsPerHour: 20,                    // per third-party app
  btScanHours: 2, btScanShare: 0.5,           // an app scanning Bluetooth this long, and this share of the checkup period
  sensorMinutes: 30,                          // an installed app holding a sensor this long without a break
  fgServiceHours: 6,                          // per 24 h
  notifications: 100,                         // per 24 h
  screenAppShare: 0.25, screenShare: 0.7,
  healthLow: 80, hotC: 40,
};

const restrict = app => ({ id: `restrict-background:${app}`, kind: 'auto', action: 'restrict-background', target: app,
  title: `Stop ${app} from running in the background`, tradeoff: 'Its notifications and background sync can be delayed or stop until you open the app.' });
const stop = app => ({ id: `force-stop:${app}`, kind: 'auto', action: 'force-stop', target: app,
  title: `Close ${app} now`, tradeoff: 'It stays closed only until it is opened or restarts itself.' });
const setting = (key, title, tradeoff) => ({ id: `setting:${key}`, kind: 'auto', action: 'setting', target: key, title, tradeoff });
const manual = (id, title, tradeoff, steps) => ({ id, kind: 'manual', title, tradeoff, steps });

// Every fix once, numbered F1, F2, ... The report and the command line both use this order.
export function fixList(flags, findings) {
  const out = [], seen = new Set();
  for (const f of flags) for (const x of f.fixes) { if (!seen.has(x.id)) { seen.add(x.id); out.push({ ...x, n: out.length + 1 }); } }
  for (const x of findings?.manual || []) out.push({ id: `manual:${x.title}`, kind: 'manual', title: x.title, tradeoff: x.tradeoff, steps: x.steps, n: out.length + 1 });
  return out;
}

// Hours of screen time a full charge gives, scaled from what this checkup's period delivered.
export function screenTime(s) {
  const w = s.window;
  if (!w || (w.dischargedPct ?? 0) < LIMITS.minDischargedPct || (w.screenOnHours ?? 0) < LIMITS.minScreenHours) return null;
  return Math.round(w.screenOnHours / w.dischargedPct * 1000) / 10;
}

export function quality(s) {
  const reasons = [];
  const w = s.window;
  if (!w) reasons.push('The phone did not report battery statistics in a format this tool understands.');
  else {
    if (w.hoursOnBattery < LIMITS.minHours || (w.dischargedPct ?? 0) < LIMITS.minDischargedPct)
      reasons.push(`Only ${w.hoursOnBattery} h and ${w.dischargedPct ?? 0}% of battery used in this checkup. Use the phone unplugged for most of a day, then check again before charging.`);
    if (s.rebootedInWindow) reasons.push('The phone restarted during this period, so wakeup and scan counters are incomplete.');
  }
  return { ok: reasons.length === 0, reasons };
}

export function evaluate(s) {
  const flags = [], w = s.window || {}, third = new Set(s.thirdPartyApps || []);
  const isThird = app => third.size === 0 || third.has(app);
  const add = (id, severity, title, detail, evidence, fixes = []) => flags.push({ id, severity, title, detail, evidence, fixes });

  if (s.idle && s.idle.pctPerHour > LIMITS.idleOk) {
    const high = s.idle.pctPerHour > LIMITS.idleHigh;
    add('idle-drain', high ? 'high' : 'medium', 'The phone drains too fast while the screen is off',
      `It loses about ${s.idle.pctPerHour}% per hour doing nothing. A healthy phone loses under ${LIMITS.idleOk}%.`,
      { pctPerHour: s.idle.pctPerHour, ma: s.idle.ma, hours: s.idle.hours, method: s.idle.method });
  }
  if (w.screenOffHours >= 4 && w.deepDozeHours === 0)
    add('no-deep-sleep', 'medium', 'The phone never reached deep sleep',
      `In ${w.screenOffHours} h with the screen off it never entered deep sleep, so something kept it busy.`,
      { screenOffHours: w.screenOffHours, lightDozeHours: w.lightDozeHours });
  if (w.awakeWhileOffPct >= LIMITS.awakeWhileOffPct)
    add('awake-while-off', 'medium', 'The phone stays awake with the screen off',
      `It was awake ${w.awakeWhileOffPct}% of the time the screen was off.`, { awakeWhileOffPct: w.awakeWhileOffPct });

  const quiet = ['Other', 'Charger or USB', 'App timers and alarms'];   // timers are judged per app below
  const noisy = (s.wakeups || []).filter(g => !quiet.includes(g.source) && w.screenOffHours > 0
    && (g.count / w.screenOffHours > LIMITS.wakeupsPerIdleHour || g.minutes / 60 / w.screenOffHours > LIMITS.wakeAwakeShare));
  if (noisy.length)
    add('frequent-wakeups', 'medium', `Woken often by: ${noisy.map(g => g.source.toLowerCase()).join(', ')}`,
      noisy.map(g => `${g.source}: ${g.count} wakeups, about ${Math.round(g.count / w.screenOffHours)} per idle hour, ${g.minutes} min awake.`).join(' '),
      { sources: noisy },
      noisy.some(g => g.source === 'Bluetooth') ? [manual('review-bluetooth-devices', 'Disconnect Bluetooth devices and companion apps you do not need all day', 'Watches, earbuds and trackers lose their live connection.',
        ['Open Settings, then Connected devices (Connections on Samsung)', 'Tap Bluetooth', 'Tap a device you do not need all day, then Disconnect'])] : []);

  for (const a of s.alarms || []) if (isThird(a.app) && third.size && a.perHour > LIMITS.alarmWakeupsPerHour)
    add(`app-wakeups:${a.app}`, 'medium', `${a.app} wakes the phone very often`,
      `${a.wakeups} wakeups since the last restart, about ${a.perHour} per hour.`, a, [restrict(a.app)]);

  const btOn = s.settings?.ble_scan_always_enabled === '1';
  for (const b of s.btScans || []) if (b.hours >= LIMITS.btScanHours && (!w.hoursOnBattery || b.hours / w.hoursOnBattery >= LIMITS.btScanShare))
    add(`bt-scan:${b.app}`, 'medium', `${b.app} scans for Bluetooth devices for hours`,
      `It scanned for ${b.hours} h of the ${w.hoursOnBattery} h in this checkup.`, b, third.has(b.app) ? [restrict(b.app), stop(b.app)] : []);

  for (const f of s.usage?.foregroundServices || []) if (third.has(f.app) && f.hours >= LIMITS.fgServiceHours)
    add(`always-running:${f.app}`, 'medium', `${f.app} runs all day`,
      `It kept a background service running for ${f.hours} h in the last 24 h.`, f, [restrict(f.app), stop(f.app)]);

  for (const x of s.sensors || []) if (x.activeMinutes >= LIMITS.sensorMinutes)
    add(`sensor:${x.app}`, 'medium', `${x.app} keeps a sensor running`, `${x.sensor}, active for ${Math.round(x.activeMinutes / 60 * 10) / 10} h without a break.`, x, [restrict(x.app)]);

  for (const l of s.location || [])
    add(`location:${l.app}`, l.accuracy === 'HIGH_ACCURACY' ? 'medium' : 'info', `${l.app} is tracking location`,
      `Active request with ${l.accuracy.toLowerCase().replace('_', ' ')}.`, l,
      [manual(`location-permission:${l.app}`, `Set location for ${l.app} to "Only while using the app"`, 'Features that need location in the background stop working.',
        ['Open Settings, then Apps', `Tap ${l.app}, then Permissions, then Location`, 'Choose "Allow only while using the app"'])]);

  for (const n of s.usage?.notifications || []) if (n.count >= LIMITS.notifications)
    add(`notifications:${n.app}`, 'info', `${n.app} sent ${n.count} notifications in a day`,
      'Each one can wake the phone and light the screen.', n,
      [manual(`notifications:${n.app}`, `Turn off notification categories you do not need in ${n.app}`, 'You will miss those alerts.',
        ['Open Settings, then Notifications', `Tap ${n.app}`, 'Turn off the categories you do not need'])]);

  const topApp = (s.screenApps || [])[0];
  if (topApp && w.drainMah && topApp.mah / w.drainMah >= LIMITS.screenAppShare)
    add(`heavy-app:${topApp.app}`, 'info', `${topApp.app} used the most battery`,
      `${topApp.minutes} min on screen used about ${Math.round(topApp.mah / w.drainMah * 100)}% of the battery drained.`, topApp);
  if (w.dischargedPct && w.dischargedScreenOnPct / w.dischargedPct >= LIMITS.screenShare)
    add('screen-time', 'info', 'Most of the drain is screen time',
      `${w.dischargedScreenOnPct} of ${w.dischargedPct} percentage points went while the screen was on (${w.screenOnHours} h). Background fixes help less here than brightness, dark mode and shorter sessions.`,
      { screenOnHours: w.screenOnHours });

  const b = s.battery || {};
  if (b.healthPct != null && b.healthPct < LIMITS.healthLow)
    add('battery-worn', 'high', 'The battery itself is worn', `It holds about ${b.healthPct}% of its original capacity. Settings cannot fix this; a replacement can.`, { healthPct: b.healthPct });
  if (b.temperatureC >= LIMITS.hotC)
    add('hot', 'medium', 'The battery is hot', `${b.temperatureC} °C at the time of the checkup. Heat wears a battery faster.`, { temperatureC: b.temperatureC });

  if (btOn) add('setting:ble_scan_always_enabled', 'info', 'Bluetooth scanning is allowed even when Bluetooth is off', 'Apps can scan for nearby devices at any time.', {},
    [setting('ble_scan_always_enabled', 'Turn off background Bluetooth scanning', 'Location accuracy indoors can drop slightly.')]);
  if (s.settings?.wifi_scan_always_enabled === '1') add('setting:wifi_scan_always_enabled', 'info', 'Wi-Fi scanning is allowed even when Wi-Fi is off', 'Apps can scan for networks at any time.', {},
    [setting('wifi_scan_always_enabled', 'Turn off background Wi-Fi scanning', 'Location accuracy indoors can drop slightly.')]);
  if (s.settings?.doze_always_on === '1') add('setting:doze_always_on', 'info', 'Always-on display is on', 'The screen stays partly lit all day.', {},
    [setting('doze_always_on', 'Turn off always-on display', 'The clock and notifications no longer show on the locked screen.')]);

  const order = { high: 0, medium: 1, info: 2 };
  return flags.sort((a, b) => order[a.severity] - order[b.severity]);
}
