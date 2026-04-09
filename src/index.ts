import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { connectMongoDB } from './config/mongodb';
import { connectRedis } from './config/redis';
import { sessionRouter } from './routes/session';
import { interviewRouter } from './routes/interview';
import { authRouter } from './routes/auth';
import { codeRouter } from './routes/code';

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors()); // Allow all origins for network access in development
app.use(express.json({ limit: '10kb' }));

// Request logging
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/auth', authRouter);
app.use('/sessions', sessionRouter);
app.use('/sessions', interviewRouter);
app.use('/code', codeRouter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function bootstrap() {
  await connectMongoDB();
  await connectRedis();

  app.listen(env.PORT, () => {
    console.log('');
    console.log('🤖 AI Interview Copilot');
    console.log('═══════════════════════════════════');
    console.log(`🚀 Server running at http://localhost:${env.PORT}`);
    console.log(`📊 Environment: ${env.NODE_ENV}`);
    console.log('');
    console.log('Available endpoints:');
    console.log('  POST   /auth/register               → Create account');
    console.log('  POST   /auth/login                  → Sign in');
    console.log('  POST   /sessions                    → [Auth] Create session');
    console.log('  POST   /sessions/:id/message        → [Auth] Send message');
    console.log('  GET    /sessions/:id/summary        → [Auth] Session analytics');
    console.log('  POST   /sessions/:id/end            → [Auth] End session');
    console.log('  GET    /sessions                    → [Auth] List sessions');
    console.log('  DELETE /sessions/:id                → [Auth] Delete session');
    console.log('  DELETE /sessions                    → [Auth] Clear history');
    console.log('  POST   /code/:id/execute            → [Auth] Execute code');
    console.log('  POST   /code/:id/analyze            → [Auth] Analyze solution');
    console.log('');
    console.log('💡 Run `npm run seed` to populate knowledge base');
    console.log('💡 Run `npm run setup-index` to create vector index');
    console.log('💡 Coding questions now supported for DSA interviews!');
    console.log('═══════════════════════════════════');
  });
}

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
