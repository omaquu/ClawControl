require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const si = require('systeminformation');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const sqlite3 = require('sqlite3').verbose();

// ─── DB Promise Wrapper ───────────────────────────────────────────────────────
function openDb() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) reject(err); else resolve(db);
        });
    });
}
let _db;
async function getDb() {
    if (!_db) _db = await openDb();
    return _db;
}
// Helpers that mimic better-sqlite3 sync API but return promises
async function dbRun(sql, params = []) {
    const db = await getDb();
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) { if (err) reject(err); else resolve({ lastID: this.lastID, changes: this.changes }); });
    });
}
async function dbAll(sql, params = []) {
    const db = await getDb();
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows || []); });
    });
}
async function dbGet(sql, params = []) {
    const db = await getDb();
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row || null); });
    });
}
async function initDb() {
    const db = await getDb();
    db.run('PRAGMA journal_mode = WAL');
    const schema = `
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
        status TEXT DEFAULT 'PLANNING', agent_id TEXT, priority TEXT DEFAULT 'MEDIUM',
        tags TEXT DEFAULT '[]', deliverables TEXT DEFAULT '[]', errors TEXT DEFAULT '[]',
        created_at INTEGER DEFAULT (strftime('%s','now')), updated_at INTEGER DEFAULT (strftime('%s','now'))
      );
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT, model TEXT, fallback_model TEXT,
        status TEXT DEFAULT 'standby', quota_used INTEGER DEFAULT 0, quota_limit INTEGER DEFAULT 0,
        config TEXT DEFAULT '{}', created_at INTEGER DEFAULT (strftime('%s','now'))
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, agent_id TEXT, agent_name TEXT, model TEXT,
        tokens INTEGER DEFAULT 0, cost REAL DEFAULT 0, last_message TEXT,
        status TEXT DEFAULT 'idle', created_at INTEGER DEFAULT (strftime('%s','now')),
        updated_at INTEGER DEFAULT (strftime('%s','now'))
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, payload TEXT, agent_id TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now'))
      );
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY, type TEXT DEFAULT 'youtube', channel_id TEXT, name TEXT,
        url TEXT, platform TEXT, notes TEXT, last_checked INTEGER, latest_data TEXT DEFAULT '{}',
        created_at INTEGER DEFAULT (strftime('%s','now'))
      );
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT, role TEXT, content TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now'))
      );
      CREATE TABLE IF NOT EXISTS consul_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT, agent_name TEXT, role TEXT,
        content TEXT, vote_id TEXT, created_at INTEGER DEFAULT (strftime('%s','now'))
      );
      CREATE TABLE IF NOT EXISTS votes (
        id TEXT PRIMARY KEY, topic TEXT, options TEXT DEFAULT '[]', results TEXT DEFAULT '{}',
        mode TEXT DEFAULT 'democratic', status TEXT DEFAULT 'open', round INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s','now'))
      );
      CREATE TABLE IF NOT EXISTS cron_jobs (
        id TEXT PRIMARY KEY, name TEXT, schedule TEXT, command TEXT,
        enabled INTEGER DEFAULT 1, last_run INTEGER, next_run INTEGER,
        created_at INTEGER DEFAULT (strftime('%s','now'))
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY, type TEXT DEFAULT 'info', title TEXT NOT NULL,
        body TEXT DEFAULT '', read INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s','now'))
      );
      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
        base_url TEXT, api_key TEXT, models TEXT DEFAULT '[]',
        priority INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1,
        health TEXT DEFAULT 'unknown', last_health_check INTEGER,
        agent_scope TEXT DEFAULT 'global',
        load_balance_mode TEXT DEFAULT 'priority',
        created_at INTEGER DEFAULT (strftime('%s','now'))
      );
    `;
    return new Promise((resolve, reject) => {
        db.exec(schema, (err) => {
            if (err) { reject(err); return; }
            // Migrate existing sessions table — ignore if columns already exist
            const migrations = [
                'ALTER TABLE sessions ADD COLUMN context_tokens INTEGER DEFAULT 0',
                'ALTER TABLE sessions ADD COLUMN context_window INTEGER DEFAULT 0',
                'ALTER TABLE sessions ADD COLUMN project TEXT'
            ];
            let pending = migrations.length;
            for (const sql of migrations) {
                db.run(sql, () => { if (--pending === 0) resolve(); }); // ignore errors (already exists)
            }
        });
    });
}

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.DASHBOARD_PORT || '7000');
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || process.cwd();
const OPENCLAW_DIR = process.env.OPENCLAW_DIR || path.join(process.env.HOME || process.env.USERPROFILE || '', '.openclaw');
const MC_API_TOKEN = process.env.MC_API_TOKEN || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const GATEWAY_RETRY_BASE = parseInt(process.env.GATEWAY_RETRY_INTERVAL || '1000');
const DATA_DIR = process.env.DATA_DIR || path.join(WORKSPACE_DIR, 'data');
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'clawcontrol.db');
const CREDENTIALS_PATH = path.join(DATA_DIR, 'credentials.json');
const AUDIT_LOG = path.join(DATA_DIR, 'audit.log');
const CLAWCONTROL_LOG = path.join(DATA_DIR, 'clawcontrol.log');
const OPENCLAW_LOG = path.join(DATA_DIR, 'openclaw.log');
const RECOVERY_TOKEN = process.env.DASHBOARD_TOKEN || crypto.randomBytes(16).toString('hex');

// ─── Ensure dirs/token ────────────────────────────────────────────────────────
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(path.join(WORKSPACE_DIR, 'public'))) fs.mkdirSync(path.join(WORKSPACE_DIR, 'public'), { recursive: true });
console.log(`🔑 Recovery token: ${RECOVERY_TOKEN}`);

