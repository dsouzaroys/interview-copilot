# AI Interview Copilot — Build Plan

## Context
Greenfield project in `/Users/royston/Documents/Roys-vinyl/ai-agent` (empty directory). User wants a personal AI interviewer that conducts DSA/Backend/System Design interviews, evaluates answers, remembers weaknesses, and adapts future questions. Tech stack matches patterns from user's existing projects (Autonomou-QA, notion-rag-pgvector).

---

## Tech Stack
- **Runtime**: Node.js + TypeScript 5.5, `tsx` for dev
- **AI**: `@anthropic-ai/sdk` with Claude's `tool_use` feature (agent loop pattern)
- **Embeddings**: Voyage AI (`voyage-3`, 1024-dim) — Anthropic's recommended partner
- **DB**: MongoDB + Atlas Vector Search (long-term memory + RAG)
- **Cache**: Redis via `ioredis` (short-term session memory)
- **HTTP**: Express + Zod validation + Pino logging

---

## Project Structure

```
ai-interview-copilot/
├── src/
│   ├── index.ts                  # Express app entry
│   ├── config/
│   │   ├── env.ts                # Zod-validated env vars
│   │   ├── mongodb.ts            # Mongoose connection
│   │   └── redis.ts              # ioredis client
│   ├── agent/
│   │   ├── loop.ts               # CORE: agentic while-loop (tool_use pattern)
│   │   ├── tools.ts              # Tool schema definitions (Anthropic.Tool[])
│   │   ├── tool-handlers.ts      # Dispatch + implementations for each tool
│   │   └── prompts.ts            # Dynamic system prompt builder
│   ├── memory/
│   │   ├── short-term.ts         # Redis: messages[], session meta, 2hr TTL
│   │   └── long-term.ts          # MongoDB: persist evaluations, sessions, weak areas
│   ├── rag/
│   │   ├── embeddings.ts         # Voyage AI embedding calls
│   │   ├── retriever.ts          # Atlas $vectorSearch aggregation
│   │   └── knowledge-base.ts     # Question CRUD
│   ├── models/
│   │   ├── session.model.ts      # Mongoose: session lifecycle
│   │   ├── question.model.ts     # Mongoose: knowledge base docs + embeddings
│   │   └── evaluation.model.ts   # Mongoose: per-answer scores
│   ├── routes/
│   │   ├── session.ts            # POST /sessions, GET /sessions/:id/summary
│   │   └── interview.ts          # POST /sessions/:id/message (main turn)
│   ├── services/
│   │   ├── evaluation.service.ts # Score aggregation, trend analysis
│   │   └── question.service.ts   # Question selection logic
│   └── scripts/
│       ├── seed.ts               # Populate MongoDB with questions + embeddings
│       └── create-vector-index.ts # One-time Atlas Vector Search index setup
├── data/questions/
│   ├── dsa.json                  # 20-30 DSA questions with ideal answers
│   ├── backend.json              # 20-30 backend questions
│   └── system-design.json        # 20-30 system design questions
├── package.json
├── tsconfig.json
└── .env.example
```

---

## Four Tools (The Agent's Capabilities)

Defined in `src/agent/tools.ts` as `Anthropic.Tool[]`. Claude decides when to call them; the loop dispatches to handlers.

| Tool | Input | Output |
|------|-------|--------|
| `get_next_question` | `{ interview_type, difficulty, weak_areas[], exclude_ids[] }` | `{ question_id, question_text, topic, difficulty }` |
| `evaluate_answer` | `{ question_id, question_text, candidate_answer, interview_type }` | `{ score: 0-10, dimensions: {correctness, depth, clarity}, missing_concepts[], feedback }` |
| `store_weak_area` | `{ session_id, topic, concept, severity }` | `{ stored: true }` |
| `fetch_candidate_profile` | `{ session_id }` | `{ weak_areas[], avg_score, questions_asked, topics_covered[] }` |

---

## Agent Loop Pattern (`src/agent/loop.ts`)

```
1. Load messages[] from Redis
2. Append new user message
3. Build system prompt (inject weak areas, difficulty rec)
4. Call claude.messages.create({ tools, messages, system })
5. If stop_reason === "tool_use":
   a. Collect ALL tool_use blocks from response.content
   b. Execute ALL handlers in parallel
   c. Append: { role: "assistant", content: response.content }
   d. Append: { role: "user", content: [tool_result blocks] }  ← Anthropic-specific format
   e. Loop back to step 4
6. If stop_reason === "end_turn":
   a. Extract text block → candidate-facing reply
   b. Save updated messages[] to Redis
   c. Return { reply }
```

**Critical gotcha**: `tool_result` blocks go inside a `user` role message (Anthropic format, different from OpenAI).

---

## Phased Build Plan

### Phase 1 — MVP Core Loop (start here)
**Goal**: Working HTTP endpoint that conducts an interview with hardcoded questions.

1. Scaffold: `package.json`, `tsconfig.json`, `.env.example`, `src/config/env.ts`
2. `src/agent/tools.ts` — define all 4 tool schemas
3. `src/agent/tool-handlers.ts` — stub implementations (in-memory questions, mock evaluate)
   - `evaluate_answer` makes a second Claude call with an evaluation sub-prompt (not a nested tool_use)
