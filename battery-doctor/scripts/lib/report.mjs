// Build one self-contained report.html for a phone from all its saved checkups.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluate, quality, LIMITS } from './rules.mjs';
import { readLog } from './fixes.mjs';

export const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');
const json = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

export function loadCheckups(dir) {
  const root = path.join(dir, 'checkups');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).sort().map(id => {
    const summary = json(path.join(root, id, 'summary.json'));
    return summary && { id, summary, findings: json(path.join(root, id, 'findings.json')) };
  }).filter(Boolean);
}

export function reportData(dir) {
  const checkups = loadCheckups(dir).map(({ id, summary, findings }) => {
    const { thirdPartyApps, ...rest } = summary;
    return { id, ...rest, flags: evaluate(summary), quality: quality(summary), findings: findings || {} };
  });
  if (!checkups.length) throw new Error('No checkups saved yet. Run "node doctor.mjs check" first.');
  return { generatedAt: new Date().toISOString(), limits: LIMITS, checkups, changes: readLog(dir) };
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
