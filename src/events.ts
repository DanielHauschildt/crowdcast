import { existsSync, readFileSync } from 'node:fs';
import type { SimEvent } from './types.js';

export const EVENTS_FILE = 'events.jsonl';

export function readEvents(file: string): SimEvent[] {
  if (!existsSync(file)) return [];
  const out: SimEvent[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as SimEvent);
    } catch {
      break; // torn write at the end of a crashed run
    }
  }
  return out;
}
