const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'ol_token';
const isProd = process.env.NODE_ENV === 'production';

function isHttpsRequest(res) {
  const req = res.req;
  // HTTPS may terminate at nginx before reaching the Node server.
  const forwardedProto = req?.headers?.['x-forwarded-proto'];
  return Boolean(req?.secure || req?.socket?.encrypted
    || (typeof forwardedProto === 'string' && forwardedProto.split(',')[0].trim().toLowerCase() === 'https'));
}

function generateToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function setTokenCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isHttpsRequest(res),
    sameSite: isProd ? 'strict' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}

function clearTokenCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: isHttpsRequest(res),
    sameSite: isProd ? 'strict' : 'lax',
  });
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

module.exports = { generateToken, setTokenCookie, clearTokenCookie, verifyToken, COOKIE_NAME };
