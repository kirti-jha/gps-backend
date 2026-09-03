"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../store/db");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// GET /api/v1/alerts
router.get('/', auth_1.authenticateToken, (req, res) => {
    const alerts = db_1.db.alerts.filter(a => a.organizationId === req.user.organizationId);
    res.json({
        success: true,
        data: alerts
    });
});
// PUT /api/v1/alerts/:id/read
router.put('/:id/read', auth_1.authenticateToken, (req, res) => {
    const alert = db_1.db.alerts.find(a => a.id === req.params.id && a.organizationId === req.user.organizationId);
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
router.delete('/clear', auth_1.authenticateToken, (req, res) => {
    db_1.db.alerts = db_1.db.alerts.filter(a => a.organizationId !== req.user.organizationId);
    res.json({
        success: true,
        message: 'All alerts cleared'
    });
});
exports.default = router;
