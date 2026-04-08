import { Schema, model, Document } from 'mongoose';

export interface ISession extends Document {
  sessionId: string;
  interviewType: 'dsa' | 'backend' | 'system-design';
  status: 'active' | 'completed' | 'abandoned';
  difficulty: 'easy' | 'medium' | 'hard';
  startedAt: Date;
  endedAt?: Date;
  totalQuestions: number;
  avgScore: number;
  weakAreasIdentified: string[];
  strongAreasIdentified: string[];
}

const SessionSchema = new Schema<ISession>(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    interviewType: {
      type: String,
      enum: ['dsa', 'backend', 'system-design'],
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'completed', 'abandoned'],
      default: 'active',
    },
    difficulty: {
      type: String,
      enum: ['easy', 'medium', 'hard'],
      default: 'easy',
    },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date },
    totalQuestions: { type: Number, default: 0 },
    avgScore: { type: Number, default: 0 },
    weakAreasIdentified: [{ type: String }],
    strongAreasIdentified: [{ type: String }],
  },
  { timestamps: true }
);

export const Session = model<ISession>('Session', SessionSchema);
