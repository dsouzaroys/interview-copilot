import { Router, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { Session } from '../models/session.model';
import { saveSessionMeta, deleteSession } from '../memory/short-term';
import { closeSession, getCandidateHistory, deleteSessionData, clearUserHistory } from '../memory/long-term';
import { getSessionSummary } from '../services/evaluation.service';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';

export const sessionRouter = Router();

const CreateSessionSchema = z.object({
  interviewType: z.enum(['dsa', 'backend', 'system-design']),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('easy'),
});

// Use authentication middleware for all session routes
sessionRouter.use(authenticate);

// POST /sessions — Create a new interview session
sessionRouter.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const body = CreateSessionSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: 'Invalid request', details: body.error.flatten() });
    }

    const sessionId = uuidv4();
    const userId = req.userId!;

    // Create MongoDB session record with userId
    await Session.create({
      sessionId,
      userId,
      interviewType: body.data.interviewType,
      difficulty: body.data.difficulty,
      status: 'active',
      startedAt: new Date(),
    });

    // Bootstrap Redis session meta with userId
    await saveSessionMeta(sessionId, {
      sessionId,
      userId,
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
sessionRouter.get('/:id/summary', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params['id']!;
    const userId = req.userId!;
    
    const session = await Session.findOne({ sessionId: id, userId });
    if (!session) {
      return res.status(404).json({ error: 'Session not found or unauthorized' });
    }

    const summary = await getSessionSummary(id);
    return res.json(summary);
  } catch (err) {
    console.error('Session summary error:', err);
    return res.status(500).json({ error: 'Failed to get session summary' });
  }
});

// POST /sessions/:id/end — End a session
sessionRouter.post('/:id/end', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params['id']!;
    const userId = req.userId!;

    const session = await Session.findOne({ sessionId: id, userId });
    if (!session) {
      return res.status(404).json({ error: 'Session not found or unauthorized' });
    }

    await closeSession(id);
    await deleteSession(id);
    const summary = await getSessionSummary(id);
    return res.json({ message: 'Session ended', summary });
  } catch (err) {
    console.error('End session error:', err);
    return res.status(500).json({ error: 'Failed to end session' });
  }
});

// GET /sessions — List all user sessions
sessionRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const sessions = await Session.find({ userId })
      .sort({ startedAt: -1 })
      .limit(50)
      .select('-__v');
    return res.json({ sessions });
  } catch (err) {
    console.error('List sessions error:', err);
    return res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// GET /sessions/history — Cross-session candidate profile
sessionRouter.get('/history/profile', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const history = await getCandidateHistory(userId);
    return res.json(history);
  } catch (err) {
    console.error('History profile error:', err);
    return res.status(500).json({ error: 'Failed to get history' });
  }
});

// DELETE /sessions/:id — Delete a specific session
sessionRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params['id']!;
    const userId = req.userId!;

    await deleteSessionData(userId, id);
    await deleteSession(id); // Clear from Redis too if it was active
    
    return res.json({ message: 'Session history deleted successfully' });
  } catch (err) {
    console.error('Delete session error:', err);
    return res.status(500).json({ error: 'Failed to delete session history' });
  }
});

// DELETE /sessions — Clear ALL user history
sessionRouter.delete('/', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    await clearUserHistory(userId);
    return res.json({ message: 'All interview history cleared successfully' });
  } catch (err) {
    console.error('Clear history error:', err);
    return res.status(500).json({ error: 'Failed to clear history' });
  }
});
