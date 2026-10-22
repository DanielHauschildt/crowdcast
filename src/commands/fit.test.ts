import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FetchFn } from '../platform.js';
import { threadId, type Timeline } from '../platforms/bluesky/bsky-api.js';
import { fit } from './fit.js';

const CSV = fileURLToPath(
  new URL(
    '../platforms/linkedin/fixtures/analytics-synthetic.csv',
    import.meta.url
  )
);

const run = async (
  argv: string[],
  fetch?: FetchFn
): Promise<{ code: number; out: string }> => {
  const logs: string[] = [];
  const code = await fit(argv, { log: (m) => void logs.push(m), fetch });
  return { code, out: logs.join('\n') };
};

describe('fit command', () => {
  it("dispatches to linkedin's fit with --followers", async () => {
    const { code, out } = await run(['linkedin', CSV, '--followers', '1800']);
    expect(code, out).toBe(0);
    expect(out).toMatch(/testSlice: [\d.]+/);
    expect(out).toMatch(/expansion: [\d.]+/);
  });

  it("dispatches to bluesky's fit: cached timelines of the list, fit.json beside it", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fit-'));
    const uris = [1, 2].map(
      (i) => `at://did:plc:maker${i}/app.bsky.feed.post/${i}`
    );
    writeFileSync(
      join(dir, 'threads.txt'),
      uris.map((u) => `${threadId(u)}  # ${u}`).join('\n')
    );
    uris.forEach((uri, i) => {
      const t: Timeline = {
        uri,
        createdAt: '2026-01-01T00:00:00Z',
        followers: 1000 * (i + 1),
        likes: 4,
        reposts: 0,
        quotes: 0,
        likeMinutes: [1, 5, 20, 40],
        likesComplete: true,
        reposterFollowers: []
      };
      const tdir = join(dir, 'threads', String(threadId(uri)));
      mkdirSync(tdir, { recursive: true });
      writeFileSync(join(tdir, 'timeline.json'), JSON.stringify(t));
    });
    const offline: FetchFn = async (url) => {
      throw new Error(`unexpected fetch ${url}`);
    };
    const { code, out } = await run(
      ['bluesky', join(dir, 'threads.txt')],
      offline
    );
    expect(code, out).toBe(0);
    expect(out).toContain('fit on 2 posts');
    expect(existsSync(join(dir, 'fit.json'))).toBe(true);
    expect(
      JSON.parse(readFileSync(join(dir, 'fit.json'), 'utf8')).constants
        .authorFollowers
    ).toBe(1500);
  });

  it('exits 1 for a platform without a fit and 2 without a file', async () => {
    const hn = await run(['hn', CSV]);
    expect(hn.code).toBe(1);
    expect(hn.out).toMatch(/hn has no fit/);
    expect((await run(['linkedin'])).code).toBe(2);
    expect((await run(['linkedin', CSV, '--followers', 'x'])).code).toBe(2);
  });
});
