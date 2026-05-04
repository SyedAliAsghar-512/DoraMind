import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

import authRoutes     from './routes/auth.js';
import chatRoutes     from './routes/chat.js';
import documentRoutes from './routes/document.js';
import aiRoutes       from './routes/ai.js';
import modelRoutes    from './routes/models.js';
import errorHandler   from './middleware/errorHandler.js';
import { handleWebSocket } from './services/wsHandler.js';

const app = express();

app.set('trust proxy', 1);

// ── Security headers ──────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "https://accounts.google.com"],
    }
  }
}));

// ── CORS ──────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Rate limiting ─────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many auth attempts.' },
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  message: { error: 'AI rate limit exceeded, wait a moment.' },
});

app.use(globalLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/ai', aiLimiter);

// ── Body parsing ──────────────────────────────────────────────
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// ── Routes ────────────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/chat',    chatRoutes);
app.use('/api/docs',    documentRoutes);
app.use('/api/ai',      aiRoutes);
app.use('/api/models',  modelRoutes);

// Health check (no auth required)
app.get('/health', async (_, res) => {
  const { checkOllamaHealth } = await import('./services/ollamaService.js');
  const ollama = await checkOllamaHealth();
  res.json({
    status: 'ok',
    ts: new Date().toISOString(),
    ollama: ollama.healthy ? 'up' : 'down',
  });
});

app.use(errorHandler);

// ── HTTP + WebSocket Server ───────────────────────────────────
const httpServer = createServer(app);

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
wss.on('connection', (ws, req) => handleWebSocket(ws, req, wss));

// Ping all clients periodically to detect dead connections
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) { ws.terminate(); return; }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// ── DB + Server start ─────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌  MONGO_URI environment variable is required');
  process.exit(1);
}

mongoose.connect(MONGO_URI, {
  serverSelectionTimeoutMS: 5000,
  maxPoolSize: 10,
}).then(() => {
  console.log('✅  MongoDB connected');
  const PORT = process.env.PORT || 5000;
  httpServer.listen(PORT, () => {
    console.log(`🚀  DoraMind API running on port ${PORT}`);
    console.log(`🔌  WebSocket listening on ws://localhost:${PORT}/ws`);
  });
}).catch(err => {
  console.error('❌  DB connection failed:', err.message);
  process.exit(1);
});

// ── Graceful shutdown ─────────────────────────────────────────
const shutdown = async (signal) => {
  console.log(`\n⏳  ${signal} received, shutting down…`);
  await mongoose.disconnect();
  httpServer.close(() => {
    console.log('✅  Server closed');
    process.exit(0);
  });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

export default app;