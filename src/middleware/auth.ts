import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { db } from '../store/db.js';
import { UserRole } from '../types/index.js';

// Load .env early — auth.ts may be imported before index.ts calls dotenv.config()
dotenv.config();

// ── JWT Secret Guard ──────────────────────────────────────────────────────────
// If JWT_SECRET is not set, the server must NOT start.
// A missing secret means we'd fall back to a publicly-known default — a critical
// security vulnerability that allows anyone to forge valid tokens.
if (!process.env.JWT_SECRET) {
  throw new Error(
    '\n\n' +
    '═══════════════════════════════════════════════════════\n' +
    '  FATAL: JWT_SECRET environment variable is not set.\n' +
    '  The server cannot start without a secure secret.\n' +
    '\n' +
    '  Fix: Add JWT_SECRET to your .env file.\n' +
    '  Generate one with:\n' +
    '    node -e "require(\'crypto\').randomBytes(48, (e,b) => console.log(b.toString(\'hex\')))"\n' +
    '═══════════════════════════════════════════════════════\n'
  );
}

export const JWT_SECRET = process.env.JWT_SECRET;

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    organizationId: string;
    role: UserRole;
    name: string;
  };
}

export function generateToken(payload: object): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ success: false, error: 'Invalid or expired token' });
  }
}

export function requireRole(allowedRoles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Insufficient permissions' });
    }
    next();
  };
}
