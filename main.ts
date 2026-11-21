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

/** One room: its boxes, its goals, and its lowest square (scan order). */
export interface Room {
  boxes: number[];
  goals: number[];
  first: number;
}

/** Split a board into rooms: cut the dead squares of the player's row
 *  (the hallway) out of the floor; each remaining connected part holding
 *  boxes is a room. Null when the level is not a set of rooms: a box
 *  starts on a cut square in the hallway, a goal falls in a cut square,
 *  or some part holds unequal boxes and goals (or goals with no boxes).
 *  A box on a live square in the player's row is fine — it can still
 *  reach a goal, so the level can still be a set of rooms. */
export function splitRooms(board: Board): Room[] | null {
  if (board.player < 0) return null;
  const live = liveSquares(board);
  const playerRow = Math.floor(board.player / board.width);
  const cut = new Set<number>();
  for (let x = 0; x < board.width; x++) {
    const sq = playerRow * board.width + x;
    if (board.wall[sq] === 0 && live[sq] === 0) cut.add(sq);
  }
  if (board.boxes.some((box) => cut.has(box))) return null;
  for (let sq = 0; sq < board.width * board.height; sq++) {
    if (board.goal[sq] === 1 && cut.has(sq)) return null;
  }
  const seen = new Set<number>();
  const rooms: Room[] = [];
  for (let start = 0; start < board.width * board.height; start++) {
    if (board.wall[start] === 1 || cut.has(start) || seen.has(start)) continue;
    const comp: number[] = [];
    const queue = [start];
    seen.add(start);
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head];
      comp.push(cur);
      const cx = cur % board.width;
      const cy = Math.floor(cur / board.width);
      for (const dir of DIRS) {
        const nx = cx + dir.dx;
        const ny = cy + dir.dy;
        if (nx < 0 || nx >= board.width || ny < 0 || ny >= board.height) continue;
        const next = ny * board.width + nx;
        if (board.wall[next] === 1 || cut.has(next) || seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    const boxes = comp.filter((sq) => board.boxes.includes(sq)).sort((a, b) => a - b);
    const goals = comp.filter((sq) => board.goal[sq] === 1);
    if (boxes.length === 0 && goals.length === 0) continue;
    if (boxes.length !== goals.length) return null;
    rooms.push({ boxes, goals, first: comp[0] });
  }
  if (rooms.length === 0) return null;
  rooms.sort((a, b) => a.first - b.first);
  return rooms;
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

/** Work budget for a whole set of levels (5 searches of SEARCH_BUDGET). */
const SET_BUDGET = SEARCH_BUDGET * 5;

/** Below this much remaining set budget, a level is not attempted: not
 *  even a small room search can be trusted to finish, and an empty
 *  solution beats burning the rest of the run's time. */
const SET_MIN_REMAINING = 10_000;

/** Shared work budget for a set of levels: states spent so far, and the
 *  cap for the whole set. */
export interface WorkBudget {
  spent: number;
  limit: number;
}

/** A fresh set budget. */
export function createSetBudget(limit: number = SET_BUDGET): WorkBudget {
  return { spent: 0, limit };
}

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
  depth: number;
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
        const sx = tlx + dx;
        const sy = tly + dy;
        // Out-of-board squares count as walls — and must not wrap around
        // to the other side of the board, where a real square could hold
        // a box and falsely mark this block frozen.
        if (sx < 0 || sx >= w || sy < 0 || sy >= board.height) continue;
        const sq = sy * w + sx;
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

/** Outcome of one push search: the moves, how many of them are pushes,
 *  where the player ends up, and how many states the search created. */
interface SearchOutcome {
  moves: string;
  pushes: number;
  endPlayer: number;
  states: number;
}

/** Push-optimal BFS over one board: a state is the sorted box squares
 *  plus the canonical player region (lowest reachable square); states
 *  expand in push order, so the first solved state found is push-optimal.
 *  The search draws on the shared work budget and charges every state it
 *  creates to it. Null when the board has no solution or the state
 *  budget runs out. An already-solved board returns an empty outcome. */
function searchPushes(board: Board, player: number, budget: WorkBudget): SearchOutcome | null {
  if (player < 0 || board.boxes.length === 0) {
    return { moves: '', pushes: 0, endPlayer: player, states: 0 };
  }
  if (board.boxes.every((box) => board.goal[box] === 1)) {
    return { moves: '', pushes: 0, endPlayer: player, states: 0 };
  }
  if (boxOnDeadSquare(board)) return null;
  const live = liveSquares(board);
  const size = board.width * board.height;
  // Two scratches: the dequeued state's region stays live in `regionScratch`
  // while candidate regions are filled into `candidateScratch`.
  const regionScratch = makeRegionScratch(size);
  const candidateScratch = makeRegionScratch(size);
  const nodes: SearchNode[] = [
    { boxes: [...board.boxes], player, parent: -1, pushSquare: -1, pushCh: '', depth: 0 },
  ];
  const keyOf = (boxes: readonly number[], region: number): string =>
    `${boxes.join(',')}|${region}`;
  const startRegion = fillRegion(board, board.boxes, player, regionScratch);
  const seen = new Map<string, number>();
  seen.set(keyOf(board.boxes, startRegion.lowest), 0);
  // This search may use at most one per-search budget, and never more
  // than the shared budget has left.
  const cap = Math.min(SEARCH_BUDGET, budget.limit - budget.spent);
  if (cap <= 0) return null;
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
          const moves = reconstruct(board, nodes, head, pushSq, dir.ch);
          budget.spent += nodes.length;
          if (moves === '') return null;
          return { moves, pushes: nodes[head].depth + 1, endPlayer: box, states: nodes.length };
        }
        const nextRegion = fillRegion(board, nextBoxes, box, candidateScratch);
        const key = keyOf(nextBoxes, nextRegion.lowest);
        if (seen.has(key)) continue;
        if (nodes.length >= cap) {
          budget.spent += nodes.length;
          return null;
        }
        seen.set(key, nodes.length);
        nodes.push({
          boxes: nextBoxes,
          player: box,
          parent: head,
          pushSquare: pushSq,
          pushCh: dir.ch.toUpperCase(),
          depth: nodes[head].depth + 1,
        });
      }
    }
  }
  budget.spent += nodes.length;
  return null;
}

