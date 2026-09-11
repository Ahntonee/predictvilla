const { body, validationResult } = require('express-validator');
const { errorResponse } = require('../utils/helpers');

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return errorResponse(res, 'Validation failed', 422, errors.array());
  }
  next();
}

const validateRegister = [
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 100 }),
  body('email').trim().isEmail().withMessage('Valid email required').normalizeEmail(),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
    .matches(/[0-9]/).withMessage('Password must contain at least one number')
    .matches(/[^A-Za-z0-9]/).withMessage('Password must contain at least one special character'),
  body('country').optional().trim().isLength({ max: 100 }),
  handleValidation,
];

const validateVerification = [
  body('email').trim().isEmail().withMessage('Valid email required').normalizeEmail(),
  body('token').trim().isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits').isNumeric(),
  handleValidation,
];

const validateLogin = [
  body('email').trim().isEmail().withMessage('Valid email required').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required'),
  handleValidation,
];

const validatePrediction = [
  body('home_team').trim().notEmpty().withMessage('Home team is required'),
  body('away_team').trim().notEmpty().withMessage('Away team is required'),
  body('match_date').notEmpty().withMessage('Match date is required').isISO8601(),
  body('tip').trim().notEmpty().withMessage('Tip is required'),
  body('market').optional().trim(),
  body('category').optional().trim(),
  handleValidation,
];

const validateBlog = [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('content').trim().notEmpty().withMessage('Content is required'),
  handleValidation,
];

module.exports = { validateRegister, validateVerification, validateLogin, validatePrediction, validateBlog, handleValidation };
