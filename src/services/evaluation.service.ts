import { Evaluation } from '../models/evaluation.model';

export interface ScoreTrend {
  scores: number[];
  movingAverage: number[];
  direction: 'improving' | 'declining' | 'stable';
}

export interface WeakAreaAnalysis {
  weakTopics: string[];
  borderlineTopics: string[];
  strongTopics: string[];
}

// ─── Score Trend ──────────────────────────────────────────────────────────────

export async function getScoreTrend(sessionId: string): Promise<ScoreTrend> {
  const evaluations = await Evaluation.find({ sessionId })
    .sort({ evaluatedAt: 1 })
    .select('score');

  const scores = evaluations.map((e) => e.score);

  const movingAverage = scores.map((_, i) => {
    const window = scores.slice(Math.max(0, i - 2), i + 1);
    return Math.round((window.reduce((a, b) => a + b, 0) / window.length) * 10) / 10;
  });

  let direction: 'improving' | 'declining' | 'stable' = 'stable';
  if (scores.length >= 3) {
    const first = scores.slice(0, Math.floor(scores.length / 2));
    const second = scores.slice(Math.floor(scores.length / 2));
    const firstAvg = first.reduce((a, b) => a + b, 0) / first.length;
    const secondAvg = second.reduce((a, b) => a + b, 0) / second.length;
    if (secondAvg - firstAvg > 0.5) direction = 'improving';
    else if (firstAvg - secondAvg > 0.5) direction = 'declining';
  }

  return { scores, movingAverage, direction };
}

// ─── Identify Weak Areas ──────────────────────────────────────────────────────

export async function identifyWeakAreas(sessionId: string): Promise<WeakAreaAnalysis> {
  const evaluations = await Evaluation.find({ sessionId });

  const topicScores = new Map<string, number[]>();
  for (const ev of evaluations) {
    const scores = topicScores.get(ev.topic) ?? [];
    scores.push(ev.score);
    topicScores.set(ev.topic, scores);
  }

  const weakTopics: string[] = [];
  const borderlineTopics: string[] = [];
  const strongTopics: string[] = [];

  for (const [topic, scores] of topicScores.entries()) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (avg < 5) weakTopics.push(topic);
    else if (avg < 7) borderlineTopics.push(topic);
    else strongTopics.push(topic);
  }

  return { weakTopics, borderlineTopics, strongTopics };
}

// ─── Difficulty Recommendation ────────────────────────────────────────────────

export async function getDifficultyRecommendation(
  sessionId: string
): Promise<'easy' | 'medium' | 'hard'> {
  const evaluations = await Evaluation.find({ sessionId })
    .sort({ evaluatedAt: -1 })
    .limit(3)
    .select('score');

  if (evaluations.length < 3) return 'easy';

  const recentScores = evaluations.map((e) => e.score);
  const avg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;

  if (avg >= 8) return 'hard';
  if (avg >= 6) return 'medium';
  return 'easy';
}

// ─── Session Summary ──────────────────────────────────────────────────────────

export interface SessionSummary {
  sessionId: string;
  totalQuestions: number;
  avgScore: number;
  scoreByTopic: Record<string, number>;
  weakAreas: string[];
  strongAreas: string[];
  scoreTrend: ScoreTrend;
  recommendation: 'easy' | 'medium' | 'hard';
}

export async function getSessionSummary(sessionId: string): Promise<SessionSummary> {
  const evaluations = await Evaluation.find({ sessionId }).sort({ evaluatedAt: 1 });

  const avgScore =
    evaluations.length > 0
      ? Math.round(
          (evaluations.reduce((sum, e) => sum + e.score, 0) / evaluations.length) * 10
        ) / 10
      : 0;

  const scoreByTopic: Record<string, number> = {};
  const topicScores = new Map<string, number[]>();
  for (const ev of evaluations) {
    const scores = topicScores.get(ev.topic) ?? [];
    scores.push(ev.score);
    topicScores.set(ev.topic, scores);
  }
  for (const [topic, scores] of topicScores.entries()) {
    scoreByTopic[topic] =
      Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
  }

  const { weakTopics, strongTopics } = await identifyWeakAreas(sessionId);
  const scoreTrend = await getScoreTrend(sessionId);
  const recommendation = await getDifficultyRecommendation(sessionId);

  return {
    sessionId,
    totalQuestions: evaluations.length,
    avgScore,
    scoreByTopic,
    weakAreas: weakTopics,
    strongAreas: strongTopics,
    scoreTrend,
    recommendation,
  };
}
