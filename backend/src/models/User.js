import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  googleId:   { type: String, unique: true, sparse: true }, // sparse for non-Google users
  email:      { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String }, // Only for non-Google users
  name:       { type: String, required: true },
  avatar:     { type: String },
  preferences: {
    defaultModel:    { type: String, default: 'mistral', enum: ['mistral', 'llama3', 'qwen:latest'] },
    theme:           { type: String, default: 'dark', enum: ['dark', 'light'] },
    responseStyle:   { type: String, default: 'balanced', enum: ['concise', 'balanced', 'detailed'] },
    codeLanguage:    { type: String, default: 'auto' },
  },
  lastSeen:   { type: Date, default: Date.now },
}, { timestamps: true });

export default mongoose.model('User', UserSchema);// Google profile picture URL
