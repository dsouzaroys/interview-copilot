import { FunctionDeclaration, Type } from '@google/genai';

// ─── Gemini Function Declarations (@google/genai SDK) ─────────────────────────
// Uses Type enum (STRING, OBJECT, ARRAY) — all-caps values in this SDK.

export const toolDeclarations: FunctionDeclaration[] = [
  {
    name: 'get_next_question',
    description: `Fetches the next interview question from the knowledge base or generates a fresh one.

ALWAYS use this tool when you need to ask a new question. NEVER invent questions yourself.
Can return theory questions (discussion-based) or coding questions (with test cases).
For DSA interviews, coding questions are preferred. For Backend/System Design, theory questions are preferred.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        interview_type: {
          type: Type.STRING,
          description: 'The type of interview: dsa | backend | system-design',
        },
        difficulty: {
          type: Type.STRING,
          description: 'Difficulty level: easy | medium | hard',
        },
        weak_areas: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "Topics the candidate is weak in — drives semantic question selection",
        },
        exclude_question_ids: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Question IDs already asked this session — prevents repetition',
        },
        question_type: {
          type: Type.STRING,
          description: 'Type of question: theory | coding. For DSA, use coding. For Backend/System Design, use theory.',
        },
      },
      required: ['interview_type', 'difficulty', 'weak_areas', 'exclude_question_ids', 'question_type'],
    },
  },
  {
    name: 'generate_fresh_question',
    description: `Generates a brand new interview question using AI. Use this when the knowledge base is exhausted or you want the latest questions.

The question is verified by AI before being presented. For coding questions, includes test cases and starter code.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        interview_type: {
          type: Type.STRING,
          description: 'The type of interview: dsa | backend | system-design',
        },
        difficulty: {
          type: Type.STRING,
          description: 'Difficulty level: easy | medium | hard',
        },
        question_type: {
          type: Type.STRING,
          description: 'Type of question: theory | coding',
        },
        topic: {
          type: Type.STRING,
          description: 'Optional specific topic to focus on',
        },
      },
      required: ['interview_type', 'difficulty', 'question_type'],
    },
  },
  {
    name: 'execute_code',
    description: `Executes code submitted by the candidate in a sandboxed environment.

Use this when a candidate submits code for a coding question. Runs the code against test cases and returns results.
Supports JavaScript, TypeScript, Python, Java, and C++.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        question_id: {
          type: Type.STRING,
          description: 'The ID of the coding question being answered',
        },
        code: {
          type: Type.STRING,
          description: 'The code submitted by the candidate',
        },
        language: {
          type: Type.STRING,
          description: 'Programming language: javascript | typescript | python | java | cpp',
        },
        test_cases: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              input: { type: Type.STRING },
              expected_output: { type: Type.STRING },
            },
          },
          description: 'Test cases to run against the code',
        },
      },
      required: ['question_id', 'code', 'language'],
    },
  },
  {
    name: 'analyze_solution',
    description: `Analyzes a coding solution for correctness, efficiency, and code quality.

Use this after code execution to provide detailed feedback on the solution approach, time/space complexity, and code style.
This is for detailed code review, not just test case results.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        question_id: {
          type: Type.STRING,
          description: 'The ID of the coding question',
        },
        question_text: {
          type: Type.STRING,
          description: 'The problem statement',
        },
        submitted_code: {
          type: Type.STRING,
          description: "The candidate's submitted code",
        },
        language: {
          type: Type.STRING,
          description: 'Programming language used',
        },
        test_results: {
          type: Type.STRING,
          description: 'JSON string of test case results',
        },
      },
      required: ['question_id', 'question_text', 'submitted_code', 'language', 'test_results'],
    },
  },
  {
    name: 'evaluate_answer',
    description: `Evaluates the candidate's answer using a structured rubric.

ALWAYS call this after a candidate provides their answer. NEVER evaluate answers yourself.
Returns a score 0-10, dimension breakdown, strengths, missing concepts, and feedback.
If score < 6, call store_weak_area.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        question_id: {
          type: Type.STRING,
          description: 'The ID of the question being answered',
        },
        question_text: {
          type: Type.STRING,
          description: 'The full text of the question',
        },
        candidate_answer: {
          type: Type.STRING,
          description: "The candidate's complete answer",
        },
        interview_type: {
          type: Type.STRING,
          description: 'Type of interview: dsa | backend | system-design',
        },
        topic: {
          type: Type.STRING,
          description: 'Topic the question tests (e.g. "binary search", "caching")',
        },
        ideal_answer_hints: {
          type: Type.STRING,
          description: 'Key points from the ideal answer used as evaluation rubric',
        },
      },
      required: ['question_id', 'question_text', 'candidate_answer', 'interview_type', 'topic'],
    },
  },
  {
    name: 'store_weak_area',
    description: `Records a weak area for the candidate based on their performance.

Call when score < 6 OR when important concepts are missing.
Persists across ALL sessions and influences future question selection.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        session_id: {
          type: Type.STRING,
          description: 'The current session ID',
        },
        topic: {
          type: Type.STRING,
          description: 'Broad topic area (e.g. "databases", "algorithms")',
        },
        concept: {
          type: Type.STRING,
          description: 'Specific concept struggled with (e.g. "B-tree indexing")',
        },
        severity: {
          type: Type.STRING,
          description: 'Severity: low (score 5-6) | medium (score 3-4) | high (score 0-2)',
        },
      },
      required: ['session_id', 'topic', 'concept', 'severity'],
    },
  },
  {
    name: 'fetch_candidate_profile',
    description: `Retrieves the candidate's full performance profile across ALL past sessions.

ALWAYS call this at the START of every session before asking the first question.
Use weak areas to drive adaptive question selection.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        session_id: {
          type: Type.STRING,
          description: 'The current session ID',
        },
      },
      required: ['session_id'],
    },
  },
];
