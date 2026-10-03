import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makePersona, makePost } from '../test/fixtures.js';
import { EVENTS_FILE } from './events.js';
import { interview, personaTranscript } from './interview.js';
import { FakeLlm } from './llm.js';
import { PERSONAS_FILE, RUN_FILE } from './report.js';
import type { SimEvent } from './types.js';

const events: SimEvent[] = [
  { kind: 'post', step: 0, post: makePost() },
  { kind: 'visit', step: 0, actor: 'p1' },
  {
    kind: 'comment',
    step: 0,
    id: 'c1',
    parent: 'post',
    author: 'p1',
    text: 'P1 SAYS'
  },
  {
    kind: 'comment',
    step: 0,
    id: 'c2',
    parent: 'c1',
    author: 'p2',
    text: 'P2 REPLIES'
  },
  { kind: 'vote', step: 0, voter: 'p1', target: 'post', value: 'flag' },
  {
    kind: 'step-end',
    step: 0,
    score: 0,
    band: 'new',
    points: 1,
    flags: 1,
    calls: 2,
    failed: 0
  }
];

function runDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'iv-'));
  writeFileSync(
    join(dir, EVENTS_FILE),
    events.map((e) => JSON.stringify(e)).join('\n') + '\n'
  );
  writeFileSync(
    join(dir, PERSONAS_FILE),
    JSON.stringify({
      personas: [
        makePersona(1, { segment: 'a' }),
        makePersona(2, { segment: 'a', handle: 'bob' }),
        makePersona(3, { segment: 'b' })
      ],
      voters: []
    })
  );
  writeFileSync(
    join(dir, RUN_FILE),
    JSON.stringify({
      seedName: 's',
      variant: 'default',
      rngSeed: 1,
      personaSeed: 1,
      createdAt: '',
      founderAnswers: '',
      hypotheses: ''
    })
  );
  return dir;
}

describe('personaTranscript', () => {
  it('lists only that persona’s actions and replies to them', () => {
    const t = personaTranscript(events, 'p1');
    expect(t).toContain('P1 SAYS');
    expect(t).toContain('flag');
    expect(t).toContain('P2 REPLIES');
    expect(personaTranscript(events, 'p3')).toContain('did not visit');
  });
});

describe('interview', () => {
  it('interviews one persona by id or handle with opus and appends to interviews.md', async () => {
    const dir = runDir();
    const llm = new FakeLlm(() => ({
      answer: 'Because of telemetry.',
      stance: 'negative'
    }));
    const res = await interview(llm, dir, 'bob', 'Why?');
    expect(res.answers).toHaveLength(1);
    expect(res.answers[0]!.personaId).toBe('p2');
    expect(llm.requests[0]!.tier).toBe('opus');
    expect(readFileSync(join(dir, 'interviews.md'), 'utf8')).toContain(
      'Because of telemetry.'
    );
  });

  it('interviews a whole segment and tallies stances', async () => {
    const dir = runDir();
    const res = await interview(
      new FakeLlm(() => ({ answer: 'ok', stance: 'neutral' })),
      dir,
      'a',
      'Would you install it?'
    );
    expect(res.answers).toHaveLength(2);
    expect(res.markdown).toContain('neutral 2');
  });

  it('rejects unknown targets and lists segments', async () => {
    await expect(
      interview(new FakeLlm(() => ({})), runDir(), 'zzz', 'q')
    ).rejects.toThrow(/segments: a, b/);
  });
});
