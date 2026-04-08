import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { Session } from '../models/session.model';
import { saveSessionMeta, deleteSession } from '../memory/short-term';
import { closeSession, getCandidateHistory } from '../memory/long-term';
import { getSessionSummary } from '../services/evaluation.service';

export const sessionRouter = Router();

const CreateSessionSchema = z.object({
  interviewType: z.enum(['dsa', 'backend', 'system-design']),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('easy'),
});

// POST /sessions — Create a new interview session
sessionRouter.post('/', async (req: Request, res: Response) => {
  try {
    const body = CreateSessionSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: 'Invalid request', details: body.error.flatten() });
    }

    const sessionId = uuidv4();

    // Create MongoDB session record
    await Session.create({
      sessionId,
      interviewType: body.data.interviewType,
      difficulty: body.data.difficulty,
      status: 'active',
      startedAt: new Date(),
    });

    // Bootstrap Redis session meta
    await saveSessionMeta(sessionId, {
      sessionId,
      interviewType: body.data.interviewType,
      difficulty: body.data.difficulty,
      weakAreas: [],
      strongAreas: [],
      avgScore: 0,
      scores: [],
      questionsAsked: 0,
      askedQuestionIds: [],
      startedAt: new Date().toISOString(),
    });

    return res.status(201).json({
      sessionId,
      interviewType: body.data.interviewType,
      difficulty: body.data.difficulty,
      message: 'Session created. POST to /sessions/:id/message to start your interview.',
    });
  } catch (err) {
    console.error('Create session error:', err);
    return res.status(500).json({ error: 'Failed to create session' });
  }
});

// GET /sessions/:id/summary — Get session analytics
sessionRouter.get('/:id/summary', async (req: Request, res: Response) => {
  try {
    const id = req.params['id']!;
    const session = await Session.findOne({ sessionId: id });
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const summary = await getSessionSummary(id);
    return res.json(summary);
  } catch (err) {
    console.error('Session summary error:', err);
    return res.status(500).json({ error: 'Failed to get session summary' });
  }
});

// POST /sessions/:id/end — End a session
sessionRouter.post('/:id/end', async (req: Request, res: Response) => {
  try {
    const id = req.params['id']!;
    await closeSession(id);
    await deleteSession(id);
    const summary = await getSessionSummary(id);
    return res.json({ message: 'Session ended', summary });
  } catch (err) {
    console.error('End session error:', err);
    return res.status(500).json({ error: 'Failed to end session' });
  }
});

// GET /sessions — List all sessions
sessionRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const sessions = await Session.find()
      .sort({ startedAt: -1 })
      .limit(20)
      .select('-__v');
    return res.json({ sessions });
  } catch (err) {
    console.error('List sessions error:', err);
    return res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// GET /sessions/history — Cross-session candidate profile
sessionRouter.get('/history/profile', async (req: Request, res: Response) => {
  try {
    // For multi-user: use req.user.id. Single user for now.
    const history = await getCandidateHistory('global');
    return res.json(history);
  } catch (err) {
    console.error('History profile error:', err);
    return res.status(500).json({ error: 'Failed to get history' });
  }
});
