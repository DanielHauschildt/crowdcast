import type { FetchFn, RealComment, RealThread } from '../../platform.js';
import { githubRepo, MAX_CONTEXT_CHARS, stripHtml } from '../hn/fetch.js';

const API = 'https://arctic-shift.photon-reddit.com/api';
/** Large enough that Arctic Shift returns the whole tree instead of "more" stubs. */
const TREE_LIMIT = 9999;
const SKIP_AUTHORS = new Set(['[deleted]', 'AutoModerator']);
const SKIP_BODIES = new Set(['[deleted]', '[removed]']);

interface Post {
  id: string;
  author: string;
  title: string;
  selftext: string;
  is_self: boolean;
  url: string;
  score: number;
}

interface Thing {
  kind: string;
  data: {
    id: string;
    parent_id: string;
    author: string;
    body: string;
    score: number;
    created_utc: number;
    replies?: { data: { children: Thing[] } } | '';
  };
}

/** Reddit markdown with HTML entities → plain text (the markdown itself stays). */
const plain = (md: string): string => stripHtml(md.replace(/&#x200b;/gi, ''));

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

async function getJson<T>(fetchFn: FetchFn, url: string): Promise<T> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Arctic Shift ${url}: HTTP ${res.status}`);
  return JSON.parse(await res.text()) as T;
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

const REDDIT_HOSTED = /^https?:\/\/([^/]*\.)?(reddit\.com|redd\.it)\//;

/** A link post's link or a self post's first link, skipping Reddit's own pages and media. */
function productUrl(p: Post): string {
  const links = p.is_self
    ? (p.selftext.match(/https?:\/\/[^\s)\]]+/g) ?? [])
    : [p.url];
  return links.find((u) => !REDDIT_HOSTED.test(u)) ?? '';
}

function flatten(things: Thing[], out: RealComment[]): void {
  for (const t of things) {
    const c = t.data;
    if (
      t.kind !== 't1' ||
      SKIP_AUTHORS.has(c.author) ||
      SKIP_BODIES.has(c.body.trim())
    )
      continue;
    out.push({
      id: c.id,
      parent: c.parent_id.startsWith('t3_') ? 'post' : c.parent_id.slice(3),
      author: c.author,
      createdAt: new Date(c.created_utc * 1000).toISOString(),
      text: plain(c.body),
      points: c.score
    });
    if (c.replies) flatten(c.replies.data.children, out);
  }
}

/** A Reddit post by its numeric id (`parseInt(base36, 36)`, so thread lists stay numeric). */
export async function fetchReference(
  id: number,
  fetchFn: FetchFn = fetch
): Promise<RealThread> {
  const b36 = id.toString(36);
  const { data } = await getJson<{ data: Post[] }>(
    fetchFn,
    `${API}/posts/ids?ids=${b36}`
  );
  const p = data[0];
  if (!p) throw new Error(`Reddit post ${b36}: not found on Arctic Shift`);
  const tree = await getJson<{ data: Thing[] }>(
    fetchFn,
    `${API}/comments/tree?link_id=t3_${b36}&limit=${TREE_LIMIT}&start_breadth=${TREE_LIMIT}&start_depth=${TREE_LIMIT}`
  );
  const comments: RealComment[] = [];
  flatten(tree.data, comments);
  const body = plain(p.selftext);
  const opTop = comments
    .filter((c) => c.author === p.author && c.parent === 'post')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  const link = productUrl(p);
  const linked = link ? await linkedText(fetchFn, link) : '';
  const firstComment = body ? null : (opTop?.text ?? null);
  return {
    id,
    post: { title: p.title, url: p.is_self ? '' : p.url, body, firstComment },
    comments,
    points: p.score,
    op: p.author,
    context: (linked || body || firstComment || '').slice(0, MAX_CONTEXT_CHARS)
  };
}