/** Solve a level room by room, in scan order. Other rooms' boxes act as
 *  walls (on their goals once solved — they never move, so a wall is all
 *  they ever are to this room). The player carries on from where the last
 *  room left them; push counts add up. Null when any room fails: the
 *  caller falls back to the whole-level search. */
function solveRooms(board: Board, rooms: readonly Room[], budget: WorkBudget): string | null {
  let moves = '';
  let player = board.player;
  // Where every room's boxes stand right now: their starting squares
  // until the room is solved, their goals afterwards. A later room's
  // search must see the solved boxes where they actually are — on their
  // goals — or it will plan walks through occupied squares.
  const placed: number[][] = rooms.map((room) => [...room.boxes]);
  for (let ri = 0; ri < rooms.length; ri++) {
    const room = rooms[ri];
    const otherBoxes: number[] = [];
    for (let oj = 0; oj < rooms.length; oj++) {
      if (oj !== ri) otherBoxes.push(...placed[oj]);
    }
    const wall = new Uint8Array(board.wall);
    for (const box of otherBoxes) wall[box] = 1;
    const goal = new Uint8Array(board.width * board.height);
    for (const sq of room.goals) goal[sq] = 1;
    const sub: Board = {
      width: board.width,
      height: board.height,
      wall,
      goal,
      boxes: [...room.boxes],
      player,
    };
    const result = searchPushes(sub, player, budget);
    if (result === null) return null;
    moves += result.moves;
    player = result.endPlayer;
    placed[ri] = [...room.goals].sort((a, b) => a - b);
  }
  return moves;
}

/** The moves for a level in XSB: a string of u, d, l and r (an upper letter marks a push; case is not checked).
 *  Room by room when the level splits into rooms, whole-level otherwise;
 *  a failed room search falls back to the whole-level search. Returns ''
 *  when the level is already solved, has no solution, or the work budget
 *  runs out. The optional budget is shared across a set of levels; a
 *  fresh one is created for a single level. One level may charge at most
 *  two per-search budgets to the shared budget — one for the room phase,
 *  one for the whole-level fallback — so a single pathological level can
 *  never starve the other levels in the set. */
export function solve(level: string, budget: WorkBudget = createSetBudget()): string {
  const board = parseBoard(level);
  if (board.player < 0 || board.boxes.length === 0) return '';
  if (board.boxes.every((box) => board.goal[box] === 1)) return '';
  if (boxOnDeadSquare(board)) return '';
  if (budget.limit - budget.spent <= 0) return '';
  const levelBudget: WorkBudget = {
    spent: budget.spent,
    limit: Math.min(budget.limit, budget.spent + 2 * SEARCH_BUDGET),
  };
  const rooms = splitRooms(board);
  if (rooms !== null) {
    const roomMoves = solveRooms(board, rooms, levelBudget);
    if (roomMoves !== null) {
      budget.spent = levelBudget.spent;
      return roomMoves;
    }
  }
  const whole = searchPushes(board, board.player, levelBudget);
  budget.spent = levelBudget.spent;
  return whole === null ? '' : whole.moves;
}

function run(inputDir: string, outputDir: string): void {
  let ids: string[];
  try {
    ids = readdirSync(inputDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return;
  }
  // One work budget for the whole set: a timeout zeroes the run, so once
  // the budget is nearly spent, stop searching and write empty solutions
  // for the remaining levels instead of risking the run.
  const budget = createSetBudget();
  for (const id of ids) {
    // One bad instance must never kill the rest of the set: a missing or
    // unreadable level still gets an empty (valid, 0-point) solution.
    let moves = '';
    try {
      const level = readFileSync(join(inputDir, id, 'level.txt'), 'utf8');
      moves =
        budget.limit - budget.spent < SET_MIN_REMAINING ? '' : solve(level, budget);
    } catch {
      moves = '';
    }
    try {
      mkdirSync(join(outputDir, id), { recursive: true });
      writeFileSync(join(outputDir, id, 'solution.txt'), `${moves}\n`);
    } catch {
      // Nowhere to write this instance's solution; continue with the rest.
    }
  }
}

// The IO loop runs only when this file is executed directly, so tests can
// import solve() without side effects.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run(INPUT_DIR, OUTPUT_DIR);
}
