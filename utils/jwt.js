const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'ol_token';

function isSecureRequest(req) {
  const forwardedProto = req?.headers?.['x-forwarded-proto'];
  if (req?.secure === false || forwardedProto === 'http') return false;
  if (process.env.COOKIE_SECURE === 'false') return false;
  if (process.env.COOKIE_SECURE === 'true') return req?.secure === true || forwardedProto === 'https';
  return req?.secure === true || forwardedProto === 'https';
}

function generateToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function setTokenCookie(res, token, req) {
  const secure = isSecureRequest(req);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: secure ? 'strict' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}

function clearTokenCookie(res, req) {
  const secure = isSecureRequest(req);
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure,
    sameSite: secure ? 'strict' : 'lax',
  });
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

module.exports = { generateToken, setTokenCookie, clearTokenCookie, verifyToken, COOKIE_NAME };
