import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';
import { env } from '../config/env';

const genAI = new GoogleGenerativeAI(env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });

export const EMBEDDING_DIMENSIONS = 768;

// ─── Embed for Indexing (Documents) ──────────────────────────────────────────

export async function embedDocument(text: string): Promise<number[]> {
  const result = await model.embedContent({
    content: { parts: [{ text }], role: 'user' },
    taskType: TaskType.RETRIEVAL_DOCUMENT,
  });
  return result.embedding.values;
}

// ─── Embed for Querying (Search) ─────────────────────────────────────────────

export async function embedQuery(text: string): Promise<number[]> {
  const result = await model.embedContent({
    content: { parts: [{ text }], role: 'user' },
    taskType: TaskType.RETRIEVAL_QUERY,
  });
  return result.embedding.values;
}

// ─── Batch Embed (with rate-limit protection) ─────────────────────────────────

export async function embedBatch(
  texts: string[],
  batchSize = 5,
  delayMs = 500
): Promise<number[][]> {
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const embeddings = await Promise.all(batch.map((text) => embedDocument(text)));
    results.push(...embeddings);

    if (i + batchSize < texts.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}
