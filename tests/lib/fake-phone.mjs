// Synthetic dumps for tests. Nothing here comes from a real phone.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const pad = n => String(n).padStart(2, '0');

// style: 'samsung' (absolute timestamps, current= samples) or 'aosp' (relative timestamps, no current)
export function fakeDumps({ style = 'samsung', idleMa = 150, activeMa = 500, hours = 10, screenOnHours = 4, start = '2026-11-03-08-00-00', bleScan = '1', background = [], restricted = [] } = {}) {
  const offHours = hours - screenOnHours;
  const hist = ['Battery History [Format: 2] (1% used):'];
  const stamp = sec => style === 'samsung'
    ? `11-03 ${pad(8 + Math.floor(sec / 3600))}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}.000`
    : `+${Math.floor(sec / 3600)}h${Math.floor(sec / 60) % 60}m${sec % 60}s000ms (2)`;
  if (style === 'samsung') hist.push('  11-03 08:00:00.000 RESET:TIME: 2026-11-03-08-00-00-000');
  else hist.push('                    0 (15) RESET:TIME: 2026-11-03-08-00-00');
  let level = 100;
  const total = hours * 3600, offEnd = offHours * 3600;
  for (let t = 0; t <= total; t += 300) {
    const on = t >= offEnd;
    level = Math.max(1, Math.round(100 - (Math.min(t, offEnd) / 3600 * idleMa + Math.max(0, t - offEnd) / 3600 * activeMa) / 5000 * 100));
    const bits = [];
    if (t === 0) bits.push('status=discharging health=good plug=none temp=300 volt=4300');
    if (style === 'samsung') bits.push(`current=-${on ? activeMa : idleMa}`);
    if (t === offEnd) bits.push('+screen +top=u0a201:"com.example.video"');
    hist.push(`  ${stamp(t)} ${String(level).padStart(3, '0')} ${bits.join(' ')}`.trimEnd());
  }
  const used = 100 - level, usedOff = Math.round(offHours * idleMa / 5000 * 100);
  const d = h => `${Math.floor(h)}h ${Math.round(h % 1 * 60)}m 0s 0ms`;
  const bs = `Statistics since last charge:
  System starts: 0, currently on battery: true
  Time on battery: ${d(hours)} (100.0%) realtime, ${d(screenOnHours + offHours * 0.3)} (50.0%) uptime
  Time on battery screen off: ${d(offHours)} (60.0%) realtime, ${d(offHours * 0.3)} (18.0%) uptime
  Start clock time: ${start}
  Screen on: ${d(screenOnHours)} (40.0%) 12x, Interactive: ${d(screenOnHours)} (40.0%)
  Idle mode light time: ${d(offHours * 0.5)} (30.0%) 20x -- longest 30m 0s 0ms
  Idle mode full time: 0ms (0.0%) 0x -- longest 0ms
    Amount discharged (lower bound): ${used}
    Amount discharged (upper bound): ${used}
    Amount discharged while screen on: ${used - usedOff}
    Amount discharged while screen off: ${usedOff}
  Estimated power use (mAh):
    Capacity: 5000, Rated: 4855, Typical: 5000, Computed drain: ${used * 50}, actual drain: ${used * 50}
    Global
    screen: 900 apps: 900
  UID u0a201: 800 fg: 700 (4h 0m 0s 0ms)
  UID 1000: 200 bg: 200
  UID u0a202: 90 bg: 90

  All wakeup reasons:
  Wakeup reason 265 hs_uart_wakeup: 20m 0s 0ms (900 times) realtime
  Wakeup reason Abort: Pending Wakeup Sources: [timerfd]: 10m 0s 0ms (400 times) realtime
  Wakeup reason -1 IRQ 431, glink-native-modem: 1m 0s 0ms (50 times) realtime

`;
  const ev = (h, m, type, pkg) => `    time="2026-11-03 ${pad(h)}:${pad(m)}:00" type=${type}${pkg ? ` package=${pkg}` : ''}`;
  const usage = ['user=0', '  In-memory daily stats', '  events',
    ev(8, 0, 'FOREGROUND_SERVICE_START', 'com.example.tracker'),
    ...Array.from({ length: 120 }, (_, i) => ev(8 + Math.floor(i / 12), (i % 12) * 5, 'NOTIFICATION_INTERRUPTION', 'com.example.chat')),
    ev(14, 0, 'SCREEN_INTERACTIVE'), ev(14, 0, 'ACTIVITY_RESUMED', 'com.example.video'),
    ev(18, 0, 'ACTIVITY_PAUSED', 'com.example.video'), ev(18, 0, 'SCREEN_NON_INTERACTIVE'),
    ev(18, 0, 'FOREGROUND_SERVICE_STOP', 'com.example.tracker')].join('\n');
  return {
    'battery.txt': `Current Battery Service state:\n  AC powered: false\n  Charge counter: ${Math.round(4600 * level * 10)}\n  level: ${level}\n  scale: 100\n  temperature: 301\n${style === 'samsung' ? '  mSavedBatteryAsoc: [91]\n' : ''}`,
    'batterystats.txt': bs,
    'history.txt': hist.join('\n') + '\n',
    'usagestats.txt': usage + '\n',
    'alarm.txt': 'Current Alarm Manager state:\n  Alarm Stats:\n  u0a202:com.example.tracker +4m0s0ms running, 900 wakeups:\n    +4m0s0ms 900 wakes 900 alarms\n  1000:android +1m0s0ms running, 300 wakeups:\n',
    'sensor.txt': 'Sensor List:\nConnection Number: 0 \n\tOperating Mode: NORMAL\n \n\t com.example.tracker.Listener | WakeLockRefCount 0 | uid 10202 | cache size 0 | max cache size 0 | has sensor access: true\n\t accel Accelerometer Non-wakeup 0x0000000b | first flush pending: false | pending flush events 0 \n\t\tSession Start: 08:00:00 | Active Duration: 09:30:00 | Suspended Duration: 00:00:00\n',
    'bt.txt': 'Bluetooth Status\n  Uptime:        30h 0m 0s\n         AppRecord(11-03 08:00:00.000 ~ 11-03 17:00:00.000, id=5, appName=com.example.tracker, LE, reason=REASON_UNREGISTER_CLIENT)\n',
    'loc.txt': 'Location Manager State:\n        10202/com.example.tracker/AB12CD34 Request[HIGH_ACCURACY, minUpdateInterval=0]\n        10233/com.google.android.gms/90F1A84E Request[PASSIVE, minUpdateInterval=0]\n',
    'packages.txt': 'package:com.example.video uid:10201\npackage:com.example.tracker uid:10202\npackage:com.example.chat uid:10203\npackage:com.google.android.gms uid:10233\n',
    'packages3.txt': 'package:com.example.video\npackage:com.example.tracker\npackage:com.example.chat\n',
    'uptime.txt': '108000.00 90000.00\n',
    'props.txt': `ro.product.manufacturer=${style === 'samsung' ? 'samsung' : 'Google'}\nro.product.brand=${style === 'samsung' ? 'samsung' : 'google'}\nro.product.model=${style === 'samsung' ? 'SM-TEST' : 'Pixel Test'}\nro.build.version.release=16\nro.build.version.sdk=36\n`,
    'settings.txt': `global ble_scan_always_enabled=${bleScan}\nglobal wifi_scan_always_enabled=0\nsecure doze_always_on=null\nglobal low_power=0\n`,
    'bgrestricted.txt': background.length ? background.join('\n') + '\n' : 'No operations.\n',
    'standby.txt': ['com.example.video', 'com.example.tracker', 'com.example.chat', 'com.google.android.gms'].map(p => `${p}: ${restricted.includes(p) ? 45 : 10}`).join('\n') + '\n',
  };
}

export function tmpDir(prefix = 'battery-doctor-test-') { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

export function writeDumps(dir, dumps) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(dumps)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}
