import type { FetchFn, RealComment, RealThread } from '../../platform.js';
import { QUOTE_PREFIX } from './prompts.js';

const API = 'https://public.api.bsky.app/xrpc/';
const MAX_LIKE_PAGES = 50;

/** Reach data of one real post; `fit.ts` reads it. */
export interface Timeline {
  uri: string;
  createdAt: string;
  followers: number;
  likes: number;
  reposts: number;
  quotes: number;
  /** Minutes after posting of every like fetched, ascending. */
  likeMinutes: number[];
  /** False when getLikes was cut off at MAX_LIKE_PAGES; the earliest likes are then missing. */
  likesComplete: boolean;
  /** Follower counts of up to 25 reposters. */
  reposterFollowers: number[];
}

interface PostView {
  uri: string;
  author: { did: string };
  record: { text: string; createdAt: string };
  embed?: { external?: { uri: string; title: string; description: string } };
  likeCount?: number;
  repostCount?: number;
  quoteCount?: number;
}

interface ThreadNode {
  post?: PostView;
  replies?: ThreadNode[];
}

export function parseRef(ref: string): { repo: string; rkey: string } {
  const m =
    /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/?#]+)$/.exec(ref) ??
    /^https:\/\/bsky\.app\/profile\/([^/]+)\/post\/([^/?#]+)/.exec(ref);
  if (!m) throw new Error(`not a Bluesky post at-URI or bsky.app URL: ${ref}`);
  return { repo: m[1]!, rkey: m[2]! };
}

/** 32-bit FNV-1a of the at-URI: backtests key threads by number. */
export function threadId(atUri: string): number {
  let h = 0x811c9dc5;
  for (const ch of atUri) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h || 1;
}

const minutesBetween = (from: string, to: string): number =>
  (Date.parse(to) - Date.parse(from)) / 60_000;

export async function fetchBskyPost(
  ref: string,
  fetchFn: FetchFn = fetch,
  opts: { delayMs?: number } = {}
): Promise<{ thread: RealThread; timeline: Timeline }> {
  const delayMs = opts.delayMs ?? 250;
  let calls = 0;
  const get = async <T>(
    method: string,
    params: Array<[string, string]> | Record<string, string>
  ): Promise<T> => {
    if (calls++ > 0 && delayMs > 0)
      await new Promise((r) => setTimeout(r, delayMs));
    const res = await fetchFn(`${API}${method}?${new URLSearchParams(params)}`);
    if (!res.ok) throw new Error(`${method} failed: HTTP ${res.status}`);
    return JSON.parse(await res.text()) as T;
  };

  const { repo, rkey } = parseRef(ref);
  const did = repo.startsWith('did:')
    ? repo
    : (await get<{ did: string }>('app.bsky.actor.getProfile', { actor: repo }))
        .did;
  const uri = `at://${did}/app.bsky.feed.post/${rkey}`;
  const { thread: root } = await get<{ thread: ThreadNode }>(
    'app.bsky.feed.getPostThread',
    { uri, depth: '100', parentHeight: '0' }
  );
  const post = root.post;
  if (!post) throw new Error(`post not found: ${uri}`);
  const profile = await get<{ followersCount?: number }>(
    'app.bsky.actor.getProfile',
    { actor: did }
  );

  const likeMinutes: number[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await get<{
      likes: Array<{ createdAt: string }>;
      cursor?: string;
    }>('app.bsky.feed.getLikes', {
      uri,
      limit: '100',
      ...(cursor ? { cursor } : {})
    });
    for (const l of page.likes)
      likeMinutes.push(minutesBetween(post.record.createdAt, l.createdAt));
    cursor = page.likes.length > 0 ? page.cursor : undefined;
  } while (cursor && ++pages < MAX_LIKE_PAGES);
  likeMinutes.sort((a, b) => a - b);

  const { repostedBy } = await get<{ repostedBy: Array<{ did: string }> }>(
    'app.bsky.feed.getRepostedBy',
    { uri, limit: '25' }
  );
  const reposterFollowers =
    repostedBy.length === 0
      ? []
      : (
          await get<{ profiles: Array<{ followersCount?: number }> }>(
            'app.bsky.actor.getProfiles',
            repostedBy.map((r): [string, string] => ['actors', r.did])
          )
        ).profiles.map((p) => p.followersCount ?? 0);
  const { posts: quotes } = await get<{ posts: PostView[] }>(
    'app.bsky.feed.getQuotes',
    { uri, limit: '100' }
  );

  const comments: RealComment[] = [];
  const ids = new Map<string, string>();
  const add = (p: PostView, parent: string, prefix = ''): string => {
    const id = `b${comments.length + 1}`;
    ids.set(p.uri, id);
    comments.push({
      id,
      parent,
      author: p.author.did,
      createdAt: p.record.createdAt,
      text: prefix + p.record.text,
      points: p.likeCount ?? 0
    });
    return id;
  };
  const walk = (nodes: ThreadNode[] | undefined, parent: string): void => {
    for (const n of nodes ?? []) {
      if (!n.post) continue;
      walk(n.replies, add(n.post, parent));
    }
  };
  walk(root.replies, 'post');
  for (const q of quotes) add(q, 'post', QUOTE_PREFIX);

  const text = post.record.text;
  const ext = post.embed?.external;
  const thread: RealThread = {
    id: threadId(uri),
    post: {
      title: (text.split('\n')[0] ?? '').trim().slice(0, 80),
      url: ext?.uri ?? `https://bsky.app/profile/${did}/post/${rkey}`,
      body: text,
      firstComment: null
    },
    comments,
    points: 1 + (post.likeCount ?? 0) + (post.repostCount ?? 0),
    op: did,
    author: { followers: profile.followersCount ?? 0 },
    context: ext
      ? `${text}\n\nLinked: ${ext.title} — ${ext.description} (${ext.uri})`
      : text
  };
  return {
    thread,
    timeline: {
      uri,
      createdAt: post.record.createdAt,
      followers: profile.followersCount ?? 0,
      likes: post.likeCount ?? 0,
      reposts: post.repostCount ?? 0,
      quotes: post.quoteCount ?? 0,
      likeMinutes,
      likesComplete: !cursor,
      reposterFollowers
    }
  };
}
