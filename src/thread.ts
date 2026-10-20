import { FOUNDER, type Post, type SimEvent } from './types.js';

// Moved to the HN platform; re-exported for callers of the old path.
export { flamewarFactor, rankScore } from './platforms/hn/rank.js';

/** Deepest rendered depth; replies below are collapsed into a count. */
export const MAX_DEPTH = 4;

export interface Comment {
  id: string;
  parent: string;
  author: string;
  text: string;
  step: number;
  depth: number;
  ups: number;
  downs: number;
  flags: number;
  /** Votes by value, e.g. `{ up: 3, down: 1 }`. */
  reactions: Record<string, number>;
}

export interface ThreadState {
  post: Post;
  postUps: number;
  postDowns: number;
  postFlags: number;
  /** Votes on the post by value. */
  postReactions: Record<string, number>;
  comments: Map<string, Comment>;
  /** `${voter}|${target}` — one vote per actor per target. */
  voted: Set<string>;
  departed: Set<string>;
  lastVisit: Map<string, number>;
  nextId: number;
}

export function emptyThread(post: Post): ThreadState {
  return {
    post,
    postUps: 0,
    postDowns: 0,
    postFlags: 0,
    postReactions: {},
    comments: new Map(),
    voted: new Set(),
    departed: new Set(),
    lastVisit: new Map(),
    nextId: 1
  };
}

export function newCommentId(s: ThreadState): string {
  return `c${s.nextId}`;
}

const bump = (counts: Record<string, number>, value: string): void => {
  counts[value] = (counts[value] ?? 0) + 1;
};

export function applyEvent(s: ThreadState, e: SimEvent): void {
  switch (e.kind) {
    case 'post':
      s.post = e.post;
      return;
    case 'comment': {
      if (s.comments.has(e.id)) throw new Error(`duplicate comment id ${e.id}`);
      let depth = 0;
      if (e.parent !== 'post') {
        const parent = s.comments.get(e.parent);
        if (!parent) throw new Error(`unknown parent ${e.parent} for ${e.id}`);
        depth = parent.depth + 1;
      }
      s.comments.set(e.id, {
        id: e.id,
        parent: e.parent,
        author: e.author,
        text: e.text,
        step: e.step,
        depth,
        ups: 0,
        downs: 0,
        flags: 0,
        reactions: {}
      });
      s.nextId = Math.max(s.nextId, Number(e.id.slice(1)) + 1);
      return;
    }
    case 'vote': {
      const key = `${e.voter}|${e.target}`;
      if (s.voted.has(key)) return;
      // 'flag' and 'down' count against the target; every other reaction counts for it.
      if (e.target === 'post') {
        if (e.value === 'flag') s.postFlags++;
        else if (e.value === 'down') s.postDowns++;
        else s.postUps++;
        bump(s.postReactions, e.value);
      } else {
        const c = s.comments.get(e.target);
        if (!c || c.author === e.voter) return;
        if (e.value === 'flag') c.flags++;
        else if (e.value === 'down') c.downs++;
        else c.ups++;
        bump(c.reactions, e.value);
      }
      s.voted.add(key);
      return;
    }
    case 'visit':
      s.lastVisit.set(e.actor, e.step);
      return;
    case 'leave':
      s.departed.add(e.actor);
      return;
    default:
      return;
  }
}

export function replay(post: Post, events: readonly SimEvent[]): ThreadState {
  const s = emptyThread(post);
  for (const e of events) applyEvent(s, e);
  return s;
}

/** The submitter's own vote counts, as on HN and Reddit. */
export function postPoints(s: ThreadState): number {
  return 1 + s.postUps - s.postDowns;
}

export function commentScore(c: Comment): number {
  return c.ups - c.downs - 2 * c.flags;
}

/** HN kills a comment once enough users flag it. */
export const DEAD_FLAGS = 3;

export function isDead(c: Comment): boolean {
  return c.flags >= DEAD_FLAGS;
}

export function liveComments(s: ThreadState): Comment[] {
  return [...s.comments.values()].filter((c) => !isDead(c));
}

