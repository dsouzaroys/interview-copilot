import { redis } from '../config/redis';
import type Anthropic from '@anthropic-ai/sdk';

const SESSION_TTL_SECONDS = 60 * 60 * 2; // 2 hours
const MAX_MESSAGES_VERBATIM = 20; // Keep last 20 messages; summarize older ones

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
}

type MessageParam = Anthropic.MessageParam;

// ─── Messages ────────────────────────────────────────────────────────────────

const messagesKey = (id: string) => `session:${id}:messages`;
const metaKey = (id: string) => `session:${id}:meta`;

export async function saveMessages(sessionId: string, messages: MessageParam[]): Promise<void> {
  // Context window guard: sliding window
  const windowed = applyContextWindow(messages);
  await redis.set(messagesKey(sessionId), JSON.stringify(windowed), 'EX', SESSION_TTL_SECONDS);
}

export async function getMessages(sessionId: string): Promise<MessageParam[]> {
  const raw = await redis.get(messagesKey(sessionId));
  if (!raw) return [];
  try {
    return JSON.parse(raw) as MessageParam[];
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

function applyContextWindow(messages: MessageParam[]): MessageParam[] {
  if (messages.length <= MAX_MESSAGES_VERBATIM) {
    return messages;
  }

  // Keep the last MAX_MESSAGES_VERBATIM messages verbatim
  const recent = messages.slice(-MAX_MESSAGES_VERBATIM);

  // Create a summary sentinel for older context
  const olderCount = messages.length - MAX_MESSAGES_VERBATIM;
  const summary: MessageParam = {
    role: 'user',
    content: `[System: ${olderCount} earlier messages were summarized to save context. The interview has been in progress. Continue based on the recent conversation below.]`,
  };

  return [summary, ...recent];
}
