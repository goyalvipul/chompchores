'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Credentials are legacy SHA-256 hashes. Recovery retains that format to avoid
// changing existing passwords; a separate migration should move to scrypt/argon2.
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const ttlMs = 20 * 60 * 1000;
const sessionMs = 7 * 24 * 60 * 60 * 1000;
const sessions = new Map();
const attempts = new Map();

function normalizedEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}
function contactsFromEnv() {
  const entries = String(process.env.RECOVERY_CONTACTS || '').split(',');
  if (process.env.RECOVERY_USERNAME && process.env.RECOVERY_EMAIL) {
    entries.push(process.env.RECOVERY_USERNAME + '=' + process.env.RECOVERY_EMAIL);
  }
  const contacts = new Map();
  for (const entry of entries) {
    const i = entry.indexOf('=');
    if (i < 1) continue;
    const username = entry.slice(0, i).trim().toLowerCase();
    const email = normalizedEmail(entry.slice(i + 1));
    if (username && email) contacts.set(username, email);
  }
  return contacts;
}
function publicUrl() {
  try {
    const url = new URL(process.env.APP_BASE_URL || '');
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return null;
    return url;
  } catch (_) { return null; }
}
function mailReady() {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM && publicUrl() && contactsFromEnv().size);
}
function cookie(req, sid) {
  const secure = process.env.COOKIE_SECURE === 'true' || (process.env.COOKIE_SECURE !== 'false' && publicUrl()?.protocol === 'https:');
  return 'chomp_sid=' + (sid || '') + '; Path=/; HttpOnly; SameSite=Lax' +
    (secure ? '; Secure' : '') + (sid ? '; Max-Age=604800' : '; Max-Age=0');
}
function ipOf(req) {
  // Ignore client-controlled X-Forwarded-For unless an explicit trusted proxy is configured.
  return req.socket.remoteAddress || 'unknown';
}
function withinLimit(key, max, windowMs) {
  const now = Date.now();
  const history = (attempts.get(key) || []).filter(t => t > now - windowMs);
  if (history.length >= max) { attempts.set(key, history); return false; }
  history.push(now);
  attempts.set(key, history);
  if (attempts.size > 10000) {
    for (const [k, v] of attempts) if (!v.some(t => t > now - 60 * 60 * 1000)) attempts.delete(k);
  }
  return true;
}
function safeCompare(a, b) {
  if (!/^[a-f0-9]{64}$/.test(String(a)) || !/^[a-f0-9]{64}$/.test(String(b))) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
function loadTokenFile(file) {
  try {
    const content = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(content) ? content.filter(x => x && typeof x.hash === 'string' && x.expires > Date.now()) : [];
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[recovery] Cannot read reset tokens:', err.message);
    return [];
  }
}
function saveTokenFile(file, list) {
  const temp = file + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temp, JSON.stringify(list), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, file);
}
async function sendEmail(to, subject, textBody, htmlBody) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.MAIL_FROM,
      to: [to],
      subject,
      text: textBody,
      html: htmlBody
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('Email provider returned HTTP ' + response.status);
}
function cleanName(text) {
  return String(text).replace(/[<>&"']/g, '');
}
function readRequest(req, parseBody, limit = 4096) {
  if (Number(req.headers['content-length'] || 0) > limit) throw new Error('Request too large');
  return parseBody(req);
}
function createAuth({ readData, writeData, json, parseBody, dataFile }) {
  const tokenFile = dataFile + '.recovery-tokens.json';

  function ensureInitialUser() {
    const data = readData() || {};
    if (Array.isArray(data.users) && data.users.length) return data;
    const seed = {
      points: 0, chores: [], rewards: [], checked: {}, history: [],
      adminLog: [], oneTimeTasks: [], calFeeds: [], tasks: [],
      userProgress: {}, userScoped: false, rev: 0,
      settings: { dailyTarget: 15, penaltyPts: 5, pin: '1234' }, lastResetDate: null
    };
    const next = { ...seed, ...data, users: [{
      id: crypto.randomUUID(), username: 'maahira', passwordHash: digest('cherry'),
      roles: ['chore'], createdAt: new Date().toISOString()
    }] };
    if (!writeData(next)) throw new Error('Could not initialize accounts');
    return next;
  }
  function currentSession(req) {
    const match = /(?:^|;\s*)chomp_sid=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '');
    if (!match) return null;
    const key = digest(match[1]);
    const stored = sessions.get(key);
    if (!stored || stored.expires <= Date.now()) { sessions.delete(key); return null; }
    const user = (readData()?.users || []).find(x => x.id === stored.userId);
    if (!user) { sessions.delete(key); return null; }
    return { user, key };
  }
  function revokeUserSessions(userId) {
    for (const [key, sess] of sessions) if (sess.userId === userId) sessions.delete(key);
  }
  function reject(res, status = 401) { json(res, status, { error: status === 401 ? 'Sign in required' : 'Forbidden' }); }

  async function handle(req, res, urlObj) {
    const url = urlObj.pathname;
    if (!url.startsWith('/auth/')) return false;
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (req.method === 'GET' && url === '/auth/session') {
        ensureInitialUser();
        const s = currentSession(req);
        json(res, 200, s ? { authenticated: true, userId: s.user.id } : { authenticated: false });
        return true;
      }
      if (req.method === 'POST' && url === '/auth/login') {
        if (!withinLimit('login-ip:' + ipOf(req), 30, 15 * 60 * 1000)) {
          json(res, 429, { error: 'Too many attempts. Try again later.' }); return true;
        }
        const body = await readRequest(req, parseBody);
        const username = String(body?.username || '').trim().toLowerCase().slice(0, 100);
        const password = String(body?.password || '');
        const data = ensureInitialUser();
        const user = (data.users || []).find(x => String(x.username || '').toLowerCase() === username);
        if (!user || !safeCompare(user.passwordHash, digest(password))) {
          json(res, 401, { error: 'Incorrect username or password' }); return true;
        }
        const sid = crypto.randomBytes(32).toString('hex');
        sessions.set(digest(sid), { userId: user.id, expires: Date.now() + sessionMs });
        res.setHeader('Set-Cookie', cookie(req, sid));
        json(res, 200, { ok: true, userId: user.id });
        return true;
      }
      if (req.method === 'POST' && url === '/auth/logout') {
        const s = currentSession(req);
        if (s) sessions.delete(s.key);
        res.setHeader('Set-Cookie', cookie(req, ''));
        json(res, 200, { ok: true }); return true;
      }
      if (req.method === 'GET' && url === '/auth/recovery-config') {
        json(res, 200, { enabled: mailReady() }); return true;
      }
      if (req.method === 'POST' && url === '/auth/forgot') {
        if (!withinLimit('forgot-ip:' + ipOf(req), 12, 60 * 60 * 1000)) {
          json(res, 429, { error: 'Too many requests. Try again later.' }); return true;
        }
        const body = await readRequest(req, parseBody);
        const email = normalizedEmail(body?.email);
        const kind = body?.kind === 'username' ? 'username' : 'password';
        if (!email) { json(res, 400, { error: 'Enter a valid email address' }); return true; }
        if (!mailReady()) { json(res, 503, { error: 'Email recovery is not configured. Contact the app administrator.' }); return true; }
        if (withinLimit('forgot-email:' + digest(email), 3, 60 * 60 * 1000)) {
          const accounts = ensureInitialUser().users || [];
          const names = [...contactsFromEnv()].filter(([username, address]) =>
            address === email && accounts.some(x => String(x.username).toLowerCase() === username)
          ).map(([username]) => username);
          if (names.length) {
            try {
              if (kind === 'username') {
                const safeNames = names.map(cleanName).join(', ');
                await sendEmail(email, 'Your ChompChores username', 'Your ChompChores username(s): ' + safeNames,
                  '<p>Your ChompChores username(s): <strong>' + safeNames + '</strong></p>');
              } else {
                const tokens = loadTokenFile(tokenFile);
                for (const username of names) {
                  const user = accounts.find(x => String(x.username).toLowerCase() === username);
                  const token = crypto.randomBytes(32).toString('hex');
                  const url = new URL(publicUrl());
                  url.searchParams.set('reset_token', token);
                  tokens.push({ hash: digest(token), userId: user.id, expires: Date.now() + ttlMs });
                  saveTokenFile(tokenFile, tokens);
                  await sendEmail(email, 'Reset your ChompChores password',
                    'Password reset for ' + username + ' (expires in 20 minutes): ' + url.toString(),
                    '<p>Reset the password for <strong>' + cleanName(username) + '</strong>.</p>' +
                    '<p><a href="' + url.toString() + '">Reset password</a> (expires in 20 minutes).</p>' +
                    '<p>If you did not request this, ignore this email.</p>');
                }
              }
            } catch (err) {
              console.error('[recovery] Email delivery failed:', err.message);
            }
          }
        }
        json(res, 200, { ok: true, message: 'If the address is registered, check your inbox.' });
        return true;
      }
      if (req.method === 'GET' && url === '/auth/verify-reset') {
        const token = urlObj.searchParams.get('token') || '';
        const match = /^[a-f0-9]{64}$/.test(token) && loadTokenFile(tokenFile).some(x => safeCompare(x.hash, digest(token)));
        json(res, 200, { valid: Boolean(match) }); return true;
      }
      if (req.method === 'POST' && url === '/auth/reset') {
        if (!withinLimit('reset-ip:' + ipOf(req), 25, 60 * 60 * 1000)) {
          json(res, 429, { error: 'Too many attempts. Try again later.' }); return true;
        }
        const body = await readRequest(req, parseBody);
        const token = String(body?.token || '');
        const password = String(body?.password || '');
        if (!/^[a-f0-9]{64}$/.test(token)) { json(res, 400, { error: 'Invalid or expired reset link' }); return true; }
        if (password.length < 12 || password.length > 128) {
          json(res, 400, { error: 'Use a password between 12 and 128 characters' }); return true;
        }
        const tokens = loadTokenFile(tokenFile);
        const index = tokens.findIndex(x => safeCompare(x.hash, digest(token)));
        if (index < 0) { json(res, 400, { error: 'Invalid or expired reset link' }); return true; }
        const data = readData();
        const user = (data?.users || []).find(x => x.id === tokens[index].userId);
        if (!user) { json(res, 400, { error: 'Invalid or expired reset link' }); return true; }
        user.passwordHash = digest(password);
        data.rev = (Number.isFinite(Number(data.rev)) ? Number(data.rev) : 0) + 1;
        if (!writeData(data)) { json(res, 500, { error: 'Could not update password' }); return true; }
        saveTokenFile(tokenFile, tokens.filter(x => x.userId !== user.id));
        revokeUserSessions(user.id);
        json(res, 200, { ok: true }); return true;
      }
      json(res, 404, { error: 'Unknown auth endpoint' });
    } catch (err) {
      console.error('[auth] Error:', err.message);
      json(res, 400, { error: 'Unable to process request' });
    }
    return true;
  }
  return { handle, currentSession, reject };
}
module.exports = { createAuth };
