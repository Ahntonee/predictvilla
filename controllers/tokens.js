const { successResponse, errorResponse, asyncHandler } = require('../utils/helpers');
const tokens = require('../services/tokens');

exports.getBalance = asyncHandler(async (req, res) => {
  const bal = await tokens.getBalance(req.user.id);
  const status = await tokens.getCheckinStatus(req.user.id);
  return successResponse(res, { ...bal, checkin: status });
});

exports.getCheckinStatus = asyncHandler(async (req, res) => {
  const status = await tokens.getCheckinStatus(req.user.id);
  return successResponse(res, status);
});

exports.checkin = asyncHandler(async (req, res) => {
  const result = await tokens.dailyCheckin(req.user.id);
  if (result.alreadyCheckedIn) return errorResponse(res, 'Already checked in today — come back tomorrow!', 409);
  return successResponse(res, result,
    result.bonus
      ? `+${result.tokens} PVT! ${result.bonus} (Day ${result.streakDay})`
      : `+${result.tokens} PVT — Day ${result.streakDay} streak!`
  );
});

exports.getTransactions = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 30, 100);
  const txns = await tokens.getTransactions(req.user.id, limit);
  return successResponse(res, { transactions: txns });
});

exports.placeBet = asyncHandler(async (req, res) => {
  const { prediction_id, amount, direction } = req.body;
  if (!prediction_id || !amount || !direction) return errorResponse(res, 'prediction_id, amount, direction required', 400);
  const result = await tokens.placeBet(req.user.id, parseInt(prediction_id), parseInt(amount), direction);
  return successResponse(res, result, `Bet placed — ${amount} PVT ${direction} this prediction`, 201);
});

exports.getUserBets = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 30, 100);
  const bets = await tokens.getUserBets(req.user.id, limit);
  return successResponse(res, { bets });
});

exports.getPredictionBets = asyncHandler(async (req, res) => {
  const stats = await tokens.getPredictionBetStats(parseInt(req.params.predictionId));
  return successResponse(res, stats);
});
