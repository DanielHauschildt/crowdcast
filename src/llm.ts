import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import type { Tier } from './types.js';

export interface LlmRequest<T> {
  tier: Tier;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  validate: (x: unknown) => x is T;
  /** Shows up in calls.jsonl, e.g. `agent:p12` or `voters:3`. */
  label: string;
}

export type LlmResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export interface Llm {
  call<T>(req: LlmRequest<T>): Promise<LlmResult<T>>;
  readonly callCount: number;
}

/** The run's --max-calls budget is spent. */
export class BudgetExceeded extends Error {}
/** Retrying can't help: claude missing, not logged in. */
export class LlmFatal extends Error {}

export interface ProcResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export type Runner = (args: string[], stdin: string) => Promise<ProcResult>;

export function spawnRunner(bin = 'claude'): Runner {
  return (args, stdin) =>
    new Promise((resolve, reject) => {
      const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      child.on('error', reject);
      child.on('close', (code) => resolve({ stdout, stderr, code }));
      child.stdin.end(stdin);
    });
}

/** Counting semaphore whose limit can shrink at runtime (slots are handed off on release). */
export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(public limit: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.active <= this.limit ? this.queue.shift() : undefined;
    if (next) next();
    else this.active--;
  }
}

const RATE_LIMIT = /rate.?limit|\b429\b|overloaded|usage limit/i;
const AUTH = /not logged in|\/login|invalid api key|authenticat/i;

export type Parsed =
  | { kind: 'ok'; value: unknown; usage: unknown; cost: number | null }
  | { kind: 'rate-limit' | 'auth' | 'error'; message: string };

export function parseCliOutput(res: ProcResult): Parsed {
  const classify = (message: string): Parsed => {
    if (RATE_LIMIT.test(message)) return { kind: 'rate-limit', message };
    if (AUTH.test(message)) return { kind: 'auth', message };
    return { kind: 'error', message };
  };
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(res.stdout) as Record<string, unknown>;
  } catch {
    return classify(
      `exit ${res.code}: ${(res.stdout + res.stderr).slice(0, 400)}`
    );
  }
  if (json.is_error)
    return classify(String(json.result ?? json.subtype ?? 'unknown error'));
  if (json.structured_output === undefined)
    return { kind: 'error', message: 'no structured_output' };
  const cost =
    typeof json.total_cost_usd === 'number' ? json.total_cost_usd : null;
  return { kind: 'ok', value: json.structured_output, usage: json.usage, cost };
}

export function cliArgs(req: LlmRequest<unknown>): string[] {
  return [
    '-p',
    '--model',
    req.tier,
    '--system-prompt',
    req.system,
    '--json-schema',
    JSON.stringify(req.schema),
    '--output-format',
    'json',
    '--tools',
    '',
    '--no-session-persistence',
    '--strict-mcp-config',
    '--setting-sources',
    ''
  ];
}

export interface ClaudeCliOptions {
  concurrency?: number;
  maxCalls?: number;
  logFile?: string;
  runner?: Runner;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
}

const MAX_BACKOFFS = 5;

export class ClaudeCli implements Llm {
  callCount = 0;
  private readonly sem: Semaphore;
  private readonly maxCalls: number;
  private readonly retries: number;
  private readonly runner: Runner;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly logFile: string | undefined;

  constructor(opts: ClaudeCliOptions = {}) {
    this.sem = new Semaphore(opts.concurrency ?? 8);
    this.maxCalls = opts.maxCalls ?? Infinity;
    this.retries = opts.retries ?? 2;
    this.runner = opts.runner ?? spawnRunner();
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.logFile = opts.logFile;
  }

  get concurrency(): number {
    return this.sem.limit;
  }

  async call<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    let lastError = 'no attempt';
    let backoffs = 0;
    for (let attempt = 0; attempt <= this.retries; ) {
      if (this.callCount >= this.maxCalls)
        throw new BudgetExceeded(`max-calls ${this.maxCalls} reached`);
      this.callCount++;
      await this.sem.acquire();
      const t0 = Date.now();
      let res: ProcResult;
      try {
        res = await this.runner(cliArgs(req), req.prompt);
      } catch (err) {
        throw new LlmFatal(`cannot run claude: ${(err as Error).message}`);
      } finally {
        this.sem.release();
      }
      const parsed = parseCliOutput(res);
      const valid = parsed.kind === 'ok' && req.validate(parsed.value);
      this.log({
        ts: new Date().toISOString(),
        label: req.label,
        tier: req.tier,
        ms: Date.now() - t0,
        ok: valid,
        kind: parsed.kind,
        usage: parsed.kind === 'ok' ? parsed.usage : undefined,
        cost: parsed.kind === 'ok' ? parsed.cost : undefined,
        error:
          parsed.kind === 'ok'
            ? valid
              ? undefined
              : 'schema validation failed'
            : parsed.message
      });
      if (parsed.kind === 'auth')
        throw new LlmFatal(`claude is not usable: ${parsed.message}`);
      if (parsed.kind === 'rate-limit') {
        if (backoffs >= MAX_BACKOFFS)
          return { ok: false, error: `rate limited: ${parsed.message}` };
        this.sem.limit = Math.max(1, Math.floor(this.sem.limit / 2));
        await this.sleep(5000 * 2 ** backoffs++);
        continue;
      }
      if (valid) return { ok: true, value: parsed.value as T };
      lastError =
        parsed.kind === 'ok' ? 'schema validation failed' : parsed.message;
      attempt++;
    }
    return { ok: false, error: lastError };
  }

  private log(entry: Record<string, unknown>): void {
    if (this.logFile)
      appendFileSync(this.logFile, JSON.stringify(entry) + '\n');
  }
}

/** Test double: the handler returns a value (validated like real output) or an Error. */
export class FakeLlm implements Llm {
  callCount = 0;
  readonly requests: Array<LlmRequest<unknown>> = [];
  constructor(
    private readonly handler: (req: LlmRequest<unknown>) => unknown
  ) {}

  async call<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    this.callCount++;
    this.requests.push(req as LlmRequest<unknown>);
    const value = this.handler(req as LlmRequest<unknown>);
    if (value instanceof LlmFatal || value instanceof BudgetExceeded)
      throw value;
    if (value instanceof Error) return { ok: false, error: value.message };
    return req.validate(value)
      ? { ok: true, value }
      : { ok: false, error: 'schema validation failed' };
  }
}
