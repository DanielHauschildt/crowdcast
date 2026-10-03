import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makePersona, makePost } from '../test/fixtures.js';
import { EVENTS_FILE } from './events.js';
import { FakeLlm, type LlmRequest } from './llm.js';
import {
  DISCLAIMER,
  PERSONAS_FILE,
  RUN_FILE,
  citedIds,
  writeReport,
  type RunMeta
} from './report.js';
import type { SimEvent } from './types.js';

export function writeRun(dir: string): void {
  const events: SimEvent[] = [
    { kind: 'post', step: 0, post: makePost() },
    {
      kind: 'comment',
      step: 0,
      id: 'c1',
      parent: 'post',
      author: 'p1',
      text: 'Why not just use an image model?'
    },
    {
      kind: 'comment',
      step: 1,
      id: 'c2',
      parent: 'c1',
      author: 'founder',
      text: 'Because files.'
    },
    {
      kind: 'step-end',
      step: 0,
      score: 0.5,
      band: 'page2',
      points: 5,
      flags: 0,
      calls: 3,
      failed: 0
    }
  ];
  writeFileSync(
    join(dir, EVENTS_FILE),
    events.map((e) => JSON.stringify(e)).join('\n') + '\n'
  );
  writeFileSync(
    join(dir, PERSONAS_FILE),
    JSON.stringify({ personas: [makePersona(1)], voters: [] })
  );
  const meta: RunMeta = {
    seedName: 's',
    variant: 'default',
    rngSeed: 1,
    personaSeed: 1,
    createdAt: '2026-10-03T10:00:00Z',
    founderAnswers: 'fa',
    hypotheses: 'H1'
  };
  writeFileSync(join(dir, RUN_FILE), JSON.stringify(meta));
}

const sections = (cite: string) => ({
  topObjections: `Image-gen comparison ${cite}`,
  changes: 'Lead with editability.',
  riskiestComments: cite,
  founderReplies: '[c2] helped.',
  hypotheses: 'H1 supported.'
});

function reportLlm(cites: string[]) {
  return new FakeLlm((req: LlmRequest<unknown>) => {
    if (req.label.startsWith('labels'))
      return { labels: [{ id: 'c1', label: 'vs-image-gen', sentiment: -1 }] };
    return sections(cites.shift()!);
  });
}

describe('citedIds', () => {
  it('extracts unique comment citations', () => {
    expect(citedIds('see [c1], [c12] and [c1]; not c3 or [p1]')).toEqual([
      'c1',
      'c12'
    ]);
  });
});

describe('writeReport', () => {
  it('writes all derived files with the disclaimer on line 1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rep-'));
    writeRun(dir);
    const llm = reportLlm(['[c1]']);
    const file = await writeReport(llm, dir);
    const md = readFileSync(file, 'utf8');
    expect(md.split('\n')[0]).toBe(DISCLAIMER);
    expect(md).toContain('vs-image-gen');
    for (const f of ['thread.md', 'labels.json', 'metrics.json'])
      expect(existsSync(join(dir, f))).toBe(true);
    expect(llm.requests.find((r) => r.label === 'report')!.tier).toBe('opus');
  });

  it('retries once when citations do not exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rep-'));
    writeRun(dir);
    const llm = reportLlm(['[c99]', '[c1]']);
    await writeReport(llm, dir);
    const reportCalls = llm.requests.filter((r) => r.label === 'report');
    expect(reportCalls).toHaveLength(2);
    expect(reportCalls[1]!.prompt).toContain('c99');
  });

  it('fails when citations stay invalid', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rep-'));
    writeRun(dir);
    await expect(
      writeReport(reportLlm(['[c99]', '[c98]']), dir)
    ).rejects.toThrow(/c98/);
  });
});
