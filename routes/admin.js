const router = require('express').Router();
const ctrl = require('../controllers/admin');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.use(authenticate, requireAdmin);

router.get('/dashboard', ctrl.getDashboardStats);
// Keep the endpoint used by existing admin clients while dashboard is the canonical name.
router.get('/stats', ctrl.getDashboardStats);
router.get('/users', ctrl.listUsers);
router.get('/users/:id', ctrl.getUser);
router.put('/users/:id/ban', ctrl.banUser);
router.put('/users/:id/unban', ctrl.unbanUser);
router.put('/users/:id/role', ctrl.updateUserRole);
router.post('/users/:id/grant-vip', ctrl.grantVip);
router.get('/leaderboard', ctrl.getLeaderboard);
router.get('/settings', ctrl.getSettings);
router.put('/settings/:key', ctrl.updateSetting);
router.get('/seo', ctrl.getSeoSettings);
router.put('/seo/:pageKey', ctrl.updateSeoSetting);

module.exports = router;
