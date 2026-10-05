# MiroFish analysis (2026-10-01, commit 7657031)

~50k lines total (incl. tests/frontend); real logic ≈ 5k lines Python. Flask + Vue.

## Pipeline

1. **Seed → ontology** — 1 LLM call; exactly 10 entity types (Zep limit), "entities that can speak on social media".
2. **Graph** — 500-char chunks → Zep Cloud episodes. Zep (server-side LLM) does entity/relation extraction, dedup, summaries, search. MiroFish does none of this itself.
3. **Personas** — 1 agent per extracted entity (no cap/filter); 1 LLM call each → bio + ~2000-char persona (MBTI, stance, posting habits).
4. **Config** — ~3 + N/15 LLM calls: time schedule (UTC+8 defaults), initial posts, per-agent activity. Most fields (stance, sentiment_bias, influence, posts_per_hour, recsys weights, hot_topics) are **never read** by the runtime.
5. **Simulation** — OASIS (camel-oasis 0.2.5): Twitter + Reddit run independently via asyncio.gather (agents don't cross platforms). Per round: random time-of-day activation → each active agent sees recsys feed → CAMEL ChatAgent picks action via native tool call → sqlite. Default 72 rounds, semaphore 30/platform. No temperature/seed → not reproducible.
6. **Write-back** — actions.jsonl → rendered as Chinese sentences → Zep graph.add. Agents never read Zep; "long-term memory" = CAMEL chat history.
7. **Report** — outline + per-section ReACT (text-parsed tool calls, ≥3 per section) over Zep search tools. Narrative only: no metrics, probabilities, citations, or multi-run comparison. Never reads raw sim logs (two LLM summarisation hops away).
8. **Interviews** — file-based IPC into the still-alive sim process; ManualAction(INTERVIEW). Lost if process dies.

## Gaps vs README claims

- "God's-eye view" variable injection: **not implemented** (scheduled_events hard-coded `[]`).
- "Thousands of agents": agent count = number of extracted entities.
- Prediction = narrative over LLM-of-LLM summaries; no validation/calibration.

## Rebuild verdict

Feasible, ~2k lines. Hard parts: feed/ranking realism, bounded per-agent context. Zep and OASIS are both replaceable for our use case (product-perception sims), see proposal in chat/plan.
