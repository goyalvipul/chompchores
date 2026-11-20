'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAuth } = require('../auth');

test('legacy Docker account recovery end-to-end (mock email provider)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chomp-auth-'));
  const dataFile = path.join(dir, 'data.json');
  const oldFetch = global.fetch;
  const oldEnv = Object.fromEntries(['APP_BASE_URL', 'RESEND_API_KEY', 'MAIL_FROM', 'RECOVERY_CONTACTS',
    'RECOVERY_USERNAME', 'RECOVERY_EMAIL'].map(key => [key, process.env[key]]));
  process.env.APP_BASE_URL = 'http://localhost:3000';
  process.env.RESEND_API_KEY = 'test-provider-key';
  process.env.MAIL_FROM = 'ChompChores <test@example.org>';
  process.env.RECOVERY_CONTACTS = 'maahira=owner@example.org';
  delete process.env.RECOVERY_USERNAME;
  delete process.env.RECOVERY_EMAIL;
  const emails = [];
  global.fetch = async (_, opts) => {
    emails.push(JSON.parse(opts.body));
    return { ok: true, status: 200 };
  };

  let state = null;
  const auth = createAuth({
    readData: () => state && structuredClone(state),
    writeData: (next) => { state = structuredClone(next); return true; },
    json: (res, status, body) => { res.status = status; res.body = body; },
    parseBody: async req => req.body,
    dataFile
  });
  async function call(method, uri, body, cookie = '') {
    const headers = { cookie, origin: 'http://localhost:3000' };
    const req = { method, headers, body, socket: { remoteAddress: '127.0.0.1' } };
    const res = { headers: {}, setHeader(name, value) { this.headers[name] = value; } };
    const used = await auth.handle(req, res, new URL(uri, 'http://localhost:3000'));
    assert.equal(used, true);
    return res;
  }

  try {
    const boot = await call('GET', '/auth/session');
    assert.equal(boot.body.authenticated, false);
    assert.equal(state.users.length, 1);
    assert.equal(state.users[0].username, 'maahira');

    const bad = await call('POST', '/auth/login', { username: 'maahira', password: 'wrong' });
    assert.equal(bad.status, 401);
    const login = await call('POST', '/auth/login', { username: 'maahira', password: 'cherry' });
    assert.equal(login.status, 200);
    const cookie = login.headers['Set-Cookie'].split(';')[0];
    const req = { headers: { cookie } };
    assert.equal(auth.currentSession(req).user.username, 'maahira');

    const config = await call('GET', '/auth/recovery-config');
    assert.equal(config.body.enabled, true);

    const unknown = await call('POST', '/auth/forgot', { email: 'unknown@example.org', kind: 'username' });
    assert.equal(unknown.status, 200);
    assert.equal(emails.length, 0); // no account enumeration

    const remind = await call('POST', '/auth/forgot', { email: 'owner@example.org', kind: 'username' });
    assert.equal(remind.status, 200);
    assert.match(emails[0].text, /maahira/);

    const requested = await call('POST', '/auth/forgot', { email: 'owner@example.org', kind: 'password' });
    assert.equal(requested.status, 200);
    assert.equal(emails.length, 2);
    const token = emails[1].text.match(/#reset_token=([a-f0-9]{64})/)?.[1];
    assert.ok(token);
    const verification = await call('POST', '/auth/verify-reset', { token });
    assert.equal(verification.body.valid, true);

    const short = await call('POST', '/auth/reset', { token, password: 'short' });
    assert.equal(short.status, 400);
    const updated = await call('POST', '/auth/reset', { token, password: 'new-long-password-123!' });
    assert.equal(updated.status, 200);
    assert.equal(auth.currentSession(req), null); // old session revoked
    const reused = await call('POST', '/auth/reset', { token, password: 'a-different-long-pass!' });
    assert.equal(reused.status, 400);
    const invalid = await call('GET', '/auth/verify-reset?token=' + token);
    assert.equal(invalid.body.valid, false);

    const oldPassword = await call('POST', '/auth/login', { username: 'maahira', password: 'cherry' });
    assert.equal(oldPassword.status, 401);
    const newPassword = await call('POST', '/auth/login', { username: 'maahira', password: 'new-long-password-123!' });
    assert.equal(newPassword.status, 200);
    assert.ok(state.rev >= 1);
  } finally {
    global.fetch = oldFetch;
    for (const [k, val] of Object.entries(oldEnv)) {
      if (val === undefined) delete process.env[k];
      else process.env[k] = val;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
