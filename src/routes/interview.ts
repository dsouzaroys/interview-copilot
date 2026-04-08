import { Response } from 'express';
import { z } from 'zod';
import { Session } from '../models/session.model';
import { agentLoop } from '../agent/loop';
import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';

export const interviewRouter = Router();

const MessageSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty').max(5000),
});

// Use authentication for all interview interactions
interviewRouter.use(authenticate);

// POST /sessions/:id/message — Main turn endpoint
interviewRouter.post('/:id/message', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params['id']!;
    const userId = req.userId!;

    // Validate request body
    const body = MessageSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: 'Invalid request', details: body.error.flatten() });
    }

    // Verify session exists, is active, and belongs to the user
    const session = await Session.findOne({ sessionId: id, userId });
    if (!session) {
      return res.status(404).json({ error: 'Session not found or unauthorized. Create one with POST /sessions' });
    }
    if (session.status === 'completed') {
      return res.status(400).json({
        error: 'Session has ended. Create a new session to continue practicing.',
      });
    }

    // Run the agentic loop
    const startTime = Date.now();
    const result = await agentLoop(id, body.data.message);
    const duration = Date.now() - startTime;

    return res.json({
      sessionId: id,
      reply: result.reply,
      meta: {
        toolsUsed: result.toolsUsed,
        iterations: result.iterationCount,
        processingMs: duration,
      },
    });
  } catch (err) {
    console.error('Interview message error:', err);
    return res.status(500).json({
      error: 'Failed to process message',
      detail: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});
