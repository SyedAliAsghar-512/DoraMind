import { Router } from 'express';
import auth from '../middleware/auth.js';
import asyncCatch from '../utils/asyncCatchErrors.js';
import {
  getModels,
  getHealth,
  pullModelController,
  deleteModelController,
} from '../controller/modelController.js';

const router = Router();
router.use(auth);

router.get('/',              asyncCatch(getModels));
router.get('/health',        asyncCatch(getHealth));
router.post('/pull',         asyncCatch(pullModelController));
router.delete('/:model',     asyncCatch(deleteModelController));

export default router;