// Comparing two checkups fairly, and finding what changed on the phone between them.

const MIN_HOUR_SEC = 1200;   // an hour of the day counts when both checkups have 20 min of screen-off time in it
const MIN_SHARED_H = 3;      // and the shared hours add up to 3 h of screen-off time in each

// Hours as readable ranges: [11,12,13,19] -> "11:00-14:00, 19:00-20:00"
export const hourRanges = hours => {
  const out = [];
  for (const h of hours) { const r = out[out.length - 1]; if (r && r[1] === h) r[1] = h + 1; else out.push([h, h + 1]); }
  const hh = h => `${String(h % 24).padStart(2, '0')}:00`;
  return out.map(([a, b]) => `${hh(a)}-${hh(b)}`).join(', ');
};

// Screen-off drain over the hours of the day both checkups cover, so a night in one does not flatter it.
export function sameHours(a, b) {
  const A = a?.offByHour, B = b?.offByHour;
  if (!A || !B) return null;
  const hours = [...Array(24).keys()].filter(h => A[h][0] >= MIN_HOUR_SEC && B[h][0] >= MIN_HOUR_SEC);
  const sum = (X, k) => hours.reduce((s, h) => s + (X[h][k] || 0), 0);
  const offA = sum(A, 0) / 3600, offB = sum(B, 0) / 3600;
  if (offA < MIN_SHARED_H || offB < MIN_SHARED_H) return null;
  const measured = hours.every(h => A[h][1] != null && B[h][1] != null) && a.battery?.designMah && b.battery?.designMah;
  const rate = (X, s, off) => measured ? sum(X, 1) / (sum(X, 3) || sum(X, 0)) / s.battery.designMah * 100 : sum(X, 2) / off;
  const r1 = n => Math.round(n * 10) / 10;
  return { hours, label: hourRanges(hours), before: r1(rate(A, a, offA)), after: r1(rate(B, b, offB)), offBefore: r1(offA), offAfter: r1(offB), method: measured ? 'measured current' : 'percent while screen off' };
}

const SETTING_NAMES = {
  ble_scan_always_enabled: 'Background Bluetooth scanning',
  wifi_scan_always_enabled: 'Background Wi-Fi scanning',
  doze_always_on: 'Always-on display',
};
const onOff = v => (v === '1' ? 'on' : v === '0' ? 'off' : 'set to the phone default');

// What changed on the phone between two checkups that this tool's own log does not explain.
// Each item: { key, target, text } where key identifies the change for the log.
export function phoneChanges(prev, cur, log, app = p => p) {
  if (!prev || !cur) return [];
  const from = prev.takenAt, to = cur.takenAt;
  // a change this tool made or undid between the two checkups explains a difference on the same target
  const touched = new Set(log.filter(e => (e.at > from && e.at <= to) || (e.undoneAt && e.undoneAt > from && e.undoneAt <= to)).map(e => e.target));
  const out = [];
  for (const [k, name] of Object.entries(SETTING_NAMES)) {
    const a = prev.settings?.[k] ?? null, b = cur.settings?.[k] ?? null;
    if (!prev.settings || !cur.settings || a === b || touched.has(k)) continue;
    out.push({ key: `setting:${k}:${b}`, target: k, text: `${name} was turned ${onOff(b)}` });
  }
  const P = prev.restrictions, C = cur.restrictions;
  if (P && C) {
    const diff = (x, y) => x.filter(p => !y.includes(p));
    for (const p of diff(C.background, P.background)) if (!touched.has(p)) out.push({ key: `background:${p}:on`, target: p, text: `${app(p)} was stopped from running in the background` });
    for (const p of diff(P.background, C.background)) if (!touched.has(p)) out.push({ key: `background:${p}:off`, target: p, text: `${app(p)} was allowed to run in the background again` });
    // Android moves rarely used apps in and out of the restricted group by itself: only apps that show up in the battery figures count
    const seen = new Set([prev, cur].flatMap(s => [...(s.screenApps || []), ...(s.estimatedApps || []), ...(s.alarms || []), ...(s.btScans || []), ...(s.usage?.foregroundServices || []), ...(s.sensors || []), ...(s.location || [])].map(x => x.app)));
    for (const p of diff(C.restricted, P.restricted).filter(p => seen.has(p))) out.push({ key: `restricted:${p}:on`, target: p, text: `${app(p)} was put in deep sleep, or restricted by Android as rarely used` });
    for (const p of diff(P.restricted, C.restricted).filter(p => seen.has(p))) out.push({ key: `restricted:${p}:off`, target: p, text: `${app(p)} was taken out of deep sleep or the restricted group` });
  }
  return out;
}
