import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  makePersona,
  makePost,
  makeSeed,
  makeVoter
} from '../../../test/fixtures.js';
import { runSimulation } from '../../engine.js';
import { FakeLlm, type LlmRequest } from '../../llm.js';
import type { Metrics } from '../../metrics.js';
import {
  DISCLAIMER,
  PERSONAS_FILE,
  RUN_FILE,
  writeReport,
  type RunMeta
} from '../../report.js';
import type { PersonaSet } from '../../types.js';
import { loadPlatform } from '../index.js';
import { X_DISCLAIMER } from './prompts.js';

const personas: PersonaSet = {
  personas: Array.from({ length: 6 }, (_, i) =>
    makePersona(i + 1, { activity: 1 })
  ),
  voters: Array.from({ length: 30 }, (_, i) => makeVoter(i + 1))
};

/** Agents bookmark and reply once; voters like; the founder answers the first reply. */
function world(req: LlmRequest<unknown>): unknown {
  if (req.label.startsWith('agent:')) {
    const commented = req.prompt.includes(
      'Your earlier comments in this thread:\n['
    );
    return {
      vote: 'bookmark',
      upvoteComments: [],
      comment: commented
        ? null
        : { parent: 'post', text: 'does it do log axes?' },
      leave: commented
    };
  }
  if (req.label.startsWith('voters:'))
    return {
      ballots: [...req.prompt.matchAll(/- (v\d+):/g)].map((m) => ({
        voterId: m[1],
        postVote: 'like',
        commentVotes: []
      }))
    };
  if (req.label.startsWith('founder:'))
    return { replies: [{ parent: 'c1', text: 'Yes: --log-y.' }] };
  if (req.label.startsWith('labels')) {
    const ids = [...req.prompt.matchAll(/\[(c\d+)\]/g)].map((m) => m[1]);
    return {
      labels: [...new Set(ids)].map((id) => ({
        id,
        label: 'question',
        sentiment: 0
      }))
    };
  }
  if (req.label === 'report')
    return {
      topObjections: 'Log axes [c1].',
      changes: 'Mention log axes.',
      riskiestComments: '[c1]',
      founderReplies: 'Helped.',
      hypotheses: 'H1 open.'
    };
  throw new Error(`unexpected ${req.label}`);
}

describe('an X run end to end', () => {
  it('simulates, then reports with the X disclaimer on the report and thread.md', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'x-'));
    const platform = await loadPlatform('x', { audiencePool: 36 });
    const llm = new FakeLlm(world);
    const res = await runSimulation({
      post: makePost({ title: 'Tablecraft 1.0 is out', url: '' }),
      seed: makeSeed({ platform: 'x', author: { followers: 2000 } }),
      personas,
      llm,
      rngSeed: 1,
      runDir,
      platform,
      steps: 3
    });
    expect(res.aborted).toBeNull();
    expect(res.state.postReactions.bookmark).toBeGreaterThan(0);
    expect(res.state.postReactions.like).toBeGreaterThan(0);

    const meta: RunMeta = {
      platform: 'x',
      seedName: 'x-test',
      variant: 'default',
      rngSeed: 1,
      personaSeed: 1,
      createdAt: '2026-10-20T10:00:00Z',
      founderAnswers: '',
      hypotheses: 'H1'
    };
    writeFileSync(join(runDir, RUN_FILE), JSON.stringify(meta));
    writeFileSync(join(runDir, PERSONAS_FILE), JSON.stringify(personas));
    const md = readFileSync(await writeReport(llm, runDir), 'utf8');
    const first = `${DISCLAIMER} ${X_DISCLAIMER}`;
    expect(md.split('\n')[0]).toBe(first);
    expect(md).toContain('X launch rehearsal: Tablecraft 1.0 is out');
    expect(readFileSync(join(runDir, 'thread.md'), 'utf8').split('\n')[0]).toBe(
      first
    );
    const m = JSON.parse(
      readFileSync(join(runDir, 'metrics.json'), 'utf8')
    ) as Metrics;
    expect(m.steps).toHaveLength(3);
    for (const s of m.steps) expect(platform.bands).toContain(s.band);
    expect(m.founderReplies).toBeGreaterThan(0);
  });
});
