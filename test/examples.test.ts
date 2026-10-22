import { cpSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import { FakeLlm, type LlmRequest } from '../src/llm.js';
import { loadPlatform } from '../src/platforms/index.js';
import { loadSeed } from '../src/seed.js';
import { personaHandler } from './fixtures.js';

const EXAMPLES = fileURLToPath(new URL('../examples', import.meta.url));

/** Agents comment once and give no reaction (valid on every platform); the founder stays quiet. */
function world(req: LlmRequest<unknown>): unknown {
  if (
    req.label.startsWith('personas') ||
    req.label.startsWith('voter-profiles')
  )
    return personaHandler(req);
  if (req.label.startsWith('agent:'))
    return {
      vote: 'none',
      upvoteComments: [],
      comment: { parent: 'post', text: 'Is it open source?' },
      leave: true
    };
  if (req.label.startsWith('voters:')) return { ballots: [] };
  if (req.label.startsWith('founder:')) return { replies: [] };
  if (req.label.startsWith('labels')) {
    const ids = [...req.prompt.matchAll(/^\[(c\d+)\]/gm)].map((m) => m[1]);
    return {
      labels: ids.map((id) => ({ id, label: 'question', sentiment: 0 }))
    };
  }
  if (req.label === 'report')
    return {
      topObjections: 'none',
      changes: 'none',
      riskiestComments: 'none',
      founderReplies: 'none',
      hypotheses: 'none'
    };
  throw new Error(`unexpected ${req.label}`);
}

describe('example seeds', () => {
  const names = readdirSync(EXAMPLES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  it('cover every platform', async () => {
    const platforms = new Set(
      names.map((n) => loadSeed(join(EXAMPLES, n)).platform)
    );
    expect([...platforms].sort()).toEqual([
      'bluesky',
      'hn',
      'linkedin',
      'reddit',
      'x'
    ]);
  });

  it.each(names)('%s runs with the fake LLM and reports', async (name) => {
    const root = mkdtempSync(join(tmpdir(), 'example-'));
    const seedDir = join(root, 'seeds', name);
    cpSync(join(EXAMPLES, name), seedDir, { recursive: true });
    const logs: string[] = [];
    const code = await main(['run', seedDir, '--steps', '1'], {
      makeLlm: () => new FakeLlm(world),
      now: () => new Date('2026-10-20T09:00:00Z'),
      log: (m: string) => void logs.push(m)
    });
    expect(code, logs.join('\n')).toBe(0);
    const [run] = readdirSync(join(root, 'runs'));
    const report = readFileSync(join(root, 'runs', run!, 'report.md'), 'utf8');
    const seed = loadSeed(seedDir);
    const platform = await loadPlatform(
      seed.platform,
      seed.options,
      seed.author
    );
    const post = JSON.parse(
      readFileSync(join(root, 'runs', run!, 'events.jsonl'), 'utf8').split(
        '\n'
      )[0]!
    ) as { post: Parameters<typeof platform.reportTitle>[0] };
    expect(report).toContain(`# ${platform.reportTitle(post.post)}`);
  });
});
