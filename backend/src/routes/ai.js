import { Router } from 'express';
import asyncCatch from '../utils/asyncCatchErrors.js';
import auth from '../middleware/auth.js';
import { aiChat, aiStream } from '../controller/aiController.js';

const router = Router();
router.use(auth);

router.post('/chat', asyncCatch(aiChat));
router.post('/stream', asyncCatch(aiStream));

export default router;