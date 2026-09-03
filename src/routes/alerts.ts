import { Router, Response } from 'express';
import { db } from '../store/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/v1/alerts
router.get('/', authenticateToken, (req: AuthRequest, res: Response) => {
  const alerts = db.alerts.filter(a => a.organizationId === req.user!.organizationId);

  res.json({
    success: true,
    data: alerts
  });
});

// PUT /api/v1/alerts/:id/read
router.put('/:id/read', authenticateToken, (req: AuthRequest, res: Response) => {
  const alert = db.alerts.find(a => a.id === req.params.id && a.organizationId === req.user!.organizationId);
  if (!alert) {
    return res.status(404).json({ success: false, error: 'Alert not found' });
  }

  alert.isRead = true;

  res.json({
    success: true,
    data: alert
  });
});

// DELETE /api/v1/alerts/clear
router.delete('/clear', authenticateToken, (req: AuthRequest, res: Response) => {
  db.alerts = db.alerts.filter(a => a.organizationId !== req.user!.organizationId);
  res.json({
    success: true,
    message: 'All alerts cleared'
  });
});

export default router;
