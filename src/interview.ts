import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentSystem } from './agents.js';
import type { Llm } from './llm.js';
import { loadRun } from './report.js';
import { renderThread, replay } from './thread.js';
import type { Persona, SimEvent } from './types.js';

export interface InterviewAnswer {
  personaId: string;
  handle: string;
  answer: string;
  stance: 'positive' | 'neutral' | 'negative';
}

const STANCES = ['positive', 'neutral', 'negative'] as const;

const SCHEMA = {
  type: 'object',
  required: ['answer', 'stance'],
  properties: { answer: { type: 'string' }, stance: { enum: STANCES } }
};

export function personaTranscript(
  events: readonly SimEvent[],
  personaId: string
): string {
  const mine = new Set<string>();
  const lines: string[] = [];
  for (const e of events) {
    if (e.kind === 'visit' && e.actor === personaId)
      lines.push(`step ${e.step}: opened the thread`);
    if (e.kind === 'vote' && e.voter === personaId)
      lines.push(`step ${e.step}: ${e.value} on ${e.target}`);
    if (e.kind === 'leave' && e.actor === personaId)
      lines.push(`step ${e.step}: left the thread`);
    if (e.kind === 'comment' && e.author === personaId) {
      mine.add(e.id);
      lines.push(
        `step ${e.step}: wrote [${e.id}] (reply to ${e.parent}): ${e.text}`
      );
    }
    if (e.kind === 'comment' && mine.has(e.parent) && e.author !== personaId) {
      lines.push(
        `step ${e.step}: ${e.author} replied to you [${e.id}]: ${e.text}`
      );
    }
  }
  return lines.length ? lines.join('\n') : 'You did not visit this thread.';
}

function resolveTargets(personas: Persona[], target: string): Persona[] {
  const direct = personas.filter((p) => p.id === target || p.handle === target);
  if (direct.length) return direct;
  const segment = personas.filter((p) => p.segment === target);
  if (segment.length) return segment;
  const segments = [...new Set(personas.map((p) => p.segment))].sort();
  throw new Error(
    `no persona or segment "${target}"; segments: ${segments.join(', ')}`
  );
}

export async function interview(
  llm: Llm,
  runDir: string,
  target: string,
  question: string
): Promise<{ answers: InterviewAnswer[]; markdown: string }> {
  const { events, personas, post } = loadRun(runDir);
  const targets = resolveTargets(personas.personas, target);
  const thread = renderThread(replay(post, events), { maxChars: 12000 });
  const results = await Promise.all(
    targets.map(async (p): Promise<InterviewAnswer> => {
      const res = await llm.call({
        tier: 'opus',
        label: `interview:${p.id}`,
        system: `${agentSystem(p)}\n\nAfter the thread, a researcher interviews you. Answer in character, candidly, in 2–6 sentences.`,
        prompt: [
          `<thread-as-it-ended>\n${thread}\n</thread-as-it-ended>`,
          `<what-you-did>\n${personaTranscript(events, p.id)}\n</what-you-did>`,
          '',
          `Question: ${question}`,
          'Also give your overall stance toward the product: positive, neutral or negative.'
        ].join('\n'),
        schema: SCHEMA,
        validate: (
          x
        ): x is { answer: string; stance: InterviewAnswer['stance'] } =>
          typeof (x as { answer?: unknown }).answer === 'string' &&
          STANCES.includes((x as { stance: InterviewAnswer['stance'] }).stance)
      });
      return res.ok
        ? { personaId: p.id, handle: p.handle, ...res.value }
        : {
            personaId: p.id,
            handle: p.handle,
            answer: `(no answer: ${res.error})`,
            stance: 'neutral'
          };
    })
  );
  const tally = STANCES.map(
    (s) => `${s} ${results.filter((r) => r.stance === s).length}`
  ).join(' · ');
  const markdown = [
    `## ${new Date().toISOString()} — ${target}: ${question}`,
    '',
    ...results.map(
      (r) =>
        `- **${r.handle}** (${r.personaId}, ${r.stance}): ${r.answer.replace(/\n/g, ' ')}`
    ),
    '',
    targets.length > 1 ? `Tally: ${tally}\n` : ''
  ].join('\n');
  appendFileSync(join(runDir, 'interviews.md'), markdown + '\n');
  return { answers: results, markdown };
}
