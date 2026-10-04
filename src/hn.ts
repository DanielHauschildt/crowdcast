import type { Post } from './types.js';

export const MAX_CONTEXT_CHARS = 8000;
const ITEMS_API = 'https://hn.algolia.com/api/v1/items/';

export type FetchFn = (
  url: string,
  init?: { headers?: Record<string, string> }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface RealComment {
  id: string;
  /** `post` for top-level comments, else the parent comment's id. */
  parent: string;
  author: string;
  createdAt: string;
  text: string;
}

export interface RealThread {
  id: number;
  post: Post;
  comments: RealComment[];
  /** Final points on HN. */
  points: number;
  /** The submitter's username. */
  op: string;
  /** Linked page as plain text (a GitHub repo's README), else the post text. */
  context: string;
}

interface Item {
  id: number;
  author: string | null;
  created_at: string;
  parent_id: number | null;
  title?: string | null;
  url?: string | null;
  text: string | null;
  points?: number | null;
  children?: Item[];
}

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code =
        e[1] === 'x' || e[1] === 'X'
          ? parseInt(e.slice(2), 16)
          : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

export function stripHtml(html: string): string {
  const text = html
    .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[!?][^>]*>/g, '')
    .replace(/<(p|br|div|li|h[1-6]|tr|pre|section|article)\b[^>]*>/gi, '\n\n')
    .replace(/<\/?[a-z][^>]*>/gi, '');
  return decodeEntities(text)
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function githubRepo(
  url: string
): { owner: string; repo: string } | null {
  const m = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/?#]+)/i.exec(url);
  return m ? { owner: m[1]!, repo: m[2]!.replace(/\.git$/, '') } : null;
}

async function getText(
  fetchFn: FetchFn,
  url: string,
  headers?: Record<string, string>
): Promise<string | null> {
  try {
    const res = await fetchFn(url, headers ? { headers } : undefined);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

async function linkedText(fetchFn: FetchFn, url: string): Promise<string> {
  const gh = githubRepo(url);
  if (gh) {
    const readme = await getText(
      fetchFn,
      `https://api.github.com/repos/${gh.owner}/${gh.repo}/readme`,
      { Accept: 'application/vnd.github.raw' }
    );
    if (readme?.trim()) return readme.trim();
  }
  const page = await getText(fetchFn, url);
  return page ? stripHtml(page) : '';
}

function flatten(node: Item, storyId: number, out: RealComment[]): void {
  for (const c of node.children ?? []) {
    if (c.author && c.text) {
      out.push({
        id: String(c.id),
        parent: c.parent_id === storyId ? 'post' : String(c.parent_id),
        author: c.author,
        createdAt: c.created_at,
        text: stripHtml(c.text)
      });
      flatten(c, storyId, out);
    }
  }
}

export async function fetchThread(
  id: number,
  fetchFn: FetchFn = fetch
): Promise<RealThread> {
  const res = await fetchFn(`${ITEMS_API}${id}`);
  if (!res.ok) throw new Error(`HN item ${id}: HTTP ${res.status}`);
  const item = JSON.parse(await res.text()) as Item;
  const op = item.author ?? '';
  const comments: RealComment[] = [];
  flatten(item, item.id, comments);
  const body = item.text ? stripHtml(item.text) : '';
  const opTop = comments
    .filter((c) => c.author === op && c.parent === 'post')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  const url = item.url ?? '';
  const linked = url ? await linkedText(fetchFn, url) : '';
  return {
    id: item.id,
    post: {
      title: item.title ?? '',
      url,
      body,
      firstComment: body ? null : (opTop?.text ?? null)
    },
    comments,
    points: item.points ?? 0,
    op,
    context: (linked || body).slice(0, MAX_CONTEXT_CHARS)
  };
}
