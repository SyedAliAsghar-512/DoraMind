import { Router } from 'express';
import auth from '../middleware/auth.js';
import asyncCatch from '../utils/asyncCatchErrors.js';
import {
  getChats, getChat, createChat, deleteChat, updateChat,
  getChatMemory, clearMessages
} from '../controller/chatController.js';
 
const router = Router();
router.use(auth);
 
router.get('/',                      asyncCatch(getChats));
router.post('/',                     asyncCatch(createChat));
router.get('/:chatId',               asyncCatch(getChat));
router.patch('/:chatId',             asyncCatch(updateChat));
router.delete('/:chatId',            asyncCatch(deleteChat));
router.delete('/:chatId/messages',   asyncCatch(clearMessages));
router.get('/:chatId/memory',        asyncCatch(getChatMemory));
 
export default router;