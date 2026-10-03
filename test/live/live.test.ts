import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runSimulation } from '../../src/engine.js';
import { ClaudeCli } from '../../src/llm.js';
import { generatePersonas } from '../../src/personas.js';
import { makePost, makeSeed } from '../fixtures.js';

describe('live claude -p', () => {
  it('runs 5 personas for 2 steps', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'live-'));
    const llm = new ClaudeCli({
      concurrency: 4,
      maxCalls: 60,
      logFile: join(runDir, 'calls.jsonl')
    });
    const seed = makeSeed({ activeCount: 5, voterCount: 20 });
    const personas = await generatePersonas(llm, seed);
    expect(personas.personas).toHaveLength(5);
    const res = await runSimulation({
      post: makePost({
        title: 'Show HN: A design engine your coding agent drives',
        body: 'Generates editable design files via MCP.'
      }),
      seed,
      personas: {
        ...personas,
        personas: personas.personas.map((p) => ({ ...p, activity: 1 }))
      },
      llm,
      rngSeed: 1,
      runDir,
      steps: 2
    });
    expect(res.aborted).toBeNull();
    expect(res.events.filter((e) => e.kind === 'step-end')).toHaveLength(2);
  }, 600_000);
});
