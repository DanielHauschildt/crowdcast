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
import { personaHandler } from '../../test/fixtures.js';
import { main } from '../cli.js';
import type { FetchFn } from '../hn.js';
import { FakeLlm, type LlmRequest } from '../llm.js';
import type { Platform } from '../platform.js';
import hn from '../platforms/hn/index.js';
import { selectIds } from '../scorecard.js';
import { backtest, defaultThreadsFile } from './backtest.js';

function workspace(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'bt-')), 'backtests');
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, 'threads.txt'),
    '# id  # title, points\n1  # One, 30\n2  # Two, 5\n3  # Three, 90\n'
  );
  writeFileSync(join(root, 'holdout.txt'), '4  # Four, 40\n5  # Five, 50\n');
  writeFileSync(
    join(root, 'segments.yaml'),
    'active: 12\nvoters: 20\nsegments:\n  - id: hn\n    share: 1\n    leanings: general\n'
  );
  return root;
}

const story = (id: number) => ({
  id,
  author: 'op',
  created_at: '2025-01-01T00:00:00Z',
  parent_id: null,
  title: `Show HN: Thing ${id}`,
  url: null,
  text: `Thing ${id} does stuff.`,
  points: id * 10,
  children: [
    {
      id: id * 100,
      author: 'bob',
      created_at: '2025-01-01T00:05:00Z',
      parent_id: id,
      text: 'How much does it cost?',
      children: []
    }
  ]
});

const fetchFn: FetchFn = async (url) => {
  const m = /items\/(\d+)$/.exec(url);
  if (!m || m[1] === '404')
    return { ok: false, status: 404, text: async () => '' };
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(story(Number(m[1])))
  };
};

function world(req: LlmRequest<unknown>): unknown {
  if (
    req.label.startsWith('personas') ||
    req.label.startsWith('voter-profiles')
  )
    return personaHandler(req);
  if (req.label.startsWith('agent:'))
    return {
      vote: 'up',
      upvoteComments: [],
      comment: { parent: 'post', text: 'cost?' },
      leave: true
    };
  if (req.label.startsWith('voters:')) return { ballots: [] };
  if (req.label.startsWith('founder:')) return { replies: [] };
  if (req.label.startsWith('labels')) {
    const ids = [...req.prompt.matchAll(/^\[([^\]]+)\]/gm)].map((m) => m[1]);
    return {
      labels: ids.map((id) => ({
        id,
        label: 'pricing/licensing',
        sentiment: 0
      }))
    };
  }
  if (req.label === 'themes') return { themes: ['cost'] };
  if (req.label === 'theme-recall') return { raised: [true] };
  throw new Error(req.label);
}

const deps = (logs: string[]) => ({
  makeLlm: () => new FakeLlm(world),
  now: () => new Date('2026-10-04T09:05:00Z'),
  log: (m: string) => void logs.push(m),
  fetch: fetchFn
});

describe('backtest command', () => {
  it('runs every listed thread, writes run dirs, a scorecard and a history row', async () => {
    const root = workspace();
    const logs: string[] = [];
    const code = await backtest(
      [
        '--threads',
        join(root, 'threads.txt'),
        '--steps',
        '2',
        '--parallel',
        '2'
      ],
      deps(logs)
    );
    expect(code).toBe(0);
    expect(readdirSync(join(root, 'runs')).sort()).toEqual([
      '20261004-0905-hn1-s1',
      '20261004-0905-hn2-s1',
      '20261004-0905-hn3-s1'
    ]);
    for (const id of ['1', '2', '3'])
      expect(existsSync(join(root, 'threads', id, 'real.json'))).toBe(true);
    expect(existsSync(join(root, 'personas', 'seed-1.json'))).toBe(true);
    const card = readFileSync(
      join(root, '20261004-0905', 'scorecard.md'),
      'utf8'
    );
    expect(card).toContain('| 3 | Show HN: Thing 3 | 30 |');
    expect(card).toContain('3/3');
    const history = readFileSync(join(root, 'history.md'), 'utf8');
    expect(history.match(/^\| 20261004-0905 /gm)).toHaveLength(1);
    expect(logs.join('\n')).toContain('scorecard.md');
  });

  it('takes ids as positionals and keeps going when one thread cannot be fetched', async () => {
    const root = workspace();
    const logs: string[] = [];
    const code = await backtest(
      ['404', '2', '--threads', join(root, 'threads.txt'), '--steps', '1'],
      deps(logs)
    );
    expect(code).toBe(0);
    expect(readdirSync(join(root, 'runs'))).toEqual(['20261004-0905-hn2-s1']);
    expect(logs.join('\n')).toMatch(/404.*HTTP 404/);
  });

  it('is reachable from the cli', async () => {
    const root = workspace();
    const code = await main(
      ['backtest', '2', '--threads', join(root, 'threads.txt'), '--steps', '1'],
      { ...deps([]) }
    );
    expect(code).toBe(0);
  });
});

