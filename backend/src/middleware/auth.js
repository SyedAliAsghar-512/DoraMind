import jwt from 'jsonwebtoken';
import User from '../models/User.js';
 
export default async function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization token required.' });
    }
 
    const token = header.slice(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
 
    // Attach userId — avoid DB call on every request by trusting JWT
    // (short expiry + refresh token pattern keeps this safe)
    req.userId = decoded.sub;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired.', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token.' });
  }
}