// ─── Console Logger ────────────────────────────────────────────────────────────
function writeAppLog(level, args) {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${msg}\n`;
    fs.appendFile(CLAWCONTROL_LOG, line, () => { });
}
const origLog = console.log;
console.log = function (...args) { origLog.apply(console, args); writeAppLog('info', args); };
const origWarn = console.warn;
console.warn = function (...args) { origWarn.apply(console, args); writeAppLog('warn', args); };
const origErr = console.error;
console.error = function (...args) { origErr.apply(console, args); writeAppLog('error', args); };



// ─── Credentials ──────────────────────────────────────────────────────────────
function loadCreds() {
    if (!fs.existsSync(CREDENTIALS_PATH)) return null;
    try { return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8')); }
    catch { return null; }
}
function saveCreds(c) {
    fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(c, null, 2));
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────
const sessions = new Map(); // sessionId → { createdAt }
const gatewayUsage = new Map(); // agentId → { model, lastUsed }
const loginAttempts = new Map(); // ip → { count, lockedUntil }

function hashPassword(pw, salt) {
    salt = salt || crypto.randomBytes(32).toString('hex');
    const hash = crypto.pbkdf2Sync(pw, salt, 100000, 64, 'sha512').toString('hex');
    return { hash, salt };
}

function verifyPassword(pw, salt, hash) {
    const { hash: candidate } = hashPassword(pw, salt);
    return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'));
}

function generateSessionId() { return crypto.randomBytes(32).toString('hex'); }

function checkRateLimit(ip) {
    const a = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
    if (a.lockedUntil > Date.now()) return { locked: true, hard: a.count >= 20 };
    return { locked: false };
}

function recordFailedAttempt(ip) {
    const a = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
    a.count++;
    if (a.count >= 20) a.lockedUntil = Date.now() + 86400000;
    else if (a.count >= 5) a.lockedUntil = Date.now() + 900000;
    loginAttempts.set(ip, a);
}

function clearAttempts(ip) { loginAttempts.delete(ip); }

function auditLog(event, detail) {
    const line = JSON.stringify({ ts: new Date().toISOString(), event, detail }) + '\n';
    fs.appendFileSync(AUDIT_LOG, line);
}

// ─── Express App ──────────────────────────────────────────────────────────────
const app = express();

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com", "cdn.jsdelivr.net"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com", "cdnjs.cloudflare.com", "cdn.jsdelivr.net"],
            fontSrc: ["'self'", "fonts.gstatic.com", "cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'", "ws:", "wss:", "blob:"],
            workerSrc: ["'self'", "blob:"],
            upgradeInsecureRequests: null,
        }
    },
    // Prevent forcing HTTPS on the dashboard causing SSL_ERROR_RX_RECORD_TOO_LONG
    hsts: false,
    referrerPolicy: { policy: "no-referrer" },
}));


app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// HTTPS enforcement (skip localhost & Tailscale)
app.use((req, res, next) => {
    const ip = req.ip || '';
    const isLocal = ip === '127.0.0.1' || ip === '::1' || ip.startsWith('::ffff:127.');
    const isTailscale = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);
    const allowHttp = process.env.DASHBOARD_ALLOW_HTTP === 'true';
    if (!allowHttp && !isLocal && !isTailscale && req.headers['x-forwarded-proto'] !== 'https' && req.protocol !== 'https') {
        return res.redirect(301, 'https://' + req.hostname + req.url);
    }
    next();
});

// Auth middleware
function requireAuth(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
    if (token && MC_API_TOKEN && token === MC_API_TOKEN) return next();
    const sessionId = req.headers['x-session-id'] || req.headers['authorization']?.replace('Session ', '');
    if (sessionId && sessions.has(sessionId)) {
        req.sessionId = sessionId;
        return next();
    }
    res.status(401).json({ error: 'Unauthorized' });
}

// ─── API: Auth ────────────────────────────────────────────────────────────────
app.get('/api/auth/status', (req, res) => {
    const creds = loadCreds();
    const sessionId = req.headers['x-session-id'];
    res.json({
        registered: !!creds,
        authenticated: !!(sessionId && sessions.has(sessionId)),
        mfaEnabled: !!(creds && creds.mfaSecret)
    });
});

app.post('/api/auth/register', (req, res) => {
    const creds = loadCreds();
    if (creds) return res.status(409).json({ error: 'Already registered' });
    const { username, password } = req.body;
    if (!username || !password || password.length < 8) return res.status(400).json({ error: 'Invalid credentials' });
    const { hash, salt } = hashPassword(password);
    saveCreds({ username, hash, salt });
    auditLog('register', { username });
    res.json({ ok: true });
});

app.post('/api/auth/login', (req, res) => {
    const ip = req.ip;
    const rl = checkRateLimit(ip);
    if (rl.locked) return res.status(429).json({ error: rl.hard ? 'Account locked. Restart service.' : 'Too many attempts. Wait 15 minutes.' });
    const creds = loadCreds();
    if (!creds) return res.status(404).json({ error: 'Not registered' });
    const { username, password, totp } = req.body;
    if (username !== creds.username || !verifyPassword(password, creds.salt, creds.hash)) {
        recordFailedAttempt(ip);
        auditLog('login_failed', { username, ip });
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (creds.mfaSecret) {
        if (!totp) return res.status(200).json({ mfaRequired: true });
        const valid = authenticator.verify({ token: totp, secret: creds.mfaSecret });
        if (!valid) { recordFailedAttempt(ip); return res.status(401).json({ error: 'Invalid TOTP code' }); }
    }
    clearAttempts(ip);
    const sessionId = generateSessionId();
    sessions.set(sessionId, { createdAt: Date.now(), username });
    auditLog('login', { username, ip });
    res.json({ sessionId, username });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
    sessions.delete(req.sessionId);
    res.json({ ok: true });
});

app.post('/api/auth/reset-password', (req, res) => {
    const { token, newPassword } = req.body;
    if (!crypto.timingSafeEqual(Buffer.from(token || ''), Buffer.from(RECOVERY_TOKEN))) {
        return res.status(401).json({ error: 'Invalid recovery token' });
    }
    const creds = loadCreds();
    if (!creds) return res.status(404).json({ error: 'Not registered' });
    const { hash, salt } = hashPassword(newPassword);
    creds.hash = hash; creds.salt = salt;
    saveCreds(creds);
    sessions.clear();
    auditLog('password_reset', {});
    res.json({ ok: true });
});

app.post('/api/auth/change-password', requireAuth, (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const creds = loadCreds();
    if (!verifyPassword(currentPassword, creds.salt, creds.hash)) return res.status(401).json({ error: 'Wrong password' });
    const { hash, salt } = hashPassword(newPassword);
    creds.hash = hash; creds.salt = salt;
    saveCreds(creds);
    sessions.clear();
    res.json({ ok: true });
});

app.post('/api/auth/mfa/setup', requireAuth, (req, res) => {
    const creds = loadCreds();
    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(creds.username, 'ClawControl', secret);
    QRCode.toDataURL(otpauth, (err, url) => {
        if (err) return res.status(500).json({ error: 'QR error' });
        res.json({ secret, qrcode: url, otpauth });
    });
});

app.post('/api/auth/mfa/enable', requireAuth, (req, res) => {
    const { secret, token } = req.body;
    const valid = authenticator.verify({ token, secret });
    if (!valid) return res.status(400).json({ error: 'Invalid TOTP code' });
    const creds = loadCreds();
    creds.mfaSecret = secret;
    saveCreds(creds);
    auditLog('mfa_enabled', {});
    res.json({ ok: true });
});

app.post('/api/auth/mfa/disable', requireAuth, (req, res) => {
    const { token } = req.body;
    const creds = loadCreds();
    if (!creds.mfaSecret) return res.status(400).json({ error: 'MFA not enabled' });
    if (!authenticator.verify({ token, secret: creds.mfaSecret })) return res.status(401).json({ error: 'Invalid TOTP' });
    delete creds.mfaSecret;
    saveCreds(creds);
    auditLog('mfa_disabled', {});
    res.json({ ok: true });
});

// ─── API: Tasks ───────────────────────────────────────────────────────────────
const taskSchemaKeys = ['title', 'description', 'status', 'agent_id', 'priority', 'tags', 'deliverables', 'errors'];

app.get('/api/tasks', requireAuth, async (req, res) => {
    const tasks = await dbAll('SELECT * FROM tasks ORDER BY created_at DESC');
    res.json(tasks.map(t => ({ ...t, tags: JSON.parse(t.tags || '[]'), deliverables: JSON.parse(t.deliverables || '[]'), errors: JSON.parse(t.errors || '[]') })));
});

app.post('/api/tasks', requireAuth, async (req, res) => {
    const id = crypto.randomUUID();
    const { title, description, status = 'PLANNING', priority = 'MEDIUM', tags = [], agent_id } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    await dbRun('INSERT INTO tasks (id,title,description,status,priority,tags,agent_id) VALUES (?,?,?,?,?,?,?)',
        [id, title, description || '', status, priority, JSON.stringify(tags), agent_id || null]);
    broadcastEvent({ type: 'TASK_CREATED', payload: { id, title, status } });
    res.json({ id });
});

app.put('/api/tasks/:id', requireAuth, async (req, res) => {
    const task = await dbGet('SELECT id FROM tasks WHERE id=?', [req.params.id]);
    if (!task) return res.status(404).json({ error: 'Not found' });
    const updates = {};
    for (const k of taskSchemaKeys) {
        if (req.body[k] !== undefined) updates[k] = Array.isArray(req.body[k]) ? JSON.stringify(req.body[k]) : req.body[k];
    }
    updates.updated_at = Math.floor(Date.now() / 1000);
    const sets = Object.keys(updates).map(k => `${k}=?`).join(',');
    await dbRun(`UPDATE tasks SET ${sets} WHERE id=?`, [...Object.values(updates), req.params.id]);
    broadcastEvent({ type: 'TASK_UPDATED', payload: { id: req.params.id, ...req.body } });
    res.json({ ok: true });
});

app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
    await dbRun('DELETE FROM tasks WHERE id=?', [req.params.id]);
    broadcastEvent({ type: 'TASK_DELETED', payload: { id: req.params.id } });
    res.json({ ok: true });
});

// ─── API: Agents ──────────────────────────────────────────────────────────────
app.get('/api/agents', requireAuth, async (req, res) => {
    const agents = await dbAll('SELECT * FROM agents ORDER BY created_at DESC');
    res.json(agents.map(a => ({ ...a, config: JSON.parse(a.config || '{}') })));
});

app.post('/api/agents', requireAuth, async (req, res) => {
    const id = crypto.randomUUID();
    const { name, role, model, fallback_model, quota_limit, config } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    await dbRun('INSERT INTO agents (id,name,role,model,fallback_model,quota_limit,config) VALUES (?,?,?,?,?,?,?)',
        [id, name, role || '', model || '', fallback_model || '', quota_limit || 0, JSON.stringify(config || {})]);
    broadcastEvent({ type: 'AGENT_CREATED', payload: { id, name } });
    res.json({ id });
});

app.put('/api/agents/:id', requireAuth, async (req, res) => {
    const agent = await dbGet('SELECT id FROM agents WHERE id=?', [req.params.id]);
    if (!agent) return res.status(404).json({ error: 'Not found' });
    const { name, role, model, fallback_model, status, quota_used, quota_limit, config } = req.body;
    await dbRun('UPDATE agents SET name=COALESCE(?,name),role=COALESCE(?,role),model=COALESCE(?,model),fallback_model=COALESCE(?,fallback_model),status=COALESCE(?,status),quota_used=COALESCE(?,quota_used),quota_limit=COALESCE(?,quota_limit),config=COALESCE(?,config) WHERE id=?',
        [name || null, role || null, model || null, fallback_model || null, status || null, quota_used || null, quota_limit || null, config ? JSON.stringify(config) : null, req.params.id]);
    res.json({ ok: true });
});

app.delete('/api/agents/:id', requireAuth, async (req, res) => {
    await dbRun('DELETE FROM agents WHERE id=?', [req.params.id]);
    res.json({ ok: true });
});

// ─── API: Sessions ────────────────────────────────────────────────────────────
app.get('/api/sessions', requireAuth, async (req, res) => {
    const list = await dbAll('SELECT * FROM sessions ORDER BY updated_at DESC');
    res.json(list);
});

app.post('/api/sessions', requireAuth, async (req, res) => {
    const id = crypto.randomUUID();
    const { agent_id, agent_name, model } = req.body;
    await dbRun('INSERT INTO sessions (id,agent_id,agent_name,model) VALUES (?,?,?,?)', [id, agent_id, agent_name || '', model || '']);
    res.json({ id });
});

// ─── API: Chat ────────────────────────────────────────────────────────────────
app.get('/api/chat/:agentId', requireAuth, async (req, res) => {
    const msgs = await dbAll('SELECT * FROM chat_messages WHERE agent_id=? ORDER BY created_at ASC', [req.params.agentId]);
    res.json(msgs);
});

app.post('/api/chat/:agentId', requireAuth, async (req, res) => {
    const { role, content } = req.body;
    const r = await dbRun('INSERT INTO chat_messages (agent_id,role,content) VALUES (?,?,?)', [req.params.agentId, role || 'user', content]);
    const msg = { id: r.lastID, agent_id: req.params.agentId, role: role || 'user', content, created_at: Math.floor(Date.now() / 1000) };
    broadcastEvent({ type: 'CHAT_MESSAGE', payload: msg });
    res.json(msg);
});

// ─── API: Consul ──────────────────────────────────────────────────────────────
app.get('/api/consul/messages', requireAuth, async (req, res) => {
    const msgs = await dbAll('SELECT * FROM consul_messages ORDER BY created_at ASC LIMIT 200');
    res.json(msgs);
});

app.post('/api/consul/messages', requireAuth, async (req, res) => {
    const { agent_id, agent_name, role, content } = req.body;
    const r = await dbRun('INSERT INTO consul_messages (agent_id,agent_name,role,content) VALUES (?,?,?,?)', [agent_id || null, agent_name || 'User', role || 'user', content]);
    const msg = { id: r.lastID, agent_id, agent_name: agent_name || 'User', role: role || 'user', content, created_at: Math.floor(Date.now() / 1000) };
    broadcastEvent({ type: 'CONSUL_MESSAGE', payload: msg });
    res.json(msg);
});

app.get('/api/consul/votes', requireAuth, async (req, res) => {
    const votes = await dbAll('SELECT * FROM votes ORDER BY created_at DESC');
    res.json(votes.map(v => ({ ...v, options: JSON.parse(v.options || '[]'), results: JSON.parse(v.results || '{}') })));
});

app.post('/api/consul/votes', requireAuth, async (req, res) => {
    const id = crypto.randomUUID();
    const { topic, options, mode, round = 1 } = req.body;
    await dbRun('INSERT INTO votes (id,topic,options,mode,round) VALUES (?,?,?,?,?)', [id, topic, JSON.stringify(options || []), mode || 'democratic', round]);
    broadcastEvent({ type: 'VOTE_CREATED', payload: { id, topic } });
    res.json({ id });
});

app.put('/api/consul/votes/:id', requireAuth, async (req, res) => {
    const { status } = req.body;
    await dbRun('UPDATE votes SET status=COALESCE(?,status) WHERE id=?', [status || null, req.params.id]);
    broadcastEvent({ type: 'VOTE_CLOSED', payload: { id: req.params.id } });
    res.json({ ok: true });
});

app.post('/api/consul/votes/:id/cast', requireAuth, async (req, res) => {
    const vote = await dbGet('SELECT * FROM votes WHERE id=?', [req.params.id]);
    if (!vote || vote.status !== 'open') return res.status(400).json({ error: 'Vote not open' });
    const { option, voter } = req.body;
    const results = JSON.parse(vote.results || '{}');
    results[voter] = option;
    await dbRun('UPDATE votes SET results=? WHERE id=?', [JSON.stringify(results), req.params.id]);
    broadcastEvent({ type: 'VOTE_CAST', payload: { id: req.params.id, voter, option } });
    res.json({ ok: true });
});

// ─── API: Costs (mock + real from sessions) ───────────────────────────────────
app.get('/api/costs', requireAuth, async (req, res) => {
    const list = await dbAll('SELECT * FROM sessions');
    const totalCost = list.reduce((s, x) => s + (x.cost || 0), 0);
    const totalTokens = list.reduce((s, x) => s + (x.tokens || 0), 0);
    const byModel = {};
    for (const s of list) {
        if (!byModel[s.model]) byModel[s.model] = { tokens: 0, cost: 0 };
        byModel[s.model].tokens += s.tokens || 0;
        byModel[s.model].cost += s.cost || 0;
    }
    res.json({ totalCost, totalTokens, byModel, sessions: list });
});

// ─── API: Rate Limits ─────────────────────────────────────────────────────────
app.get('/api/rate-limits', requireAuth, (req, res) => {
    // Returns placeholder structure; real data comes from OpenClaw Gateway
    res.json({
        claude: { windowTokens: 0, windowLimit: 0, weeklyTokens: 0, weeklyLimit: 0, burnRate: 0, windowResets: 0 },
        gemini: { windowTokens: 0, windowLimit: 0, burnRate: 0 },
        updated: Date.now()
    });
});

// ─── API: System Health ───────────────────────────────────────────────────────
app.get('/api/system', requireAuth, async (req, res) => {
    try {
        const [cpu, mem, disk, temp] = await Promise.all([
            si.currentLoad(),
            si.mem(),
            si.fsSize(),
            si.cpuTemperature().catch(() => ({ main: null }))
        ]);
        res.json({
            cpu: Math.round(cpu.currentLoad),
            ram: { used: mem.used, total: mem.total, percent: Math.round((mem.used / mem.total) * 100) },
            disk: disk.slice(0, 3).map(d => ({ fs: d.fs, size: d.size, used: d.used, percent: d.use })),
            temp: temp.main,
            uptime: process.uptime()
        });
    } catch (e) { res.json({ cpu: 0, ram: { used: 0, total: 0, percent: 0 }, disk: [], temp: null, uptime: 0 }); }
});

// ─── API: Files ───────────────────────────────────────────────────────────────
function safePath(p) {
    const base = WORKSPACE_DIR;
    const resolved = path.resolve(base, p || '');
    if (!resolved.startsWith(base)) throw new Error('Path traversal blocked');
    return resolved;
}

app.get('/api/files', requireAuth, (req, res) => {
    try {
        const target = safePath(req.query.path || '');
        const stat = fs.statSync(target);
        if (stat.isDirectory()) {
            const items = fs.readdirSync(target).map(name => {
                const fp = path.join(target, name);
                const s = fs.statSync(fp);
                return { name, path: path.relative(WORKSPACE_DIR, fp).replace(/\\/g, '/'), isDir: s.isDirectory(), size: s.size, modified: s.mtime };
            });
            res.json({ type: 'directory', items });
        } else {
            res.json({ type: 'file', path: req.query.path });
        }
    } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/file', requireAuth, (req, res) => {
    try {
        const target = safePath(req.query.path || '');
        const ext = path.extname(target).toLowerCase();
        const imgExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico'];
        if (imgExts.includes(ext)) {
            return res.sendFile(target);
        }
        const content = fs.readFileSync(target, 'utf8');
        res.json({ content, path: req.query.path });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/file', requireAuth, (req, res) => {
    try {
        const target = safePath(req.body.path || '');
        if (fs.existsSync(target)) fs.copyFileSync(target, target + '.bak');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, req.body.content || '');
        auditLog('file_write', { path: req.body.path });
        res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── API: Config (openclaw.json) ──────────────────────────────────────────────
app.get('/api/config', requireAuth, (req, res) => {
    const cfgPath = path.join(OPENCLAW_DIR, 'openclaw.json');
    if (!fs.existsSync(cfgPath)) return res.json({ content: '{}', exists: false });
    res.json({ content: fs.readFileSync(cfgPath, 'utf8'), exists: true });
});

app.post('/api/config', requireAuth, (req, res) => {
    const cfgPath = path.join(OPENCLAW_DIR, 'openclaw.json');
    try { JSON.parse(req.body.content); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
    if (fs.existsSync(cfgPath)) fs.copyFileSync(cfgPath, cfgPath + '.bak');
    fs.mkdirSync(OPENCLAW_DIR, { recursive: true });
    fs.writeFileSync(cfgPath, req.body.content);
    auditLog('config_write', {});
    res.json({ ok: true });
});

// ─── API: Workspaces ────────────────────────────────────────────────────────────
app.get('/api/workspaces', requireAuth, (req, res) => {
    // Return current workspace as the only active one for now
    res.json([{
        id: 'default',
        name: path.basename(WORKSPACE_DIR) || 'Workspace',
        path: WORKSPACE_DIR,
        active: true
    }]);
});

app.post('/api/workspaces', requireAuth, (req, res) => {
    res.status(501).json({ error: 'Workspace switching not fully implemented yet without restart.' });
});

// ─── API: Logs ────────────────────────────────────────────────────────────────
const ALLOWED_SERVICES = ['openclaw', 'clawcontrol', 'system', 'audit'];

app.get('/api/logs', requireAuth, (req, res) => {
    const service = ALLOWED_SERVICES.includes(req.query.service) ? req.query.service : 'audit';
    const lines = Math.min(parseInt(req.query.lines || '100'), 500);
    let content = '';
    if (service === 'audit') {
        if (fs.existsSync(AUDIT_LOG)) content = fs.readFileSync(AUDIT_LOG, 'utf8');
    } else if (service === 'clawcontrol') {
        if (fs.existsSync(CLAWCONTROL_LOG)) content = fs.readFileSync(CLAWCONTROL_LOG, 'utf8');
    } else if (service === 'openclaw') {
        if (fs.existsSync(OPENCLAW_LOG)) content = fs.readFileSync(OPENCLAW_LOG, 'utf8');
    } else if (service === 'system') {
        content = `[ClawControl] Running on port ${PORT}\n[DB] ${DB_PATH}\n[Workspace] ${WORKSPACE_DIR}`;
    } else {
        content = `[${service}] Log access - service not running locally or not available via filesystem.\nConfigure log paths in environment variables.`;
    }
    // Limit to latest N lines efficiently
    const result = content.trim().split('\n').filter(Boolean).slice(-lines).join('\n');
    res.json({ service, lines: result });
});

// ─── API: Crons (stored in SQLite) ────────────────────────────────────────────
app.get('/api/crons', requireAuth, async (req, res) => {
    const rows = await dbAll('SELECT * FROM cron_jobs ORDER BY created_at DESC');
    res.json(rows.map(r => ({ ...r, enabled: !!r.enabled })));
});

app.post('/api/crons', requireAuth, async (req, res) => {
    const id = crypto.randomUUID();
    const { name, schedule, command, enabled = true } = req.body;
    await dbRun('INSERT INTO cron_jobs (id,name,schedule,command,enabled) VALUES (?,?,?,?,?)',
        [id, name, schedule || '', command || '', enabled ? 1 : 0]);
    res.json({ id });
});

app.put('/api/crons/:id', requireAuth, async (req, res) => {
    const { name, schedule, command, enabled } = req.body;
    await dbRun('UPDATE cron_jobs SET name=COALESCE(?,name),schedule=COALESCE(?,schedule),command=COALESCE(?,command),enabled=COALESCE(?,enabled) WHERE id=?',
        [name || null, schedule || null, command || null, enabled !== undefined ? enabled ? 1 : 0 : null, req.params.id]);
    res.json({ ok: true });
});

app.delete('/api/crons/:id', requireAuth, async (req, res) => {
    await dbRun('DELETE FROM cron_jobs WHERE id=?', [req.params.id]);
    res.json({ ok: true });
});

app.post('/api/crons/:id/trigger', requireAuth, async (req, res) => {
    const job = await dbGet('SELECT * FROM cron_jobs WHERE id=?', [req.params.id]);
    if (!job) return res.status(404).json({ error: 'Not found' });
    await dbRun('UPDATE cron_jobs SET last_run=? WHERE id=?', [Math.floor(Date.now() / 1000), req.params.id]);
    res.json({ message: `Triggered: ${job.name}` });
});

// ─── API: Channels ────────────────────────────────────────────────────────────
app.get('/api/channels', requireAuth, async (req, res) => {
    const rows = await dbAll('SELECT * FROM channels ORDER BY created_at DESC');
    res.json(rows.map(c => ({ ...c, latest_data: JSON.parse(c.latest_data || '{}') })));
});

app.post('/api/channels', requireAuth, async (req, res) => {
    const id = crypto.randomUUID();
    const { name, url, platform, notes } = req.body;
    await dbRun('INSERT INTO channels (id,name,url,platform,notes) VALUES (?,?,?,?,?)',
        [id, name || '', url || '', platform || 'YouTube', notes || '']);
    res.json({ id });
});

app.put('/api/channels/:id', requireAuth, async (req, res) => {
    const { name, url, platform, notes } = req.body;
    await dbRun('UPDATE channels SET name=COALESCE(?,name),url=COALESCE(?,url),platform=COALESCE(?,platform),notes=COALESCE(?,notes) WHERE id=?',
        [name || null, url || null, platform || null, notes || null, req.params.id]);
    res.json({ ok: true });
});

app.delete('/api/channels/:id', requireAuth, async (req, res) => {
    await dbRun('DELETE FROM channels WHERE id=?', [req.params.id]);
    res.json({ ok: true });
});

// ─── API: Actions ─────────────────────────────────────────────────────────────
const ALLOWED_ACTIONS = ['restart-clawcontrol', 'clear-events', 'nuke-data', 'restart-gateway'];
app.post('/api/action/:action', requireAuth, async (req, res) => {
    const { action } = req.params;
    if (!ALLOWED_ACTIONS.includes(action)) return res.status(400).json({ error: 'Unknown action' });
    auditLog('action', { action });
    if (action === 'clear-events') { await dbRun('DELETE FROM events'); return res.json({ ok: true }); }
    if (action === 'nuke-data') {
        await Promise.all(['tasks', 'agents', 'sessions', 'events', 'consul_messages', 'chat_messages', 'votes'].map(t => dbRun(`DELETE FROM ${t}`)));
        return res.json({ ok: true });
    }
    if (action === 'restart-clawcontrol') {
        res.json({ ok: true, message: 'Restarting...' });
        setTimeout(() => process.exit(0), 500);
        return;
    }
    if (action === 'restart-gateway') {
        triggerGatewayReconnect();
        return res.json({ ok: true });
    }
    res.json({ ok: true });
});

// ─── SSE Live Feed ────────────────────────────────────────────────────────────
const sseClients = new Set();

function broadcastEvent(event) {
    const data = typeof event === 'string' ? event : JSON.stringify(event);
    for (const client of sseClients) {
        try { client.write(`data: ${data}\n\n`); } catch { }
    }
    // persist to events table (fire and forget)
    dbRun('INSERT INTO events (type,payload,agent_id) VALUES (?,?,?)',
        [event.type || 'event', JSON.stringify(event.payload || {}), event.payload?.agent_id || null]).catch(() => { });
}

app.get('/api/live', (req, res) => {
    const token = req.query.token;
    const sessionId = req.query.sessionId || req.headers['x-session-id'];
    if (MC_API_TOKEN && token !== MC_API_TOKEN && !sessions.has(sessionId)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.write('data: {"type":"connected"}\n\n');
    const hb = setInterval(() => { try { res.write(':heartbeat\n\n'); } catch { } }, 30000);
    sseClients.add(res);
    req.on('close', () => { clearInterval(hb); sseClients.delete(res); });
});

// ─── Recent Events API ────────────────────────────────────────────────────────
app.get('/api/events', requireAuth, async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '50'), 200);
    const events = await dbAll('SELECT * FROM events ORDER BY created_at DESC LIMIT ?', [limit]);
    res.json(events.map(e => ({ ...e, payload: JSON.parse(e.payload || '{}') })));
});

// ─── Gateway Info ─────────────────────────────────────────────────────────────
app.get('/api/gateway/status', requireAuth, (req, res) => {
    const creds = loadCreds() || {};
    const url = creds.gatewayUrl || process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789';
    const actually_connected = gatewayConnected && gatewayWs?.readyState === WebSocket.OPEN;
    res.json({
        url,
        connected: actually_connected,
        lastError: gatewayLastError,
        lastConnectedAt: gatewayLastConnectedAt,
        reconnectAttempts: gatewayRetryAttempts
    });
});

app.get('/api/gateway/config', requireAuth, (req, res) => {
    const creds = loadCreds() || {};
    res.json({
        gatewayUrl: creds.gatewayUrl || process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789',
        gatewayToken: creds.gatewayToken || process.env.OPENCLAW_GATEWAY_TOKEN || ''
    });
});

app.post('/api/gateway/config', requireAuth, (req, res) => {
    const { gatewayUrl, gatewayToken } = req.body;
    let creds = loadCreds();
    if (!creds) return res.status(400).json({ error: 'System not initialized. Please register first.' });

    creds.gatewayUrl = gatewayUrl.trim();
    creds.gatewayToken = gatewayToken.trim();
    creds.gatewayEnabled = true;
    saveCreds(creds);
    auditLog('gateway_config_updated', { url: creds.gatewayUrl });

    // Trigger immediate reconnect
    triggerGatewayReconnect();

    res.json({ ok: true });
});

app.post('/api/gateway/disconnect', requireAuth, (req, res) => {
    let creds = loadCreds();
    if (creds) {
        creds.gatewayEnabled = false;
        saveCreds(creds);
    }

    if (gatewayWs) { try { gatewayWs.terminate(); } catch (e) { } }
    if (gatewayRetryTimer) { clearTimeout(gatewayRetryTimer); gatewayRetryTimer = null; }

    gatewayConnected = false;
    res.json({ ok: true });
});


// ─── Gateway Agents & Chat ────────────────────────────────────────────────────
app.get('/api/gateway/agents', requireAuth, (req, res) => {
    res.json(gatewayNodes || []);
});

app.post('/api/gateway/chat', requireAuth, (req, res) => {
    const { agentId, message } = req.body || {};
    if (!agentId || !message) return res.status(400).json({ error: 'agentId and message required' });
    if (!gatewayWs || gatewayWs.readyState !== WebSocket.OPEN) {
        return res.status(503).json({ error: 'Gateway not connected' });
    }
    const requestId = 'chat-' + Date.now();
    gatewayWs.send(JSON.stringify({
        type: 'req',
        id: requestId,
        method: 'chat.send',
        params: { agentId, text: message }
    }));
    res.json({ ok: true, requestId });
});

// ─── Google Antigravity OAuth ─────────────────────────────────────────────────
const antigravityPending = new Map(); // state → { verifier, resolve }

const ANTIGRAVITY_CLIENT_ID = process.env.ANTIGRAVITY_CLIENT_ID || '';
const ANTIGRAVITY_CLIENT_SECRET = process.env.ANTIGRAVITY_CLIENT_SECRET || '';
const ANTIGRAVITY_SCOPES = [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/cclog',
    'https://www.googleapis.com/auth/experimentsandconfigs'
].join(' ');

app.post('/api/oauth/antigravity/start', requireAuth, (req, res) => {
    const host = req.headers['x-forwarded-host'] || req.headers.host || `${req.hostname}:${PORT}`;
    const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    const redirectUri = `${proto}://${host}/auth/oauth/antigravity/callback`;

    const verifier = crypto.randomBytes(32).toString('hex');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = crypto.randomBytes(16).toString('hex');

    antigravityPending.set(state, { verifier, redirectUri, ts: Date.now() });
    // Cleanup stale pending states (older than 10m)
    for (const [k, v] of antigravityPending) { if (Date.now() - v.ts > 600000) antigravityPending.delete(k); }

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', ANTIGRAVITY_CLIENT_ID);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', ANTIGRAVITY_SCOPES);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');

    res.json({ authUrl: url.toString() });
});

