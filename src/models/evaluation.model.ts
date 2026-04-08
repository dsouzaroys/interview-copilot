import { Schema, model, Document } from 'mongoose';

export interface IEvaluation extends Document {
  sessionId: string;
  questionId: string;
  topic: string;
  interviewType: 'dsa' | 'backend' | 'system-design';
  candidateAnswer: string;
  score: number;
  dimensions: {
    correctness: number;
    depth: number;
    clarity: number;
  };
  missingConcepts: string[];
  strengths: string[];
  evaluatedAt: Date;
  userId: string;
}

const EvaluationSchema = new Schema<IEvaluation>(
  {
    sessionId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    questionId: { type: String, required: true },
    topic: { type: String, required: true },
    interviewType: {
      type: String,
      enum: ['dsa', 'backend', 'system-design'],
      required: true,
    },
    candidateAnswer: { type: String, required: true },
    score: { type: Number, required: true, min: 0, max: 10 },
    dimensions: {
      correctness: { type: Number, min: 0, max: 10 },
      depth: { type: Number, min: 0, max: 10 },
      clarity: { type: Number, min: 0, max: 10 },
    },
    missingConcepts: [{ type: String }],
    strengths: [{ type: String }],
    evaluatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Compound index for efficient analytics queries
EvaluationSchema.index({ sessionId: 1, evaluatedAt: 1 });
EvaluationSchema.index({ topic: 1, score: 1 });

export const Evaluation = model<IEvaluation>('Evaluation', EvaluationSchema);
