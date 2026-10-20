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
  PERSONAS_FILE,
  RUN_FILE,
  writeReport,
  type RunMeta
} from '../../report.js';
import type { PersonaSet } from '../../types.js';
import { loadPlatform } from '../index.js';
import { QUOTE_PREFIX } from './prompts.js';

const personas: PersonaSet = {
  personas: Array.from({ length: 6 }, (_, i) =>
    makePersona(i + 1, { activity: 1 })
  ),
  voters: Array.from({ length: 30 }, (_, i) => makeVoter(i + 1))
};

/** Agents repost and quote once; voters like; the report cites the first quote. */
function world(req: LlmRequest<unknown>): unknown {
  if (req.label.startsWith('agent:')) {
    const commented = req.prompt.includes(
      'Your earlier comments in this thread:\n['
    );
    return {
      vote: 'repost',
      upvoteComments: [],
      comment: commented
        ? null
        : { parent: 'post', text: `${QUOTE_PREFIX}worth a look` },
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
  if (req.label.startsWith('founder:')) return { replies: [] };
  if (req.label.startsWith('labels')) {
    const ids = [...req.prompt.matchAll(/\[(c\d+)\]/g)].map((m) => m[1]);
    return {
      labels: [...new Set(ids)].map((id) => ({
        id,
        label: 'praise',
        sentiment: 1
      }))
    };
  }
  if (req.label === 'report')
    return {
      topObjections: 'None raised [c1].',
      changes: 'Post earlier.',
      riskiestComments: '[c1]',
      founderReplies: 'None.',
      hypotheses: 'H1 open.'
    };
  throw new Error(`unexpected ${req.label}`);
}

describe('a Bluesky run end to end', () => {
  it('simulates, then labels, measures and reports with the platform reloaded by id', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'bsky-'));
    const platform = await loadPlatform('bluesky', { audiencePool: 36 });
    const llm = new FakeLlm(world);
    const res = await runSimulation({
      post: makePost({ title: 'Gridline 1.0 is out' }),
      seed: makeSeed({ platform: 'bluesky', author: { followers: 2000 } }),
      personas,
      llm,
      rngSeed: 1,
      runDir,
      platform,
      steps: 3
    });
    expect(res.aborted).toBeNull();
    expect(res.state.postReactions.repost).toBeGreaterThan(0);
    expect(res.state.postReactions.like).toBeGreaterThan(0);

    const meta: RunMeta = {
      platform: 'bluesky',
      seedName: 'bluesky-test',
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
    expect(md).toContain('Bluesky launch rehearsal: Gridline 1.0 is out');
    const m = JSON.parse(
      readFileSync(join(runDir, 'metrics.json'), 'utf8')
    ) as Metrics;
    expect(m.steps).toHaveLength(3);
    for (const s of m.steps) expect(platform.bands).toContain(s.band);
    expect(m.frontPage).toBe(['viral', 'spreading'].includes(m.peakBand));
    expect(m.objectionMix.praise).toBeGreaterThan(0);
  });
});
