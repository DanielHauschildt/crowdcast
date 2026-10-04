const API = 'https://hn.algolia.com/api/v1';

export type FetchFn = (
  url: string
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
};

export function stripHtml(html: string): string {
  return html
    .replace(/<p>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
      const code =
        e[1] === 'x' || e[1] === 'X'
          ? parseInt(e.slice(2), 16)
          : parseInt(e.slice(1), 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : m;
    })
    .trim();
}

async function getJson(fetchFn: FetchFn, url: string, what: string) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`HN ${what}: HTTP ${res.status}`);
  return res.json();
}

interface ItemNode {
  author?: string | null;
  children?: ItemNode[];
}

/** Commenters of a thread, most comments first; the OP and deleted comments are left out. */
export async function fetchThreadAuthors(
  id: string,
  fetchFn: FetchFn = fetch
): Promise<string[]> {
  const root = (await getJson(
    fetchFn,
    `${API}/items/${id}`,
    `item ${id}`
  )) as ItemNode;
  const counts = new Map<string, number>();
  const walk = (n: ItemNode): void => {
    for (const c of n.children ?? []) {
      if (c.author && c.author !== root.author)
        counts.set(c.author, (counts.get(c.author) ?? 0) + 1);
      walk(c);
    }
  };
  walk(root);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([a]) => a);
}

export interface UserComment {
  text: string;
  createdAt: string;
  storyId: string | null;
}

interface Hit {
  comment_text?: string | null;
  created_at?: string;
  story_id?: number | null;
}

export async function fetchUserComments(
  author: string,
  n = 40,
  fetchFn: FetchFn = fetch
): Promise<UserComment[]> {
  const tags = encodeURIComponent(`comment,author_${author}`);
  const body = (await getJson(
    fetchFn,
    `${API}/search_by_date?tags=${tags}&hitsPerPage=${n}`,
    `comments of a user`
  )) as { hits?: Hit[] };
  return (body.hits ?? []).flatMap((h) => {
    const text = stripHtml(h.comment_text ?? '');
    return text
      ? [
          {
            text,
            createdAt: h.created_at ?? '',
            storyId: h.story_id == null ? null : String(h.story_id)
          }
        ]
      : [];
  });
}
