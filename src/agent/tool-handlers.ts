import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env';
import { EVALUATION_SYSTEM_PROMPT } from './prompts';
import { fetchQuestion, fetchNextQuestion } from '../rag/retriever';
import { persistEvaluation, getCandidateHistory, upsertWeakArea } from '../memory/long-term';
import { getSessionMeta, updateSessionMeta } from '../memory/short-term';
import { generateFreshQuestion, getOrGenerateQuestion } from '../services/question-generator.service';
import { executeCode, runTestCases } from '../services/code-execution.service';

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
    case 'generate_fresh_question':
      return handleGenerateFreshQuestion(sessionId, input);
    case 'execute_code':
      return handleExecuteCode(sessionId, input);
    case 'analyze_solution':
      return handleAnalyzeSolution(sessionId, input);
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
    lastQuestionId: question.questionId,
    lastQuestionType: question.questionType,
  });

  const result: Record<string, unknown> = {
    question_id: question.questionId,
    question_text: question.questionText,
    topic: question.topic,
    difficulty: question.difficulty,
    interview_type: question.interviewType,
    question_type: question.questionType,
    key_concepts: question.keyConcepts,
    follow_up_hints: question.followUpHints,
    generated: question.tags?.includes('generated') ?? false,
  };

  // Include coding-specific fields
  if (question.questionType === 'coding') {
    result.starter_code = question.starterCode;
    result.supported_languages = question.supportedLanguages;
    result.test_cases = question.testCases?.map(tc => ({
      input: tc.input,
      expected_output: tc.expectedOutput,
      is_hidden: tc.isHidden,
    }));
    result.time_limit_seconds = question.timeLimitSeconds;
    result.memory_limit_mb = question.memoryLimitMB;
  }

  return result;
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

// ─── Tool: generate_fresh_question ───────────────────────────────────────────

async function handleGenerateFreshQuestion(
  _sessionId: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const interviewType = input['interview_type'] as 'dsa' | 'backend' | 'system-design';
  const difficulty = input['difficulty'] as 'easy' | 'medium' | 'hard';
  const questionType = input['question_type'] as 'theory' | 'coding';
  const topic = input['topic'] as string | undefined;

  try {
    const question = await getOrGenerateQuestion({
      interviewType,
      difficulty,
      questionType,
      topic,
    });

    const result: Record<string, unknown> = {
      question_id: question.questionId,
      question_text: question.questionText,
      topic: question.topic,
      difficulty: question.difficulty,
      interview_type: question.interviewType,
      question_type: question.questionType,
      key_concepts: question.keyConcepts,
      follow_up_hints: question.followUpHints,
      generated: true,
      verified: !!question.verifiedAt,
    };

    // Include coding-specific fields
    if (question.questionType === 'coding') {
      result.starter_code = question.starterCode;
      result.supported_languages = question.supportedLanguages;
      result.test_cases = question.testCases?.map(tc => ({
        input: tc.input,
        expected_output: tc.expectedOutput,
        is_hidden: tc.isHidden,
      }));
      result.time_limit_seconds = question.timeLimitSeconds;
      result.memory_limit_mb = question.memoryLimitMB;
    }

    return result;
  } catch (err) {
    console.error('Failed to generate fresh question:', err);
    return {
      error: 'Failed to generate question',
      detail: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// ─── Tool: execute_code ──────────────────────────────────────────────────────

async function handleExecuteCode(
  sessionId: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const questionId = input['question_id'] as string;
  const code = input['code'] as string;
  const language = input['language'] as 'javascript' | 'python' | 'java' | 'cpp' | 'typescript';
  const testCases = (input['test_cases'] as Array<{ input: string; expected_output: string }>) ?? [];

  if (!code || !language) {
    return { error: 'Code and language are required' };
  }

  try {
    // If test cases provided in input, use them
    let casesToRun = testCases.map(tc => ({
      input: tc.input,
      expectedOutput: tc.expected_output,
    }));

    // Otherwise fetch from the question
    if (casesToRun.length === 0) {
      const question = await fetchQuestion(questionId);
      if (question && question.testCases) {
        casesToRun = question.testCases.map(tc => ({
          input: tc.input,
          expectedOutput: tc.expectedOutput,
        }));
      }
    }

    if (casesToRun.length === 0) {
      // Run without test cases (just check if code executes)
      const result = await executeCode({
        code,
        language,
        timeoutSeconds: 5,
      });

      return {
        success: result.success,
        output: result.output,
        error: result.error,
        execution_time_ms: result.executionTimeMs,
        timed_out: result.timedOut,
        test_results: [],
      };
    }

    // Run against test cases
    const testResults = await runTestCases(code, language, casesToRun);

    return {
      success: testResults.success,
      all_passed: testResults.allPassed,
      summary: testResults.summary,
      total_execution_time_ms: testResults.totalExecutionTimeMs,
      test_results: testResults.results.map(r => ({
        test_case: r.testCase,
        passed: r.passed,
        input: r.input,
        expected_output: r.expectedOutput,
        actual_output: r.actualOutput,
        error: r.error,
        execution_time_ms: r.executionTimeMs,
      })),
    };
  } catch (err) {
    console.error('Code execution error:', err);
    return {
      error: 'Code execution failed',
      detail: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// ─── Tool: analyze_solution ──────────────────────────────────────────────────

async function handleAnalyzeSolution(
  _sessionId: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const questionText = input['question_text'] as string;
  const submittedCode = input['submitted_code'] as string;
  const language = input['language'] as string;
  const testResults = input['test_results'] as string;

  const analysisPrompt = `You are an expert code reviewer and technical interviewer. Analyze this coding solution:

PROBLEM: ${questionText}

SUBMITTED CODE (${language}):
\`\`\`
${submittedCode}
\`\`\`

TEST RESULTS: ${testResults}

Provide a detailed analysis covering:
1. Correctness - Does it solve the problem?
2. Algorithm efficiency (time/space complexity)
3. Code quality and style
4. Edge case handling
5. Areas for improvement

Respond with ONLY valid JSON:
{
  "correctness": "excellent|good|partial|incorrect",
  "correctness_score": 0-10,
  "time_complexity": "e.g., O(n log n)",
  "space_complexity": "e.g., O(n)",
  "code_quality": "excellent|good|fair|poor",
  "strengths": ["specific strength 1", "strength 2"],
  "improvements": ["specific suggestion 1", "suggestion 2"],
  "feedback": "Detailed feedback for the candidate"
}`;

  try {
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: analysisPrompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.3,
      },
    });

    const rawText = result.text ?? '';
    try {
      const analysis = JSON.parse(rawText);
      return {
        ...analysis,
        analyzed: true,
      };
    } catch {
      return {
        error: 'Failed to parse analysis',
        raw_response: rawText.slice(0, 500),
        analyzed: false,
      };
    }
  } catch (err) {
    console.error('Solution analysis error:', err);
    return {
      error: 'Analysis failed',
      detail: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
