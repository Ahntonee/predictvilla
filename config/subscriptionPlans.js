const SUBSCRIPTION_PLANS = {
  minimum_biweekly: {
    id: 'minimum_biweekly',
    tier: 'minimum',
    label: 'Minimum',
    period: '2 weeks',
    days: 14,
    currency: 'NGN',
    amount: 5000,
    usdAmount: 15,
    benefits: ['Up to 20 prediction tips weekly', '24/7 support', '2 odds bankers twice a week', 'VIP Telegram access'],
  },
  minimum_monthly: {
    id: 'minimum_monthly',
    tier: 'minimum',
    label: 'Minimum',
    period: '1 month',
    days: 30,
    currency: 'NGN',
    amount: 10000,
    usdAmount: 15,
    benefits: ['Up to 20 prediction tips weekly', '24/7 support', '2 odds bankers twice a week', 'VIP Telegram access'],
  },
  standard_biweekly: {
    id: 'standard_biweekly',
    tier: 'standard',
    label: 'Standard',
    period: '2 weeks',
    days: 14,
    currency: 'NGN',
    amount: 7500,
    usdAmount: 15,
    benefits: ['20-35 tips weekly at 85% confidence', '2 odds bankers 3 times a week', '24/7 support', 'Standard VIP channel', 'Weekend accumulator'],
  },
  standard_monthly: {
    id: 'standard_monthly',
    tier: 'standard',
    label: 'Standard',
    period: '1 month',
    days: 30,
    currency: 'NGN',
    amount: 15000,
    usdAmount: 15,
    benefits: ['20-35 tips weekly at 85% confidence', '2 odds bankers 3 times a week', '24/7 support', 'Standard VIP channel', 'Weekend accumulator'],
  },
  diamond_biweekly: {
    id: 'diamond_biweekly',
    tier: 'diamond',
    label: 'Diamond',
    period: '2 weeks',
    days: 14,
    currency: 'NGN',
    amount: 12500,
    usdAmount: 15,
    benefits: ['35-50 odds weekly', '24/7 standby support', 'Diamond VIP channel', '2 odds bankers 5 days a week', 'Weekend accumulator and longshots', 'Daily 1.5 odds'],
  },
  diamond_monthly: {
    id: 'diamond_monthly',
    tier: 'diamond',
    label: 'Diamond',
    period: '1 month',
    days: 30,
    currency: 'NGN',
    amount: 25000,
    usdAmount: 15,
    benefits: ['35-50 odds weekly', '24/7 standby support', 'Diamond VIP channel', '2 odds bankers 5 days a week', 'Weekend accumulator and longshots', 'Daily 1.5 odds'],
  },
};

function getSubscriptionPlan(id, currency = 'NGN') {
  const plan = SUBSCRIPTION_PLANS[id];
  if (!plan) return null;
  if (currency === 'USD') {
    return { ...plan, currency: 'USD', amount: plan.usdAmount };
  }
  return plan;
}

module.exports = { SUBSCRIPTION_PLANS, getSubscriptionPlan };