4. `src/agent/loop.ts` — full agentic while-loop
5. `src/agent/prompts.ts` — system prompt telling Claude to use tools (never invent questions)
6. `src/routes/interview.ts` — `POST /sessions` + `POST /sessions/:id/message`

**Deliverable**: `curl -X POST /sessions/:id/message -d '{"message": "ready"}'` → Claude calls `get_next_question` → presents question → user answers → `evaluate_answer` → feedback + next question.

---

### Phase 2 — Memory Layer
**Goal**: Stateful sessions. Weaknesses remembered across turns.

1. `src/config/redis.ts` + `src/memory/short-term.ts`
   - `saveMessages`, `getMessages`, `saveSessionMeta`, TTL 2hr
2. Mongoose models: `session.model.ts`, `evaluation.model.ts`
3. `src/memory/long-term.ts` — `persistEvaluation`, `closeSession`, `getCandidateHistory`
4. Wire tool handlers: `store_weak_area` → Redis + Mongo; `evaluate_answer` → `persistEvaluation`
5. `GET /sessions/:id/summary` → score breakdown, weak areas, trajectory

**Deliverable**: Session survives server restarts. Full Q&A + scores persisted in MongoDB.

---

### Phase 3 — RAG + Vector Search
**Goal**: Questions fetched semantically from real knowledge base.

1. Populate `data/questions/dsa.json`, `backend.json`, `system-design.json` (60-90 questions total)
   - Each doc: `{ id, topic, difficulty, interview_type, question_text, ideal_answer, key_concepts[], follow_up_hints[] }`
2. `src/rag/embeddings.ts` — Voyage AI HTTP calls (`voyage-3`, 1024-dim)
3. `src/scripts/seed.ts` — embed + upsert all questions into MongoDB
4. `src/scripts/create-vector-index.ts` — create Atlas Vector Search index with `interview_type` + `difficulty` filters
5. `src/rag/retriever.ts` — `$vectorSearch` aggregation, exclude seen question IDs
6. Wire `get_next_question` handler to `retriever.fetchQuestion()`

**Deliverable**: `npm run seed` populates knowledge base. Questions are semantically matched to weak areas.

---

### Phase 4 — Adaptive Logic
**Goal**: System learns from candidate within and across sessions.

1. `src/services/evaluation.service.ts`
   - `getScoreTrend(sessionId)` — moving avg of scores
   - `identifyWeakAreas(sessionId)` — topics with avg < 6
   - `getDifficultyRecommendation(sessionId)` — bump up if last 3 > 8, reduce if < 4
2. Update `prompts.ts` — inject weak areas + difficulty recommendation dynamically
3. Update `fetch_candidate_profile` — query past sessions by `candidateId` for cross-session memory
4. Boost `$vectorSearch` scores for weak-area topic matches in retriever

**Deliverable**: Session 2 feels adaptive. Weak topics get targeted. Difficulty adjusts automatically.

---

## Data Flow (Single Turn)

```
POST /sessions/:id/message { message }
  → Load Redis messages[]
  → agentLoop(sessionId, userMessage)
      → Claude (tool_use) → handlers → Redis/MongoDB/Atlas
      → Claude (end_turn) → text reply
  → Save messages[] to Redis
  → Response { reply }
```

One HTTP request may trigger 2–4 Claude API calls (main loop + evaluation sub-call).

---

## Environment Variables (.env)

```
ANTHROPIC_API_KEY=
VOYAGE_API_KEY=         # voyageai.com - free tier sufficient for dev
MONGODB_URI=            # MongoDB Atlas cluster URI
REDIS_URL=              # redis://localhost:6379
PORT=3000
```

---

## Setup Sequence (New Environment)

```bash
cp .env.example .env    # fill in keys
npm install
npm run setup-index     # one-time Atlas Vector Search index creation
npm run seed            # populate knowledge base with embeddings
npm run dev             # start server
```

---

## Key Files to Get Right First

1. `src/agent/loop.ts` — entire system behavior depends on correct `tool_use`/`tool_result` message format
2. `src/agent/tools.ts` — Claude's behavior driven entirely by tool descriptions and input schemas
3. `src/agent/prompts.ts` — must explicitly instruct Claude to always use tools for questions/evaluation (never hallucinate)
4. `src/scripts/seed.ts` — nothing works without knowledge base populated

---

## Message Array Growth Mitigation

For interviews >10 questions, implement sliding window in `short-term.ts`:
- Always keep last 10 exchanges verbatim
- Summarize older exchanges into a single "Prior conversation summary" user message
- Prevents hitting Claude's context limit

---

## Verification

1. **Phase 1**: `POST /sessions` → `POST /sessions/:id/message` with `"message": "I'm ready"` → Claude calls `get_next_question` tool → presents question
2. **Phase 2**: Kill and restart server mid-session → session resumes correctly from Redis
3. **Phase 3**: `npm run seed` → check MongoDB has questions with `embedding` field → submit an answer about "caching" → next question should be cache-related
4. **Phase 4**: Score < 5 on "database indexing" twice → next session opens with an indexing question automatically
