export type Vote = 'up' | 'none' | 'flag';
export type Tier = 'haiku' | 'sonnet' | 'opus';
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
      value: 'up' | 'flag';
    }
  | { kind: 'visit'; step: number; actor: string }
  | { kind: 'leave'; step: number; actor: string }
  | { kind: 'error'; step: number; actor: string; message: string }
  | {
      kind: 'step-end';
      step: number;
      score: number;
      band: Band;
      points: number;
      flags: number;
      calls: number;
      failed: number;
    }
  | { kind: 'abort'; step: number; reason: string };
