import type { Author } from './platform.js';

/** A reaction from the platform's `votes`; 'none' is no reaction (HN: up, none, flag). */
export type Vote = string;
export type Tier = 'haiku' | 'sonnet' | 'opus';
/** HN's visibility bands; other platforms name their own (`Platform.bands`). */
export type Band = 'top10' | 'top30' | 'page2' | 'new';

/** Author id of the person who submitted the post and answers in the thread. */
export const FOUNDER = 'founder';

export interface Post {
  title: string;
  url: string;
  body: string;
  firstComment: string | null;
}

export interface Segment {
  id: string;
  share: number;
  leanings: string;
}

export interface Seed {
  name: string;
  dir: string;
  context: string;
  founderAnswers: string;
  hypotheses: string;
  segments: Segment[];
  activeCount: number;
  voterCount: number;
  /** From platform.yaml; `loadSeed` fills in `hn`. */
  platform?: string;
  author?: Author;
  /** platform.yaml's other keys, for the platform. */
  options?: Record<string, unknown>;
}

export interface Persona {
  id: string;
  segment: string;
  handle: string;
  bio: string;
  expertise: string[];
  /** -2 hostile … 2 enthusiastic */
  aiAttitude: number;
  /** 1 terse … 3 long-winded */
  verbosity: number;
  /** 0..1 tendency to push back */
  contrarian: number;
  /** 0..1 chance of engaging when visiting */
  activity: number;
  voiceSample: string;
  /** Model the persona's turns run on; absent in v1 persona files → haiku. */
  tier?: Tier;
  /** HN threads the persona was derived from; never simulate those with it. */
  sourceThreads?: string[];
}

export interface Voter {
  id: string;
  segment: string;
  oneLiner: string;
}

export interface PersonaSet {
  personas: Persona[];
  voters: Voter[];
}

export type SimEvent =
  | { kind: 'post'; step: number; post: Post }
  | {
      kind: 'comment';
      step: number;
      id: string;
      parent: string;
      author: string;
      text: string;
    }
  | {
      kind: 'vote';
      step: number;
      voter: string;
      target: string;
      value: string;
    }
  | { kind: 'visit'; step: number; actor: string }
  | { kind: 'leave'; step: number; actor: string }
  | { kind: 'error'; step: number; actor: string; message: string }
  | {
      kind: 'step-end';
      step: number;
      score: number;
      band: string;
      points: number;
      flags: number;
      calls: number;
      failed: number;
    }
  | { kind: 'abort'; step: number; reason: string };