app.get('/auth/oauth/antigravity/callback', async (req, res) => {
    const { code, state, error } = req.query;
    if (error) return res.send(`<h1>OAuth Error</h1><p>${error}</p>`);

    const pending = antigravityPending.get(state);
    if (!pending) return res.send('<h1>Invalid or expired OAuth state</h1>');
    antigravityPending.delete(state);

    try {
        const body = new URLSearchParams({
            client_id: ANTIGRAVITY_CLIENT_ID,
            client_secret: ANTIGRAVITY_CLIENT_SECRET,
            code,
            grant_type: 'authorization_code',
            redirect_uri: pending.redirectUri,
            code_verifier: pending.verifier
        });
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
        });
        if (!tokenRes.ok) throw new Error(await tokenRes.text());
        const tokens = await tokenRes.json();

        // Fetch user email
        let email;
        try {
            const uRes = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
            const u = await uRes.json(); email = u.email;
        } catch { }

        // Fetch project ID
        let projectId = 'rising-fact-p41fc';
        for (const ep of ['https://cloudcode-pa.googleapis.com', 'https://daily-cloudcode-pa.sandbox.googleapis.com']) {
            try {
                const pRes = await fetch(`${ep}/v1internal:loadCodeAssist`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json', 'User-Agent': 'google-api-nodejs-client/9.15.1' },
                    body: JSON.stringify({ metadata: { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' } })
                });
                if (pRes.ok) { const d = await pRes.json(); if (d.cloudaicompanionProject) { projectId = typeof d.cloudaicompanionProject === 'string' ? d.cloudaicompanionProject : (d.cloudaicompanionProject.id || projectId); break; } }
            } catch { }
        }

        // Save to credentials
        const creds = loadCreds() || {};
        creds.antigravityToken = {
            access: tokens.access_token,
            refresh: tokens.refresh_token,
            expires: Date.now() + (tokens.expires_in || 3600) * 1000 - 300000,
            email, projectId
        };
        saveCreds(creds);
        auditLog('antigravity_oauth_success', { email, projectId });

        res.send(`<!DOCTYPE html><html><head><title>Auth Complete</title><script>window.opener?.postMessage({type:'antigravity-oauth-ok',email:'${email || ''}',projectId:'${projectId}'},'*');window.close();</script></head><body><h1>✅ Authentication complete</h1><p>You can close this tab.</p></body></html>`);
    } catch (err) {
        console.error('[OAuth] Antigravity error:', err.message);
        res.send(`<h1>Auth failed</h1><p>${err.message}</p>`);
    }
});

