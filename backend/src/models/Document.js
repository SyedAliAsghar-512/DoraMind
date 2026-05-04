import mongoose from 'mongoose';

const DocumentSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  filename:  { type: String, required: true },
  mimeType:  { type: String },
  sizeBytes: { type: Number },

  // MD5 hash for deduplication (Phase 2D)
  fileHash: { type: String, index: true },

  // Text chunks stored in MongoDB for fallback / display
  fileChunks:  [String],
  chunkCount:  { type: Number, default: 0 },

  // Filesystem paths to extracted images (e.g. rendered PDF pages)
  imagePaths: [String],

  processed:       { type: Boolean, default: false },
  extractionError: { type: String },
  uploadedAt:      { type: Date, default: Date.now },
});

// Compound index: fast lookup of a user's documents by hash (dedup)
DocumentSchema.index({ userId: 1, fileHash: 1 });
DocumentSchema.index({ userId: 1, uploadedAt: -1 });

export const Document = mongoose.model('Document', DocumentSchema);