import fc from 'fast-check';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BudgetExceeded,
  ClaudeCli,
  FakeLlm,
  LlmFatal,
  Semaphore,
  cliArgs,
  type LlmRequest,
  type ProcResult,
  type Runner
} from './llm.js';

const isN = (x: unknown): x is { n: number } =>
  typeof x === 'object' &&
  x !== null &&
  typeof (x as { n: unknown }).n === 'number';

const req: LlmRequest<{ n: number }> = {
  tier: 'haiku',
  system: 'sys',
  prompt: 'give n',
  schema: {
    type: 'object',
    properties: { n: { type: 'integer' } },
    required: ['n']
  },
  validate: isN,
  label: 'test'
};

const ok = (value: unknown): ProcResult => ({
  stdout: JSON.stringify({
    is_error: false,
    structured_output: value,
    usage: { input_tokens: 5 },
    total_cost_usd: 0.001
  }),
  stderr: '',
  code: 0
});

function scripted(
  results: Array<ProcResult | Error>
): Runner & { calls: string[][] } {
  const calls: string[][] = [];
  const fn: Runner = async (args) => {
    calls.push(args);
    const next = results.shift();
    if (!next) throw new Error('runner exhausted');
    if (next instanceof Error) throw next;
    return next;
  };
  return Object.assign(fn, { calls });
}

const noSleep = async (): Promise<void> => {};

describe('cliArgs', () => {
  it('passes the bare-call flags and model', () => {
    const args = cliArgs(req);
    expect(args.slice(0, 3)).toEqual(['-p', '--model', 'haiku']);
    for (const flag of [
      '--json-schema',
      '--no-session-persistence',
      '--strict-mcp-config'
    ]) {
      expect(args).toContain(flag);
    }
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('');
  });
});

describe('ClaudeCli', () => {
  it('returns structured_output and logs the call', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-'));
    const runner = scripted([ok({ n: 7 })]);
    const llm = new ClaudeCli({
      runner,
      logFile: join(dir, 'calls.jsonl'),
      sleep: noSleep
    });
    expect(await llm.call(req)).toEqual({ ok: true, value: { n: 7 } });
    const line = JSON.parse(
      readFileSync(join(dir, 'calls.jsonl'), 'utf8').trim()
    );
    expect(line).toMatchObject({
      label: 'test',
      tier: 'haiku',
      ok: true,
      cost: 0.001
    });
  });

  it('retries invalid output twice, then fails softly', async () => {
    const runner = scripted([ok({ n: 'x' }), ok({}), ok({ n: 'y' })]);
    const llm = new ClaudeCli({ runner, sleep: noSleep });
    const res = await llm.call(req);
    expect(res.ok).toBe(false);
    expect(runner.calls).toHaveLength(3);
  });

  it('recovers when a retry succeeds', async () => {
    const runner = scripted([ok({ n: 'x' }), ok({ n: 2 })]);
    expect(await new ClaudeCli({ runner, sleep: noSleep }).call(req)).toEqual({
      ok: true,
      value: { n: 2 }
    });
  });

  it('backs off and halves concurrency on rate limits', async () => {
    const slept: number[] = [];
    const runner = scripted([
      { stdout: '', stderr: 'Error: 429 rate limit exceeded', code: 1 },
      ok({ n: 1 })
    ]);
    const llm = new ClaudeCli({
      runner,
      concurrency: 8,
      sleep: async (ms) => void slept.push(ms)
    });
    expect((await llm.call(req)).ok).toBe(true);
    expect(slept).toEqual([5000]);
    expect(llm.concurrency).toBe(4);
  });

  it('throws LlmFatal when claude is missing', async () => {
    const enoent = Object.assign(new Error('spawn claude ENOENT'), {
      code: 'ENOENT'
    });
    const llm = new ClaudeCli({ runner: scripted([enoent]), sleep: noSleep });
    await expect(llm.call(req)).rejects.toBeInstanceOf(LlmFatal);
  });

  it('throws LlmFatal when not logged in', async () => {
    const out = {
      stdout: JSON.stringify({
        is_error: true,
        result: 'Not logged in · Please run /login'
      }),
      stderr: '',
      code: 1
    };
    await expect(
      new ClaudeCli({ runner: scripted([out]), sleep: noSleep }).call(req)
    ).rejects.toBeInstanceOf(LlmFatal);
  });

  it('enforces maxCalls across spawns', async () => {
    const llm = new ClaudeCli({
      runner: scripted([ok({ n: 1 }), ok({ n: 2 })]),
      maxCalls: 1,
      sleep: noSleep
    });
    await llm.call(req);
    await expect(llm.call(req)).rejects.toBeInstanceOf(BudgetExceeded);
  });
});

describe('Semaphore', () => {
  it('never exceeds its limit', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 30 }),
        async (limit, jobs) => {
          const sem = new Semaphore(limit);
          let active = 0;
          let peak = 0;
          await Promise.all(
            Array.from({ length: jobs }, async () => {
              await sem.acquire();
              active++;
              peak = Math.max(peak, active);
              await new Promise((r) => setTimeout(r, 0));
              active--;
              sem.release();
            })
          );
          expect(peak).toBeLessThanOrEqual(limit);
        }
      ),
      { numRuns: 30 }
    );
  });
});

describe('FakeLlm', () => {
  it('validates handler output', async () => {
    const llm = new FakeLlm(() => ({ n: 'nope' }));
    expect((await llm.call(req)).ok).toBe(false);
    expect(llm.requests).toHaveLength(1);
  });
});