describe('backtest thread sets', () => {
  const ran = (root: string): number[] =>
    readdirSync(join(root, 'runs'))
      .map((d) => Number(/-hn(\d+)-/.exec(d)![1]))
      .sort((a, b) => a - b);
  const run = (root: string, ...args: string[]) =>
    backtest(
      ['--threads', join(root, 'threads.txt'), '--steps', '1', ...args],
      deps([])
    );

  it('runs the holdout list and records the set and n in scorecard and history', async () => {
    const root = workspace();
    expect(await run(root, '--set', 'holdout')).toBe(0);
    expect(ran(root)).toEqual([4, 5]);
    const card = readFileSync(
      join(root, '20261004-0905', 'scorecard.md'),
      'utf8'
    );
    expect(card).toContain('2 real Show HN threads (holdout set)');
    const history = readFileSync(join(root, 'history.md'), 'utf8');
    expect(history).toMatch(/\| holdout \| 2 \|\n$/);
  });

  it('samples a seeded subset of all threads', async () => {
    const root = workspace();
    expect(
      await run(root, '--set', 'all', '--sample', '2', '--seed', '3')
    ).toBe(0);
    const expected = selectIds([1, 2, 3, 4, 5], { sample: 2, seed: 3 });
    expect(ran(root)).toEqual([...expected].sort((a, b) => a - b));
    expect(readFileSync(join(root, 'history.md'), 'utf8')).toMatch(
      /\| all \| 2 \|\n$/
    );
  });

  it('takes the first N of the train set with --limit', async () => {
    const root = workspace();
    expect(await run(root, '--limit', '2')).toBe(0);
    expect(ran(root)).toEqual([1, 2]);
  });

  it('rejects an unknown set or a non-positive sample', async () => {
    const root = workspace();
    expect(await run(root, '--set', 'dev')).toBe(2);
    expect(await run(root, '--sample', '0')).toBe(2);
  });
});

describe('backtest --platform', () => {
  it('defaults to hn and keeps HN lists at the top of simulations/backtests', () => {
    expect(defaultThreadsFile('hn')).toBe('simulations/backtests/threads.txt');
    expect(defaultThreadsFile('bluesky')).toBe(
      'simulations/backtests/bluesky/threads.txt'
    );
  });

  it('loads the platform and fetches its reference threads through it', async () => {
    const root = workspace();
    const loaded: string[] = [];
    const fetched: number[] = [];
    // The core reloads the platform by id when it writes the report, so the double keeps a real id.
    const traced: Platform = {
      ...hn,
      fetchReference: (id, f) => {
        fetched.push(id);
        return hn.fetchReference!(id, f);
      }
    };
    const code = await backtest(
      [
        '--platform',
        'hn',
        '--threads',
        join(root, 'threads.txt'),
        '--steps',
        '1'
      ],
      {
        ...deps([]),
        loadPlatform: async (id: string) => {
          loaded.push(id);
          return traced;
        }
      }
    );
    expect(code).toBe(0);
    expect(loaded).toEqual(['hn']);
    expect(fetched.sort()).toEqual([1, 2, 3]);
  });

  it('applies per-thread options from the list and keeps them in run.json', async () => {
    const root = workspace();
    writeFileSync(
      join(root, 'threads.txt'),
      '1 flavour=spicy  # One\n2  # Two\n'
    );
    const applied: Array<Record<string, unknown>> = [];
    const flavoured: Platform = {
      ...hn,
      withOptions: (options) => {
        applied.push(options);
        return {
          ...hn,
          agentRules: `${hn.agentRules} (${String(options.flavour)})`
        };
      }
    };
    const llm = new FakeLlm(world);
    const code = await backtest(
      ['--threads', join(root, 'threads.txt'), '--steps', '1'],
      { ...deps([]), makeLlm: () => llm, loadPlatform: async () => flavoured }
    );
    expect(code).toBe(0);
    expect(applied).toEqual([{ flavour: 'spicy' }]);
    const agentPrompts = llm.requests
      .filter((r) => r.label.startsWith('agent:'))
      .map((r) => r.prompt);
    expect(agentPrompts.some((p) => p.includes('(spicy)'))).toBe(true);
    const meta = (id: number) =>
      JSON.parse(
        readFileSync(
          join(root, 'runs', `20261004-0905-hn${id}-s1`, 'run.json'),
          'utf8'
        )
      ) as { options?: Record<string, unknown> };
    expect(meta(1).options).toEqual({ flavour: 'spicy' });
    expect(meta(2).options).toEqual({});
  });

  it('exits 1 naming the known platforms for an unknown id', async () => {
    const root = workspace();
    const logs: string[] = [];
    expect(
      await backtest(
        ['--platform', 'nope', '--threads', join(root, 'threads.txt')],
        deps(logs)
      )
    ).toBe(1);
    expect(logs.join('\n')).toMatch(/unknown platform "nope".*hn/);
  });
});

describe('backtest command errors', () => {
  it('exits 1 with the reason when the thread list is missing', async () => {
    const logs: string[] = [];
    expect(
      await backtest(['--threads', '/nonexistent/threads.txt'], deps(logs))
    ).toBe(1);
    expect(logs.join('\n')).toMatch(/error: .*threads\.txt/);
  });
});
