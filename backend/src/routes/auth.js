import { Router } from 'express';
import asyncCatch from '../utils/asyncCatchErrors.js';
import authMiddleware from '../middleware/auth.js';
import { googleAuth, refreshToken, getMe, updatePreferences, login, register } from '../controller/authController.js';
 
const router = Router();
 
router.post('/register', asyncCatch(register));
router.post('/login',    asyncCatch(login));
router.post('/google',        asyncCatch(googleAuth));
router.post('/refresh',       asyncCatch(refreshToken));
router.get('/me',             authMiddleware, asyncCatch(getMe));
router.patch('/preferences',  authMiddleware, asyncCatch(updatePreferences));
 
export default router;