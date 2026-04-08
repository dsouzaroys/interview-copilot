import { Question, IQuestion } from '../models/question.model';
import { embedQuery } from './embeddings';

export interface FetchQuestionOptions {
  interviewType: 'dsa' | 'backend' | 'system-design';
  difficulty: 'easy' | 'medium' | 'hard';
  weakAreas: string[];
  excludeIds: string[];
}

// ─── Fetch Single Question by ID ──────────────────────────────────────────────

export async function fetchQuestion(questionId: string): Promise<IQuestion | null> {
  return Question.findOne({ questionId });
}

// ─── Fetch Next Question via Atlas Vector Search ──────────────────────────────

export async function fetchNextQuestion(
  options: FetchQuestionOptions
): Promise<IQuestion | null> {
  const { interviewType, difficulty, weakAreas, excludeIds } = options;

  // Build query text from weak areas for semantic matching
  const queryText =
    weakAreas.length > 0
      ? `Technical interview question about ${weakAreas.slice(0, 3).join(', ')}`
      : `${interviewType} interview question ${difficulty} difficulty`;

  // Try vector search first
  try {
    const queryEmbedding = await embedQuery(queryText);

    const pipeline = [
      {
        $vectorSearch: {
          index: 'question_vector_index',
          queryVector: queryEmbedding,
          path: 'embedding',
          numCandidates: 50,
          limit: 10,
          filter: {
            interviewType,
            difficulty,
          },
        },
      },
      // Exclude already-asked questions
      ...(excludeIds.length > 0
        ? [{ $match: { questionId: { $nin: excludeIds } } }]
        : []),
      { $limit: 5 },
      {
        $project: {
          _id: 0,
          questionId: 1,
          topic: 1,
          difficulty: 1,
          interviewType: 1,
          questionText: 1,
          idealAnswer: 1,
          keyConcepts: 1,
          tags: 1,
          followUpHints: 1,
          score: { $meta: 'vectorSearchScore' },
        },
      },
    ];

    const results = await Question.aggregate(pipeline);

    if (results.length > 0) {
      // Pick the top result (best semantic match)
      return results[0] as IQuestion;
    }
  } catch (err) {
    console.warn('Vector search failed, falling back to random selection:', err);
  }

  // Fallback: random question matching type/difficulty (before index is ready)
  return Question.findOne({
    interviewType,
    difficulty,
    ...(excludeIds.length > 0 ? { questionId: { $nin: excludeIds } } : {}),
  }).then((doc) => doc);
}