app.get('/api/oauth/antigravity/status', requireAuth, (req, res) => {
    const creds = loadCreds() || {};
    const t = creds.antigravityToken;
    if (!t) return res.json({ connected: false });
    const expired = t.expires && Date.now() > t.expires;
    res.json({ connected: !expired, email: t.email, projectId: t.projectId, expiresAt: t.expires });
});

// ─── API: System — Network / PM2 / Docker ────────────────────────────────────
app.get('/api/system/network', requireAuth, async (req, res) => {
    try {
        const nets = await si.networkStats();
        res.json(nets.map(n => ({
            iface: n.iface,
            rx_sec: n.rx_sec,
            tx_sec: n.tx_sec,
            rx_bytes: n.rx_bytes,
            tx_bytes: n.tx_bytes
        })));
    } catch (e) { res.json([]); }
});

app.get('/api/system/pm2', requireAuth, (req, res) => {
    const { exec } = require('child_process');
    exec('pm2 jlist', { timeout: 5000 }, (err, stdout) => {
        if (err) return res.json({ error: 'PM2 not available or not running', processes: [] });
        try {
            const list = JSON.parse(stdout);
            res.json({ processes: list.map(p => ({ name: p.name, pid: p.pid, status: p.pm2_env?.status, cpu: p.monit?.cpu, memory: p.monit?.memory, restarts: p.pm2_env?.restart_time })) });
        } catch { res.json({ error: 'Could not parse PM2 output', processes: [] }); }
    });
});

