#!/usr/bin/env node
// PostToolUse hook (Edit|Write|MultiEdit): format and lint ONLY the file that was just edited.
// Fast by design — the full typecheck runs once in the Stop hook instead.
// Exit 2 sends remaining lint errors back to Claude so it fixes them; anything else is silent.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const FORMAT = /\.(ts|mts|js|mjs|astro|vue|css|json|md)$/;
const LINT = /\.(ts|mts|js|mjs|astro|vue)$/;

let input;
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}

const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const file = input?.tool_input?.file_path;
if (!file || !existsSync(file)) process.exit(0);

const rel = path.relative(root, file);
// Only files inside the project, and never generated or vendored ones.
if (rel.startsWith('..') || /^(node_modules|dist|\.astro|qa-artifacts)\//.test(rel))
  process.exit(0);

const bin = (name) => path.join(root, 'node_modules', '.bin', name);
const run = (cmd, args) =>
  execFileSync(bin(cmd), args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

if (FORMAT.test(file)) {
  try {
    run('prettier', ['--write', '--ignore-unknown', file]);
  } catch {
    // A file Prettier cannot parse will fail lint or typecheck with a clearer message.
  }
}

if (LINT.test(file)) {
  try {
    run('eslint', ['--fix', '--no-warn-ignored', file]);
  } catch (err) {
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim();
    process.stderr.write(`ESLint errors remain in ${rel}:\n${out}\n`);
    process.exit(2);
  }
}
process.exit(0);
