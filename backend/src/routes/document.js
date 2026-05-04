import { Router } from 'express';
import multer from 'multer';
import auth from '../middleware/auth.js';
import asyncCatch from '../utils/asyncCatchErrors.js';

import {
  getDocuments,
  uploadDocument,
  deleteDocument,
  getDocumentChunks
} from '../controller/documentController.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

const router = Router();

router.use(auth);

router.get('/', asyncCatch(getDocuments));
router.post('/upload', upload.single('file'), asyncCatch(uploadDocument));
router.get('/:docId/chunks', asyncCatch(getDocumentChunks));
router.delete('/:docId', asyncCatch(deleteDocument));

export default router;