app.get('/api/system/docker', requireAuth, (req, res) => {
    const { exec } = require('child_process');
    exec('docker ps --format "{{json .}}"', { timeout: 5000 }, (err, stdout) => {
        if (err) return res.json({ error: 'Docker not available', containers: [] });
        try {
            const containers = stdout.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
            res.json({ containers });
        } catch { res.json({ error: 'Could not parse docker output', containers: [] }); }
    });
});

// ─── API: Memory Browser ──────────────────────────────────────────────────────
function findMemoryFiles(dir, baseDir, results = []) {
    if (!fs.existsSync(dir)) return results;
    try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                // Recurse into workspace-* dirs inside OPENCLAW_DIR
                if (dir === baseDir || entry.name.startsWith('workspace')) {
                    findMemoryFiles(fullPath, baseDir, results);
                }
            } else if (['.md', '.txt', '.json'].includes(path.extname(entry.name).toLowerCase())) {
                results.push({ path: path.relative(baseDir, fullPath).replace(/\\/g, '/'), name: entry.name, size: entry.size || fs.statSync(fullPath).size });
            }
        }
    } catch { }
    return results;
}

app.get('/api/memory', requireAuth, (req, res) => {
    const files = findMemoryFiles(OPENCLAW_DIR, OPENCLAW_DIR);
    res.json(files);
});

app.get('/api/memory/file', requireAuth, (req, res) => {
    try {
        const target = path.resolve(OPENCLAW_DIR, req.query.path || '');
        if (!target.startsWith(OPENCLAW_DIR)) return res.status(400).json({ error: 'Path traversal blocked' });
        const content = fs.readFileSync(target, 'utf8');
        res.json({ content, path: req.query.path });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/memory/file', requireAuth, (req, res) => {
    try {
        const target = path.resolve(OPENCLAW_DIR, req.body.path || '');
        if (!target.startsWith(OPENCLAW_DIR)) return res.status(400).json({ error: 'Path traversal blocked' });
        if (fs.existsSync(target)) fs.copyFileSync(target, target + '.bak');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, req.body.content || '');
        auditLog('memory_write', { path: req.body.path });
        res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/memory/search', requireAuth, (req, res) => {
    const q = (req.query.q || '').toLowerCase().trim();
    if (!q) return res.json([]);
    const files = findMemoryFiles(OPENCLAW_DIR, OPENCLAW_DIR);
    const results = [];
    for (const f of files.slice(0, 200)) {
        try {
            const target = path.resolve(OPENCLAW_DIR, f.path);
            const content = fs.readFileSync(target, 'utf8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].toLowerCase().includes(q)) {
                    results.push({ file: f.path, line: i + 1, snippet: lines[i].trim().slice(0, 200) });
                    if (results.length >= 100) break;
                }
            }
        } catch { }
        if (results.length >= 100) break;
    }
    res.json(results);
});

