import Anthropic from '@anthropic-ai/sdk';

export const tools: Anthropic.Tool[] = [
  {
    name: 'get_next_question',
    description: `Fetches the next interview question from the curated knowledge base.
    
    ALWAYS use this tool when you need to ask a new question. NEVER invent or make up questions yourself.
    The tool semantically matches questions to the candidate's weak areas using vector search.
    It will avoid questions already asked in this session.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        interview_type: {
          type: 'string',
          enum: ['dsa', 'backend', 'system-design'],
          description: 'The type of interview',
        },
        difficulty: {
          type: 'string',
          enum: ['easy', 'medium', 'hard'],
          description: 'Difficulty level for the question',
        },
        weak_areas: {
          type: 'array',
          items: { type: 'string' },
          description: 'Topics the candidate is weak in — drives semantic question selection',
        },
        exclude_question_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Question IDs already asked this session — always pass these to prevent repetition',
        },
      },
      required: ['interview_type', 'difficulty', 'weak_areas', 'exclude_question_ids'],
    },
  },
  {
    name: 'evaluate_answer',
    description: `Evaluates the candidate's answer to a question using a structured rubric.
    
    ALWAYS call this tool after a candidate provides their answer. NEVER evaluate answers yourself.
    Returns a score 0-10, dimension breakdown, strengths, missing concepts, and feedback.
    After evaluation, decide if you should call store_weak_area based on the score.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        question_id: {
          type: 'string',
          description: 'The ID of the question being answered',
        },
        question_text: {
          type: 'string',
          description: 'The full text of the question',
        },
        candidate_answer: {
          type: 'string',
          description: "The candidate's complete answer",
        },
        interview_type: {
          type: 'string',
          enum: ['dsa', 'backend', 'system-design'],
        },
        topic: {
          type: 'string',
          description: 'The specific topic this question tests (e.g., "binary search", "caching", "rate limiting")',
        },
        ideal_answer_hints: {
          type: 'string',
          description: 'Key points from the ideal answer to use as evaluation rubric',
        },
      },
      required: ['question_id', 'question_text', 'candidate_answer', 'interview_type', 'topic'],
    },
  },
  {
    name: 'store_weak_area',
    description: `Records a weak area for the candidate based on their performance.
    
    Call this when score < 6 OR when important concepts are missing from the answer.
    This data persists across ALL sessions and influences future question selection.
    Be specific with the concept — "database indexing" not just "databases".`,
    input_schema: {
      type: 'object' as const,
      properties: {
        session_id: {
          type: 'string',
          description: 'The current session ID',
        },
        topic: {
          type: 'string',
          description: 'Broad topic area (e.g., "databases", "system design", "algorithms")',
        },
        concept: {
          type: 'string',
          description: 'Specific concept struggled with (e.g., "B-tree indexing", "cache eviction policies", "two-pointer technique")',
        },
        severity: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'low: score 5-6, medium: score 3-4, high: score 0-2',
        },
      },
      required: ['session_id', 'topic', 'concept', 'severity'],
    },
  },
  {
    name: 'fetch_candidate_profile',
    description: `Retrieves the candidate's complete performance profile across ALL past sessions.
    
    ALWAYS call this at the START of every session before asking the first question.
    Use the weak areas to drive adaptive question selection.
    Also call this when deciding the next question to personalize the difficulty and topic.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        session_id: {
          type: 'string',
          description: 'The current session ID',
        },
      },
      required: ['session_id'],
    },
  },
];
