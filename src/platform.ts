import type { ThreadState } from './thread.js';
import type { Persona, Post, Segment } from './types.js';

export type FetchFn = (
  url: string,
  init?: { headers?: Record<string, string> }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** The poster on follower-graph platforms; HN ignores it. */
export interface Author {
  followers: number;
  audience?: string;
}

export interface Visibility {
  band: string;
  /** Share of the population that opens the thread during this step. */
  visitorFraction: number;
}

export interface RealComment {
  id: string;
  /** `post` for top-level comments, else the parent comment's id. */
  parent: string;
  author: string;
  createdAt: string;
  text: string;
  /** Final score where the platform exposes it. */
  points?: number;
}

/** A real thread to backtest against. */
export interface RealThread {
  id: number;
  post: Post;
  comments: RealComment[];
  /** Final score of the post. */
  points: number;
  /** The submitter's username. */
  op: string;
  /** Linked page as plain text, else the post text. */
  context: string;
}

/**
 * Everything platform-specific the engine needs. Add a platform as `src/platforms/<id>/index.ts`
 * with a default export; `loadPlatform(id)` finds it.
 */
export interface Platform {
  id: string;
  stepMinutes: number;
  defaultSteps: number;
  /** Every band `visibility` can return, best first. */
  bands: readonly string[];
  /** Bands that count as reaching the front page / wide distribution. */
  frontPage: readonly string[];
  /** Reactions an agent or voter can give a post or comment; 'none' = no reaction, 'flag' counts against. */
  votes: readonly string[];
  /** The reaction an agent's comment upvote is recorded as. */
  commentVote: string;
  visibility(state: ThreadState, step: number, author?: Author): Visibility;
  /** The post's ranking score at `ageHours`, recorded at each step end. */
  rankScore(state: ThreadState, ageHours: number): number;

  agentSystem(persona: Persona): string;
  /** The action wording that closes every agent prompt. */
  agentRules: string;
  voterSystem: string;
  founderSystem(maxReplies: number): string;
  personaSystem: string;
  personaPrompt(segment: Segment, count: number): string;
  voterPersonaSystem: string;
  labelSystem: string;
  reportSystem: string;
  reportTitle(post: Post): string;
  /** Backtest: theme extraction from the real thread and recall judging. */
  themesSystem: string;
  recallSystem: string;

  fetchReference?(id: number, fetchFn?: FetchFn): Promise<RealThread>;
  /** Applies the extra keys of a seed's platform.yaml. */
  withOptions?(options: Record<string, unknown>): Platform;
}