// ─── API: Global Search ───────────────────────────────────────────────────────
app.get('/api/search', requireAuth, (req, res) => {
    const q = (req.query.q || '').toLowerCase().trim();
    const scope = req.query.scope || 'all'; // all | memory | files
    if (!q || q.length < 2) return res.json([]);
    const results = [];

    function searchDir(dir, baseDir, label) {
        if (!fs.existsSync(dir)) return;
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (results.length >= 150) return;
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (!entry.name.startsWith('.') && entry.name !== 'node_modules') searchDir(fullPath, baseDir, label);
                } else if (['.md', '.txt', '.json', '.js', '.ts', '.py', '.sh'].includes(path.extname(entry.name).toLowerCase())) {
                    try {
                        const content = fs.readFileSync(fullPath, 'utf8');
                        const lines = content.split('\n');
                        for (let i = 0; i < lines.length; i++) {
                            if (lines[i].toLowerCase().includes(q)) {
                                results.push({ source: label, file: path.relative(baseDir, fullPath).replace(/\\/g, '/'), line: i + 1, snippet: lines[i].trim().slice(0, 200) });
                                if (results.length >= 150) return;
                            }
                        }
                    } catch { }
                }
            }
        } catch { }
    }

    if (scope === 'all' || scope === 'memory') searchDir(OPENCLAW_DIR, OPENCLAW_DIR, 'memory');
    if (scope === 'all' || scope === 'files') searchDir(WORKSPACE_DIR, WORKSPACE_DIR, 'workspace');
    res.json(results);
});

// ─── API: Notifications ───────────────────────────────────────────────────────
app.get('/api/notifications', requireAuth, async (req, res) => {
    const rows = await dbAll('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100');
    res.json(rows);
});

app.post('/api/notifications', requireAuth, async (req, res) => {
    const id = crypto.randomUUID();
    const { type = 'info', title, body } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    await dbRun('INSERT INTO notifications (id,type,title,body) VALUES (?,?,?,?)', [id, type, title, body || '']);
    broadcastEvent({ type: 'NOTIFICATION', payload: { id, type, title, body } });
    res.json({ id });
});

app.put('/api/notifications/:id/read', requireAuth, async (req, res) => {
    await dbRun('UPDATE notifications SET read=1 WHERE id=?', [req.params.id]);
    res.json({ ok: true });
});

app.post('/api/notifications/read-all', requireAuth, async (req, res) => {
    await dbRun('UPDATE notifications SET read=1 WHERE read=0');
    res.json({ ok: true });
});

app.delete('/api/notifications/:id', requireAuth, async (req, res) => {
    await dbRun('DELETE FROM notifications WHERE id=?', [req.params.id]);
    res.json({ ok: true });
});

app.get('/api/notifications/unread-count', requireAuth, async (req, res) => {
    const row = await dbGet('SELECT COUNT(*) as count FROM notifications WHERE read=0');
    res.json({ count: row ? row.count : 0 });
});

// ─── API: Activity Heatmap ────────────────────────────────────────────────────
app.get('/api/events/heatmap', requireAuth, async (req, res) => {
    const days = Math.min(parseInt(req.query.days || '90'), 365);
    const since = Math.floor(Date.now() / 1000) - days * 86400;
    const rows = await dbAll(
        `SELECT date(created_at, 'unixepoch') as day, COUNT(*) as count
         FROM events WHERE created_at >= ? GROUP BY day ORDER BY day ASC`,
        [since]
    );
    res.json(rows);
});


// ─── API: Providers (API Gateway / Router) ────────────────────────────────────

// Simple AES-256-GCM encryption for API keys at rest
const ENCRYPT_KEY = crypto.createHash('sha256').update(RECOVERY_TOKEN).digest(); // 32 bytes
function encryptKey(plain) {
    if (!plain) return '';
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPT_KEY, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return iv.toString('hex') + ':' + tag.toString('hex') + ':' + enc.toString('hex');
}
function decryptKey(stored) {
    if (!stored || !stored.includes(':')) return stored || '';
    try {
        const [ivHex, tagHex, encHex] = stored.split(':');
        const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPT_KEY, Buffer.from(ivHex, 'hex'));
        decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
        return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
    } catch { return ''; }
}
function maskKey(k) { if (!k || k.length < 8) return '••••••••'; return k.slice(0, 4) + '••••••••' + k.slice(-4); }

function formatProvider(p) {
    return { ...p, models: JSON.parse(p.models || '[]'), enabled: !!p.enabled, api_key: maskKey(decryptKey(p.api_key)) };
}

app.get('/api/providers', requireAuth, async (req, res) => {
    const rows = await dbAll('SELECT * FROM providers ORDER BY priority ASC, created_at ASC');
    res.json(rows.map(formatProvider));
});

app.get('/api/providers/status', requireAuth, async (req, res) => {
    const rows = await dbAll('SELECT id,name,type,health,last_health_check,enabled,priority,agent_scope,load_balance_mode FROM providers ORDER BY priority ASC');
    res.json(rows.map(r => ({ ...r, enabled: !!r.enabled })));
});

app.post('/api/providers', requireAuth, async (req, res) => {
    const id = crypto.randomUUID();
    const { name, type, base_url, api_key, models = [], priority = 0, agent_scope = 'global', load_balance_mode = 'priority' } = req.body;
    if (!name || !type) return res.status(400).json({ error: 'name and type required' });
    const encKey = encryptKey(api_key || '');
    await dbRun('INSERT INTO providers (id,name,type,base_url,api_key,models,priority,agent_scope,load_balance_mode) VALUES (?,?,?,?,?,?,?,?,?)',
        [id, name, type, base_url || '', encKey, JSON.stringify(models), priority, agent_scope, load_balance_mode]);
    broadcastEvent({ type: 'PROVIDER_CREATED', payload: { id, name, type } });
    res.json({ id });
});

app.put('/api/providers/:id', requireAuth, async (req, res) => {
    const p = await dbGet('SELECT * FROM providers WHERE id=?', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'Not found' });
    const { name, type, base_url, api_key, models, priority, enabled, agent_scope, load_balance_mode } = req.body;
    const encKey = api_key !== undefined ? encryptKey(api_key) : p.api_key;
    await dbRun(`UPDATE providers SET
        name=COALESCE(?,name), type=COALESCE(?,type), base_url=COALESCE(?,base_url),
        api_key=COALESCE(?,api_key), models=COALESCE(?,models), priority=COALESCE(?,priority),
        enabled=COALESCE(?,enabled), agent_scope=COALESCE(?,agent_scope),
        load_balance_mode=COALESCE(?,load_balance_mode) WHERE id=?`,
        [name || null, type || null, base_url || null, encKey || null,
        models ? JSON.stringify(models) : null,
        priority !== undefined ? priority : null,
        enabled !== undefined ? (enabled ? 1 : 0) : null,
        agent_scope || null, load_balance_mode || null, req.params.id]);
    broadcastEvent({ type: 'PROVIDER_UPDATED', payload: { id: req.params.id } });
    res.json({ ok: true });
});

app.delete('/api/providers/:id', requireAuth, async (req, res) => {
    await dbRun('DELETE FROM providers WHERE id=?', [req.params.id]);
    res.json({ ok: true });
});

// Bulk reorder priorities
app.post('/api/providers/reorder', requireAuth, async (req, res) => {
    const { order } = req.body; // [{ id, priority }]
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array' });
    for (const { id, priority } of order) {
        await dbRun('UPDATE providers SET priority=? WHERE id=?', [priority, id]);
    }
    res.json({ ok: true });
});

// Test a provider connection
app.post('/api/providers/:id/test', requireAuth, async (req, res) => {
    const p = await dbGet('SELECT * FROM providers WHERE id=?', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'Not found' });
    const apiKey = decryptKey(p.api_key);
    const result = await pingProvider(p.type, p.base_url, apiKey);
    // Update health in DB
    await dbRun('UPDATE providers SET health=?, last_health_check=? WHERE id=?',
        [result.healthy ? 'healthy' : 'down', Math.floor(Date.now() / 1000), p.id]);
    broadcastEvent({ type: 'PROVIDER_HEALTH_CHANGED', payload: { id: p.id, health: result.healthy ? 'healthy' : 'down' } });
    res.json(result);
});

// Provider-aware proxy: POST /api/proxy/chat
// Body: { messages: [...], agentId?: string, model?: string }
app.post('/api/proxy/chat', requireAuth, async (req, res) => {
    const { messages, agentId, model } = req.body;
    if (!messages) return res.status(400).json({ error: 'messages required' });

    // Resolve provider list: agent-scoped first, then global
    let providers = await dbAll('SELECT * FROM providers WHERE enabled=1 ORDER BY priority ASC');
    if (agentId) {
        const agentScoped = providers.filter(p => p.agent_scope === agentId);
        const global = providers.filter(p => p.agent_scope === 'global');
        providers = [...agentScoped, ...global];
    }

    if (providers.length === 0) return res.status(503).json({ error: 'No providers configured or all disabled' });

    for (const p of providers) {
        const apiKey = decryptKey(p.api_key);
        try {
            const response = await proxyToProvider(p, apiKey, messages, model);
            res.setHeader('X-Provider-Used', p.name);
            res.setHeader('X-Provider-Id', p.id);

            // Track usage
            if (agentId) {
                const models = JSON.parse(p.models || '[]');
                const actualModel = model || models[0] || 'unknown';
                gatewayUsage.set(agentId, {
                    model: actualModel,
                    provider: p.name,
                    lastUsed: Date.now()
                });
            }

            return res.json(response);
        } catch (err) {
            console.warn(`⚠️  [Proxy] Provider "${p.name}" failed: ${err.message} — trying next...`);
        }
    }
    res.status(503).json({ error: 'All providers failed' });
});

