/**
 * ChompChores — server
 * data.json = single source of truth
 * Run: node server.js
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const https = require('https');
const httpMod = require('http');

const PORT      = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const HTML_FILE = path.join(__dirname, 'index.html');

// ── helpers ──────────────────────────────────────────────────────────────────
function readData() {
  try { if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (e) { console.error('[db] read error:', e.message); }
  return null;
}
const BACKUP_DIR   = process.env.BACKUP_DIR || path.join(path.dirname(DATA_FILE), 'backups');
const BACKUP_KEEP   = 30; // rolling window of automatic pre-write snapshots

function rotateBackup() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(DATA_FILE, path.join(BACKUP_DIR, `data.${stamp}.json`));
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('data.')).sort();
    while (files.length > BACKUP_KEEP) fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
  } catch (e) { console.error('[db] backup error:', e.message); }
}

function writeData(obj) {
  try {
    rotateBackup(); // snapshot the previous good state before every overwrite
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(tmp, DATA_FILE);
    return true;
  } catch (e) { console.error('[db] write error:', e.message); return false; }
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type':'application/json','Cache-Control':'no-cache','Access-Control-Allow-Origin':'*' });
  res.end(JSON.stringify(obj));
}
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
}
function parseBody(req) {
  return new Promise((resolve,reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 10_000_000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
    req.on('error', reject);
  });
}

// ── iCal proxy (avoids CORS in browser) ──────────────────────────────────────
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : httpMod;
    const req = mod.get(url, { timeout: 8000, headers: { 'User-Agent': 'ChompChores/1.0' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── server ────────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  cors(res);
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const url    = urlObj.pathname;

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // GET /data
  if (req.method === 'GET' && url === '/data')
    return json(res, 200, readData());

  // POST /data
  if (req.method === 'POST' && url === '/data') {
    try {
      const body = await parseBody(req);
      const ok = writeData(body);
      return json(res, ok ? 200 : 500, { ok });
    }
    catch (e) { return json(res, 400, {ok:false,error:'invalid JSON'}); }
  }

  // DELETE /data
  if (req.method === 'DELETE' && url === '/data') {
    try { rotateBackup(); if (fs.existsSync(DATA_FILE)) fs.unlinkSync(DATA_FILE); } catch(e) {}
    return json(res, 200, {ok:true});
  }

  // GET /ical-proxy?url=... — fetch iCal feed server-side (avoids CORS)
  if (req.method === 'GET' && url === '/ical-proxy') {
    const icalUrl = urlObj.searchParams.get('url');
    if (!icalUrl) return json(res, 400, {error:'missing url'});
    try {
      const data = await fetchUrl(icalUrl);
      res.writeHead(200, { 'Content-Type':'text/calendar;charset=utf-8','Cache-Control':'max-age=300','Access-Control-Allow-Origin':'*' });
      res.end(data);
    } catch (e) {
      json(res, 502, {error:'could not fetch calendar: '+e.message});
    }
    return;
  }

  // GET / — serve app
  fs.readFile(HTML_FILE, (err, data) => {
    if (err) { res.writeHead(500); res.end('Cannot load index.html'); return; }
    res.writeHead(200, {'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-cache'});
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n⚡  ChompChores is running!\n');
  console.log(`   Local:   http://localhost:${PORT}`);
  Object.values(os.networkInterfaces()).flat().forEach(n => {
    if (n.family==='IPv4'&&!n.internal) console.log(`   Network: http://${n.address}:${PORT}`);
  });
  console.log(`\n   Data:   ${DATA_FILE}`);
  console.log(`   Status: ${fs.existsSync(DATA_FILE)?'✓ existing data':'○ fresh start'}`);
  console.log('   Default PIN: 1234\n');
});
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
process.on('SIGINT', ()=>server.close(()=>process.exit(0)));
