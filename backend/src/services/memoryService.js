import { Memory } from '../models/Memory.js';
import { chatWithOllama } from './ollamaService.js';

const FACT_EXTRACTION_PROMPT = `You are a memory extraction system. Analyze this conversation and extract factual information about the USER ONLY (not the assistant).

Extract:
1. Personal facts (name, profession, location, age, etc.)
2. Technical expertise and interests  
3. Communication preferences
4. Goals or ongoing projects

Return ONLY valid JSON, no markdown fences, no explanation:
{
  "facts": ["fact1", "fact2"],
  "personality": {
    "communicationStyle": "casual|formal|technical|neutral",
    "expertiseLevel": "beginner|intermediate|expert|unknown",
    "preferredName": "name or null",
    "profession": "job or null",
    "interests": ["interest1"]
  }
}

If nothing extractable, return: {"facts":[],"personality":{}}`;

/**
 * Extract facts from a conversation turn and persist them atomically.
 * Uses MongoDB atomic ops ($push, $set, $inc) to avoid ParallelSaveError.
 */
export async function extractAndUpdateMemory(userId, userMessage, assistantResponse, chatId) {
  try {
    if (!userMessage || userMessage.length < 20) return;

    // Increment message count atomically — no load+save race
    await Memory.updateOne(
      { userId },
      { $inc: { 'stats.totalMessages': 2 }, $set: { lastUpdated: new Date() } },
      { upsert: true }
    );

    // Quick pattern-based extraction (no LLM, fast)
    const quickFacts = extractQuickFacts(userMessage);
    if (quickFacts.length > 0) {
      // Push facts atomically, avoiding duplicates via $addToSet-style logic
      for (const fact of quickFacts) {
        await Memory.updateOne(
          { userId, 'facts.fact': { $ne: fact } }, // only insert if not duplicate
          {
            $push: { facts: { fact, confidence: 0.9, source: chatId?.toString(), createdAt: new Date() } },
            $set: { lastUpdated: new Date() }
          }
        );
      }
    }

    // Personality signals — load once, update once
    const memory = await Memory.findOne({ userId });
    if (memory) {
      const personalityUpdates = buildPersonalityUpdates(memory.personality, userMessage);
      if (Object.keys(personalityUpdates).length > 0) {
        await Memory.updateOne(
          { userId },
          { $set: { ...personalityUpdates, lastUpdated: new Date() } }
        );
      }
    }

    // Deep LLM extraction — every 10 messages, fully async, independent DB operation
    const memForStats = await Memory.findOne({ userId }).select('stats');
    if (memForStats && memForStats.stats.totalMessages % 10 === 0) {
      // Fire and forget — completely independent, won't conflict with above ops
      deepExtraction(userId, userMessage, assistantResponse, chatId)
        .catch(e => console.error('[Memory] Deep extraction error:', e.message));
    }

  } catch (err) {
    console.error('[Memory] extractAndUpdateMemory failed (non-fatal):', err.message);
  }
}