app.get('/api/gateway/stats', requireAuth, (req, res) => {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const stats = {
        connectedAgents: gatewayClients.clients.size,
        usage: Object.fromEntries(gatewayUsage),
        masterToken: MC_API_TOKEN ? (MC_API_TOKEN.substring(0, 4) + '...' + MC_API_TOKEN.substring(MC_API_TOKEN.length - 4)) : 'None',
        fullMasterToken: MC_API_TOKEN,
        apiUrl: `${protocol}://${host}/api/proxy/chat`,
        wsUrl: `${protocol === 'https' ? 'wss' : 'ws'}://${host}/ws/gateway`
    };
    res.json(stats);
});

// Helper: ping a provider to check health
async function pingProvider(type, baseUrl, apiKey) {
    const start = Date.now();
    try {
        const { default: https } = await import('https');
        const { default: http_mod } = await import('http');
        const endpoints = {
            anthropic: { host: 'api.anthropic.com', path: '/v1/models', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } },
            openai: { host: 'api.openai.com', path: '/v1/models', headers: { 'Authorization': `Bearer ${apiKey}` } },
            google: { host: 'generativelanguage.googleapis.com', path: `/v1beta/models?key=${apiKey}`, headers: {} },
            openrouter: { host: 'openrouter.ai', path: '/api/v1/models', headers: { 'Authorization': `Bearer ${apiKey}` } },
        };
        const ep = endpoints[type] || (baseUrl ? { host: new URL(baseUrl).host, path: '/v1/models', headers: { 'Authorization': `Bearer ${apiKey}` } } : null);
        if (!ep) return { healthy: false, latency: null, error: 'Unknown provider type and no base_url' };

        await new Promise((resolve, reject) => {
            const mod = ep.host.startsWith('localhost') || ep.host.startsWith('127.') ? http_mod : https;
            const req = mod.get({ host: ep.host, path: ep.path, headers: ep.headers, timeout: 5000 }, r => {
                r.resume();
                if (r.statusCode < 500) resolve(); else reject(new Error(`HTTP ${r.statusCode}`));
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        });
        return { healthy: true, latency: Date.now() - start };
    } catch (e) {
        return { healthy: false, latency: Date.now() - start, error: e.message };
    }
}

// Helper: forward chat request to provider
async function proxyToProvider(p, apiKey, messages, modelOverride) {
    const https_mod = require('https');
    const http_mod = require('http');
    const models = JSON.parse(p.models || '[]');
    const model = modelOverride || models[0] || 'claude-3-5-haiku-20241022';

    const payloads = {
        anthropic: {
            host: 'api.anthropic.com', path: '/v1/messages',
            headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, max_tokens: 4096, messages })
        },
        openai: {
            host: 'api.openai.com', path: '/v1/chat/completions',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelOverride || models[0] || 'gpt-4o-mini', messages })
        },
        openrouter: {
            host: 'openrouter.ai', path: '/api/v1/chat/completions',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://clawcontrol' },
            body: JSON.stringify({ model: modelOverride || models[0] || 'openai/gpt-4o-mini', messages })
        },
    };

    let ep = payloads[p.type];
    if (!ep && p.base_url) {
        // Custom / local provider (Ollama, LM Studio, etc.)
        const url = new URL('/v1/chat/completions', p.base_url);
        ep = {
            host: url.hostname, path: url.pathname + url.search, port: url.port || undefined,
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelOverride || models[0] || 'llama3', messages })
        };
    }
    if (!ep) throw new Error(`No proxy config for type: ${p.type}`);

    return new Promise((resolve, reject) => {
        const isLocal = ep.host === 'localhost' || ep.host === '127.0.0.1' || ep.host === 'host.docker.internal';
        const mod = isLocal ? http_mod : https_mod;
        const body = ep.body;
        const opts = { host: ep.host, port: ep.port, path: ep.path, method: 'POST', headers: { ...ep.headers, 'Content-Length': Buffer.byteLength(body) }, timeout: 30000 };
        const req = mod.request(opts, r => {
            let data = '';
            r.on('data', c => data += c);
            r.on('end', () => {
                if (r.statusCode >= 400) reject(new Error(`HTTP ${r.statusCode}: ${data.slice(0, 200)}`));
                else { try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); } }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.write(body);
        req.end();
    });
}

// Background health poller — runs every 60 seconds
function startHealthPoller() {
    async function poll() {
        const providers = await dbAll('SELECT * FROM providers WHERE enabled=1');
        for (const p of providers) {
            const apiKey = decryptKey(p.api_key);
            const result = await pingProvider(p.type, p.base_url, apiKey);
            const health = result.healthy ? 'healthy' : 'down';
            if (p.health !== health) {
                await dbRun('UPDATE providers SET health=?, last_health_check=? WHERE id=?',
                    [health, Math.floor(Date.now() / 1000), p.id]);
                broadcastEvent({ type: 'PROVIDER_HEALTH_CHANGED', payload: { id: p.id, name: p.name, health, latency: result.latency } });
                console.log(`🔋 [Providers] ${p.name}: ${p.health} → ${health}`);
            } else {
                await dbRun('UPDATE providers SET last_health_check=? WHERE id=?', [Math.floor(Date.now() / 1000), p.id]);
            }
        }
    }
    // Initial poll after 10s, then every 60s
    setTimeout(() => { poll().catch(() => { }); setInterval(() => poll().catch(() => { }), 60000); }, 10000);
}

// ─── Static Files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback for non-API routes
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/ws/')) return res.status(404).json({ error: 'Not found' });
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── HTTP + WebSocket Server ──────────────────────────────────────────────────
const server = http.createServer(app);

// Terminal WebSocket
let nodePty;
try { nodePty = require('node-pty'); } catch { }

const wss = new WebSocketServer({ server, path: '/ws/terminal' });
wss.on('connection', (ws, req) => {
    const sessionId = new URL(req.url, 'http://localhost').searchParams.get('sessionId');
    if (!sessions.has(sessionId)) { ws.close(4001, 'Unauthorized'); return; }

    if (!nodePty) {
        ws.send(JSON.stringify({ type: 'output', data: 'node-pty not available. Install it for terminal support.\r\n' }));
        return;
    }

    const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
    const pty = nodePty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 80, rows: 24,
        cwd: WORKSPACE_DIR,
        env: process.env
    });

    pty.onData(data => { try { ws.send(JSON.stringify({ type: 'output', data })); } catch { } });
    ws.on('message', msg => {
        try {
            const { type, data } = JSON.parse(msg);
            if (type === 'input') pty.write(data);
            else if (type === 'resize') pty.resize(data.cols, data.rows);
        } catch { }
    });
    ws.on('close', () => { try { pty.kill(); } catch { } });
});

// ─── Gateway WebSocket Proxy ──────────────────────────────────────────────────
let gatewayConnected = false;
let gatewayWs = null;
let gatewayRetryAttempts = 0;
let gatewayLastError = null;
let gatewayLastConnectedAt = null;
let gatewayRetryTimer = null;
let gatewaySnapshot = null; // cached from health events
let gatewayNodes = []; // cached from node.list requests

function triggerGatewayReconnect() {
    let creds = loadCreds();
    if (creds) { creds.gatewayEnabled = true; saveCreds(creds); }

    gatewayRetryAttempts = 0;
    if (gatewayRetryTimer) {
        clearTimeout(gatewayRetryTimer);
        gatewayRetryTimer = null;
    }
    if (gatewayWs) {
        gatewayWs.removeAllListeners('close');
        gatewayWs.on('close', () => { });
        try { gatewayWs.terminate(); } catch (e) { }
        gatewayWs = null;
    }
    gatewayConnected = false;
    connectGateway();
}

const gatewayClients = new WebSocketServer({ server, path: '/ws/gateway' });
gatewayClients.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const sessionId = url.searchParams.get('sessionId');
    const token = url.searchParams.get('token') || req.headers['authorization']?.replace('Bearer ', '');
    const isAuthorized = (sessionId && sessions.has(sessionId)) || (token && MC_API_TOKEN && token === MC_API_TOKEN);
    if (!isAuthorized) { ws.close(4001, 'Unauthorized'); return; }

    // Send immediate approval handshake to prevent agent timeout
    ws.send(JSON.stringify({
        type: 'handshake',
        status: 'approved',
        message: 'Connected to ClawControl Gateway Proxy'
    }));

    ws.on('message', msg => {
        if (gatewayWs && gatewayWs.readyState === WebSocket.OPEN) gatewayWs.send(msg);
    });
});

