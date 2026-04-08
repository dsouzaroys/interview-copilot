import { Schema, model, Document } from 'mongoose';

export interface IQuestion extends Document {
  questionId: string;
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  interviewType: 'dsa' | 'backend' | 'system-design';
  questionText: string;
  idealAnswer: string;
  keyConcepts: string[];
  tags: string[];
  followUpHints: string[];
  embedding: number[]; // 768-dim from Google text-embedding-004
}

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
    questionText: { type: String, required: true },
    idealAnswer: { type: String, required: true },
    keyConcepts: [{ type: String }],
    tags: [{ type: String }],
    followUpHints: [{ type: String }],
    embedding: [{ type: Number }], // 768 floats from Google embedding
  },
  { timestamps: true }
);

QuestionSchema.index({ interviewType: 1, difficulty: 1 });
QuestionSchema.index({ tags: 1 });

export const Question = model<IQuestion>('Question', QuestionSchema);
