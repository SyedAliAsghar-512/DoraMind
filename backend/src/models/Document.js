import mongoose from 'mongoose';

const DocumentSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  filename:  { type: String, required: true },
  mimeType:  { type: String },
  sizeBytes: { type: Number },

  // Text chunks for RAG
  fileChunks:  [String],
  embeddings:  [[Number]], // per-chunk embedding vectors (future)

  // Image support — store base64 for vision models
  imageBase64:    { type: String },      // base64-encoded image data
  imageMediaType: { type: String },      // e.g. 'image/jpeg'
  isImage:        { type: Boolean, default: false },

  processed:      { type: Boolean, default: false },
  extractionError:{ type: String },
  uploadedAt:     { type: Date, default: Date.now },
});

// Index for quick user lookups
DocumentSchema.index({ userId: 1, uploadedAt: -1 });

export const Document = mongoose.model('Document', DocumentSchema);