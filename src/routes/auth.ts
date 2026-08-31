import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../store/db.js';
import { generateToken, authenticateToken, AuthRequest } from '../middleware/auth.js';

const router = Router();

// POST /api/v1/auth/login
router.post('/login', (req, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password required' });
  }

  // Find user by email
  const user = Array.from(db.users.values()).find(u => u.email.toLowerCase() === email.toLowerCase());

  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }

  const token = generateToken({
    id: user.id,
    email: user.email,
    organizationId: user.organizationId,
    role: user.role,
    name: user.name
  });

  const org = db.organizations.get(user.organizationId);

  res.json({
    success: true,
    data: {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        organizationId: user.organizationId,
        organizationName: org?.name || 'Organization'
      }
    }
  });
});

// GET /api/v1/auth/me
router.get('/me', authenticateToken, (req: AuthRequest, res: Response) => {
  const user = db.users.get(req.user!.id);
  if (!user) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }
  const org = db.organizations.get(user.organizationId);
  res.json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        organizationId: user.organizationId,
        organizationName: org?.name || 'Organization'
      }
    }
  });
});

export default router;