function extractQuickFacts(text) {
  const facts = [];
  const patterns = [
    { re: /my name is (\w+)/i,              tpl: m => `User's name is ${m[1]}` },
    { re: /(?:call me|people call me) (\w+)/i, tpl: m => `User prefers to be called ${m[1]}` },
    { re: /i(?:'m| am) (?:a |an )?([a-z\s]+(developer|engineer|designer|student|manager|doctor|teacher|writer|researcher))/i,
                                             tpl: m => `User is a ${m[1].trim()}` },
    { re: /i(?:'m| am) (\d+) years? old/i,  tpl: m => `User is ${m[1]} years old` },
    { re: /i(?:'m| am) from ([A-Za-z\s,]+)/i, tpl: m => `User is from ${m[1].trim()}` },
    { re: /i work (?:at|for) ([A-Za-z\s]+)/i, tpl: m => `User works at ${m[1].trim()}` },
    { re: /i(?:'m| am) (?:learning|studying) ([A-Za-z\s]+)/i,
                                             tpl: m => `User is learning ${m[1].trim()}` },
    { re: /my (?:project|app|startup|company) (?:is |is called |called )?([A-Za-z0-9\s]+)/i,
                                             tpl: m => `User's project is called ${m[1].trim()}` },
  ];

  for (const { re, tpl } of patterns) {
    const match = text.match(re);
    if (match) {
      const fact = tpl(match);
      if (fact && fact.length < 200) facts.push(fact);
    }
  }
  return facts;
}

function buildPersonalityUpdates(current, text) {
  const updates = {};
  const lower = text.toLowerCase();

  const casualWords    = ['hey', 'lol', 'btw', 'wanna', 'gonna', 'ngl', 'imo', 'tbh', 'fr'];
  const formalWords    = ['therefore', 'furthermore', 'consequently', 'nevertheless', 'regarding', 'pursuant'];
  const technicalWords = ['api', 'algorithm', 'function', 'variable', 'database', 'async', 'promise', 'runtime', 'latency'];

  const casualScore  = casualWords.filter(w => lower.includes(w)).length;
  const formalScore  = formalWords.filter(w => lower.includes(w)).length;
  const techScore    = technicalWords.filter(w => lower.includes(w)).length;

  let newStyle = current.communicationStyle;
  if (techScore >= 2)              newStyle = 'technical';
  else if (casualScore > formalScore) newStyle = 'casual';
  else if (formalScore > casualScore) newStyle = 'formal';

  if (newStyle !== current.communicationStyle) {
    updates['personality.communicationStyle'] = newStyle;
  }

  const beginnerWords = ['how do i', 'what is', 'explain', 'i don\'t understand', 'new to', 'beginner', 'just started'];
  const expertWords   = ['optimize', 'refactor', 'architecture', 'scalability', 'tradeoff', 'benchmark', 'profiling'];
  
  let newLevel = current.expertiseLevel;
  if (expertWords.filter(w => lower.includes(w)).length >= 2)   newLevel = 'expert';
  else if (beginnerWords.filter(w => lower.includes(w)).length >= 2) newLevel = 'beginner';
  else if (newLevel === 'unknown') newLevel = 'intermediate';

  if (newLevel !== current.expertiseLevel) {
    updates['personality.expertiseLevel'] = newLevel;
  }

  // Detect interests
  const interestMap = {
    'AI/ML':       ['ai', 'machine learning', 'llm', 'neural', 'gpt', 'transformer', 'embedding'],
    'Web Dev':     ['react', 'html', 'css', 'frontend', 'backend', 'nextjs', 'vue', 'website'],
    'Mobile':      ['android', 'ios', 'react native', 'flutter', 'swift', 'kotlin'],
    'Data Science':['pandas', 'numpy', 'jupyter', 'matplotlib', 'sklearn', 'dataset'],
    'DevOps':      ['docker', 'kubernetes', 'ci/cd', 'nginx', 'terraform', 'aws', 'gcp'],
    'Gaming':      ['game', 'unity', 'unreal', 'godot', 'opengl', 'shader'],
    'Security':    ['security', 'vulnerability', 'pentest', 'encryption', 'oauth', 'jwt'],
    'Blockchain':  ['blockchain', 'solidity', 'ethereum', 'smart contract', 'web3', 'nft'],
  };

  const currentInterests = current.interests || [];
  const newInterests = [...currentInterests];
  for (const [interest, keywords] of Object.entries(interestMap)) {
    if (!newInterests.includes(interest) && keywords.some(k => lower.includes(k))) {
      newInterests.push(interest);
    }
  }
  if (newInterests.length !== currentInterests.length) {
    updates['personality.interests'] = newInterests;
  }

  return updates;
}

async function deepExtraction(userId, userMessage, assistantResponse, chatId) {
  try {
    const response = await chatWithOllama({
      model: 'mistral',
      messages: [
        { role: 'system', content: FACT_EXTRACTION_PROMPT },
        { role: 'user', content: `User: "${userMessage.substring(0, 800)}"\nAssistant: "${(assistantResponse || '').substring(0, 400)}"` }
      ],
      timeout: 20000,
    });

    const content = response?.message?.content || '';
    let extracted;
    try {
      const clean = content.replace(/```json\s*|```\s*/g, '').trim();
      // Find JSON object in response
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      extracted = JSON.parse(jsonMatch?.[0] || clean);
    } catch {
      return; // Malformed JSON — skip silently
    }

    const factsToAdd = (extracted.facts || []).filter(f => f && f.length > 5 && f.length < 300);

    // All atomic operations — no load/save cycle
    if (factsToAdd.length > 0) {
      for (const fact of factsToAdd) {
        await Memory.updateOne(
          { userId, 'facts.fact': { $ne: fact }, 'facts.99': { $exists: false } }, // cap at 100
          { $push: { facts: { fact, confidence: 0.75, source: chatId?.toString(), createdAt: new Date() } } }
        );
      }
    }

    const ep = extracted.personality || {};
    const personalitySet = {};
    if (ep.communicationStyle && ep.communicationStyle !== 'neutral') personalitySet['personality.communicationStyle'] = ep.communicationStyle;
    if (ep.expertiseLevel && ep.expertiseLevel !== 'unknown')         personalitySet['personality.expertiseLevel'] = ep.expertiseLevel;
    if (ep.preferredName) personalitySet['personality.preferredName'] = ep.preferredName;
    if (ep.profession)    personalitySet['personality.profession']    = ep.profession;

    const ops = { $set: { ...personalitySet, lastUpdated: new Date() } };

    if (ep.interests?.length > 0) {
      ops.$addToSet = { 'personality.interests': { $each: ep.interests } };
    }

    if (Object.keys(personalitySet).length > 0 || ep.interests?.length > 0) {
      await Memory.updateOne({ userId }, ops);
    }

  } catch (err) {
    console.error('[Memory] deepExtraction failed:', err.message);
  }
}