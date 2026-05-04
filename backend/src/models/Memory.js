import mongoose from 'mongoose';

const MemorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
 
  // Extracted facts about the user
  facts: [{
    fact:      { type: String, required: true },  // "User is a software engineer"
    confidence:{ type: Number, default: 0.8 },    // 0-1
    source:    { type: String },                  // chatId that produced this fact
    createdAt: { type: Date, default: Date.now },
  }],
 
  // Personality profile (built over time)
  personality: {
    communicationStyle: { type: String, default: 'neutral' }, // formal/casual/technical/neutral
    expertiseLevel:     { type: String, default: 'unknown' }, // beginner/intermediate/expert
    primaryLanguage:    { type: String, default: 'English' },
    interests:          [String],   // ["AI", "web dev", "gaming"]
    profession:         String,
    preferredName:      String,     // how they like to be called
  },
 
  // What models/features they prefer
  aiPreferences: {
    preferredModel:    { type: String, default: 'auto' },
    responseLength:    { type: String, default: 'medium' },
    codeStyle:         { type: String, default: 'commented' },
    preferStreaming:   { type: Boolean, default: true },
  },
 
  // Interaction statistics
  stats: {
    totalMessages:  { type: Number, default: 0 },
    totalChats:     { type: Number, default: 0 },
    avgSessionLen:  { type: Number, default: 0 },
    mostUsedModel:  { type: String, default: 'mistral' },
  },
 
  lastUpdated: { type: Date, default: Date.now },
}, { timestamps: true });
 
MemorySchema.statics.findOrCreate = async function (userId) {
  let m = await this.findOne({ userId });
  if (!m) m = await this.create({ userId });
  return m;
};
 
// Build a compact summary string for prompt injection
MemorySchema.methods.toPromptContext = function () {
  const lines = [];
  const p = this.personality;
  if (p.preferredName) lines.push(`User's preferred name: ${p.preferredName}`);
  if (p.profession)    lines.push(`Profession: ${p.profession}`);
  if (p.expertiseLevel !== 'unknown') lines.push(`Technical expertise: ${p.expertiseLevel}`);
  if (p.communicationStyle !== 'neutral') lines.push(`Communication style: ${p.communicationStyle}`);
  if (p.interests?.length) lines.push(`Interests: ${p.interests.slice(0, 5).join(', ')}`);
 
  // Top confidence facts
  const topFacts = this.facts
    .filter(f => f.confidence > 0.7)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8)
    .map(f => `• ${f.fact}`);
 
  if (topFacts.length) lines.push('Known facts:', ...topFacts);
  return lines.join('\n');
};
 
export const Memory = mongoose.model('Memory', MemorySchema);