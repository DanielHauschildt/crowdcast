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
import { personaHandler } from '../test/fixtures.js';
import { main, runDirName } from './cli.js';
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

  it('compare runs every variant and writes compare.md', async () => {
    const { seedDir, root } = workspace();
    const code = await main(
      [
        'compare',
        seedDir,
        '--variants',
        'default,b',
        '--runs',
        '2',
        '--steps',
        '1'
      ],
      deps([])
    );
    expect(code).toBe(0);
    expect(readdirSync(join(root, 'runs'))).toHaveLength(4);
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

  it('reports usage errors with exit code 2', async () => {
    const logs: string[] = [];
    expect(await main(['nope'], deps(logs))).toBe(2);
    expect(logs.join('\n')).toMatch(/usage/i);
  });
});
