import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { connectMongoDB } from './config/mongodb';
import { connectRedis } from './config/redis';
import { sessionRouter } from './routes/session';
import { interviewRouter } from './routes/interview';

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:3001'] }));
app.use(express.json({ limit: '10kb' }));

// Request logging
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/sessions', sessionRouter);
app.use('/sessions', interviewRouter);

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
    console.log('  POST   /sessions                    → Create session');
    console.log('  POST   /sessions/:id/message        → Send message');
    console.log('  GET    /sessions/:id/summary        → Session analytics');
    console.log('  POST   /sessions/:id/end            → End session');
    console.log('  GET    /sessions                    → List all sessions');
    console.log('  GET    /health                      → Health check');
    console.log('');
    console.log('💡 Run `npm run seed` to populate the knowledge base');
    console.log('💡 Run `npm run setup-index` to create Atlas Vector Search index');
    console.log('═══════════════════════════════════');
  });
}

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
