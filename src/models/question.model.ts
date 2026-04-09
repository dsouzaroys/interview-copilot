import { Schema, model, Document } from 'mongoose';

export interface ITestCase {
  input: string;
  expectedOutput: string;
  isHidden: boolean;
  explanation?: string;
}

export interface IQuestion extends Document {
  questionId: string;
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  interviewType: 'dsa' | 'backend' | 'system-design';
  questionType: 'theory' | 'coding';
  questionText: string;
  idealAnswer: string;
  keyConcepts: string[];
  tags: string[];
  followUpHints: string[];
  embedding: number[]; // 768-dim from Google text-embedding-001
  // Coding question fields
  starterCode?: Record<string, string>; // language -> code template
  testCases?: ITestCase[];
  supportedLanguages?: string[]; // e.g., ['javascript', 'python', 'java', 'cpp']
  timeLimitSeconds?: number;
  memoryLimitMB?: number;
  sourceUrl?: string; // URL where question was sourced from
  verifiedAt?: Date; // When the question was last verified
  // Mongoose timestamps
  createdAt?: Date;
  updatedAt?: Date;
}

const TestCaseSchema = new Schema<ITestCase>({
  input: { type: String, required: true },
  expectedOutput: { type: String, required: true },
  isHidden: { type: Boolean, default: false },
  explanation: { type: String },
});

const QuestionSchema = new Schema<IQuestion>(
  {
    questionId: { type: String, required: true, unique: true, index: true },
    topic: { type: String, required: true },
    difficulty: {
      type: String,
      enum: ['easy', 'medium', 'hard'],
      required: true,
    },
    interviewType: {
      type: String,
      enum: ['dsa', 'backend', 'system-design'],
      required: true,
    },
    questionType: {
      type: String,
      enum: ['theory', 'coding'],
      default: 'theory',
      required: true,
    },
    questionText: { type: String, required: true },
    idealAnswer: { type: String, required: true },
    keyConcepts: [{ type: String }],
    tags: [{ type: String }],
    followUpHints: [{ type: String }],
    embedding: [{ type: Number }], // 768 floats from Google embedding
    // Coding question fields
    starterCode: { type: Map, of: String },
    testCases: [TestCaseSchema],
    supportedLanguages: [{ type: String }],
    timeLimitSeconds: { type: Number, default: 2 },
    memoryLimitMB: { type: Number, default: 256 },
    sourceUrl: { type: String },
    verifiedAt: { type: Date },
  },
  { timestamps: true }
);

QuestionSchema.index({ interviewType: 1, difficulty: 1, questionType: 1 });
QuestionSchema.index({ tags: 1 });
QuestionSchema.index({ questionType: 1 });

export const Question = model<IQuestion>('Question', QuestionSchema);
