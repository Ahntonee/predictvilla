const router = require('express').Router();
const ctrl = require('../controllers/subscriptions');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { successResponse, asyncHandler } = require('../utils/helpers');
const { pool } = require('../config/db');
const { NIGERIA_PRICES, INTL_PRICES_USD, isNigeria } = require('../controllers/subscriptions');

const TIERS = [
  {
    id: 'basic', name: 'Villa Basic', tagline: 'Big Odds',
    description: 'For subscribers comfortable with higher variance. 5–10 combined-odds target plus weekend long shots.',
    badge: null, accent: 'soft',
  },
  {
    id: 'standard', name: 'Villa Standard', tagline: 'Balanced',
    description: 'Built around a 2.00 daily target with more selective picks. The middle ground between returns and risk.',
    badge: 'Most Popular', accent: 'primary',
  },
  {
    id: 'diamond', name: 'Villa Diamond', tagline: 'Priority Picks',
    description: 'Built around 1.50 target selections and highest-priority lower-risk picks. 2–3 per day when fixtures justify it.',
    badge: 'Premium', accent: 'diamond',
  },
];

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

// Geo-aware tiered pricing.
// Requires auth so we can read the user's country — never exposes the other country's prices.
router.get('/pricing', authenticate, asyncHandler(async (req, res) => {
  const [[user]] = await pool.query('SELECT country FROM users WHERE id=?', [req.user.id]);
  const nigeria = isNigeria(user?.country);
  const currency  = nigeria ? 'NGN' : 'USD';
  const symbol    = nigeria ? '₦'   : '$';
  const prices    = nigeria ? NIGERIA_PRICES : INTL_PRICES_USD;

  const tiers = TIERS.map(t => ({
    ...t,
    plans: {
      biweekly: { id: `${t.id}_biweekly`, amount: prices[`${t.id}_biweekly`], label: '2 Weeks', period: '14 days' },
      monthly:  { id: `${t.id}_monthly`,  amount: prices[`${t.id}_monthly`],  label: 'Monthly',  period: '1 month' },
    },
  }));

  return successResponse(res, { currency, symbol, country_tier: nigeria ? 'NG' : 'INTL', tiers });
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
