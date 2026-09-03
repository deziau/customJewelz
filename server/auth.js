'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db, getSetting, setSetting } = require('./db');

const SESSION_COOKIE = 'cj_admin';
const SESSION_TTL_HOURS = 12;

function ensureAdminPassword() {
  if (getSetting('admin_password_hash')) return null;
  const initial = process.env.ADMIN_PASSWORD || 'admin123';
  setSetting('admin_password_hash', bcrypt.hashSync(initial, 10));
  return initial;
}

function verifyPassword(password) {
  const hash = getSetting('admin_password_hash');
  return Boolean(hash) && bcrypt.compareSync(String(password || ''), hash);
}

function changePassword(current, next) {
  if (!verifyPassword(current)) return { ok: false, error: 'Current password is incorrect.' };
  if (!next || String(next).length < 6) return { ok: false, error: 'New password must be at least 6 characters.' };
  setSetting('admin_password_hash', bcrypt.hashSync(String(next), 10));
  db.prepare('DELETE FROM sessions').run();
  return { ok: true };
}

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)').run(token, expires);
  return { token, expires };
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function sessionValid(token) {
  if (!token) return false;
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  return Boolean(db.prepare('SELECT token FROM sessions WHERE token = ?').get(token));
}

function requireAdmin(req, res, next) {
  if (sessionValid(req.cookies?.[SESSION_COOKIE])) return next();
  return res.status(401).json({ error: 'Not signed in as admin.' });
}

module.exports = {
  SESSION_COOKIE,
  SESSION_TTL_HOURS,
  ensureAdminPassword,
  verifyPassword,
  changePassword,
  createSession,
  destroySession,
  sessionValid,
  requireAdmin,
};
