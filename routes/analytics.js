const router = require('express').Router();
const ctrl = require('../controllers/analytics');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.use(authenticate, requireAdmin);

router.get('/overview', ctrl.overview);
router.get('/pages', ctrl.topPages);
router.get('/countries', ctrl.countries);
router.get('/devices', ctrl.devices);
router.get('/referrers', ctrl.referrers);
router.get('/revenue/overview', ctrl.revenueOverview);
router.get('/revenue/by-month', ctrl.revenueByMonth);
router.get('/revenue/plans', ctrl.revenuePlans);
router.get('/revenue/churn', ctrl.revenueChurn);

// Prediction intelligence analytics
router.get('/intel/league-stats',       ctrl.leagueStats);
router.get('/intel/market-stats',       ctrl.marketStats);
router.get('/intel/best-picks',         ctrl.bestPicks);
router.get('/intel/team-stats',         ctrl.teamStats);
router.get('/intel/league-profiles',    ctrl.leagueGoalProfiles);
router.get('/intel/accuracy-tracker',   ctrl.accuracyTracker);
router.get('/intel/league-submarket',   ctrl.leagueSubmarket);
router.get('/intel/team-consistency',   ctrl.teamConsistency);
router.get('/intel/calibration',        ctrl.calibration);
router.get('/intel/prediction-frequency', ctrl.predictionFrequency);

module.exports = router;
