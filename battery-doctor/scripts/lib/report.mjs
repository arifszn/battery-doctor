// Build one self-contained report.html for a phone from all its saved checkups.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluate, quality, screenTime, LIMITS } from './rules.mjs';
import { summarize } from './parse.mjs';
import { readLog } from './fixes.mjs';
import { readPlan } from './plan.mjs';
import { sameHours } from './compare.mjs';

export const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');
const json = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

export function loadCheckups(dir) {
  const root = path.join(dir, 'checkups');
  if (!fs.existsSync(root)) return [];
  const all = fs.readdirSync(root).sort().map(id => {
    let summary = json(path.join(root, id, 'summary.json'));
    // A checkup saved by an older version is read again from its raw dumps, for the figures added since.
    if (summary && (summary.version ?? 1) < 6 && fs.existsSync(path.join(root, id, 'raw', 'history.txt'))) {
      try { summary = summarize(path.join(root, id, 'raw'), summary.takenAt); fs.writeFileSync(path.join(root, id, 'summary.json'), JSON.stringify(summary, null, 2)); } catch { /* keep the saved one */ }
    }
    return summary && { id, summary, findings: json(path.join(root, id, 'findings.json')) };
  }).filter(Boolean);
  // Checkups taken in the same charge period measure the same thing: the latest one stands for the period.
  return all.filter((c, i) => { const st = c.summary.window?.startedAt; return !st || !all.slice(i + 1).some(x => x.summary.window?.startedAt === st); });
}

export function reportData(dir) {
  const checkups = loadCheckups(dir).map(({ id, summary, findings }) => {
    const { thirdPartyApps, ...rest } = summary;
    return { id, ...rest, flags: evaluate(summary), quality: quality(summary), screenTime: screenTime(summary), findings: findings || {} };
  });
  if (!checkups.length) throw new Error('No checkups saved yet. Run "node doctor.mjs check" first.');
  // idle drain against the checkup before, over the hours of the day both cover
  checkups.forEach((c, i) => { c.sameHours = i ? sameHours(checkups[i - 1], c) : null; });
  return { generatedAt: new Date().toISOString(), limits: LIMITS, checkups, changes: readLog(dir), plan: readPlan(dir) };
}

export function buildReport(dir) {
  const data = JSON.stringify(reportData(dir)).replace(/</g, '\\u003c');
  const html = fs.readFileSync(path.join(ASSETS, 'report-template.html'), 'utf8')
    .replace('"__REPORT_DATA__"', () => data);
  const out = path.join(dir, 'report.html');
  fs.writeFileSync(out, html);
  return out;
}

export function openInBrowser(file) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [file]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', file]] : ['xdg-open', [file]];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref(); } catch { /* the path is printed anyway */ }
}
