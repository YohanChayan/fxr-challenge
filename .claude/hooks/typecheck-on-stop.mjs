#!/usr/bin/env node
// Stop hook: run the full typecheck (astro check + vue-tsc) once, when Claude finishes a turn.
// Too slow for every edit, so it lives here. On failure, exit 2 keeps Claude working on the
// errors. `stop_hook_active` means Claude is already continuing because of this hook — skip
// to avoid an endless loop.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  // No input: still run the check.
}
if (input.stop_hook_active) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
try {
  execSync('npm run --silent typecheck', { cwd: root, encoding: 'utf8', stdio: 'pipe' });
} catch (err) {
  const out = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim().split('\n').slice(-40).join('\n');
  process.stderr.write(`Typecheck failed (npm run typecheck). Fix before finishing:\n${out}\n`);
  process.exit(2);
}
process.exit(0);
