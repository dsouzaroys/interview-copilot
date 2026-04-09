import { GoogleGenAI } from '@google/genai';
import { v4 as uuidv4 } from 'uuid';
import { Question, IQuestion } from '../models/question.model';
import { embedQuery } from '../rag/embeddings';
import { env } from '../config/env';

const ai = new GoogleGenAI({ apiKey: env.GOOGLE_API_KEY });

export interface GenerateQuestionOptions {
  interviewType: 'dsa' | 'backend' | 'system-design';
  difficulty: 'easy' | 'medium' | 'hard';
  questionType: 'theory' | 'coding';
  topic?: string;
  weakAreas?: string[];
}

// Topics for each interview type
const TOPIC_MAP: Record<string, string[]> = {
  dsa: [
    'arrays', 'strings', 'hash maps', 'two pointers', 'sliding window',
    'binary search', 'trees', 'binary search trees', 'graphs', 'BFS', 'DFS',
    'dynamic programming', 'recursion', 'backtracking', 'heap', 'stack', 'queue',
    'linked list', 'trie', 'union find', 'topological sort', 'greedy algorithms',
    'bit manipulation', 'math', 'sorting', 'searching'
  ],
  backend: [
    'REST API design', 'authentication', 'JWT', 'OAuth', 'database indexing',
    'query optimization', 'caching strategies', 'Redis', 'rate limiting',
    'message queues', 'Kafka', 'RabbitMQ', 'WebSocket', 'Server-Sent Events',
    'microservices', 'service discovery', 'load balancing', 'Docker',
    'Kubernetes', 'CI/CD', 'SQL', 'NoSQL', 'ACID properties', 'CAP theorem',
    'connection pooling', 'API versioning', 'error handling', 'observability',
    'distributed tracing', 'database sharding', 'GraphQL'
  ],
  'system-design': [
    'URL shortener', 'chat system', 'rate limiter', 'news feed',
    'distributed cache', 'search autocomplete', 'video streaming',
    'notification system', 'API gateway', 'distributed file storage',
    'ride-sharing backend', 'search engine', 'collaborative editor',
    'recommendation system', 'job scheduler', 'e-commerce inventory',
    'payment system', 'ad click tracking', 'proximity service',
    'distributed transactions'
  ]
};

// Prompts for generating different question types
const THEORY_QUESTION_PROMPT = `You are an expert technical interviewer. Generate a fresh, high-quality interview question based on current industry standards.

Requirements:
1. The question should be realistic and commonly asked in FAANG-style interviews
2. Include a detailed ideal answer with key concepts
3. Focus on fundamental understanding, not memorization
4. Include follow-up hints that probe deeper understanding

Generate a {difficulty} level {interviewType} theory question about: {topic}

Respond with ONLY valid JSON in this format:
{{
  "questionText": "the complete question text",
  "idealAnswer": "comprehensive ideal answer with key points",
  "keyConcepts": ["concept1", "concept2", "concept3"],
  "tags": ["tag1", "tag2"],
  "followUpHints": ["hint1", "hint2"]
}}`;

const CODING_QUESTION_PROMPT = `You are an expert technical interviewer. Generate a fresh, high-quality coding interview problem.

Requirements:
1. The problem should be clear, well-defined, and test algorithmic thinking
2. Include starter code templates for JavaScript, Python, and Java
3. Include 3-4 test cases (mix of public and hidden)
4. Specify time and space complexity expectations
5. The problem should be solvable in 20-30 minutes

Generate a {difficulty} level coding question about: {topic} for {interviewType} interviews.

Respond with ONLY valid JSON in this format:
{{
  "questionText": "problem description with examples and constraints",
  "idealAnswer": "optimal solution explanation with time/space complexity analysis",
  "keyConcepts": ["concept1", "concept2", "concept3"],
  "tags": ["tag1", "tag2"],
  "followUpHints": ["hint1", "hint2"],
  "starterCode": {{
    "javascript": "function solve(args) { // TODO }",
    "python": "def solve(args): # TODO",
    "java": "public class Solution { public returnType solve(args) { // TODO } }"
  }},
  "testCases": [
    {{
      "input": "test input as string",
      "expectedOutput": "expected output as string",
      "isHidden": false,
      "explanation": "why this is a good test case"
    }}
  ],
  "timeLimitSeconds": 2,
  "memoryLimitMB": 256,
  "supportedLanguages": ["javascript", "python", "java"]
}}`;

/**
 * Generate a fresh question using Gemini
 */
