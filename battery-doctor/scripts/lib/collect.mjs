// Pull the raw dumps for one checkup into <dir>/raw. Read-only on the phone.
import fs from 'node:fs';
import path from 'node:path';
import { shellToFile } from './adb.mjs';

// --user 0: phones with a work profile or Secure Folder refuse a listing across all users.
export const DUMPS = {
  'battery.txt': 'dumpsys battery',
  'batterystats.txt': 'dumpsys batterystats --charged',
  'history.txt': 'dumpsys batterystats --history',
  'usagestats.txt': 'dumpsys usagestats',
  'alarm.txt': 'dumpsys alarm',
  'sensor.txt': 'dumpsys sensorservice',
  'bt.txt': 'dumpsys bluetooth_manager',
  'loc.txt': 'dumpsys location',
  'packages.txt': 'pm list packages -U --user 0',
  'packages3.txt': 'pm list packages -3 --user 0',
  'uptime.txt': 'cat /proc/uptime',
  'props.txt': 'for p in ro.product.manufacturer ro.product.brand ro.product.model ro.build.version.release ro.build.version.sdk; do echo "$p=$(getprop $p)"; done',
  'settings.txt': 'for k in "global ble_scan_always_enabled" "global wifi_scan_always_enabled" "secure doze_always_on" "global low_power"; do echo "$k=$(settings get $k)"; done',
};

export async function collect(bin, serial, dir, log = () => {}) {
  const raw = path.join(dir, 'raw');
  fs.mkdirSync(raw, { recursive: true });
  for (const [file, cmd] of Object.entries(DUMPS)) {
    log(`reading ${file.replace('.txt', '')}`);
    await shellToFile(bin, serial, cmd, path.join(raw, file));
  }
  return raw;
}
