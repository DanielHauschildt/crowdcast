#!/usr/bin/env node
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { compareMarkdown, summarizeRun, type RunSummary } from './compare.js';
import { estimateCalls, runSimulation } from './engine.js';
import { interview } from './interview.js';
import { ClaudeCli, type Llm } from './llm.js';
import { loadOrGeneratePersonas } from './personas.js';
import {
  PERSONAS_FILE,
  RUN_FILE,
  writeReport,
  type RunMeta
} from './report.js';
import { DEFAULT_STEPS } from './schedule.js';
import { loadPost, loadSeed } from './seed.js';

export interface CliDeps {
  makeLlm: (opts: {
    logFile?: string;
    maxCalls?: number;
    concurrency: number;
  }) => Llm;
  now: () => Date;
  log: (msg: string) => void;
}

const defaults: CliDeps = {
  makeLlm: (opts) => new ClaudeCli(opts),
  now: () => new Date(),
  log: (msg) => console.log(msg)
};

const USAGE = `usage:
  crowdcast run <seedDir> [--variant default] [--seed 1] [--persona-seed N] [--runs 1]
                [--steps 12] [--max-calls 400] [--concurrency 8] [--dry-run] [--no-report]
                [--resume <runDir>]
  crowdcast compare <seedDir> --variants a,b[,c] [--runs 2] [same options as run]
  crowdcast report <runDir>
  crowdcast interview <runDir> <personaId|handle|segment> "<question>"`;

const pad = (n: number): string => String(n).padStart(2, '0');

export function runDirName(
  now: Date,
  seedName: string,
  variant: string,
  index: number
): string {
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;
  return `${stamp}-${seedName}-${variant}-r${index}`;
}

const OPTIONS = {
  variant: { type: 'string', default: 'default' },
  variants: { type: 'string' },
  seed: { type: 'string', default: '1' },
  'persona-seed': { type: 'string' },
  runs: { type: 'string' },
  steps: { type: 'string', default: String(DEFAULT_STEPS) },
  'max-calls': { type: 'string', default: '400' },
  concurrency: { type: 'string', default: '8' },
  'dry-run': { type: 'boolean', default: false },
  'no-report': { type: 'boolean', default: false },
  resume: { type: 'string' }
} as const;

type Values = ReturnType<
  typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>
>['values'];

async function runOne(
  deps: CliDeps,
  seedDir: string,
  variant: string,
  index: number,
  v: Values
): Promise<string> {
  const seed = loadSeed(seedDir);
  const post = loadPost(seed, variant);
  const rngSeed = Number(v.seed);
  const personaSeed = Number(v['persona-seed'] ?? v.seed);
  const steps = Number(v.steps);
  const concurrency = Number(v.concurrency);
  const personaLlm = deps.makeLlm({ concurrency, logFile: undefined });
  const personas = await loadOrGeneratePersonas(
    personaLlm,
    seed,
    join(seed.dir, 'personas', `seed-${personaSeed}.json`)
  );

  if (v['dry-run']) {
    const est = estimateCalls(personas, steps);
    deps.log(`estimated calls for ${variant}: ${JSON.stringify(est)}`);
    return '';
  }

  const runsRoot = resolve(seed.dir, '..', '..', 'runs');
  const runDir = v.resume
    ? resolve(v.resume)
    : join(runsRoot, runDirName(deps.now(), seed.name, variant, index));
  mkdirSync(runDir, { recursive: true });
  const meta: RunMeta = {
    seedName: seed.name,
    variant,
    rngSeed: rngSeed + index - 1,
    personaSeed,
    createdAt: deps.now().toISOString(),
    founderAnswers: seed.founderAnswers,
    hypotheses: seed.hypotheses
  };
  writeFileSync(join(runDir, RUN_FILE), JSON.stringify(meta, null, 2));
  writeFileSync(join(runDir, PERSONAS_FILE), JSON.stringify(personas, null, 2));

  const llm = deps.makeLlm({
    concurrency,
    maxCalls: Number(v['max-calls']),
    logFile: join(runDir, 'calls.jsonl')
  });
  deps.log(
    `run ${basename(runDir)}: ${personas.personas.length} personas, ${personas.voters.length} voters, ${steps} steps`
  );
  const res = await runSimulation({
    post,
    seed,
    personas,
    llm,
    rngSeed: meta.rngSeed,
    runDir,
    steps,
    onStep: (e) =>
      deps.log(
        `  step ${e.step + 1}/${steps}: ${e.points} points, band ${e.band}, ${e.calls} calls (${e.failed} failed)`
      )
  });
  if (res.aborted)
    deps.log(
      `  aborted: ${res.aborted} — partial log kept; resume with --resume ${runDir}`
    );
  if (!v['no-report']) deps.log(`  report: ${await writeReport(llm, runDir)}`);
  return runDir;
}

export async function main(
  argv: string[],
  partial: Partial<CliDeps> = {}
): Promise<number> {
  const deps = { ...defaults, ...partial };
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: OPTIONS,
      allowPositionals: true
    });
  } catch (err) {
    deps.log(`${(err as Error).message}\n${USAGE}`);
    return 2;
  }
  const [cmd, ...pos] = parsed.positionals;
  const v = parsed.values;
  try {
    switch (cmd) {
      case 'run': {
        if (!pos[0]) break;
        const runs = Number(v.runs ?? 1);
        for (let i = 1; i <= runs; i++)
          await runOne(deps, pos[0], v.variant, i, v);
        return 0;
      }
      case 'compare': {
        if (!pos[0] || !v.variants) break;
        const variants = v.variants
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const runs = Number(v.runs ?? 2);
        const summaries: RunSummary[] = [];
        for (const variant of variants) {
          for (let i = 1; i <= runs; i++) {
            const runDir = await runOne(deps, pos[0], variant, i, v);
            if (runDir)
              summaries.push(
                await summarizeRun(
                  deps.makeLlm({ concurrency: Number(v.concurrency) }),
                  runDir,
                  variant,
                  i
                )
              );
          }
        }
        if (summaries.length === 0) return 0;
        const seed = loadSeed(pos[0]);
        const dir = join(
          resolve(seed.dir, '..', '..', 'compares'),
          `${runDirName(deps.now(), seed.name, 'compare', 1)}`
        );
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, 'compare.md'),
          compareMarkdown(seed.name, summaries)
        );
        deps.log(`compare: ${join(dir, 'compare.md')}`);
        return 0;
      }
      case 'report': {
        if (!pos[0]) break;
        const runDir = resolve(pos[0]);
        deps.log(
          `report: ${await writeReport(deps.makeLlm({ concurrency: Number(v.concurrency), logFile: join(runDir, 'calls.jsonl') }), runDir)}`
        );
        return 0;
      }
      case 'interview': {
        if (pos.length < 3) break;
        const [runDir, target, ...question] = pos;
        const res = await interview(
          deps.makeLlm({ concurrency: Number(v.concurrency) }),
          resolve(runDir!),
          target!,
          question.join(' ')
        );
        deps.log(res.markdown);
        return 0;
      }
    }
  } catch (err) {
    deps.log(`error: ${(err as Error).message}`);
    return 1;
  }
  deps.log(USAGE);
  return 2;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  void main(process.argv.slice(2)).then((code) => process.exit(code));
}
