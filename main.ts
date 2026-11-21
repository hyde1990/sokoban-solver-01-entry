// Push-optimal Sokoban solver for make.fun's sokoban-solver-01-run-20261121.
// Run: MAKEFUN_INPUT_DIR=<input> MAKEFUN_OUTPUT_DIR=<output> node main.ts
// Node 22, stdlib only, erasable TypeScript (no enums, no parameter
// properties). Reads <id>/level.txt for every input subdirectory, writes
// <id>/solution.txt (moves + trailing newline) for each.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const INPUT_DIR: string = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR: string = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The moves for a level in XSB: a string of u, d, l and r (an upper letter marks a push; case is not checked). */
export function solve(_level: string): string {
  return '';
}

function run(inputDir: string, outputDir: string): void {
  const ids = readdirSync(inputDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const id of ids) {
    const level = readFileSync(join(inputDir, id, 'level.txt'), 'utf8');
    const moves = solve(level);
    mkdirSync(join(outputDir, id), { recursive: true });
    writeFileSync(join(outputDir, id, 'solution.txt'), `${moves}\n`);
  }
}

// The IO loop runs only when this file is executed directly, so tests can
// import solve() without side effects.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run(INPUT_DIR, OUTPUT_DIR);
}
