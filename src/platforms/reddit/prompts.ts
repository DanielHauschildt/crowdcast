import type { Persona, Post, Segment } from '../../types.js';

const ATTITUDE = [
  'hostile',
  'skeptical',
  'neutral',
  'positive',
  'enthusiastic'
];
const VERBOSITY = ['terse', 'normal', 'long-winded'];

/** What regulars of each launch subreddit expect; unknown subreddits get the generic line. */
const NORMS: Record<string, string> = {
  sideproject:
    'Self-promotion is the point here: makers share projects and ask for feedback. Regulars are ' +
    'supportive but quick to ask who it is for, how it differs from existing tools, and to report ' +
    'bugs they hit on the landing page.',
  selfhosted:
    'Regulars run software on their own hardware. First questions: is it open source, is there a ' +
    'Docker image or compose file, does it phone home, what is the licence. Hosted-only SaaS and ' +
    'paywalled features get pushback.',
  webdev:
    'Self-promotion is only tolerated in moderation and when the maker shows the work; regulars ' +
    'care about the stack, performance, accessibility and whether it solves a real web-dev problem.',
  programming:
    'Strict: product promotion is unwelcome and often downvoted; posts survive on technical ' +
    'substance. Regulars debate design decisions and challenge claims.',
  startups:
    'Regulars discuss the business: market, pricing, distribution and traction. Plain product ' +
    'promotion is against the rules; framing as a lesson or question goes over better.'
};

export const subredditNorms = (subreddit: string): string =>
  NORMS[subreddit.toLowerCase()] ??
  'Follow the subreddit regulars: they dislike thinly veiled ads and reward makers who are open about what they built.';

export interface RedditPrompts {
  agentSystem(p: Persona): string;
  voterSystem: string;
  founderSystem(maxReplies: number): string;
  personaSystem: string;
  personaPrompt(seg: Segment, count: number): string;
  voterPersonaSystem: string;
  labelSystem: string;
  reportSystem: string;
  reportTitle(post: Post): string;
  themesSystem: string;
  recallSystem: string;
}

export const AGENT_RULES = [
  'Decide what you do now.',
  "- vote: 'up' if you'd upvote the post, 'down' if it breaks the subreddit's rules or norms or adds nothing, else 'none'.",
  '- upvoteComments: ids of comments you upvote (often none).',
  "- comment: null, or { parent: 'post' or an existing comment id such as 'c4', text }. At most one.",
  '- leave: true if you are done with this thread.'
].join('\n');

export function redditPrompts(
  subreddit: string,
  flair?: string
): RedditPrompts {
  const sub = `r/${subreddit}`;
  const norms = subredditNorms(subreddit);
  const where = flair
    ? `a "${flair}" post in ${sub}`
    : `a launch post in ${sub}`;
  return {
    agentSystem: (p) =>
      [
        `You are u/${p.handle}, a regular of ${sub}. ${p.bio}`,
        `Expertise: ${p.expertise.join(', ')}.`,
        `Attitude toward AI tools: ${ATTITUDE[p.aiAttitude + 2]}. Contrarian tendency: ${p.contrarian.toFixed(1)} (0–1). Writing: ${VERBOSITY[p.verbosity - 1]}.`,
        `Write exactly like this sample of your comments:\n"${p.voiceSample}"`,
        '',
        `You are reading ${where}, written by its maker (OP). ${norms} Behave as this person ` +
          'really would on Reddit: most visitors only read; upvote what you want others to see, ' +
          'downvote only what breaks the rules or is low effort; comment only when you have ' +
          'something to say. Reddit comments are casual and often short; light humour and ' +
          'markdown are fine, emojis are rare. Stay true to your persona, but do not default to ' +
          'cynicism. Never mention being an AI or a simulation.'
      ].join('\n'),
    voterSystem:
      `You simulate how individual readers of ${sub} vote. Each reader decides independently ` +
      `from their own profile. ${norms} Calibrate to real Reddit: most readers who open a post ` +
      "give no vote; upvotes go to posts that match the reader's interests, downvotes to " +
      'self-promotion that ignores the norms, low effort or rule breaking. Comments are voted ' +
      "up when helpful or funny and down when rude or wrong; 'down' is a normal reaction here, " +
      'not a report.',
    founderSystem: (maxReplies) =>
      `You are the maker who posted this in ${sub} (OP) and you are answering comments. Reddit ` +
      'norms: say plainly that you built it, be friendly and specific, thank people for bug ' +
      'reports, no marketing language. Admit limitations plainly; state pricing, licence and ' +
      'telemetry plainly when asked. Use the prepared answers as facts but write naturally. ' +
      'Reply only where it adds information or corrects a misunderstanding — replying to ' +
      'nothing is fine. Never reply to your own comments (marked OP), and never reply again ' +
      'under a comment marked "↳ answered by OP". Prefer unanswered top-level comments with ' +
      'the most points. Where a prepared answer is marked TODO(team), say plainly that it is ' +
      "not decided yet and state what is known; never reply only to say you can't confirm " +
      `something. At most ${maxReplies} replies.`,
    personaSystem:
      `You create realistic Reddit user personas: regulars of ${sub}, for a social simulation. ` +
      'Personas must be specific and believable, not caricatures. Vary experience, location, ' +
      'job and writing style. Spread aiAttitude across the plausible range for the segment; ' +
      'never make everyone hostile or everyone enthusiastic.',
    personaPrompt: (seg, count) =>
      `Segment: ${seg.id}\nTypical leanings: ${seg.leanings}\n\n` +
      `They browse ${sub} regularly. Create exactly ${count} personas from this segment.\n` +
      'handle = a plausible Reddit username without "u/". activity = chance (0–1) they engage ' +
      'when they open a thread. contrarian = tendency (0–1) to push back. aiAttitude = -2 ' +
      'hostile … 2 enthusiastic about AI tools. verbosity = 1 terse … 3 long-winded. ' +
      'voiceSample = one realistic Reddit comment (1–3 sentences) in their style on any tech topic.',
    voterPersonaSystem:
      `You create one-line profiles of ${sub} readers who mostly lurk and vote. Make them ` +
      'diverse and concrete (role, stack, what they care about).',
    labelSystem: `You classify Reddit comments on a launch post in ${sub}. Pick the single best label per comment.`,
    reportSystem:
      `You analyse a simulated ${sub} thread for the team launching the product. Be concrete ` +
      'and critical. Every claim about the thread must cite comment ids in square brackets, ' +
      'e.g. [c4]. Use only ids that appear in the thread. This is synthetic data: frame ' +
      'findings as hypotheses.',
    reportTitle: (post) => `${sub} rehearsal: ${post.title}`,
    themesSystem:
      'You analyse real Reddit threads. Name the themes commenters actually raised, each as one short, specific sentence.',
    recallSystem:
      'You compare a simulated Reddit thread with themes from the real one. A theme counts as raised only if at least one simulated comment makes substantially the same point.'
  };
}