export function answeredByFounder(s: ThreadState, id: string): boolean {
  for (const c of s.comments.values())
    if (c.parent === id && c.author === FOUNDER) return true;
  return false;
}

const idNum = (id: string): number => Number(id.slice(1));

export function children(s: ThreadState, parent: string): Comment[] {
  return [...s.comments.values()]
    .filter((c) => c.parent === parent)
    .sort(
      (a, b) => commentScore(b) - commentScore(a) || idNum(a.id) - idNum(b.id)
    );
}

export function topComments(s: ThreadState, n: number): Comment[] {
  return liveComments(s)
    .sort(
      (a, b) => commentScore(b) - commentScore(a) || idNum(a.id) - idNum(b.id)
    )
    .slice(0, n);
}

/**
 * True when someone else replied to one of `actor`'s comments at or after their last visit.
 * Within a step all visits are logged before any comment, so `>=` is exact.
 */
export function unseenReplies(s: ThreadState, actor: string): boolean {
  const seen = s.lastVisit.get(actor) ?? -1;
  for (const c of s.comments.values()) {
    if (c.parent === 'post' || c.author === actor || c.step < seen) continue;
    if (s.comments.get(c.parent)?.author === actor) return true;
  }
  return false;
}

export interface RenderOptions {
  /** Hard cap on output length; lowest-scored leaves are hidden first. */
  maxChars?: number;
}

/** Live comments below `id`. */
function countDescendants(s: ThreadState, id: string): number {
  let n = 0;
  for (const c of children(s, id))
    n += (isDead(c) ? 0 : 1) + countDescendants(s, c.id);
  return n;
}

function visibleOrder(s: ThreadState, hidden: Set<string>): Comment[] {
  const out: Comment[] = [];
  const walk = (parent: string): void => {
    for (const c of children(s, parent)) {
      if (hidden.has(c.id)) continue;
      if (isDead(c) && countDescendants(s, c.id) === 0) continue;
      out.push(c);
      if (c.depth < MAX_DEPTH) walk(c.id);
    }
  };
  walk('post');
  return out;
}

function renderComment(s: ThreadState, c: Comment): string {
  const indent = '  '.repeat(c.depth);
  const who = c.author === FOUNDER ? `${c.author} (OP)` : c.author;
  const answered = answeredByFounder(s, c.id) ? ' · ↳ answered by OP' : '';
  const body = c.text.replace(/\n/g, `\n${indent}`);
  let out = isDead(c)
    ? `${indent}[dead]\n`
    : `${indent}[${c.id}] ${who} · ${commentScore(c)} points${answered}\n${indent}${body}\n`;
  if (c.depth === MAX_DEPTH) {
    const deeper = countDescendants(s, c.id);
    if (deeper > 0) out += `${indent}  [${deeper} more replies collapsed]\n`;
  }
  return out;
}

export function renderThread(s: ThreadState, opts: RenderOptions = {}): string {
  const maxChars = opts.maxChars ?? Infinity;
  const url = s.post.url ? ` (${s.post.url})` : '';
  const header =
    `${s.post.title}${url}\n${postPoints(s)} points | ${liveComments(s).length} comments\n\n` +
    `${s.post.body}\n\n---\n`;
  const hidden = new Set<string>();
  const compose = (): string => {
    const visible = visibleOrder(s, hidden);
    let out = header + visible.map((c) => renderComment(s, c)).join('\n');
    if (hidden.size > 0)
      out += `\n(${hidden.size} low-scored comments hidden)\n`;
    return out;
  };
  let out = compose();
  while (out.length > maxChars) {
    const visible = visibleOrder(s, hidden);
    const hasVisibleChild = new Set(visible.map((c) => c.parent));
    const leaves = visible
      .filter((c) => !hasVisibleChild.has(c.id))
      .sort((a, b) => commentScore(a) - commentScore(b) || a.step - b.step);
    const victim = leaves[0];
    if (!victim) break;
    hidden.add(victim.id);
    out = compose();
  }
  return out.length > maxChars ? out.slice(0, maxChars) : out;
}
