import { GoogleGenAI, FunctionDeclaration, Type } from '@google/genai';
import { env } from '../config/env';

const ai = new GoogleGenAI({ apiKey: env.GOOGLE_API_KEY });

export const EMBEDDING_DIMENSIONS = 3072;

// ─── Embed for Indexing (Documents) ──────────────────────────────────────────

export async function embedDocument(text: string): Promise<number[]> {
  const result = await ai.models.embedContent({
    model: 'gemini-embedding-001',
    contents: text,
    config: { taskType: 'RETRIEVAL_DOCUMENT' },
  });
  const values = result.embeddings?.[0]?.values;
  if (!values) throw new Error('No embedding values returned');
  return values;
}

// ─── Embed for Querying (Search) ─────────────────────────────────────────────

export async function embedQuery(text: string): Promise<number[]> {
  const result = await ai.models.embedContent({
    model: 'gemini-embedding-001',
    contents: text,
    config: { taskType: 'RETRIEVAL_QUERY' },
  });
  const values = result.embeddings?.[0]?.values;
  if (!values) throw new Error('No embedding values returned');
  return values;
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

// Re-export types used by tools.ts
export type { FunctionDeclaration, Type };
