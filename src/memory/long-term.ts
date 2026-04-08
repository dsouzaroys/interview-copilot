import { Evaluation } from '../models/evaluation.model';
import { Session } from '../models/session.model';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EvaluationInput {
  sessionId: string;
  questionId: string;
  topic: string;
  interviewType: 'dsa' | 'backend' | 'system-design';
  candidateAnswer: string;
  score: number;
  dimensions: { correctness: number; depth: number; clarity: number };
  missingConcepts: string[];
  strengths: string[];
}

export interface WeakAreaInput {
  sessionId: string;
  topic: string;
  concept: string;
  severity: 'low' | 'medium' | 'high';
}

export interface CandidateHistory {
  weakAreas: string[];
  strongAreas: string[];
  avgScore: number;
  totalSessions: number;
  totalQuestions: number;
  scoreTrend: Array<{ score: number; topic: string; date: Date }>;
}

// ─── Persist Evaluation ───────────────────────────────────────────────────────

export async function persistEvaluation(input: EvaluationInput): Promise<void> {
  await Evaluation.create({
    sessionId: input.sessionId,
    questionId: input.questionId,
    topic: input.topic,
    interviewType: input.interviewType,
    candidateAnswer: input.candidateAnswer,
    score: input.score,
    dimensions: input.dimensions,
    missingConcepts: input.missingConcepts,
    strengths: input.strengths,
    evaluatedAt: new Date(),
  });
}

// ─── Upsert Weak Area ─────────────────────────────────────────────────────────

export async function upsertWeakArea(input: WeakAreaInput): Promise<void> {
  // Store weak area on the session document
  await Session.updateOne(
    { sessionId: input.sessionId },
    {
      $addToSet: { weakAreasIdentified: input.concept },
    }
  );
}

// ─── Close Session ────────────────────────────────────────────────────────────

export async function closeSession(sessionId: string): Promise<void> {
  const evaluations = await Evaluation.find({ sessionId });
  const avgScore =
    evaluations.length > 0
      ? evaluations.reduce((sum, e) => sum + e.score, 0) / evaluations.length
      : 0;

  // Identify strong areas (avg score >= 7.5 on a topic)
  const topicScores = new Map<string, number[]>();
  for (const ev of evaluations) {
    const scores = topicScores.get(ev.topic) ?? [];
    scores.push(ev.score);
    topicScores.set(ev.topic, scores);
  }

  const strongAreas: string[] = [];
  for (const [topic, scores] of topicScores.entries()) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (avg >= 7.5) strongAreas.push(topic);
  }

  await Session.updateOne(
    { sessionId },
    {
      status: 'completed',
      endedAt: new Date(),
      totalQuestions: evaluations.length,
      avgScore: Math.round(avgScore * 10) / 10,
      strongAreasIdentified: strongAreas,
    }
  );
}

// ─── Get Candidate History ────────────────────────────────────────────────────

export async function getCandidateHistory(sessionId: string): Promise<CandidateHistory> {
  // Fetch all sessions to build cross-session profile
  // In a multi-user system, filter by userId here
  const allSessions = await Session.find({ status: { $in: ['active', 'completed'] } })
    .sort({ startedAt: -1 })
    .limit(20);

  const sessionIds = allSessions.map((s) => s.sessionId);
  const allEvaluations = await Evaluation.find({ sessionId: { $in: sessionIds } }).sort({
    evaluatedAt: 1,
  });

  // Aggregate weak areas from all sessions
  const weakAreas = [...new Set(allSessions.flatMap((s) => s.weakAreasIdentified))];
  const strongAreas = [...new Set(allSessions.flatMap((s) => s.strongAreasIdentified))];

  const avgScore =
    allEvaluations.length > 0
      ? allEvaluations.reduce((sum, e) => sum + e.score, 0) / allEvaluations.length
      : 0;

  const scoreTrend = allEvaluations.slice(-20).map((e) => ({
    score: e.score,
    topic: e.topic,
    date: e.evaluatedAt,
  }));

  return {
    weakAreas,
    strongAreas,
    avgScore: Math.round(avgScore * 10) / 10,
    totalSessions: allSessions.length,
    totalQuestions: allEvaluations.length,
    scoreTrend,
  };
}
