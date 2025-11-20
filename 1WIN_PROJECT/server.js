/**
 * server.js
 * Minimal Express server for the 1WIN SPA.
 * - Serves static files from /public (express.static BEFORE catch-all)
 * - Simple JSON file DB (db.json) for persistence
 * - Endpoints implemented to support the frontend:
 *   /api/register, /api/login, /api/profile/:id, /api/clans, /api/create-clan,
 *   /api/join-clan, /api/leaderboard, /api/statuses, /api/buy-status,
 *   /api/set-status, /api/search-user, /api/bonus, /api/bank/*, /api/games/*,
 *   /api/admin/*, /api/clan/:id/messages (and send)
 *
 * Note: This is a development/test server (file-backed). Do NOT use in production.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key';
const DB_FILE = path.join(__dirname, 'db.json');

const app = express();
app.use(express.json());

// Simple DB helpers (sync for simplicity)
function ensureDB() {
  if (!fs.existsSync(DB_FILE)) {
    const seed = {
      users: [],
      clans: [],
      statuses: [],
      transactions: [],
      clanMessages: {}, // clanId -> messages array
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2), 'utf8');
  }
}
function readDB() {
  ensureDB();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('readDB error', err);
    return { users: [], clans: [], statuses: [], transactions: [], clanMessages: {} };
  }
}
function writeDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

// Logging middleware (helpful)
app.use((req, res, next) => {
  console.log(new Date().toISOString(), req.method, req.url);
  next();
});

// Serve static files from public (MUST be before catch-all)
app.use(express.static(path.join(__dirname, 'public')));

// Auth helper middleware
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.id;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
function generateToken(user) {
  return jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
}

// Utility: minimal sanitizer
function publicProfile(user) {
  return {
    id: user.id,
    nickname: user.nickname,
    email: user.email,
    balance: user.balance || 0,
    bankBalance: user.bankBalance || 0,
    bankAccountNumber: user.bankAccountNumber || null,
    totalEarned: user.totalEarned || 0,
    clanId: user.clanId || null,
    status: user.status || 'Новичок',
    registrationDate: user.registrationDate,
    gamesPlayed: user.gamesPlayed || 0,
    maxWin: user.maxWin || 0,
    lastBonusClaim: user.lastBonusClaim || null,
    purchasedStatuses: user.purchasedStatuses || [],
    vipExpiry: user.vipExpiry || null,
    adminMode: user.adminMode || false,
  };
}

/* ----------------- AUTH & PROFILE ----------------- */
// Register
app.post('/api/register', async (req, res) => {
  try {
    const { nickname, email, password } = req.body;
    if (!nickname || !email || !password) return res.status(400).json({ error: 'Missing fields' });
    const db = readDB();
    if (db.users.find(u => u.email === email || u.nickname === nickname)) {
      return res.status(400).json({ error: 'User already exists' });
    }
    const hash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    const now = new Date().toISOString();
    const user = {
      id,
      nickname,
      email,
      passwordHash: hash,
      balance: 5000, // default starting balance
      bankBalance: 0,
      bankAccountNumber: 'AC' + Math.floor(Math.random()*900000 + 100000),
      totalEarned: 0,
      registrationDate: now,
      gamesPlayed: 0,
      maxWin: 0,
      purchasedStatuses: [],
      vipExpiry: null,
      status: 'Новичок',
      adminMode: false,
    };
    db.users.push(user);
    writeDB(db);
    return res.json({ ok: true });
  } catch (err) {
    console.error('register error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { nicknameOrEmail, password } = req.body;
    if (!nicknameOrEmail || !password) return res.status(400).json({ error: 'Missing' });
    const db = readDB();
    const user = db.users.find(u => u.email === nicknameOrEmail || u.nickname === nicknameOrEmail);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = generateToken(user);
    return res.json({ token, user: publicProfile(user) });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Profile
app.get('/api/profile/:id', (req, res) => {
  try {
    const db = readDB();
    const user = db.users.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    return res.json({ profile: publicProfile(user) });
  } catch (err) {
    console.error('profile error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ----------------- CLANS ----------------- */
// List clans
app.get('/api/clans', (req, res) => {
  try {
    const db = readDB();
    const out = db.clans.map(c => ({
      id: c.id,
      name: c.name,
      description: c.description || '',
      treasury: c.treasury || 0,
      members: (c.members || []).length
    }));
    res.json({ clans: out });
  } catch (err) {
    console.error('clans list', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create clan
app.post('/api/create-clan', authMiddleware, (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const db = readDB();
    const user = db.users.find(u => u.id === req.userId);
    if (!user) return res.status(401).json({ error: 'No user' });
    const CREATION_COST = 50000;
    if ((user.balance || 0) < CREATION_COST) return res.status(400).json({ error: 'Not enough funds' });
    // Deduct
    user.balance -= CREATION_COST;
    const clan = { id: uuidv4(), name, description: description || '', treasury: 0, members: [user.id] };
    db.clans.push(clan);
    user.clanId = clan.id;
    writeDB(db);
    return res.json({ ok: true, clan });
  } catch (err) {
    console.error('create clan', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Join clan
app.post('/api/join-clan', authMiddleware, (req, res) => {
  try {
    const { clanId } = req.body;
    const db = readDB();
    const clan = db.clans.find(c => c.id === clanId);
    if (!clan) return res.status(404).json({ error: 'Clan not found' });
    const user = db.users.find(u => u.id === req.userId);
    if (!user) return res.status(401).json({ error: 'No user' });
    if (user.clanId && user.clanId === clanId) return res.status(400).json({ error: 'Already in clan' });
    // Add
    clan.members = clan.members || [];
    clan.members.push(user.id);
    user.clanId = clan.id;
    writeDB(db);
    return res.json({ ok: true });
  } catch (err) {
    console.error('join clan', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ----------------- LEADERBOARD ----------------- */
app.get('/api/leaderboard', (req, res) => {
  try {
    const db = readDB();
    const players = db.users
      .map(u => ({
        id: u.id,
        nickname: u.nickname,
        balance: u.balance || 0,
        status: u.status || 'Новичок',
        vip: u.vipExpiry ? new Date(u.vipExpiry) > new Date() : false
      }))
      .sort((a,b) => b.balance - a.balance)
      .map((p, idx) => ({ ...p, rank: idx + 1 }));
    const clans = (db.clans || []).map(c => ({
      id: c.id,
      name: c.name,
      treasury: c.treasury || 0,
      members: (c.members || []).length
    })).sort((a,b) => b.treasury - a.treasury).map((c, idx) => ({ ...c, rank: idx + 1 }));
    res.json({ players, clans });
  } catch (err) {
    console.error('leaderboard', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ----------------- STATUSES ----------------- */
// Return statuses (if none in db, fallback)
app.get('/api/statuses', (req, res) => {
  try {
    const db = readDB();
    if (Array.isArray(db.statuses) && db.statuses.length) return res.json({ statuses: db.statuses });
    // fallback
    const fallback = [
      { id:'s1', name:'Новичок', desc:'Статус по умолчанию', price:0, achievement:false },
      { id:'s2', name:'Олд', desc:'Регистрация >1 года', price:0, achievement:true },
      { id:'s3', name:'Про', desc:'Платный статус', price:50000, achievement:false },
      { id:'s4', name:'Легенда', desc:'Платный статус', price:250000, achievement:false },
    ];
    return res.json({ statuses: fallback });
  } catch (err) {
    console.error('statuses', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Buy status - optional server endpoint
app.post('/api/buy-status', authMiddleware, (req, res) => {
  try {
    const { statusId } = req.body;
    if (!statusId) return res.status(400).json({ error: 'statusId required' });
    const db = readDB();
    const status = (db.statuses || []).find(s => s.id === statusId);
    if (!status) return res.status(404).json({ error: 'Status not found' });
    const user = db.users.find(u => u.id === req.userId);
    if (!user) return res.status(401).json({ error: 'No user' });
    const price = status.price || 0;
    if ((user.balance || 0) < price) return res.status(400).json({ error: 'Not enough funds' });
    user.balance -= price;
    user.purchasedStatuses = user.purchasedStatuses || [];
    if (!user.purchasedStatuses.includes(statusId)) user.purchasedStatuses.push(statusId);
    writeDB(db);
    return res.json({ ok: true });
  } catch (err) {
    console.error('buy-status', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Set status
app.post('/api/set-status', authMiddleware, (req, res) => {
  try {
    const { statusId } = req.body;
    if (!statusId) return res.status(400).json({ error: 'statusId required' });
    const db = readDB();
    const user = db.users.find(u => u.id === req.userId);
    if (!user) return res.status(401).json({ error: 'No user' });
    user.status = (db.statuses || []).find(s => s.id === statusId)?.name || statusId;
    writeDB(db);
    return res.json({ ok: true });
  } catch (err) {
    console.error('set-status', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ----------------- SEARCH ----------------- */
app.get('/api/search-user', (req, res) => {
  try {
    const q = String(req.query.q || '').toLowerCase();
    const db = readDB();
    if (!q) return res.json({ results: [] });
    const results = db.users
      .filter(u => u.nickname.toLowerCase().includes(q))
      .map(u => ({ id: u.id, nickname: u.nickname, balance: u.balance || 0 }));
    res.json({ results });
  } catch (err) {
    console.error('search-user', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ----------------- BONUS ----------------- */
app.post('/api/bonus', authMiddleware, (req, res) => {
  try {
    const db = readDB();
    const user = db.users.find(u => u.id === req.userId);
    if (!user) return res.status(401).json({ error: 'No user' });
    const now = new Date();
    if (user.lastBonusClaim) {
      const last = new Date(user.lastBonusClaim);
      const next = new Date(last.getTime() + 24*3600*1000);
      if (now < next) return res.status(400).json({ error: 'Bonus not available yet', nextAvailable: next.toISOString() });
    }
    // award bonus (simple logic)
    const amount = 1000 + Math.floor(Math.random()*4000); // 1000..4999
    user.balance = (user.balance || 0) + amount;
    user.lastBonusClaim = now.toISOString();
    writeDB(db);
    return res.json({ ok: true, amount });
  } catch (err) {
    console.error('bonus', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ----------------- BANK ----------------- */
app.post('/api/bank/deposit', authMiddleware, (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    const db = readDB();
    const user = db.users.find(u => u.id === req.userId);
    if (!user) return res.status(401).json({ error: 'No user' });
    user.balance = (user.balance || 0) + Number(amount);
    db.transactions = db.transactions || [];
    db.transactions.push({ id: uuidv4(), userId: user.id, type: 'deposit', amount, date: new Date().toISOString() });
    writeDB(db);
    res.json({ ok: true });
  } catch (err) {
    console.error('deposit', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/bank/withdraw', authMiddleware, (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    const db = readDB();
    const user = db.users.find(u => u.id === req.userId);
    if (!user) return res.status(401).json({ error: 'No user' });
    if ((user.balance || 0) < amount) return res.status(400).json({ error: 'Not enough funds' });
    user.balance -= Number(amount);
    db.transactions = db.transactions || [];
    db.transactions.push({ id: uuidv4(), userId: user.id, type: 'withdraw', amount, date: new Date().toISOString() });
    writeDB(db);
    res.json({ ok: true });
  } catch (err) {
    console.error('withdraw', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/bank/transfer', authMiddleware, (req, res) => {
  try {
    const { toAccount, amount } = req.body;
    if (!toAccount || !amount) return res.status(400).json({ error: 'Missing' });
    const db = readDB();
    const from = db.users.find(u => u.id === req.userId);
    const to = db.users.find(u => u.bankAccountNumber === toAccount);
    if (!from) return res.status(401).json({ error: 'No user' });
    if (!to) return res.status(404).json({ error: 'Recipient not found' });
    if ((from.balance || 0) < amount) return res.status(400).json({ error: 'Not enough funds' });
    from.balance -= Number(amount);
    to.balance = (to.balance || 0) + Number(amount);
    db.transactions = db.transactions || [];
    db.transactions.push({ id: uuidv4(), from: from.id, to: to.id, type: 'transfer', amount, date: new Date().toISOString() });
    writeDB(db);
    res.json({ ok: true });
  } catch (err) {
    console.error('transfer', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ----------------- GAMES (simple stubs) ----------------- */
app.post('/api/games/slots', authMiddleware, (req, res) => {
  try {
    const { bet } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.id === req.userId);
    if (!user) return res.status(401).json({ error: 'No user' });
    if ((user.balance || 0) < bet) return res.status(400).json({ error: 'Not enough funds' });
    // simple random outcome
    const symbols = ['🍒','🍋','⭐','7','🔔'];
    const s = [symbols[Math.floor(Math.random()*symbols.length)], symbols[Math.floor(Math.random()*symbols.length)], symbols[Math.floor(Math.random()*symbols.length)]];
    let multiplier = 0;
    if (s[0] === s[1] && s[1] === s[2]) multiplier = 5;
    else if (s[0] === s[1] || s[1] === s[2] || s[0] === s[2]) multiplier = 2;
    const win = Math.floor(bet * multiplier);
    user.balance = (user.balance || 0) - bet + win;
    user.totalEarned = (user.totalEarned || 0) + win;
    user.gamesPlayed = (user.gamesPlayed || 0) + 1;
    user.maxWin = Math.max(user.maxWin || 0, win);
    writeDB(db);
    res.json({ symbols: s, multiplier, win });
  } catch (err) {
    console.error('slots', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/games/rocket', authMiddleware, (req, res) => {
  try {
    const { bet } = req.body;
    const db = readDB(); const user = db.users.find(u => u.id === req.userId);
    if (!user) return res.status(401).json({ error: 'No user' });
    if ((user.balance || 0) < bet) return res.status(400).json({ error: 'Not enough funds' });
    // simulate crash multiplier
    const crash = Number((1 + Math.random()*9).toFixed(2)); // 1.00 .. 10.00
    const cashedAt = Math.random() > 0.5 ? Number((1 + Math.random()* (crash-1)).toFixed(2)) : 0; // either cashed or lost
    let win = 0;
    if (cashedAt) win = Math.floor(bet * cashedAt);
    user.balance = (user.balance || 0) - bet + win;
    user.totalEarned = (user.totalEarned || 0) + win;
    user.gamesPlayed = (user.gamesPlayed || 0) + 1;
    user.maxWin = Math.max(user.maxWin || 0, win);
    writeDB(db);
    res.json({ crash, cashedAt, win });
  } catch (err) {
    console.error('rocket', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/games/basket', authMiddleware, (req, res) => {
  try {
    const { bet } = req.body;
    const db = readDB(); const user = db.users.find(u => u.id === req.userId);
    if (!user) return res.status(401).json({ error: 'No user' });
    if ((user.balance || 0) < bet) return res.status(400).json({ error: 'Not enough funds' });
    const success = Math.random() > 0.5;
    const multiplier = success ? (1 + Math.random()*4) : 0;
    const win = success ? Math.floor(bet * multiplier) : 0;
    user.balance = (user.balance || 0) - bet + win;
    user.totalEarned = (user.totalEarned || 0) + win;
    user.gamesPlayed = (user.gamesPlayed || 0) + 1;
    user.maxWin = Math.max(user.maxWin || 0, win);
    writeDB(db);
    res.json({ multiplier: multiplier?Number(multiplier.toFixed(2)):0, win });
  } catch (err) {
    console.error('basket', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ----------------- CLAN CHAT ----------------- */
app.get('/api/clan/:id/messages', authMiddleware, (req, res) => {
  try {
    const db = readDB();
    const msgs = db.clanMessages && db.clanMessages[req.params.id] ? db.clanMessages[req.params.id] : [];
    res.json({ messages: msgs });
  } catch (err) {
    console.error('clan messages', err);
    res.status(500).json({ error: 'Server error' });
  }
});
app.post('/api/clan/:id/message', authMiddleware, (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });
    const db = readDB();
    db.clanMessages = db.clanMessages || {};
    db.clanMessages[req.params.id] = db.clanMessages[req.params.id] || [];
    const user = db.users.find(u => u.id === req.userId) || { nickname: 'Unknown' };
    const msg = { id: uuidv4(), nickname: user.nickname, text, date: new Date().toISOString() };
    db.clanMessages[req.params.id].push(msg);
    writeDB(db);
    res.json({ ok: true });
  } catch (err) {
    console.error('post clan message', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ----------------- ADMIN ----------------- */
// Toggle adminMode
app.post('/api/admin/toggle-mode', authMiddleware, (req, res) => {
  try {
    const db = readDB();
    const user = db.users.find(u => u.id === req.userId);
    if (!user) return res.status(401).json({ error: 'No user' });
    if ((user.status || '').toLowerCase() !== 'админ') return res.status(403).json({ error: 'Not admin' });
    user.adminMode = !user.adminMode;
    writeDB(db);
    res.json({ adminMode: user.adminMode });
  } catch (err) { console.error('toggle admin', err); res.status(500).json({ error: 'Server error' }); }
});

// Predict simple
app.get('/api/admin/predict', authMiddleware, (req, res) => {
  try {
    const db = readDB(); const user = db.users.find(u => u.id === req.userId);
    if (!user) return res.status(401).json({ error: 'No user' });
    if ((user.status || '').toLowerCase() !== 'админ') return res.status(403).json({ error: 'Not admin' });
    const prediction = Math.random() > 0.5 ? 'WIN' : 'LOSE';
    const confidence = Math.floor(50 + Math.random()*50);
    res.json({ prediction, confidence });
  } catch (err) { console.error('predict', err); res.status(500).json({ error: 'Server error' }); }
});

// Grant funds
app.post('/api/admin/grant', authMiddleware, (req, res) => {
  try {
    const { amount, targetId } = req.body;
    const db = readDB();
    const caller = db.users.find(u => u.id === req.userId);
    if (!caller) return res.status(401).json({ error: 'No user' });
    if ((caller.status || '').toLowerCase() !== 'админ') return res.status(403).json({ error: 'Not admin' });
    const target = targetId ? db.users.find(u => u.id === targetId) : caller;
    if (!target) return res.status(404).json({ error: 'Target not found' });
    target.balance = (target.balance || 0) + Number(amount || 0);
    writeDB(db);
    res.json({ ok: true, newBalance: target.balance });
  } catch (err) { console.error('grant', err); res.status(500).json({ error: 'Server error' }); }
});

/* ----------------- CATCH-ALL for SPA (after static) ---------------- */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ----------------- START SERVER ----------------- */
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});