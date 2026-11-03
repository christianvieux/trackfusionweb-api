// middlewares/authMiddleware.js
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv'; dotenv.config();  // Load environment variables from .env file
import { getUserById } from '../controllers/userController.js';

async function attachAuthenticatedUser(req, res, next, userId) {
  const user = await getUserById(userId);

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  // Never make password hashes available to downstream route handlers.
  const safeUser = { ...user };
  delete safeUser.password_hash;
  req.user = safeUser;
  return next();
}

export async function authenticateToken(req, res, next) {
  // if (1+1 == 2) {
  //   req.user = {id: 50}
  //   req.session.user = {
  //     id: 59,
  //     username: 'test_1',
  //     email: 'test@test.com',
  //   };
  //   return next()
  // }

  const sessionUserId = req.session?.user?.id;

  // Browser clients use the server-side session as their source of truth.
  // Accept it here so /auth/session and protected routes cannot disagree merely
  // because the redundant JWT cookie is absent.
  if (sessionUserId) {
    try {
      return await attachAuthenticatedUser(req, res, next, sessionUserId);
    } catch (error) {
      console.error('Error authenticating session:', error);
      return res.status(500).json({ error: 'Unable to verify the current session' });
    }
  }

  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: 'Access denied: No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return await attachAuthenticatedUser(req, res, next, decoded.id);
  } catch (error) {
    // Handle specific JWT validation errors
    if (error instanceof jwt.TokenExpiredError) {
      // Token is expired
      return res.status(401).json({ error: 'Token expired. Please log in again.' });
    }

    if (error instanceof jwt.JsonWebTokenError) {
      // Invalid token or signature mismatch
      return res.status(403).json({ error: 'Invalid token. Please log in again to authenticate.' });
    }

    // Generic catch for any other JWT-related errors
    console.error('Error authenticating token:', error);
    return res.status(403).json({ error: 'Invalid token: The provided token is either expired or not valid. Please log in again to authenticate.' })
  }
}
