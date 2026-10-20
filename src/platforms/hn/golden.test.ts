import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  makePersona,
  makePost,
  makeSeed,
  makeVoter,
  personaHandler
} from '../../../test/fixtures.js';
import { backtestThread } from '../../backtest.js';
import { runSimulation } from '../../engine.js';
import { readEvents } from '../../events.js';
import { interview } from '../../interview.js';
import { LABELS } from '../../label.js';
import { FakeLlm, type LlmRequest } from '../../llm.js';
import { generatePersonas } from '../../personas.js';
import type { Platform, RealThread } from '../../platform.js';
import {
  PERSONAS_FILE,
  RUN_FILE,
  writeReport,
  type RunMeta
} from '../../report.js';
import type { PersonaSet, SimEvent } from '../../types.js';
import { loadPlatform } from '../index.js';

const GOLDEN_FILE = fileURLToPath(
  new URL('./golden-events.jsonl', import.meta.url)
);
const PROMPTS_FILE = fileURLToPath(
  new URL('./golden-prompts.txt', import.meta.url)
);

/** A deterministic hash so the scripted world varies by request without randomness. */
const hash = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
};

const ids = (prompt: string): string[] => [
  ...new Set([...prompt.matchAll(/\[(c\d+)\]/g)].map((m) => m[1]!))
];

function goldenWorld(req: LlmRequest<unknown>): unknown {
  const h = hash(req.label + req.prompt);
  if (req.label.startsWith('agent:')) {
    const seen = ids(req.prompt.split('Your earlier comments')[0]!);
    return {
      vote: ['up', 'none', 'up', 'up', 'none', 'up', 'none', 'flag'][h % 8],
      upvoteComments: seen.filter((_, i) => (h >> i) % 3 === 0),
      comment:
        h % 4 === 0
          ? null
          : {
              parent:
                h % 3 === 0 || seen.length === 0
                  ? 'post'
                  : seen[h % seen.length]!,
              text: `note ${h % 1000} from ${req.label}`
            },
      leave: h % 7 === 0
    };
  }
  if (req.label.startsWith('voters:')) {
    const shown = ids(req.prompt);
    const voters = [...req.prompt.matchAll(/- (v\d+):/g)].map((m) => m[1]!);
    return {
      ballots: voters.map((voterId, i) => {
        const v = hash(voterId + req.label);
        return {
          voterId,
          postVote: (v + i) % 23 === 0 ? 'flag' : (v + i) % 2 ? 'up' : 'none',
          commentVotes: shown
            .filter((_, j) => (v >> j) % 4 === 0)
            .map((id, j) => ({ id, vote: j % 9 === 8 ? 'flag' : 'up' }))
        };
      })
    };
  }
  if (req.label.startsWith('founder:')) {
    const seen = ids(req.prompt);
    return {
      replies: seen
        .filter((_, i) => (h >> i) % 3 === 0)
        .slice(0, 3)
        .map((parent) => ({ parent, text: `answer to ${parent}` }))
    };
  }
  if (req.label.startsWith('labels:'))
    return {
      labels: [...req.prompt.matchAll(/^\[(c\d+)\]/gm)].map((m, i) => ({
        id: m[1],
        label: LABELS[(h + i) % LABELS.length],
        sentiment: ((h + i) % 5) - 2
      }))
    };
  if (req.label === 'report')
    return Object.fromEntries(
      ['topObjections', 'changes', 'riskiestComments', 'founderReplies']
        .map((k) => [k, `see [c1] (${k})`])
        .concat([['hypotheses', 'nothing']])
    );
  if (req.label.startsWith('interview:'))
    return { answer: 'It was fine.', stance: 'neutral' };
  if (req.label === 'themes') return { themes: ['fonts', 'pricing'] };
  if (req.label === 'theme-recall') return { raised: [true, false] };
  if (req.label.startsWith('personas') || req.label.startsWith('voter-'))
    return personaHandler(req);
  throw new Error(`unexpected ${req.label}`);
}

const sha = (x: unknown): string =>
  createHash('sha1')
    .update(typeof x === 'string' ? x : JSON.stringify(x))
    .digest('hex')
    .slice(0, 12);