export async function generateFreshQuestion(
  options: GenerateQuestionOptions
): Promise<Partial<IQuestion>> {
  const { interviewType, difficulty, questionType, topic, weakAreas } = options;

  // Select topic - either specified, from weak areas, or random
  let selectedTopic = topic;
  if (!selectedTopic && weakAreas && weakAreas.length > 0) {
    selectedTopic = weakAreas[Math.floor(Math.random() * weakAreas.length)];
  }
  if (!selectedTopic) {
    const topics = TOPIC_MAP[interviewType] || [];
    if (topics.length > 0) {
      selectedTopic = topics[Math.floor(Math.random() * topics.length)];
    } else {
      selectedTopic = 'general';
    }
  }

  const promptTemplate = questionType === 'coding' ? CODING_QUESTION_PROMPT : THEORY_QUESTION_PROMPT;
  const prompt = promptTemplate
    .replace('{interviewType}', interviewType)
    .replace('{difficulty}', difficulty)
    .replace('{topic}', selectedTopic || 'general');

  // Generate question using Gemini
  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      temperature: 0.7,
    },
  });

  const rawText = result.text ?? '';
  let generated: any;
  try {
    generated = JSON.parse(rawText);
  } catch (err) {
    console.error('Failed to parse generated question:', rawText);
    throw new Error('Failed to generate valid question format');
  }

  // Create the question document
  const questionId = `${interviewType}-${questionType}-${uuidv4().slice(0, 8)}`;

  const questionData: Partial<IQuestion> = {
    questionId,
    topic: selectedTopic,
    difficulty,
    interviewType,
    questionType,
    questionText: generated.questionText,
    idealAnswer: generated.idealAnswer,
    keyConcepts: generated.keyConcepts || [],
    tags: [...(generated.tags || []), 'generated', questionType, interviewType],
    followUpHints: generated.followUpHints || [],
    verifiedAt: new Date(),
  };

  // Add coding-specific fields if applicable
  if (questionType === 'coding') {
    questionData.starterCode = generated.starterCode || {
      javascript: '// TODO: Implement your solution\nfunction solve(args) {\n  \n}',
      python: '# TODO: Implement your solution\ndef solve(args):\n    pass',
      java: '// TODO: Implement your solution\npublic class Solution {\n    public static returnType solve(args) {\n        \n    }\n}'
    };
    questionData.testCases = generated.testCases || [];
    questionData.timeLimitSeconds = generated.timeLimitSeconds || 2;
    questionData.memoryLimitMB = generated.memoryLimitMB || 256;
    questionData.supportedLanguages = generated.supportedLanguages || ['javascript', 'python', 'java'];
  }

  // Generate embedding for the question
  try {
    const embeddingText = `${questionData.topic} ${questionData.questionText} ${questionData.keyConcepts?.join(' ')}`;
    questionData.embedding = await embedQuery(embeddingText);
  } catch (err) {
    console.warn('Failed to generate embedding:', err);
  }

  return questionData;
}

/**
 * Save a generated question to the database
 */
export async function saveGeneratedQuestion(
  questionData: Partial<IQuestion>
): Promise<IQuestion> {
  const question = new Question(questionData);
  return question.save();
}

/**
 * Get or generate a question - checks DB first, generates if needed
 */
export async function getOrGenerateQuestion(
  options: GenerateQuestionOptions
): Promise<IQuestion> {
  // Try to find an existing unused question first
  const { interviewType, difficulty, questionType } = options;

  const existingQuestion = await Question.findOne({
    interviewType,
    difficulty,
    questionType,
    tags: { $in: ['generated'] },
  }).sort({ createdAt: -1 });

  // If we have a recent question (less than 24 hours old), use it
  if (existingQuestion && existingQuestion.createdAt) {
    const ageHours = (Date.now() - existingQuestion.createdAt.getTime()) / (1000 * 60 * 60);
    if (ageHours < 24) {
      return existingQuestion;
    }
  }

  // Generate a new question
  const generated = await generateFreshQuestion(options);
  return saveGeneratedQuestion(generated);
}

/**
 * Verify an externally sourced question using Gemini
 */
export async function verifyQuestion(
  questionText: string,
  interviewType: string,
  difficulty: string
): Promise<{
  isValid: boolean;
  quality: 'high' | 'medium' | 'low';
  issues: string[];
  improvedQuestion?: Partial<IQuestion>;
}> {
  const verifyPrompt = `You are an expert technical interviewer. Verify the quality of this interview question:

Interview Type: ${interviewType}
Difficulty: ${difficulty}
Question: ${questionText}

Evaluate:
1. Is it a realistic, commonly asked interview question?
2. Is the difficulty level appropriate?
3. Does it test important concepts?
4. Is it clear and unambiguous?

Respond with ONLY valid JSON:
{
  "isValid": true/false,
  "quality": "high" | "medium" | "low",
  "issues": ["issue1", "issue2"],
  "improvedVersion": "if quality is medium/low, provide a better version"
}`;

  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: verifyPrompt,
    config: {
      responseMimeType: 'application/json',
      temperature: 0.3,
    },
  });

  const rawText = result.text ?? '';
  try {
    const verification = JSON.parse(rawText);
    return {
      isValid: verification.isValid,
      quality: verification.quality,
      issues: verification.issues || [],
      improvedQuestion: verification.improvedVersion ? {
        questionText: verification.improvedVersion,
      } : undefined,
    };
  } catch (err) {
    console.error('Failed to parse verification result:', rawText);
    return { isValid: false, quality: 'low', issues: ['Failed to verify question'] };
  }
}
