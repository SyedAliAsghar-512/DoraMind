// backend/src/controller/chatController.js
import { Chat } from '../models/Chat.js';
import { Memory } from '../models/Memory.js';

export async function getChats(req, res) {
  const chats = await Chat.find({ userId: req.userId })
    .select('_id title model pinned createdAt updatedAt messages')
    .sort({ pinned: -1, updatedAt: -1 })
    .limit(100)
    .lean();
 
  const result = chats.map(c => ({
    id:          c._id,
    title:       c.title,
    model:       c.model,
    pinned:      c.pinned,
    messageCount:c.messages.length,
    lastMessage: c.messages.at(-1)?.content?.substring(0, 80) || '',
    lastAt:      c.updatedAt,
    createdAt:   c.createdAt,
  }));
 
  res.json({ chats: result });
}
 
export async function getChat(req, res) {
  const chat = await Chat.findOne({ _id: req.params.chatId, userId: req.userId }).populate('documentIds');
  if (!chat) return res.status(404).json({ error: 'Chat not found.' });
  res.json({ chat });
}
 
export async function createChat(req, res) {
  const { model, title, documentIds } = req.body;
  const chat = await Chat.create({
    userId: req.userId,
    title:  title || 'New Chat',
    model:  model || 'mistral',
    messages: [],
    documentIds: documentIds || [] // Support adding documents on creation
  });

  await Memory.updateOne(
    { userId: req.userId },
    { $inc: { 'stats.totalChats': 1 } },
    { upsert: true }
  );

  res.status(201).json({ chat });
}
 
export async function deleteChat(req, res) {
  const result = await Chat.deleteOne({ _id: req.params.chatId, userId: req.userId });
  if (result.deletedCount === 0) return res.status(404).json({ error: 'Chat not found.' });
  res.json({ ok: true });
}
 
export async function updateChat(req, res) {
  const allowed = {};
  if (req.body.title  !== undefined) allowed.title  = req.body.title.substring(0, 120);
  if (req.body.pinned !== undefined) allowed.pinned  = Boolean(req.body.pinned);
  if (req.body.model  !== undefined) allowed.model   = req.body.model;
  if (req.body.documentIds !== undefined) allowed.documentIds = req.body.documentIds;
 
  const chat = await Chat.findOneAndUpdate(
    { _id: req.params.chatId, userId: req.userId },
    { $set: allowed },
    { new: true }
  );
  if (!chat) return res.status(404).json({ error: 'Chat not found.' });
  res.json({ chat });
}
 
export async function getChatMemory(req, res) {
  const memory = await Memory.findOne({ userId: req.userId });
  if (!memory) return res.json({ memory: null });
  res.json({ memory: {
    facts:       memory.facts.slice(0, 20),
    personality: memory.personality,
    stats:       memory.stats,
  }});
}
 
export async function clearMessages(req, res) {
  const chat = await Chat.findOneAndUpdate(
    { _id: req.params.chatId, userId: req.userId },
    { $set: { messages: [], title: 'New Chat' } },
    { new: true }
  );
  if (!chat) return res.status(404).json({ error: 'Chat not found.' });
  res.json({ ok: true });
}