/** One line per request: label, tier and hashes of system, prompt and schema. */
const shapes = (llm: FakeLlm): string[] =>
  llm.requests.map(
    (r) =>
      `${r.label} ${r.tier} ${sha(r.system)} ${sha(r.prompt)} ${sha(r.schema)}`
  );

const goldenPersonas: PersonaSet = {
  personas: Array.from({ length: 8 }, (_, i) =>
    makePersona(i + 1, { activity: 0.6 + (i % 3) * 0.2 })
  ),
  voters: Array.from({ length: 45 }, (_, i) => makeVoter(i + 1))
};

async function goldenRun(platform?: Platform): Promise<SimEvent[]> {
  const res = await runSimulation({
    post: makePost({ firstComment: 'Hi HN, I built this.' }),
    seed: makeSeed(),
    personas: goldenPersonas,
    llm: new FakeLlm(goldenWorld),
    rngSeed: 3,
    runDir: mkdtempSync(join(tmpdir(), 'golden-')),
    maxErrorRate: 1,
    platform
  });
  return res.events;
}

/** Every prompt the HN path sends: simulation, labels, report, interview, personas, backtest. */
async function goldenPrompts(): Promise<string[]> {
  const llm = new FakeLlm(goldenWorld);
  const runDir = mkdtempSync(join(tmpdir(), 'golden-'));
  const seed = makeSeed();
  const meta: RunMeta = {
    seedName: seed.name,
    variant: 'default',
    rngSeed: 3,
    personaSeed: 3,
    createdAt: '2026-10-20T00:00:00.000Z',
    founderAnswers: seed.founderAnswers,
    hypotheses: seed.hypotheses
  };
  writeFileSync(join(runDir, RUN_FILE), JSON.stringify(meta));
  writeFileSync(join(runDir, PERSONAS_FILE), JSON.stringify(goldenPersonas));
  await runSimulation({
    post: makePost({ firstComment: 'Hi HN, I built this.' }),
    seed,
    personas: goldenPersonas,
    llm,
    rngSeed: 3,
    runDir,
    steps: 3,
    maxErrorRate: 1
  });
  await writeReport(llm, runDir);
  await interview(llm, runDir, 'p1', 'Would you try it?');
  await generatePersonas(llm, seed);
  const real: RealThread = {
    id: 1,
    post: makePost(),
    comments: [
      {
        id: '11',
        parent: 'post',
        author: 'alice',
        createdAt: '2026-01-01T00:00:00Z',
        text: 'How are fonts handled?'
      },
      {
        id: '12',
        parent: '11',
        author: 'op',
        createdAt: '2026-01-01T00:10:00Z',
        text: 'Embedded.'
      }
    ],
    points: 12,
    op: 'op',
    context: 'README'
  };
  await backtestThread({
    llm,
    real,
    threadDir: mkdtempSync(join(tmpdir(), 'golden-t-')),
    runDir: mkdtempSync(join(tmpdir(), 'golden-b-')),
    seed,
    personas: goldenPersonas,
    steps: 2,
    rngSeed: 3
  });
  return shapes(llm);
}

// UPDATE_GOLDEN=1 rewrites both fixtures; only for a deliberate HN behaviour change.
if (process.env.UPDATE_GOLDEN === '1') {
  const events = await goldenRun();
  writeFileSync(
    GOLDEN_FILE,
    events.map((e) => JSON.stringify(e)).join('\n') + '\n'
  );
  writeFileSync(PROMPTS_FILE, (await goldenPrompts()).join('\n') + '\n');
}

describe('HN golden run', () => {
  it('produces the same events as before the platform refactor', async () => {
    expect(await goldenRun()).toEqual(readEvents(GOLDEN_FILE));
  });

  it('is the same when hn is loaded by id', async () => {
    expect(await goldenRun(await loadPlatform('hn'))).toEqual(
      readEvents(GOLDEN_FILE)
    );
  });

  it('sends byte-identical prompts and schemas', async () => {
    expect((await goldenPrompts()).join('\n') + '\n').toEqual(
      readFileSync(PROMPTS_FILE, 'utf8')
    );
  });
});
