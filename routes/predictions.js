const router = require('express').Router();
const ctrl = require('../controllers/predictions');
const { authenticate, requireAdmin, optionalAuth } = require('../middleware/auth');
const { validatePrediction } = require('../middleware/validate');

// Public
router.get('/', optionalAuth, ctrl.list);
router.get('/stats', ctrl.getStats);
router.get('/recent-wins', ctrl.recentWins);
router.get('/bankers', optionalAuth, ctrl.getBankers);
router.get('/featured', optionalAuth, ctrl.getFeatured);
router.get('/id/:id/h2h', optionalAuth, ctrl.getH2H);
router.get('/id/:id/probabilities', optionalAuth, ctrl.getProbabilities);
router.get('/:slug/detail', optionalAuth, ctrl.getDetail);
router.get('/:slug', optionalAuth, ctrl.getBySlug);

// Admin
router.get('/admin/:id', authenticate, requireAdmin, ctrl.getById);
router.post('/admin', authenticate, requireAdmin, validatePrediction, ctrl.create);
router.put('/admin/:id', authenticate, requireAdmin, ctrl.update);
router.delete('/admin/:id', authenticate, requireAdmin, ctrl.remove);
router.put('/admin/:id/result', authenticate, requireAdmin, ctrl.setResult);
router.put('/admin/:id/publish', authenticate, requireAdmin, ctrl.togglePublish);
router.put('/admin/:id/banker', authenticate, requireAdmin, ctrl.toggleBanker);
router.put('/admin/:id/category', authenticate, requireAdmin, ctrl.setCategory);

module.exports = router;
