const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const { sendContactEmail } = require('../utils/email');
const { successResponse, errorResponse, asyncHandler } = require('../utils/helpers');

const validateContact = [
  body('name').trim().isLength({ min: 2, max: 100 }),
  body('email').trim().isEmail().normalizeEmail(),
  body('subject').optional({ checkFalsy: true }).trim().isLength({ max: 120 }),
  body('message').trim().isLength({ min: 10, max: 5000 }),
];

// Validates and forwards a public contact-form submission to the support inbox.
router.post('/', validateContact, asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return errorResponse(res, 'Please check the contact form fields', 400, errors.array());
  await sendContactEmail(req.body);
  return successResponse(res, null, 'Message sent');
}));

module.exports = router;
