const router = require('express').Router();
const ctrl = require('../controllers/sponsoredPosts');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.get('/', ctrl.list);
router.get('/admin/:id', authenticate, requireAdmin, ctrl.getById);
router.get('/admin', authenticate, requireAdmin, (req, res, next) => {
  req.query.admin = '1';
  ctrl.list(req, res, next);
});
router.post('/admin', authenticate, requireAdmin, ctrl.create);
router.put('/admin/:id', authenticate, requireAdmin, ctrl.update);
router.put('/admin/:id/publish', authenticate, requireAdmin, ctrl.publish);
router.delete('/admin/:id', authenticate, requireAdmin, ctrl.remove);
router.get('/:slug', ctrl.getBySlug);

module.exports = router;
