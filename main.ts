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

/** Work budget per push search, in states — work, never the clock. */
const SEARCH_BUDGET = 250_000;

/** Plain direction offsets for the hot flood fill (up, down, left, right). */
const FILL_DX: readonly number[] = [0, 0, -1, 1];
const FILL_DY: readonly number[] = [-1, 1, 0, 0];

/** One BFS node: the boxes after this node's push, where the player stands
 *  (the pushed box's old square), and how to get here from the parent. */
interface SearchNode {
  boxes: number[];
  player: number;
  parent: number;
  pushSquare: number;
  pushCh: string;
}

/** Reusable scratch for flood fills: `seen` holds a stamp per square so a
 *  fill never allocates or clears an array, `blocked` marks the boxes,
 *  `queue` is the BFS work list. Two scratches are used by the search: one
 *  holds the dequeued state's region while the other fills candidates. */
interface RegionScratch {
  seen: Uint32Array;
  blocked: Uint8Array;
  queue: Int32Array;
  stamp: number;
}

function makeRegionScratch(size: number): RegionScratch {
  return { seen: new Uint32Array(size), blocked: new Uint8Array(size), queue: new Int32Array(size), stamp: 0 };
}

/** Flood fill over open floor avoiding walls and boxes, into `scratch`.
 *  Returns the lowest square reached (the canonical name of the region)
 *  and the stamp marking this fill's squares in `scratch.seen` — a square
 *  `sq` is in the region exactly when `scratch.seen[sq] === stamp`. The
 *  stamp stays valid until the same scratch is filled again. */
function fillRegion(
  board: Board,
  boxes: readonly number[],
  from: number,
  scratch: RegionScratch,
): { lowest: number; stamp: number } {
  const stamp = ++scratch.stamp;
  const { seen, blocked, queue } = scratch;
  const w = board.width;
  const h = board.height;
  const wall = board.wall;
  for (const box of boxes) blocked[box] = 1;
  let lowest = -1;
  if (isOpen(board, from) && !blocked[from]) {
    let head = 0;
    let tail = 0;
    queue[tail++] = from;
    seen[from] = stamp;
    lowest = from;
    while (head < tail) {
      const cur = queue[head++];
      const cx = cur % w;
      const cy = Math.floor(cur / w);
      for (let d = 0; d < 4; d++) {
        const nx = cx + FILL_DX[d];
        const ny = cy + FILL_DY[d];
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const next = ny * w + nx;
        if (seen[next] === stamp || blocked[next] || wall[next]) continue;
        seen[next] = stamp;
        if (next < lowest) lowest = next;
        queue[tail++] = next;
      }
    }
  }
  for (const box of boxes) blocked[box] = 0;
  return { lowest, stamp };
}

/** True when `dest` sits in a frozen 2x2 block: all four squares are
 *  walls or boxes, and at least one box in the block is off its goal.
 *  Out-of-board squares count as walls. */
function isFrozenBlock(board: Board, boxes: readonly number[], dest: number): boolean {
  const w = board.width;
  const x = dest % w;
  const y = Math.floor(dest / w);
  for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]] as const) {
    const tlx = x + ox;
    const tly = y + oy;
    let allBlocked = true;
    let hasOffGoalBox = false;
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const sq = (tly + dy) * w + (tlx + dx);
        const isBox = boxes.includes(sq);
        if (!isBox && isOpen(board, sq)) allBlocked = false;
        if (isBox && board.goal[sq] === 0) hasOffGoalBox = true;
      }
    }
    if (allBlocked && hasOffGoalBox) return true;
  }
  return false;
}

/** Rebuild the moves for a solution whose last push starts from
 *  `parentIdx` at `lastPushSq` in direction `lastPushCh`: walk the chain
 *  of parent pointers back to the root, then walk each push's approach
 *  with the shortest walk and append the push (upper-case letter). */
