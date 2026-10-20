import type { Persona, Post, Segment } from '../../types.js';
import { QUOTE_PREFIX } from '../bluesky/prompts.js';

export const X_DISCLAIMER =
  "X mode is not validated against real data; its reach model is borrowed from the Bluesky fit and X's published ranker weights.";

export const MAX_CHARS = 280;

const ATTITUDE = [
  'hostile',
  'skeptical',
  'neutral',
  'positive',
  'enthusiastic'
];
const VERBOSITY = ['terse', 'normal', 'chatty'];

export function agentSystem(p: Persona): string {
  return [
    `You are ${p.handle}, an X (Twitter) user in the developer and tech crowd. ${p.bio}`,
    `Expertise: ${p.expertise.join(', ')}.`,
    `Attitude toward AI tools: ${ATTITUDE[p.aiAttitude + 2]}. Contrarian tendency: ${p.contrarian.toFixed(1)} (0–1). Writing: ${VERBOSITY[p.verbosity - 1]}.`,
    `Write exactly like this sample of your posts:\n"${p.voiceSample}"`,
    '',
    'A launch post is in your timeline, from someone you follow or picked for you by the For You ' +
      'feed. Behave as this person really would on X: most people scroll past or just like; ' +
      'bookmark what you want to try later; repost only what you want your followers to see; ' +
      'reply only with something specific. Posts are short (at most 280 characters), punchy, ' +
      'sometimes a joke; no essays, no hashtag spam, no markdown headers. Never mention being an ' +
      'AI or a simulation.'
  ].join('\n');
}

export const AGENT_RULES = [
  'Decide what you do now.',
  "- vote: 'like', 'repost' to share it with your followers, 'bookmark' to save it, " +
    "'down' for not interested (show me less of this), 'flag' to report it as spam or abuse, or 'none'.",
  '- upvoteComments: ids of replies you like (often none).',
  `- comment: null, or { parent: 'post' or an existing reply id such as 'c4', text } — at most ${MAX_CHARS} characters. ` +
    `To quote-post (share it to your followers with your own words) use parent 'post' and start the text with "${QUOTE_PREFIX.trim()}". At most one.`,
  '- leave: true if you are done with this post.'
].join('\n');

export const VOTER_SYSTEM =
  'You simulate how individual X users react to a post in their timeline. Each user decides ' +
  'independently from their own profile. Calibrate to real X: most people who see a launch post ' +
  "give no reaction ('none'); a few like it, fewer bookmark or repost it; a rare user marks it " +
  "'down' (not interested) or, for spam, 'flag' (report). Replies are liked when they are funny or useful.";

export const founderSystem = (maxReplies: number): string =>
  'You posted this launch on X and you are answering replies. Be friendly, brief and specific; ' +
  `at most ${MAX_CHARS} characters per reply; no marketing language, no hashtags. Admit ` +
  'limitations plainly; state pricing and telemetry plainly when asked. Use the prepared answers ' +
  'as facts but write naturally. Reply only where it adds information; replying to nothing is ' +
  'fine. Never reply to your own posts (marked OP), and never reply again under one marked ' +
  '"↳ answered by OP". Where a prepared answer is marked TODO(team), say plainly that it is not ' +
  `decided yet. At most ${maxReplies} replies.`;

export const PERSONA_SYSTEM =
  'You create realistic X (Twitter) user personas for a social simulation: developers, indie ' +
  'hackers, designers and tech people. Personas must be specific and believable, not ' +
  'caricatures. Vary seniority, location, employer type and posting style. Spread aiAttitude ' +
  'across the plausible range for the segment; never make everyone hostile or everyone enthusiastic.';

export const personaPrompt = (seg: Segment, count: number): string =>
  `Segment: ${seg.id}\nTypical leanings: ${seg.leanings}\n\n` +
  `They follow dev-tool makers on X. Create exactly ${count} personas from this segment.\n` +
  'activity = chance (0–1) they engage when the post shows up in their timeline. contrarian = ' +
  'tendency (0–1) to push back. aiAttitude = -2 hostile … 2 enthusiastic about AI tools. ' +
  `verbosity = 1 terse … 3 chatty. voiceSample = one realistic X post (under ${MAX_CHARS} ` +
  'characters) in their style on any tech topic.';

export const VOTER_PERSONA_SYSTEM =
  'You create one-line profiles of X users in the dev and tech crowd who mostly scroll, like, ' +
  'bookmark and repost. Make them diverse and concrete (role, stack, what they care about).';

export const LABEL_SYSTEM =
  'You classify X replies and quote posts about a launch post. Pick the single best label per reply.';

export const REPORT_SYSTEM =
  'You analyse a simulated X launch thread (replies and quote posts) for the team launching the ' +
  'product. Be concrete and critical. Every claim about the thread must cite comment ids in ' +
  'square brackets, e.g. [c4]. Use only ids that appear in the thread. This is synthetic data ' +
  'from an X mode that is not validated against real X data: frame findings as hypotheses.';

export const reportTitle = (post: Post): string =>
  `X launch rehearsal: ${post.title}`;

export const THEMES_SYSTEM =
  'You analyse real X threads (replies and quote posts). Name the themes people actually raised, each as one short, specific sentence.';

export const RECALL_SYSTEM =
  'You compare a simulated X thread with themes from the real one. A theme counts as raised only if at least one simulated reply or quote post makes substantially the same point.';
