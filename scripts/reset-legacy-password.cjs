#!/usr/bin/env node
'use strict';
// Emergency operator-only recovery for the legacy Docker JSON app.
// Usage inside container: node /app/scripts/reset-legacy-password.cjs USERNAME
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const file = process.env.DATA_FILE || '/data/data.json';
const username = String(process.argv[2] || '').trim().toLowerCase();
if (!username) {
  console.error('Usage: node /app/scripts/reset-legacy-password.cjs USERNAME');
  process.exit(2);
}
try {
  const original = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(original);
  const user = (data.users || []).find(x => String(x.username || '').toLowerCase() === username);
  if (!user) throw new Error('No matching user. No changes made.');
  const password = crypto.randomBytes(24).toString('base64url');
  const backupDir = path.join(path.dirname(file), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(backupDir, 'emergency-before-reset-' + stamp + '.json');
  fs.writeFileSync(backup, original, { mode: 0o600, flag: 'wx' });
  user.passwordHash = crypto.createHash('sha256').update(password).digest('hex');
  data.rev = (Number(data.rev) || 0) + 1;
  const temp = file + '.emergency-' + process.pid + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, file);
  console.log('Password reset for username: ' + user.username);
  console.log('Temporary password (copy now; not saved in plaintext): ' + password);
  console.log('Backup saved in: ' + backup);
  console.log('Sign in and change your password. Existing browser sessions may require a refresh.');
} catch (err) {
  console.error('Emergency reset failed: ' + err.message);
  process.exit(1);
}
