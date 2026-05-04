import { OAuth2Client } from 'google-auth-library';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { Memory } from '../models/Memory.js';
 
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
 
function issueJWT(userId) {
  return jwt.sign(
    { sub: userId, iat: Math.floor(Date.now() / 1000) },
    process.env.JWT_SECRET,
    { expiresIn: '7d', algorithm: 'HS256' }
  );
}
 
function issueRefreshToken(userId) {
  return jwt.sign(
    { sub: userId, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '30d', algorithm: 'HS256' }
  );
}

// POST /api/auth/register { email, password, name }
export async function register(req, res) {
  const { email, password, name } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: 'All fields required.' });

  const exists = await User.findOne({ email });
  if (exists) return res.status(409).json({ error: 'Email already registered.' });

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ email, passwordHash, name });

  await Memory.findOrCreate(user._id);

  const accessToken  = issueJWT(user._id.toString());
  const refreshToken = issueRefreshToken(user._id.toString());
  res.status(201).json({
    accessToken,
    refreshToken,
    user: {
      id: user._id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      preferences: user.preferences,
    },
    isNew: true,
  });
}

// POST /api/auth/login { email, password }
export async function login(req, res) {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user || !user.passwordHash)
    return res.status(401).json({ error: 'Invalid credentials.' });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials.' });

  const accessToken  = issueJWT(user._id.toString());
  const refreshToken = issueRefreshToken(user._id.toString());
  res.json({
    accessToken,
    refreshToken,
    user: {
      id: user._id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      preferences: user.preferences,
    },
    isNew: false,
  });
}
 
// POST /api/auth/google  { idToken: "..." }
export async function googleAuth(req, res) {
  const { idToken } = req.body;
  if (!idToken || typeof idToken !== 'string') {
    return res.status(400).json({ error: 'Google ID token is required.' });
  }
 
  // 1. Verify Google ID token
  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: 'Invalid Google token.' });
  }
 
  const { sub: googleId, email, name, picture } = payload;
 
  if (!email || !googleId) {
    return res.status(400).json({ error: 'Google account missing required fields.' });
  }
 
  // 2. Find or create user
  let user = await User.findOne({ googleId });
  const isNew = !user;
 
  if (!user) {
    user = await User.create({ googleId, email, name, avatar: picture });
    // Init memory for new users
    await Memory.findOrCreate(user._id);
  } else {
    // Update profile info in case it changed
    await User.updateOne({ _id: user._id }, {
      name, avatar: picture, lastSeen: new Date()
    });
  }
 
  // 3. Issue tokens
  const accessToken  = issueJWT(user._id.toString());
  const refreshToken = issueRefreshToken(user._id.toString());
 
  res.json({
    accessToken,
    refreshToken,
    user: {
      id:     user._id,
      email:  user.email,
      name:   user.name,
      avatar: user.avatar || picture,
      preferences: user.preferences,
    },
    isNew,
  });
}
 
// POST /api/auth/refresh  { refreshToken }
export async function refreshToken(req, res) {
  const { refreshToken: token } = req.body;
  if (!token) return res.status(400).json({ error: 'Refresh token required.' });
 
  try {
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    if (decoded.type !== 'refresh') throw new Error('Not a refresh token');
 
    const user = await User.findById(decoded.sub).select('_id');
    if (!user) return res.status(401).json({ error: 'User not found.' });
 
    const newAccess = issueJWT(user._id.toString());
    res.json({ accessToken: newAccess });
  } catch {
    res.status(401).json({ error: 'Invalid or expired refresh token.' });
  }
}
 
// GET /api/auth/me
export async function getMe(req, res) {
  const user = await User.findById(req.userId).select('-__v');
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user });
}
 
// PATCH /api/auth/preferences
export async function updatePreferences(req, res) {
  const allowed = ['defaultModel', 'theme', 'responseStyle', 'codeLanguage'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[`preferences.${key}`] = req.body[key];
  }
  const user = await User.findByIdAndUpdate(
    req.userId,
    { $set: updates },
    { new: true, runValidators: true }
  ).select('-__v');
  res.json({ user });
}