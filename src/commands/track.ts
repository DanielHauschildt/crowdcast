import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { pollLoop, type Snapshot } from '../hn-timeline.js';
import type { FetchFn } from '../hn-users.js';
import { fitMarkdown, fitSchedule, type Timeline } from '../schedule-fit.js';

export const TRACK_USAGE = `  crowdcast track [--hours 6] [--interval-min 5] [--dir simulations/timelines]
  crowdcast track fit [--dir simulations/timelines]`;

const OPTIONS = {
  hours: { type: 'string', default: '6' },
  'interval-min': { type: 'string', default: '5' },
  dir: { type: 'string', default: 'simulations/timelines' }
} as const;

export interface TrackDeps {
  fetchFn?: FetchFn;
  log: (msg: string) => void;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

function positive(raw: string, flag: string): number {
  const n = Number(raw);
  if (!(n > 0))
    throw new Error(`--${flag} must be a positive number, got ${raw}`);
  return n;
}

function parseLines(text: string): Snapshot[] {
  return text.split('\n').flatMap((line) => {
    try {
      return line ? [JSON.parse(line) as Snapshot] : [];
    } catch {
      return []; // a line cut off by a killed collector
    }
  });
}

export function loadTimelines(dataDir: string): Timeline[] {
  if (!existsSync(dataDir)) return [];
  return readdirSync(dataDir)
    .filter((f) => /^\d+\.jsonl$/.test(f))
    .map((f) => ({
      id: f.replace('.jsonl', ''),
      snapshots: parseLines(readFileSync(join(dataDir, f), 'utf8'))
    }));
}

export async function track(argv: string[], deps: TrackDeps): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: OPTIONS,
      allowPositionals: true
    });
  } catch (err) {
    deps.log(`${(err as Error).message}\nusage:\n${TRACK_USAGE}`);
    return 2;
  }
  try {
    await runTrack(parsed.values, parsed.positionals, deps);
    return 0;
  } catch (err) {
    deps.log(`error: ${(err as Error).message}`);
    return 1;
  }
}

type Values = ReturnType<
  typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>
>['values'];

async function runTrack(
  values: Values,
  positionals: string[],
  deps: TrackDeps
): Promise<void> {
  const dataDir = join(values.dir, 'data');
  if (positionals[0] === 'fit') {
    const fit = fitSchedule(loadTimelines(dataDir));
    writeFileSync(join(values.dir, 'fit.json'), JSON.stringify(fit, null, 2));
    writeFileSync(join(values.dir, 'fit.md'), fitMarkdown(fit));
    deps.log(
      `fit over ${fit.stories} stories → ${join(values.dir, 'fit.md')}, fit.json`
    );
    return;
  }
  if (positionals.length > 0)
    throw new Error(
      `unknown track argument: ${positionals[0]}\n${TRACK_USAGE}`
    );
  const intervalMs = positive(values['interval-min'], 'interval-min') * 60e3;
  const hours = positive(values.hours, 'hours');
  const cycles = await pollLoop({
    fetchFn: deps.fetchFn ?? fetch,
    dataDir,
    concurrency: 4,
    now: () => (deps.now?.() ?? new Date()).getTime(),
    sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    log: deps.log,
    hours,
    intervalMs
  });
  deps.log(`tracked ${cycles} cycles into ${dataDir}`);
}
