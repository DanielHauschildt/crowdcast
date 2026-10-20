import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  backtestThread,
  loadOrFetchThread,
  type ThreadScore
} from '../backtest.js';
import type { CliDeps } from '../cli.js';
import type { FetchFn } from '../hn.js';
import { loadOrGeneratePersonas } from '../personas.js';
import type { Platform } from '../platform.js';
import { DEFAULT_PLATFORM, loadPlatform } from '../platforms/index.js';
import {
  aggregate,
  historyRow,
  HISTORY_HEADER,
  parseThreadList,
  scorecardMarkdown,
  selectIds
} from '../scorecard.js';
import { parseSegments } from '../seed.js';
import type { Seed } from '../types.js';

export const BACKTEST_USAGE = `  crowdcast backtest [<id>…] [--platform hn] [--threads simulations/backtests[/<platform>]/threads.txt]
                     [--set train|holdout|all] [--sample N] [--limit N] [--steps 6] [--parallel 3] [--seed 1]
                     [--concurrency 4] [--max-calls 400] [--note "…"]`;

/** HN's lists predate platforms and stay at the top; other platforms get a folder each. */
export const defaultThreadsFile = (platform: string): string =>
  platform === DEFAULT_PLATFORM
    ? 'simulations/backtests/threads.txt'
    : `simulations/backtests/${platform}/threads.txt`;

type Deps = CliDeps & {
  fetch?: FetchFn;
  loadPlatform?: (id: string) => Promise<Platform>;
};

const OPTIONS = {
  platform: { type: 'string', default: DEFAULT_PLATFORM },
  threads: { type: 'string' },
  set: { type: 'string', default: 'train' },
  sample: { type: 'string' },
  limit: { type: 'string' },
  steps: { type: 'string', default: '6' },
  parallel: { type: 'string', default: '3' },
  seed: { type: 'string', default: '1' },
  concurrency: { type: 'string', default: '4' },
  'max-calls': { type: 'string', default: '400' },
  note: { type: 'string', default: '' }
} as const;

const pad = (n: number): string => String(n).padStart(2, '0');
const stampOf = (d: Date): string =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;

async function pool<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) await work(items[next++]!);
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane)
  );
}

export async function backtest(argv: string[], deps: Deps): Promise<number> {
  let v;
  let positionals;
  try {
    ({ values: v, positionals } = parseArgs({
      args: argv,
      options: OPTIONS,
      allowPositionals: true
    }));
  } catch (err) {
    deps.log(`${(err as Error).message}\nusage:\n${BACKTEST_USAGE}`);
    return 2;
  }
  try {
    return await runBacktest(v, positionals, deps);
  } catch (err) {
    deps.log(`error: ${(err as Error).message}`);
    return 1;
  }
}

type Values = ReturnType<
  typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>
>['values'];

async function runBacktest(
  v: Values,
  positionals: string[],
  deps: Deps
): Promise<number> {
  const platform = await (deps.loadPlatform ?? loadPlatform)(v.platform);
  const threadsFile = resolve(v.threads ?? defaultThreadsFile(platform.id));
  const root = dirname(threadsFile);
  const holdout = join(root, 'holdout.txt');
  const files: Partial<Record<string, string[]>> = {
    train: [threadsFile],
    holdout: [holdout],
    all: [threadsFile, holdout]
  };
  const lists = files[v.set];
  const count = (flag: string | undefined): number | undefined =>
    flag === undefined ? undefined : Number(flag);
  const sample = count(v.sample);
  const limit = count(v.limit);
  if (
    !lists ||
    [sample, limit].some(
      (n) => n !== undefined && !(Number.isInteger(n) && n > 0)
    )
  ) {
    deps.log(
      `backtest: --set is train, holdout or all; --sample and --limit are positive integers\nusage:\n${BACKTEST_USAGE}`
    );
    return 2;
  }
  const set = positionals.length > 0 ? 'ids' : v.set;
  const rngSeed = Number(v.seed);
  const ids =
    positionals.length > 0
      ? positionals.map(Number)
      : selectIds(
          lists.flatMap((f) => parseThreadList(readFileSync(f, 'utf8'))),
          { sample, limit, seed: rngSeed }
        );
  if (ids.length === 0 || ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    deps.log(`backtest: no valid thread ids\nusage:\n${BACKTEST_USAGE}`);
    return 2;
  }
  const steps = Number(v.steps);
  const concurrency = Number(v.concurrency);
  const segs = parseSegments(readFileSync(join(root, 'segments.yaml'), 'utf8'));
  const audience: Seed = {
    name: 'backtest',
    dir: root,
    context: '',
    founderAnswers: '',
    hypotheses: '',
    segments: segs.segments,
    activeCount: segs.active,
    voterCount: segs.voters
  };
  const personas = await loadOrGeneratePersonas(
    deps.makeLlm({ concurrency }),
    audience,
    join(root, 'personas', `seed-${rngSeed}.json`),
    platform
  );
  const stamp = stampOf(deps.now());
  deps.log(
    `backtest ${stamp}: ${ids.length} threads (${set}), ${personas.personas.length} personas, ${personas.voters.length} voters, ${steps} steps`
  );

  const scores = new Map<number, ThreadScore>();
  await pool(ids, Number(v.parallel), async (id) => {
    try {
      const threadDir = join(root, 'threads', String(id));
      const real = await loadOrFetchThread(threadDir, id, deps.fetch, platform);
      const runDir = join(
        root,
        'runs',
        `${stamp}-${platform.id}${id}-s${rngSeed}`
      );
      mkdirSync(runDir, { recursive: true });
      const s = await backtestThread({
        llm: deps.makeLlm({
          concurrency,
          maxCalls: Number(v['max-calls']),
          logFile: join(runDir, 'calls.jsonl')
        }),
        real,
        threadDir,
        runDir,
        seed: { ...audience, name: `${platform.id}-${id}`, dir: threadDir },
        personas,
        steps,
        rngSeed,
        platform
      });
      scores.set(id, s);
      deps.log(
        `  ${id}: sim ${s.simPoints} pts / ${s.simComments} comments vs real ${s.realPoints} / ${s.realComments}` +
          (s.aborted ? ` (aborted: ${s.aborted})` : '')
      );
    } catch (err) {
      deps.log(`  ${id}: failed — ${(err as Error).message}`);
    }
  });

  const ordered = ids.flatMap((id) => scores.get(id) ?? []);
  if (ordered.length === 0) {
    deps.log('backtest: every thread failed');
    return 1;
  }
  const agg = aggregate(ordered, rngSeed);
  const meta = { stamp, steps, seed: rngSeed, set, platform: platform.id };
  const outDir = join(root, stamp);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'scorecard.md'),
    scorecardMarkdown(ordered, agg, meta)
  );
  writeFileSync(join(outDir, 'scores.json'), JSON.stringify(ordered, null, 2));
  const history = join(root, 'history.md');
  if (!existsSync(history))
    writeFileSync(history, `# Backtest history\n\n${HISTORY_HEADER}\n`);
  appendFileSync(
    history,
    `${historyRow(agg, { ...meta, n: ids.length, note: v.note || `${ordered.length} threads` })}\n`
  );
  deps.log(`scorecard: ${join(outDir, 'scorecard.md')}`);
  return 0;
}