function reconstruct(
  board: Board,
  nodes: readonly SearchNode[],
  parentIdx: number,
  lastPushSq: number,
  lastPushCh: string,
): string {
  const chain: number[] = [];
  for (let i = parentIdx; i > 0; i = nodes[i].parent) chain.push(i);
  chain.reverse();
  let moves = '';
  for (const idx of chain) {
    const node = nodes[idx];
    const parent = nodes[node.parent];
    const walk = shortestWalk(board, parent.boxes, parent.player, node.pushSquare);
    if (walk === null) return '';
    moves += walk + node.pushCh;
  }
  const lastParent = nodes[parentIdx];
  const walk = shortestWalk(board, lastParent.boxes, lastParent.player, lastPushSq);
  if (walk === null) return '';
  return moves + walk + lastPushCh.toUpperCase();
}

/** The moves for a level in XSB: a string of u, d, l and r (an upper letter marks a push; case is not checked).
 *  Push-optimal BFS: a state is the sorted box squares plus the canonical
 *  player region (lowest reachable square); states expand in push order,
 *  so the first solved state found is push-optimal. Returns '' when the
 *  level is already solved, has no solution, or the state budget runs out. */
export function solve(level: string): string {
  const board = parseBoard(level);
  if (board.player < 0 || board.boxes.length === 0) return '';
  if (board.boxes.every((box) => board.goal[box] === 1)) return '';
  if (boxOnDeadSquare(board)) return '';
  const live = liveSquares(board);
  const size = board.width * board.height;
  // Two scratches: the dequeued state's region stays live in `regionScratch`
  // while candidate regions are filled into `candidateScratch`.
  const regionScratch = makeRegionScratch(size);
  const candidateScratch = makeRegionScratch(size);
  const nodes: SearchNode[] = [
    { boxes: [...board.boxes], player: board.player, parent: -1, pushSquare: -1, pushCh: '' },
  ];
  const keyOf = (boxes: readonly number[], region: number): string =>
    `${boxes.join(',')}|${region}`;
  const startRegion = fillRegion(board, board.boxes, board.player, regionScratch);
  const seen = new Map<string, number>();
  seen.set(keyOf(board.boxes, startRegion.lowest), 0);
  for (let head = 0; head < nodes.length; head++) {
    const node = nodes[head];
    const region = fillRegion(board, node.boxes, node.player, regionScratch);
    for (let bi = 0; bi < node.boxes.length; bi++) {
      const box = node.boxes[bi];
      const bx = box % board.width;
      const by = Math.floor(box / board.width);
      for (const dir of DIRS) {
        const dest = (by + dir.dy) * board.width + (bx + dir.dx);
        if (!isOpen(board, dest) || node.boxes.includes(dest)) continue;
        if (live[dest] === 0) continue;
        const pushSq = (by - dir.dy) * board.width + (bx - dir.dx);
        if (regionScratch.seen[pushSq] !== region.stamp) continue;
        // Move the box, keeping the list sorted (remove, then insert).
        const nextBoxes = [...node.boxes];
        nextBoxes.splice(bi, 1);
        let at = 0;
        while (at < nextBoxes.length && nextBoxes[at] < dest) at++;
        nextBoxes.splice(at, 0, dest);
        if (isFrozenBlock(board, nextBoxes, dest)) continue;
        if (nextBoxes.every((b) => board.goal[b] === 1)) {
          return reconstruct(board, nodes, head, pushSq, dir.ch);
        }
        const nextRegion = fillRegion(board, nextBoxes, box, candidateScratch);
        const key = keyOf(nextBoxes, nextRegion.lowest);
        if (seen.has(key)) continue;
        if (nodes.length >= SEARCH_BUDGET) return '';
        seen.set(key, nodes.length);
        nodes.push({
          boxes: nextBoxes,
          player: box,
          parent: head,
          pushSquare: pushSq,
          pushCh: dir.ch.toUpperCase(),
        });
      }
    }
  }
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
