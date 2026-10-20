import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makePersona, makeVoter, personaHandler } from '../test/fixtures.js';
import { main, runDirName } from './cli.js';
import type { FetchFn } from './hn-users.js';
import { FakeLlm, type LlmRequest } from './llm.js';

function workspace(): { seedDir: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'ws-'));
  const seedDir = join(root, 'seeds', 'demo');
  mkdirSync(join(seedDir, 'variants'), { recursive: true });
  writeFileSync(
    join(seedDir, 'post.md'),
    '---\ntitle: "Show HN: Demo"\n---\nBody\n'
  );
  writeFileSync(
    join(seedDir, 'variants', 'b.md'),
    '---\ntitle: "Show HN: Demo B"\n---\nBody B\n'
  );
  writeFileSync(join(seedDir, 'context.md'), 'README');
  writeFileSync(join(seedDir, 'founder-answers.md'), 'answers');
  writeFileSync(
    join(seedDir, 'segments.yaml'),
    'active: 4\nvoters: 10\nsegments:\n  - id: a\n    share: 1\n    leanings: curious\n'
  );
  return { seedDir, root };
}

function everything(req: LlmRequest<unknown>): unknown {
  if (
    req.label.startsWith('personas') ||
    req.label.startsWith('voter-profiles')
  )
    return personaHandler(req);
  if (req.label.startsWith('agent:'))
    return {
      vote: 'up',
      upvoteComments: [],
      comment: { parent: 'post', text: 'nice [c1]' },
      leave: true
    };
  if (req.label.startsWith('voters:')) return { ballots: [] };
  if (req.label.startsWith('founder:')) return { replies: [] };
  if (req.label.startsWith('labels')) {
    const ids = [...req.prompt.matchAll(/^\[(c\d+)\]/gm)].map((m) => m[1]);
    return { labels: ids.map((id) => ({ id, label: 'praise', sentiment: 1 })) };
  }
  if (req.label === 'report')
    return {
      topObjections: 'none',
      changes: 'none',
      riskiestComments: 'none',
      founderReplies: 'none',
      hypotheses: 'none'
    };
  if (req.label.startsWith('interview'))
    return { answer: 'fine', stance: 'positive' };
  throw new Error(req.label);
}

const deps = (logs: string[]) => ({
  makeLlm: () => new FakeLlm(everything),
  now: () => new Date('2026-10-03T09:05:00Z'),
  log: (m: string) => void logs.push(m)
});

