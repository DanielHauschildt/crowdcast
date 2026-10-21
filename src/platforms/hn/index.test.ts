import { describe, expect, it } from 'vitest';
import { makePersona, makePost } from '../../../test/fixtures.js';
import type { Platform } from '../../platform.js';
import { emptyThread } from '../../thread.js';
import { loadPlatform } from '../index.js';

describe('loadPlatform', () => {
  it('loads hn, which satisfies the Platform interface', async () => {
    const p: Platform = await loadPlatform('hn');
    expect(p.id).toBe('hn');
    expect(p.stepMinutes).toBe(20);
    expect(p.defaultSteps).toBe(12);
    expect(p.votes).toEqual(['up', 'none', 'flag']);
    expect(p.commentVote).toBe('up');
    expect(p.bands).toEqual(['top10', 'top30', 'page2', 'new']);
    const s = emptyThread(makePost());
    expect(p.visibility(s, 0)).toEqual({ band: 'new', visitorFraction: 0.06 });
    expect(p.rankScore(s, 1)).toBe(0);
    expect(p.agentSystem(makePersona(1))).toContain('Hacker News user');
    for (const text of [
      p.agentRules,
      p.voterSystem,
      p.founderSystem(2),
      p.personaSystem,
      p.voterPersonaSystem,
      p.labelSystem,
      p.reportSystem,
      p.reportTitle(makePost())
    ])
      expect(text.length).toBeGreaterThan(0);
    expect(typeof p.fetchReference).toBe('function');
  });

  it('names the known platforms for an unknown id', async () => {
    await expect(loadPlatform('nope')).rejects.toThrow(
      /unknown platform "nope".*known: .*hn/
    );
    await expect(loadPlatform('../hn')).rejects.toThrow(/unknown platform/);
  });
});
