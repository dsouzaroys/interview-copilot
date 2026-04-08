import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env';
import { EVALUATION_SYSTEM_PROMPT } from './prompts';
import { fetchQuestion, fetchNextQuestion } from '../rag/retriever';
import { persistEvaluation, getCandidateHistory, upsertWeakArea } from '../memory/long-term';
import { getSessionMeta, updateSessionMeta } from '../memory/short-term';

const ai = new GoogleGenAI({ apiKey: env.GOOGLE_API_KEY });

// ─── Evaluation Response Type ────────────────────────────────────────────────

interface EvaluationResult {
  score: number;
  dimensions: {
    correctness: number;
    depth: number;
    clarity: number;
  };
  strengths: string[];
  missing_concepts: string[];
  follow_up_hints: string[];
  feedback_summary: string;
}

// ─── Tool Dispatcher ─────────────────────────────────────────────────────────

export async function dispatchTool(
  sessionId: string,
  toolName: string,
  input: Record<string, unknown>
): Promise<unknown> {
  switch (toolName) {
    case 'get_next_question':
      return handleGetNextQuestion(sessionId, input);
    case 'evaluate_answer':
      return handleEvaluateAnswer(sessionId, input);
    case 'store_weak_area':
      return handleStoreWeakArea(sessionId, input);
    case 'fetch_candidate_profile':
      return handleFetchCandidateProfile(sessionId, input);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ─── Tool: get_next_question ─────────────────────────────────────────────────

async function handleGetNextQuestion(
  sessionId: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const interviewType = input['interview_type'] as 'dsa' | 'backend' | 'system-design';
  const difficulty = input['difficulty'] as 'easy' | 'medium' | 'hard';
  const weakAreas = (input['weak_areas'] as string[]) ?? [];
  const excludeIds = (input['exclude_question_ids'] as string[]) ?? [];

  const question = await fetchNextQuestion({
    interviewType,
    difficulty,
    weakAreas,
    excludeIds,
  });

  if (!question) {
    return {
      error: 'No more questions available for the given criteria',
      suggestion: 'Try a different difficulty or interview type',
    };
  }

  // Track asked questions in session meta
  const meta = await getSessionMeta(sessionId);
  const askedIds = meta?.askedQuestionIds ?? [];
  await updateSessionMeta(sessionId, {
    askedQuestionIds: [...askedIds, question.questionId],
    questionsAsked: (meta?.questionsAsked ?? 0) + 1,
  });

  return {
    question_id: question.questionId,
    question_text: question.questionText,
    topic: question.topic,
    difficulty: question.difficulty,
    interview_type: question.interviewType,
    key_concepts: question.keyConcepts,
    follow_up_hints: question.followUpHints,
  };
}

// ─── Tool: evaluate_answer ───────────────────────────────────────────────────

async function handleEvaluateAnswer(
  sessionId: string,
  input: Record<string, unknown>
): Promise<EvaluationResult> {
  const questionId = input['question_id'] as string;
  const questionText = input['question_text'] as string;
  const candidateAnswer = input['candidate_answer'] as string;
  const interviewType = input['interview_type'] as 'dsa' | 'backend' | 'system-design';
  const topic = input['topic'] as string;
  const idealAnswerHints = (input['ideal_answer_hints'] as string) ?? '';

  // Get user context from session meta
  const meta = await getSessionMeta(sessionId);
  if (!meta) throw new Error('Session metadata not found');
  const userId = meta.userId;

  // Fetch ideal answer from DB for richer evaluation
  let idealContext = idealAnswerHints;
  if (!idealContext) {
    try {
      const questionDoc = await fetchQuestion(questionId);
      if (questionDoc) {
        idealContext = `Key concepts: ${questionDoc.keyConcepts.join(', ')}. Ideal answer: ${questionDoc.idealAnswer.slice(0, 500)}`;
      }
    } catch {
      // Continue without ideal context
    }
  }

  const evaluationPrompt = `QUESTION: ${questionText}

CANDIDATE'S ANSWER: ${candidateAnswer}

${idealContext ? `IDEAL ANSWER REFERENCE: ${idealContext}` : ''}

Evaluate this answer now. Respond ONLY with valid JSON.`;

  // Sub-call to Gemini specifically for structured evaluation (no tools)
  const evalResult = await ai.models.generateContent({
    model: 'gemini-2.5-flash', // Fast and cheap for evaluations
    contents: evaluationPrompt,
    config: {
      systemInstruction: EVALUATION_SYSTEM_PROMPT,
      responseMimeType: 'application/json', // Force JSON output
    },
  });

  const rawText = evalResult.text ?? '';

  let evaluation: EvaluationResult;
  try {
    evaluation = JSON.parse(rawText) as EvaluationResult;
  } catch {
    throw new Error(`Failed to parse evaluation JSON: ${rawText.slice(0, 200)}`);
  }

  // Persist evaluation to MongoDB
  try {
    await persistEvaluation({
      sessionId,
      userId,
      questionId,
      topic,
      interviewType,
      candidateAnswer,
      score: evaluation.score,
      dimensions: evaluation.dimensions,
      missingConcepts: evaluation.missing_concepts,
      strengths: evaluation.strengths,
    });

    // Update running average in session meta
    const scores = [...(meta.scores ?? []), evaluation.score];
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    await updateSessionMeta(sessionId, { scores, avgScore });
  } catch (err) {
    console.error('Failed to persist evaluation:', err);
  }

  return evaluation;
}

// ─── Tool: store_weak_area ───────────────────────────────────────────────────

async function handleStoreWeakArea(
  sessionId: string,
  input: Record<string, unknown>
): Promise<{ stored: boolean; message: string }> {
  const topic = input['topic'] as string;
  const concept = input['concept'] as string;
  const severity = input['severity'] as 'low' | 'medium' | 'high';

  try {
    await upsertWeakArea({ sessionId, topic, concept, severity });

    const meta = await getSessionMeta(sessionId);
    const weakAreas = meta?.weakAreas ?? [];
    if (!weakAreas.includes(concept)) {
      await updateSessionMeta(sessionId, {
        weakAreas: [...weakAreas, concept],
      });
    }

    return { stored: true, message: `Weak area recorded: ${concept} (${severity})` };
  } catch (err) {
    console.error('Failed to store weak area:', err);
    return { stored: false, message: 'Failed to store weak area' };
  }
}

// ─── Tool: fetch_candidate_profile ──────────────────────────────────────────

async function handleFetchCandidateProfile(
  sessionId: string,
  _input: Record<string, unknown>
): Promise<unknown> {
  try {
    const meta = await getSessionMeta(sessionId);
    if (!meta) throw new Error('Session not found');

    const history = await getCandidateHistory(meta.userId);

    return {
      session_id: sessionId,
      weak_areas: history.weakAreas,
      strong_areas: history.strongAreas,
      avg_score: history.avgScore,
      total_sessions: history.totalSessions,
      total_questions: history.totalQuestions,
      score_trend: history.scoreTrend,
      current_session: {
        questions_asked: meta.questionsAsked ?? 0,
        scores_this_session: meta.scores ?? [],
        difficulty: meta.difficulty ?? 'easy',
      },
    };
  } catch (err) {
    console.error('Failed to fetch candidate profile:', err);
    return {
      session_id: sessionId,
      weak_areas: [],
      strong_areas: [],
      avg_score: 0,
      total_sessions: 0,
      total_questions: 0,
      score_trend: [],
      current_session: { questions_asked: 0, scores_this_session: [], difficulty: 'easy' },
    };
  }
}
