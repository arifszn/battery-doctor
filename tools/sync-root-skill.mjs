#!/usr/bin/env node
// Regenerate the root SKILL.md from battery-doctor/SKILL.md (adds the battery-doctor/ path prefix).
// Use --check to fail when the root copy is stale (CI).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = fs.readFileSync(path.join(root, 'battery-doctor', 'SKILL.md'), 'utf8')
  .replace(/`references\//g, '`battery-doctor/references/')
  .replace(/<skill-dir>\/scripts\//g, '<skill-dir>/battery-doctor/scripts/');
const target = path.join(root, 'SKILL.md');
if (process.argv.includes('--check')) {
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== out) { console.error('SKILL.md is stale: run node tools/sync-root-skill.mjs'); process.exit(1); }
} else fs.writeFileSync(target, out);
