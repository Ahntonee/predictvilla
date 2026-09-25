const router = require('express').Router();
const ctrl = require('../controllers/admin');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.use(authenticate, requireAdmin);

router.get('/dashboard', ctrl.getDashboardStats);
router.get('/stats', ctrl.getDashboardStats);
router.get('/users', ctrl.listUsers);
router.get('/users/:id', ctrl.getUser);
router.put('/users/:id/ban', ctrl.banUser);
router.put('/users/:id/unban', ctrl.unbanUser);
router.post('/users/:id/grant-vip', ctrl.grantVip);
router.put('/users/:id/role', ctrl.setUserRole);
router.get('/leaderboard', ctrl.getLeaderboard);
router.get('/settings', ctrl.getSettings);
router.put('/settings', ctrl.updateSettings);
router.post('/settings/telegram-test', ctrl.testTelegram);
router.put('/settings/:key', ctrl.updateSetting);
router.get('/seo', ctrl.getSeoSettings);
router.put('/seo/:pageKey', ctrl.updateSeoSetting);

module.exports = router;
