import { Router, Response } from 'express';
import { z } from 'zod';
import { executeCode, runTestCases } from '../services/code-execution.service';
import { fetchQuestion } from '../rag/retriever';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env';

const ai = new GoogleGenAI({ apiKey: env.GOOGLE_API_KEY });

export const codeRouter = Router();

// Schema for code execution request
const ExecuteCodeSchema = z.object({
  questionId: z.string(),
  code: z.string().min(1, 'Code cannot be empty'),
  language: z.enum(['javascript', 'python', 'java', 'cpp', 'typescript']),
  testCases: z.array(z.object({
    input: z.string(),
    expected_output: z.string(),
  })).optional(),
});

// Schema for solution analysis request
const AnalyzeSolutionSchema = z.object({
  questionId: z.string(),
  questionText: z.string(),
  submittedCode: z.string(),
  language: z.string(),
  testResults: z.string(),
});

codeRouter.use(authenticate);

// POST /code/:sessionId/execute — Execute code and run test cases
// eslint-disable-next-line @typescript-eslint/no-misused-promises
codeRouter.post('/:sessionId/execute', async (req: AuthRequest, res: Response) => {
  try {
    const body = ExecuteCodeSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({
        error: 'Invalid request',
        details: body.error.flatten(),
      });
    }

    const { questionId, code, language, testCases: providedTestCases } = body.data;

    // Get test cases from question if not provided
    let casesToRun = providedTestCases;
    if (!casesToRun || casesToRun.length === 0) {
      const question = await fetchQuestion(questionId);
      if (question && question.testCases && question.testCases.length > 0) {
        casesToRun = question.testCases.map(tc => ({
          input: tc.input,
          expected_output: tc.expectedOutput,
        }));
      }
    }

    // Execute code
    if (!casesToRun || casesToRun.length === 0) {
      // Simple execution without test cases
      const result = await executeCode({
        code,
        language,
        timeoutSeconds: 5,
      });

      return res.json({
        success: result.success,
        output: result.output,
        error: result.error,
        execution_time_ms: result.executionTimeMs,
        timed_out: result.timedOut,
        test_results: [],
      });
    }

    // Run against test cases
    const testResults = await runTestCases(
      code,
      language,
      casesToRun.map(tc => ({
        input: tc.input,
        expectedOutput: tc.expected_output,
      }))
    );

    return res.json({
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
    });
  } catch (err) {
    console.error('Code execution error:', err);
    return res.status(500).json({
      error: 'Code execution failed',
      detail: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// POST /code/:sessionId/analyze — Analyze solution with AI
// eslint-disable-next-line @typescript-eslint/no-misused-promises
codeRouter.post('/:sessionId/analyze', async (req: AuthRequest, res: Response) => {
  try {
    const body = AnalyzeSolutionSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({
        error: 'Invalid request',
        details: body.error.flatten(),
      });
    }

    const { questionText, submittedCode, language, testResults } = body.data;

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
  "feedback": "Detailed feedback for the candidate (2-3 sentences)"
}`;

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
      return res.json({
        ...analysis,
        analyzed: true,
      });
    } catch {
      return res.status(500).json({
        error: 'Failed to parse analysis',
        raw_response: rawText.slice(0, 500),
        analyzed: false,
      });
    }
  } catch (err) {
    console.error('Solution analysis error:', err);
    return res.status(500).json({
      error: 'Analysis failed',
      detail: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});
