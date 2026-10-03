const router = require('express').Router();
const ctrl = require('../controllers/subscriptions');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { successResponse, asyncHandler } = require('../utils/helpers');
const { pool } = require('../config/db');
const { NIGERIA_PRICES, INTL_PRICES_USD, isNigeria } = require('../controllers/subscriptions');

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

// Geo-aware pricing: returns prices in the user's currency based on their registered country.
// Requires auth so we can read the user's country. Never exposes other tiers' prices.
router.get('/pricing', authenticate, asyncHandler(async (req, res) => {
  const [[user]] = await pool.query('SELECT country FROM users WHERE id=?', [req.user.id]);
  const nigeria = isNigeria(user?.country);
  if (nigeria) {
    return successResponse(res, {
      currency: 'NGN', symbol: '₦', country_tier: 'NG',
      plans: [
        { id: 'biweekly',  label: '2 Weeks',   amount: NIGERIA_PRICES.biweekly,  period: '14 days',   savings: null,  popular: false },
        { id: 'monthly',   label: 'Monthly',   amount: NIGERIA_PRICES.monthly,   period: '1 month',   savings: null,  popular: false },
        { id: 'quarterly', label: 'Quarterly', amount: NIGERIA_PRICES.quarterly, period: '3 months',  savings: '13%', popular: true  },
        { id: 'annual',    label: 'Annual',    amount: NIGERIA_PRICES.annual,    period: '12 months', savings: '33%', popular: false },
      ],
    });
  }
  return successResponse(res, {
    currency: 'USD', symbol: '$', country_tier: 'INTL',
    plans: [
      { id: 'biweekly',  label: '2 Weeks',   amount: INTL_PRICES_USD.biweekly,  period: '14 days',   savings: null,  popular: false },
      { id: 'monthly',   label: 'Monthly',   amount: INTL_PRICES_USD.monthly,   period: '1 month',   savings: null,  popular: false },
      { id: 'quarterly', label: 'Quarterly', amount: INTL_PRICES_USD.quarterly, period: '3 months',  savings: null,  popular: true  },
      { id: 'annual',    label: 'Annual',    amount: INTL_PRICES_USD.annual,    period: '12 months', savings: '26%', popular: false },
    ],
  });
}));

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