describe('cli', () => {
  it('names run dirs by time, seed, variant and index', () => {
    expect(runDirName(new Date('2026-10-03T09:05:00Z'), 'demo', 'b', 2)).toBe(
      '20261003-0905-demo-b-r2'
    );
  });

  it('dry-run only generates personas, then prints an estimate', async () => {
    const { seedDir, root } = workspace();
    const logs: string[] = [];
    const llms: FakeLlm[] = [];
    const makeLlm = () => {
      const llm = new FakeLlm(everything);
      llms.push(llm);
      return llm;
    };
    expect(
      await main(['run', seedDir, '--dry-run'], { ...deps(logs), makeLlm })
    ).toBe(0);
    expect(logs.join('\n')).toMatch(/estimated calls/i);
    const labels = llms.flatMap((l) => l.requests.map((r) => r.label));
    expect(labels.every((l) => /^(personas|voter-profiles)/.test(l))).toBe(
      true
    );
    expect(existsSync(join(root, 'runs'))).toBe(false);
  });

  it('run writes a complete run dir under simulations/runs', async () => {
    const { seedDir, root } = workspace();
    const code = await main(['run', seedDir, '--steps', '2'], deps([]));
    expect(code).toBe(0);
    const runs = readdirSync(join(root, 'runs'));
    expect(runs).toEqual(['20261003-0905-demo-default-r1']);
    for (const f of [
      'run.json',
      'personas.json',
      'events.jsonl',
      'thread.md',
      'metrics.json',
      'report.md'
    ]) {
      expect(existsSync(join(root, 'runs', runs[0]!, f))).toBe(true);
    }
    expect(existsSync(join(seedDir, 'personas', 'seed-1.json'))).toBe(true);
  });

  it('takes the platform from platform.yaml, --platform overrides it', async () => {
    const { seedDir, root } = workspace();
    writeFileSync(join(seedDir, 'platform.yaml'), 'platform: nope\n');
    const logs: string[] = [];
    expect(await main(['run', seedDir, '--no-report'], deps(logs))).toBe(1);
    expect(logs.join('\n')).toMatch(/unknown platform "nope"; known: .*\bhn\b/);
    expect(
      await main(['run', seedDir, '--platform', 'hn', '--no-report'], deps([]))
    ).toBe(0);
    const [run] = readdirSync(join(root, 'runs'));
    const meta = JSON.parse(
      readFileSync(join(root, 'runs', run!, 'run.json'), 'utf8')
    ) as { platform: string };
    expect(meta.platform).toBe('hn');
    const ends = readFileSync(join(root, 'runs', run!, 'events.jsonl'), 'utf8')
      .split('\n')
      .filter((l) => l.includes('"step-end"'));
    expect(ends).toHaveLength(12);
  });

  it('compare runs every variant 3 times by default and writes compare.md', async () => {
    const { seedDir, root } = workspace();
    const code = await main(
      [
        'compare',
        seedDir,
        '--variants',
        'default,b',
        '--steps',
        '1',
        '--parallel',
        '2'
      ],
      deps([])
    );
    expect(code).toBe(0);
    expect(readdirSync(join(root, 'runs'))).toHaveLength(6);
    const [cmp] = readdirSync(join(root, 'compares'));
    expect(
      readFileSync(join(root, 'compares', cmp!, 'compare.md'), 'utf8')
    ).toContain('## b');
  });

  it('interview answers from an existing run', async () => {
    const { seedDir, root } = workspace();
    await main(['run', seedDir, '--steps', '1', '--no-report'], deps([]));
    const [run] = readdirSync(join(root, 'runs'));
    const logs: string[] = [];
    expect(
      await main(
        ['interview', join(root, 'runs', run!), 'a', 'Would you use it?'],
        deps(logs)
      )
    ).toBe(0);
    expect(logs.join('\n')).toContain('fine');
  });

  it('run --persona-file uses that persona set instead of generating one', async () => {
    const { seedDir, root } = workspace();
    const file = join(root, 'hn.json');
    const set = {
      personas: [makePersona(1, { id: 'h1', handle: 'from_file' })],
      voters: [makeVoter(1)]
    };
    writeFileSync(file, JSON.stringify(set));
    const llms: FakeLlm[] = [];
    const makeLlm = () => {
      const llm = new FakeLlm(everything);
      llms.push(llm);
      return llm;
    };
    expect(
      await main(
        ['run', seedDir, '--persona-file', file, '--steps', '1', '--no-report'],
        { ...deps([]), makeLlm }
      )
    ).toBe(0);
    const labels = llms.flatMap((l) => l.requests.map((r) => r.label));
    expect(labels.some((l) => /^(personas|voter-profiles)/.test(l))).toBe(
      false
    );
    const [run] = readdirSync(join(root, 'runs'));
    expect(
      readFileSync(join(root, 'runs', run!, 'personas.json'), 'utf8')
    ).toContain('from_file');
    expect(existsSync(join(seedDir, 'personas', 'seed-1.json'))).toBe(false);
  });

  it('personas-from-hn writes personas/hn.json into the seed', async () => {
    const { seedDir } = workspace();
    const fetchFn: FetchFn = async (url) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.includes('/items/')
          ? { author: 'op', children: [{ author: 'someone' }] }
          : {
              hits: ['one two', 'three four', 'five six'].map((t) => ({
                comment_text: t,
                created_at: '2026-09-01T00:00:00Z'
              }))
            }
    });
    const makeLlm = () =>
      new FakeLlm((req) =>
        req.label.startsWith('hn-persona')
          ? {
              segment: 'a',
              bio: 'b',
              expertise: [],
              aiAttitude: 0,
              verbosity: 2,
              contrarian: 0.5,
              activity: 0.5,
              voiceSample: 'v'
            }
          : everything(req)
      );
    expect(
      await main(['personas-from-hn', seedDir, '--threads', '1,2'], {
        ...deps([]),
        makeLlm,
        fetchFn
      })
    ).toBe(0);
    const set = JSON.parse(
      readFileSync(join(seedDir, 'personas', 'hn.json'), 'utf8')
    ) as { personas: unknown[] };
    expect(set.personas).toHaveLength(1);
  });

  it('reports usage errors with exit code 2', async () => {
    const logs: string[] = [];
    expect(await main(['nope'], deps(logs))).toBe(2);
    expect(logs.join('\n')).toMatch(/usage/i);
  });

  it('track fit writes fit.md from <dir>/data', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'track-'));
    mkdirSync(join(dir, 'data'));
    writeFileSync(
      join(dir, 'data', '1.jsonl'),
      '{"t":"","ageMin":5,"points":2,"comments":0,"rankTop":null}\n'
    );
    expect(await main(['track', 'fit', '--dir', dir], deps([]))).toBe(0);
    expect(readFileSync(join(dir, 'fit.md'), 'utf8')).toMatch(/1 stories/);
    expect(await main(['track', 'nope'], deps([]))).toBe(1);
  });
});
