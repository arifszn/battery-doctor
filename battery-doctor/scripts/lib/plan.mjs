// The plan for one phone: what the next checkup tests, when to take it, and what is still open.
// The assistant writes plan.json in the phone's folder; the script only reads it.
import fs from 'node:fs';
import path from 'node:path';

export const planFile = dir => path.join(dir, 'plan.json');

const text = (v, max = 300) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max) : '') || null;
const list = (v, f) => (Array.isArray(v) ? v.map(f).filter(Boolean).slice(0, 8) : []);

// null when there is no plan or it holds nothing usable; a broken file never stops a checkup.
export function readPlan(dir) {
  let raw, updatedAt;
  try { raw = JSON.parse(fs.readFileSync(planFile(dir), 'utf8')); updatedAt = fs.statSync(planFile(dir)).mtime.toISOString(); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const nc = raw.nextCheckup && typeof raw.nextCheckup === 'object' ? { after: text(raw.nextCheckup.after, 40), how: text(raw.nextCheckup.how) } : null;
  const plan = {
    testing: text(raw.testing),
    nextCheckup: nc && (nc.after || nc.how) ? nc : null,
    decide: list(raw.decide, x => text(x)),
    investigate: list(raw.investigate, x => text(x)),
    notDoing: list(raw.notDoing, x => (x && typeof x === 'object' && text(x.what) ? { what: text(x.what), why: text(x.why), fixes: list(x.fixes, v => text(v, 160)) } : null)),
  };
  if (!plan.testing && !plan.nextCheckup && !plan.decide.length && !plan.investigate.length && !plan.notDoing.length) return null;
  return { ...plan, updatedAt };
}

// The plan as plain lines for the script's output.
export function planLines(plan) {
  const out = [];
  if (plan.testing) out.push(`- Testing: ${plan.testing}`);
  if (plan.nextCheckup) out.push(`- Next checkup: ${[plan.nextCheckup.after && `after ${plan.nextCheckup.after}`, plan.nextCheckup.how].filter(Boolean).join('. ')}`);
  for (const d of plan.decide) out.push(`- To decide: ${d}`);
  for (const d of plan.investigate) out.push(`- To look into: ${d}`);
  for (const d of plan.notDoing) out.push(`- Not doing: ${d.what}${d.why ? ` (${d.why})` : ''}`);
  out.push(`- Plan written: ${plan.updatedAt.slice(0, 16).replace('T', ' ')} UTC`);
  return out;
}
