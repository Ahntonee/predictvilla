const router = require('express').Router();
const ctrl = require('../controllers/subscriptions');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { successResponse } = require('../utils/helpers');

// Public: plan prices (read from env so admin can change without code deploy)
router.get('/plans', (req, res) => {
  const currency = process.env.PAYSTACK_PLAN_CURRENCY || 'NGN';
  return successResponse(res, {
    currency,
    plans: [
      { id: 'monthly',   label: 'Monthly',   amount: parseInt(process.env.PAYSTACK_PLAN_MONTHLY_AMOUNT)   || 7500,  period: '1 month',   savings: null },
      { id: 'quarterly', label: 'Quarterly', amount: parseInt(process.env.PAYSTACK_PLAN_QUARTERLY_AMOUNT) || 19500, period: '3 months',  savings: '13%' },
      { id: 'annual',    label: 'Annual',    amount: parseInt(process.env.PAYSTACK_PLAN_ANNUAL_AMOUNT)    || 59900, period: '12 months', savings: '33%' },
    ],
  });
});

router.get('/status', authenticate, ctrl.getStatus);
router.post('/paystack/verify', authenticate, ctrl.paystackVerify);
router.post('/cancel', authenticate, ctrl.cancel);
router.post('/admin/grant', authenticate, requireAdmin, ctrl.adminGrant);
router.get('/admin', authenticate, requireAdmin, ctrl.adminList);
router.get('/admin/export', authenticate, requireAdmin, ctrl.adminExport);
router.put('/admin/:id/extend', authenticate, requireAdmin, ctrl.adminExtend);
router.put('/admin/:id/cancel', authenticate, requireAdmin, ctrl.adminCancel);
router.post('/admin/:id/notify-expiry', authenticate, requireAdmin, ctrl.adminNotifyExpiry);

module.exports = router;
