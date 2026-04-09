import type { Content } from '@google/genai';
import { redis } from '../config/redis';

const SESSION_TTL_SECONDS = 60 * 60 * 2; // 2 hours
const MAX_MESSAGES_VERBATIM = 20; // Keep last 20 Content turns; summarize older

export interface SessionMeta {
  sessionId: string;
  interviewType: 'dsa' | 'backend' | 'system-design';
  difficulty: 'easy' | 'medium' | 'hard';
  weakAreas: string[];
  strongAreas: string[];
  avgScore: number;
  scores: number[];
  questionsAsked: number;
  askedQuestionIds: string[];
  startedAt: string;
  userId: string;
  // Track current question state
  lastQuestionId?: string;
  lastQuestionType?: 'theory' | 'coding';
}

// ─── Keys ─────────────────────────────────────────────────────────────────────

const messagesKey = (id: string) => `session:${id}:messages`;
const metaKey = (id: string) => `session:${id}:meta`;

// ─── Messages  (Gemini Content[]) ─────────────────────────────────────────────

export async function saveMessages(sessionId: string, messages: Content[]): Promise<void> {
  const windowed = applyContextWindow(messages);
  await redis.set(messagesKey(sessionId), JSON.stringify(windowed), 'EX', SESSION_TTL_SECONDS);
}

export async function getMessages(sessionId: string): Promise<Content[]> {
  const raw = await redis.get(messagesKey(sessionId));
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Content[];
  } catch {
    return [];
  }
}

// ─── Session Meta ─────────────────────────────────────────────────────────────

export async function saveSessionMeta(sessionId: string, meta: SessionMeta): Promise<void> {
  await redis.set(metaKey(sessionId), JSON.stringify(meta), 'EX', SESSION_TTL_SECONDS);
}

export async function getSessionMeta(sessionId: string): Promise<SessionMeta | null> {
  const raw = await redis.get(metaKey(sessionId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionMeta;
  } catch {
    return null;
  }
}

export async function updateSessionMeta(
  sessionId: string,
  updates: Partial<SessionMeta>
): Promise<void> {
  const existing = await getSessionMeta(sessionId);
  const merged = { ...(existing ?? {}), ...updates } as SessionMeta;
  await redis.set(metaKey(sessionId), JSON.stringify(merged), 'EX', SESSION_TTL_SECONDS);
}

export async function deleteSession(sessionId: string): Promise<void> {
  await redis.del(messagesKey(sessionId), metaKey(sessionId));
}

// ─── Context Window Guard ─────────────────────────────────────────────────────
// Prevents hitting Gemini's context limit on long interviews

function applyContextWindow(messages: Content[]): Content[] {
  if (messages.length <= MAX_MESSAGES_VERBATIM) {
    return messages;
  }

  const recent = messages.slice(-MAX_MESSAGES_VERBATIM);
  const olderCount = messages.length - MAX_MESSAGES_VERBATIM;

  // Inject a summary sentinel as first user turn
  const summary: Content = {
    role: 'user',
    parts: [
      {
        text: `[Context: ${olderCount} earlier turns were trimmed. Interview is ongoing — continue from the recent exchanges below.]`,
      },
    ],
  };

  return [summary, ...recent];
}
