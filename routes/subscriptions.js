const router = require('express').Router();
const ctrl = require('../controllers/subscriptions');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { successResponse } = require('../utils/helpers');
const { SUBSCRIPTION_PLANS } = require('../config/subscriptionPlans');

// Public: plan prices (read from env so admin can change without code deploy)
router.get('/plans', (req, res) => {
  const plans = Object.values(SUBSCRIPTION_PLANS);
  return successResponse(res, {
    plans: plans.map(({ id, tier, label, period, days, amount, usdAmount, benefits }) => ({
      id, tier, label, period, days, amount, usdAmount, currency: 'NGN', benefits,
    })),
  });
});

router.get('/status', authenticate, ctrl.getStatus);
router.post('/paystack/verify', authenticate, ctrl.paystackVerify);
router.post('/cancel', authenticate, ctrl.cancel);
router.post('/admin/grant', authenticate, requireAdmin, ctrl.adminGrant);
router.get('/admin', authenticate, requireAdmin, ctrl.adminList);
router.put('/admin/:id/extend', authenticate, requireAdmin, ctrl.adminExtend);
router.put('/admin/:id/cancel', authenticate, requireAdmin, ctrl.adminCancel);
router.post('/admin/:id/notify-expiry', authenticate, requireAdmin, ctrl.adminNotifyExpiry);

// Admin dashboard clients use /api/admin/subscriptions. These aliases keep
// that public contract aligned with the existing subscriptions mount.
router.post('/', authenticate, requireAdmin, ctrl.adminGrant);
router.post('/grant', authenticate, requireAdmin, ctrl.adminGrant);
router.get('/', authenticate, requireAdmin, ctrl.adminList);
router.put('/:id/extend', authenticate, requireAdmin, ctrl.adminExtend);
router.put('/:id/cancel', authenticate, requireAdmin, ctrl.adminCancel);
router.post('/:id/notify-expiry', authenticate, requireAdmin, ctrl.adminNotifyExpiry);

module.exports = router;
