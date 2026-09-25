const router = require('express').Router();
const ctrl = require('../controllers/leagues');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.get('/', ctrl.list);
router.get('/admin', authenticate, requireAdmin, ctrl.listAdmin);
router.get('/:id', ctrl.getOne);
router.post('/admin', authenticate, requireAdmin, ctrl.create);
router.put('/admin/:id', authenticate, requireAdmin, ctrl.update);
router.delete('/admin/:id', authenticate, requireAdmin, ctrl.remove);

module.exports = router;
