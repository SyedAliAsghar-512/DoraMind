import { Router } from 'express';
import auth from '../middleware/auth.js';
import asyncCatch from '../utils/asyncCatchErrors.js';
import { ragStream } from '../controllers/chatController.js';
import {
  getChats,
  getChat,
  createChat,
  deleteChat,
  updateChat,
  getChatMemory,
  clearMessages,
} from '../controller/chatController.js';

const router = Router();
router.use(auth);

// ── Chat session CRUD ──────────────────────────────────────────
router.get('/',                      asyncCatch(getChats));
router.post('/',                     asyncCatch(createChat));
router.get('/:chatId',               asyncCatch(getChat));
router.patch('/:chatId',             asyncCatch(updateChat));
router.delete('/:chatId',            asyncCatch(deleteChat));
router.delete('/:chatId/messages',   asyncCatch(clearMessages));
router.get('/:chatId/memory',        asyncCatch(getChatMemory));

// ── RAG streaming chat (SSE) ───────────────────────────────────
router.post('/:chatId/rag-stream',   asyncCatch(ragStream));

export default router;