function connectGateway() {
    const creds = loadCreds() || {};

    if (creds.gatewayEnabled === false) {
        console.log('⚠️  [Gateway] Connection manually stopped by user. Not reconnecting.');
        return;
    }

    const gwUrl = creds.gatewayUrl || process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789';
    const gwToken = creds.gatewayToken || process.env.OPENCLAW_GATEWAY_TOKEN || '';

    if (!gwUrl) {
        console.log('⚠️  [Gateway] OPENCLAW_GATEWAY_URL not set — gateway disabled.');
        return;
    }
    if (!gwToken) {
        console.log('⚠️  [Gateway] OPENCLAW_GATEWAY_TOKEN not set — gateway disabled.');
        return;
    }

    // Validate scheme
    if (!gwUrl.startsWith('ws://') && !gwUrl.startsWith('wss://')) {
        console.error(`❌ [Gateway] Invalid URL scheme: "${gwUrl}"`);
        console.error('   ℹ️  OPENCLAW_GATEWAY_URL must start with ws:// or wss://');
        console.error('   ℹ️  Example: ws://host.docker.internal:18789');
        return;
    }

    console.log(`🔌 [Gateway] Trying to connect to ${gwUrl} (attempt ${gatewayRetryAttempts + 1})...`);

    try {
        gatewayWs = new WebSocket(gwUrl, {
            headers: { Authorization: `Bearer ${gwToken}` },
            rejectUnauthorized: false // Allow self-signed certs (Tailscale)
        });

        gatewayWs.on('open', () => {
            gatewayConnected = true;
            gatewayLastError = null;
            gatewayLastConnectedAt = Date.now();
            console.log(`✅ [Gateway] Connected to ${gwUrl}`);
            // Log-only — do NOT broadcast GATEWAY_CONNECTED to SSE so the live feed doesn't flood.
            fs.appendFile(OPENCLAW_LOG, `[${new Date().toISOString()}] GATEWAY_CONNECTED url=${gwUrl}\n`, () => { });

            // Only reset retry attempts if the connection stays stable for 5 seconds
            // This prevents flood loops if it connects then immediately disconnects (e.g. protocol mismatch)
            setTimeout(() => { if (gatewayConnected && gatewayWs?.readyState === WebSocket.OPEN) { gatewayRetryAttempts = 0; } }, 5000);
        });

        gatewayWs.on('message', (data) => {
            const raw = data.toString();
            try {
                const msg = JSON.parse(raw);

                // Write to openclaw.log (excluding noisy health and tick events)
                if (!(msg.type === 'event' && (msg.event === 'tick' || msg.event === 'health'))) {
                    fs.appendFile(OPENCLAW_LOG, `[${new Date().toISOString()}] ${raw}\n`, () => { });
                }

                // Handle the connect challenge → send handshake
                if (msg.type === 'event' && msg.event === 'connect.challenge') {
                    const gwToken = loadCreds()?.gatewayToken || process.env.OPENCLAW_GATEWAY_TOKEN || '';
                    const tokenSnippet = gwToken.length > 8 ? `${gwToken.slice(0, 4)}...${gwToken.slice(-4)}` : '(short token)';
                    console.log(`🔑 [Gateway] Sending connect handshake. Token length=${gwToken.length} snippet=${tokenSnippet}`);
                    gatewayWs.send(JSON.stringify({
                        type: 'req',
                        id: 'handshake-1',
                        method: 'connect',
                        params: {
                            minProtocol: 3,
                            maxProtocol: 3,
                            client: {
                                id: 'gateway-client',
                                version: '1.0.0',
                                platform: 'linux',
                                mode: 'backend'
                            },
                            auth: { token: gwToken },
                            scopes: ['operator.admin', 'operator.approvals', 'operator.pairing']
                        }
                    }));
                    return; // don't forward challenge
                }

                // Helper to map complex health agents to UI format
                function mapHealthAgents(agentsArr) {
                    if (!Array.isArray(agentsArr)) return [];
                    return agentsArr.map(a => ({
                        id: a.agentId,
                        name: a.name || a.agentId,
                        kind: 'agent',
                        status: 'online',
                        isDefault: a.isDefault,
                        scopes: [],
                        stats: { lastPing: Date.now() }
                    }));
                }

                // Cache health snapshot and emit compact event (not raw flood)
                if (msg.type === 'event' && msg.event === 'health') {
                    const hAgents = msg.payload?.agents || [];
                    const prev = JSON.stringify(gatewaySnapshot?.health?.agents?.map(a => a.agentId));
                    gatewaySnapshot = msg.payload || {};
                    const curr = JSON.stringify(hAgents.map(a => a.agentId));

                    if (prev !== curr || !gatewayNodes.length) {
                        gatewayNodes = mapHealthAgents(hAgents);
                        broadcastEvent({ type: 'GATEWAY_NODES', payload: { nodes: gatewayNodes } });
                    }
                    return; // never forward raw health to SSE/clients
                }

                // Handle handshake success
                if (msg.type === 'res' && msg.id === 'handshake-1' && msg.ok) {
                    if (msg.payload?.snapshot) {
                        gatewaySnapshot = msg.payload.snapshot;
                        const hAgents = gatewaySnapshot.health?.agents || [];
                        gatewayNodes = mapHealthAgents(hAgents);
                        broadcastEvent({ type: 'GATEWAY_NODES', payload: { nodes: gatewayNodes } });
                    }
                    console.log('✅ [Gateway] Handshake OK. Initial snapshot processed.');
                    // Emit a smaller connected event, not the full snapshot to the feed
                    broadcastEvent({ type: 'GATEWAY_CONNECTED_OK', payload: { connected: true, serverTime: msg.payload?.serverTime } });
                    return;
                }

                // Drop tick events completely
                if (msg.type === 'event' && msg.event === 'tick') {
                    return;
                }

                // Block verbose connection/disconnection events from flooding the UI
                if (msg.type === 'event' && (msg.event === 'client.connected' || msg.event === 'client.disconnected')) {
                    // We don't need to poll node.list because we get health updates with agents
                    return;
                }

            } catch (e) { }

            // Forward all other messages to proxy clients (chat replies etc)
            gatewayClients.clients.forEach(c => { try { c.send(data); } catch { } });
        });

        gatewayWs.on('close', (code, reason) => {
            gatewayConnected = false;
            let reasonStr = reason ? reason.toString() : '';
            if (!reasonStr) {
                const standardReasons = { 1000: 'Normal Closure (Server hung up cleanly, check token/auth on remote)', 1001: 'Going Away (Server shutting down)', 1006: 'Abnormal Closure (Connection dropped/timeout)', 1011: 'Internal Server Error' };
                reasonStr = standardReasons[code] || 'No reason provided';
            }
            const delay = Math.min(GATEWAY_RETRY_BASE * Math.pow(2, gatewayRetryAttempts), 30000);
            gatewayRetryAttempts++;
            const logLine = `[${new Date().toISOString()}] GATEWAY_DISCONNECTED code=${code} reason=${reasonStr}\n`;
            console.log(`🔌 [Gateway] Disconnected (code ${code}: ${reasonStr}). Reconnecting in ${delay}ms...`);
            fs.appendFile(OPENCLAW_LOG, logLine, () => { });
            // Do NOT broadcast GATEWAY_DISCONNECTED to SSE — it floods the live feed during reconnect loops.
            // The /api/gateway/status endpoint always reflects real-time connection state.
            if (gatewayRetryTimer) clearTimeout(gatewayRetryTimer);
            gatewayRetryTimer = setTimeout(connectGateway, delay);
        });

        gatewayWs.on('error', (err) => {
            gatewayLastError = err.message || String(err);
            console.error(`❌ [Gateway] Connection error: ${gatewayLastError}`);
            // 'close' will fire after 'error', which handles reconnect scheduling
        });

    } catch (err) {
        const delay = Math.min(GATEWAY_RETRY_BASE * Math.pow(2, gatewayRetryAttempts), 30000);
        gatewayRetryAttempts++;
        gatewayLastError = err.message || String(err);
        console.error(`❌ [Gateway] Failed to create WebSocket: ${gatewayLastError}. Retrying in ${delay}ms...`);
        if (gatewayRetryTimer) clearTimeout(gatewayRetryTimer);
        gatewayRetryTimer = setTimeout(connectGateway, delay);
    }
}
// Delay initial connection by 10s so OpenClaw gateway has time to start first
setTimeout(connectGateway, 10000);
console.log('⏳ [Gateway] Initial connection delayed 10s to allow gateway startup...');

// Initialize DB and start server
initDb().then(() => {
    server.listen(PORT, () => {
        console.log(`🚀 ClawControl listening on http://localhost:${PORT}`);
        console.log(`📁 Workspace: ${WORKSPACE_DIR}`);
        console.log(`🗄  Database: ${DB_PATH}`);
        startHealthPoller();
    });
}).catch(err => {
    console.error('❌ DB init failed:', err);
    process.exit(1);
});

