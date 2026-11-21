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

/** A parsed board. Squares are indexes y * width + x; wall/goal are 1 where set. */
export interface Board {
  width: number;
  height: number;
  wall: Uint8Array;
  goal: Uint8Array;
  boxes: number[];
  player: number;
}

/** Step order for walks and searches: up, down, left, right. */
const DIRS: readonly { ch: string; dx: number; dy: number }[] = [
  { ch: 'u', dx: 0, dy: -1 },
  { ch: 'd', dx: 0, dy: 1 },
  { ch: 'l', dx: -1, dy: 0 },
  { ch: 'r', dx: 1, dy: 0 },
];

/** Parse XSB text into a board. Width is the longest row; short rows and
 *  the outer frame count as walls. Unknown characters are open floor. */
export function parseBoard(level: string): Board {
  const rows = level.replace(/\r/g, '').split('\n');
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
  const width = rows.reduce((m, row) => Math.max(m, row.length), 0);
  const height = rows.length;
  const wall = new Uint8Array(width * height).fill(1);
  const goal = new Uint8Array(width * height);
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const sq = y * width + x;
      if (ch === '#') continue;
      wall[sq] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goal[sq] = 1;
      if (ch === '$' || ch === '*') boxes.push(sq);
      if (ch === '@' || ch === '+') player = sq;
    }
  });
  boxes.sort((a, b) => a - b);
  return { width, height, wall, goal, boxes, player };
}

/** True when the square is inside the board and not a wall. */
export function isOpen(board: Board, sq: number): boolean {
  if (sq < 0 || sq >= board.width * board.height) return false;
  return board.wall[sq] === 0;
}

/** Live squares: a square is live when a box standing there can be pushed
 *  onto some goal. Computed by pulling back from the goals: a box on square
 *  p can be pushed into a live square q when the player can stand on the
 *  square behind p, so p is live too. */
export function liveSquares(board: Board): Uint8Array {
  const { width, height } = board;
  const live = new Uint8Array(width * height);
  const queue: number[] = [];
  for (let sq = 0; sq < width * height; sq++) {
    if (board.goal[sq]) {
      live[sq] = 1;
      queue.push(sq);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const q = queue[head];
    const qx = q % width;
    const qy = Math.floor(q / width);
    for (const dir of DIRS) {
      const px = qx - dir.dx;
      const py = qy - dir.dy;
      const sx = px - dir.dx;
      const sy = py - dir.dy;
      if (px < 0 || px >= width || py < 0 || py >= height) continue;
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
      const p = py * width + px;
      const s = sy * width + sx;
      if (live[p] || board.wall[p] || board.wall[s]) continue;
      live[p] = 1;
      queue.push(p);
    }
  }
  return live;
}

/** True when any box starts on a dead square (no solution exists then). */
export function boxOnDeadSquare(board: Board): boolean {
  const live = liveSquares(board);
  return board.boxes.some((box) => live[box] === 0);
}

/** All floor squares the player can walk to from `from`, avoiding walls
 *  and the given boxes. */
export function floodFill(board: Board, boxes: readonly number[], from: number): Set<number> {
  const blocked = new Set<number>(boxes);
  const seen = new Set<number>();
  if (!isOpen(board, from) || blocked.has(from)) return seen;
  const queue = [from];
  seen.add(from);
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const cx = cur % board.width;
    const cy = Math.floor(cur / board.width);
    for (const dir of DIRS) {
      const nx = cx + dir.dx;
      const ny = cy + dir.dy;
      if (nx < 0 || nx >= board.width || ny < 0 || ny >= board.height) continue;
      const next = ny * board.width + nx;
      if (seen.has(next) || blocked.has(next) || board.wall[next]) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/** The name of a player region: its lowest square, or -1 when empty. */
export function regionLowest(region: Set<number>): number {
  let lowest = Infinity;
  for (const sq of region) if (sq < lowest) lowest = sq;
  return lowest === Infinity ? -1 : lowest;
}

/** Shortest walk from `from` to `to` around walls and boxes, as LURD
 *  letters; '' when already there, null when unreachable. BFS expands
 *  up, down, left, right first, so ties resolve to the first direction. */
export function shortestWalk(
  board: Board,
  boxes: readonly number[],
  from: number,
  to: number,
): string | null {
  if (from === to) return '';
  const blocked = new Set<number>(boxes);
  if (!isOpen(board, from) || blocked.has(from)) return null;
  if (!isOpen(board, to) || blocked.has(to)) return null;
  const prev = new Map<number, { at: number; ch: string }>();
  const queue = [from];
  prev.set(from, { at: -1, ch: '' });
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const cx = cur % board.width;
    const cy = Math.floor(cur / board.width);
    for (const dir of DIRS) {
      const nx = cx + dir.dx;
      const ny = cy + dir.dy;
      if (nx < 0 || nx >= board.width || ny < 0 || ny >= board.height) continue;
      const next = ny * board.width + nx;
      if (prev.has(next) || blocked.has(next) || board.wall[next]) continue;
      prev.set(next, { at: cur, ch: dir.ch });
      if (next === to) {
        let moves = '';
        let sq = next;
        while (sq !== from) {
          const step = prev.get(sq)!;
          moves = step.ch + moves;
          sq = step.at;
        }
        return moves;
      }
      queue.push(next);
    }
  }
  return null;
}

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
