const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const lockfile = require('proper-lockfile');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const DB_PATH = path.join(__dirname, 'db.json');
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-to-strong-value';
const SALT_ROUNDS = 10;

// Admin credentials (главный админ — создатель)
const CREATOR_EMAIL = 'sergeymosin04@gmail.com';
const CREATOR_PASSWORD = '10134350';

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure DB exists
if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, JSON.stringify({
    users: [],
    clans: [],
    transactions: [],
    clanMessages: []
  }, null, 2));
}

// Helper: atomic read-modify-write with lock
async function withDb(fn) {
  const release = await lockfile.lock(DB_PATH, { retries: { retries: 5, minTimeout: 50, maxTimeout: 100 }});
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    const db = JSON.parse(raw);
    const res = await fn(db);
    // write DB back to disk
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
    return res;
  } finally {
    await release();
  }
}

async function readDb() {
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  return JSON.parse(raw);
}

// Auth middleware
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'No token' });
  const parts = auth.split(' ');
  if (parts.length !== 2) return res.status(401).json({ error: 'Bad token' });
  const token = parts[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Utility: case-insensitive nickname exists
function nicknameExists(db, nickname) {
  return db.users.some(u => u.nickname.toLowerCase() === nickname.toLowerCase());
}

// Utility: case-insensitive email exists
function emailExists(db, email) {
  return db.users.some(u => u.email.toLowerCase() === email.toLowerCase());
}

// Utility: generate unique 10-digit bank account
function generateBankAccount(db) {
  let account;
  do {
    account = Math.floor(1000000000 + Math.random() * 9000000000).toString();
  } while (db.users.some(u => u.bankAccountNumber === account));
  return account;
}

/*
  ROUTES
*/

// Registration
app.post('/api/register', async (req, res) => {
  const { nickname, email, password } = req.body;
  if (!nickname || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  if (password.length < 6) return res.status(400).json({ error: 'Password too short' });
  await withDb(async (db) => {
    if (nicknameExists(db, nickname)) {
      return res.status(409).json({ error: 'Nickname already exists' });
    }
    if (emailExists(db, email)) {
      return res.status(409).json({ error: 'Email already exists' });
    }
    const id = uuidv4();
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const now = new Date().toISOString();

    // Check if this is the creator/admin account (exact match of email & password)
    let status = "Новичок";
    let adminMode = false;
    if (email.toLowerCase() === CREATOR_EMAIL.toLowerCase() && password === CREATOR_PASSWORD) {
      status = "Админ";
      adminMode = true;
    }

    const user = {
      id,
      nickname,
      email,
      passwordHash,
      balance: 5000,
      registrationDate: now,
      bankAccountNumber: generateBankAccount(db),
      bankBalance: 0,
      totalEarned: 0,
      gamesPlayed: 0,
      maxWin: 0,
      clanId: null,
      status: status,
      vipExpiry: null,
      lastBonusClaim: null,
      purchasedStatuses: [],
      adminMode: adminMode
    };
    db.users.push(user);
    db.transactions.push({
      id: uuidv4(),
      userId: id,
      type: 'registration',
      amount: 0,
      date: now,
      info: 'Registered'
    });
    res.json({ ok: true });
  });
});

// Login
app.post('/api/login', async (req, res) => {
  const { nicknameOrEmail, password } = req.body;
  if (!nicknameOrEmail || !password) return res.status(400).json({ error: 'Missing fields' });
  const db = await readDb();
  const user = db.users.find(u => u.nickname.toLowerCase() === nicknameOrEmail.toLowerCase() || u.email.toLowerCase() === (nicknameOrEmail.toLowerCase()));
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, nickname: user.nickname }, JWT_SECRET, { expiresIn: '7d' });
  const safeUser = { ...user };
  delete safeUser.passwordHash;
  res.json({ token, user: safeUser });
});

// Search users
app.get('/api/search-user', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  if (!q) return res.json({ results: [] });
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  const results = db.users.filter(u => u.nickname.toLowerCase().includes(q)).map(u => ({
    id: u.id,
    nickname: u.nickname,
    balance: u.balance,
    clanId: u.clanId
  }));
  res.json({ results });
});

// Get leaderboard
app.get('/api/leaderboard', (req, res) => {
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  const players = db.users.slice().sort((a,b) => b.balance - a.balance).map((u, idx) => ({
    rank: idx + 1,
    id: u.id,
    nickname: u.nickname,
    vip: u.vipExpiry && new Date(u.vipExpiry) > new Date(),
    status: u.status,
    balance: u.balance
  }));
  const clans = db.clans.slice().sort((a,b) => b.treasury - a.treasury).map((c, idx) => ({
    rank: idx + 1,
    id: c.id,
    name: c.name,
    treasury: c.treasury,
    members: c.members.length
  }));
  res.json({ players, clans });
});

// Get profile
app.get('/api/profile/:id', (req, res) => {
  const id = req.params.id;
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  const u = db.users.find(x => x.id === id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const safe = { ...u };
  delete safe.passwordHash;
  res.json({ profile: safe });
});

// Toggle admin mode (persisted flag)
app.post('/api/admin/toggle-mode', authMiddleware, async (req, res) => {
  const uid = req.user.id;
  await withDb(async (db) => {
    const u = db.users.find(x => x.id === uid);
    if (!u) return res.status(404).json({ error: 'User not found' });
    if (u.status !== 'Админ') return res.status(403).json({ error: 'Not an admin' });
    u.adminMode = !u.adminMode;
    res.json({ adminMode: u.adminMode });
  });
});

// Admin: simple prediction endpoint
app.get('/api/admin/predict', authMiddleware, async (req, res) => {
  const uid = req.user.id;
  const db = await readDb();
  const u = db.users.find(x => x.id === uid);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (u.status !== 'Админ') return res.status(403).json({ error: 'Not an admin' });

  // Простая вероятностная "модель" прогноза: случайно выдаём WIN/LOSE с confidence
  const confidence = Math.floor(50 + Math.random() * 46);
  const prediction = Math.random() < 0.5 ? 'WIN' : 'LOSE';
  res.json({ prediction, confidence });
});

// Admin: grant money
app.post('/api/admin/grant', authMiddleware, async (req, res) => {
  const uid = req.user.id;
  const { amount, targetId } = req.body;
  if (!amount || typeof amount !== 'number' || amount <= 0) return res.status(400).json({ error: 'Bad amount' });
  await withDb(async (db) => {
    const actor = db.users.find(x => x.id === uid);
    if (!actor) return res.status(404).json({ error: 'User not found' });
    if (actor.status !== 'Админ') return res.status(403).json({ error: 'Not an admin' });
    const target = targetId ? db.users.find(x => x.id === targetId) : actor;
    if (!target) return res.status(404).json({ error: 'Target user not found' });
    target.balance += amount;
    target.totalEarned += amount;
    db.transactions.push({
      id: uuidv4(),
      userId: target.id,
      type: 'admin_grant',
      amount,
      date: new Date().toISOString(),
      info: `Granted by admin ${actor.nickname}`
    });
    res.json({ ok: true, targetId: target.id, newBalance: target.balance });
  });
});

// Bonus
app.post('/api/bonus', authMiddleware, async (req, res) => {
  const uid = req.user.id;
  const now = new Date();
  await withDb(async (db) => {
    const u = db.users.find(x => x.id === uid);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const last = u.lastBonusClaim ? new Date(u.lastBonusClaim) : null;
    if (last && (now - last) < 24 * 3600 * 1000) {
      const next = new Date(last.getTime() + 24*3600*1000);
      return res.status(429).json({ error: 'Too early', nextAvailable: next.toISOString() });
    }
    const isVip = u.vipExpiry && new Date(u.vipExpiry) > now;
    const amount = isVip ? (10000 + Math.floor(Math.random() * 10001)) : (1000 + Math.floor(Math.random() * 2001));
    u.balance += amount;
    u.totalEarned += amount;
    u.lastBonusClaim = now.toISOString();
    db.transactions.push({
      id: uuidv4(),
      userId: uid,
      type: 'bonus',
      amount,
      date: now.toISOString(),
      info: 'Daily bonus'
    });
    res.json({ amount, balance: u.balance });
  });
});

// Create clan
app.post('/api/create-clan', authMiddleware, async (req, res) => {
  const { name, description } = req.body;
  const uid = req.user.id;
  await withDb(async (db) => {
    const user = db.users.find(u => u.id === uid);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.clanId) return res.status(400).json({ error: 'Already in clan' });
    if (user.balance < 50000) return res.status(400).json({ error: 'Not enough funds' });
    user.balance -= 50000;
    const clan = {
      id: uuidv4(),
      name,
      description: description || '',
      treasury: 0,
      members: [{ id: uid, nickname: user.nickname, role: 'leader', warnings: [] }],
      warnings: {},
      createdAt: new Date().toISOString()
    };
    user.clanId = clan.id;
    db.clans.push(clan);
    db.transactions.push({
      id: uuidv4(),
      userId: uid,
      type: 'create_clan',
      amount: -50000,
      date: new Date().toISOString(),
      info: `Created clan ${name}`
    });
    res.json({ clan });
  });
});

// List clans
app.get('/api/clans', (req, res) => {
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  const clans = db.clans.map(c => ({
    id: c.id, name: c.name, description: c.description, treasury: c.treasury, members: c.members.length
  }));
  res.json({ clans });
});

// Join clan
app.post('/api/join-clan', authMiddleware, async (req, res) => {
  const { clanId } = req.body;
  const uid = req.user.id;
  await withDb(async (db) => {
    const clan = db.clans.find(c => c.id === clanId);
    const user = db.users.find(u => u.id === uid);
    if (!clan) return res.status(404).json({ error: 'Clan not found' });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.clanId) return res.status(400).json({ error: 'Already in clan' });
    clan.members.push({ id: uid, nickname: user.nickname, role: 'member', warnings: [] });
    user.clanId = clan.id;
    res.json({ ok: true });
  });
});

// Clan messages (polling)
app.get('/api/clan/:id/messages', authMiddleware, (req, res) => {
  const clanId = req.params.id;
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  const msgs = db.clanMessages.filter(m => m.clanId === clanId).slice(-200);
  res.json({ messages: msgs });
});

app.post('/api/clan/:id/message', authMiddleware, async (req, res) => {
  const clanId = req.params.id;
  const { text } = req.body;
  const uid = req.user.id;
  await withDb(async (db) => {
    const clan = db.clans.find(c => c.id === clanId);
    if (!clan) return res.status(404).json({ error: 'Clan not found' });
    const user = db.users.find(u => u.id === uid);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.clanId !== clanId) return res.status(403).json({ error: 'Not in clan' });
    const msg = {
      id: uuidv4(),
      clanId,
      userId: uid,
      nickname: user.nickname,
      text,
      date: new Date().toISOString(),
      system: false
    };
    db.clanMessages.push(msg);
    res.json({ message: msg });
  });
});

// Clan action endpoints
app.post('/api/clan/:id/action', authMiddleware, async (req, res) => {
  const clanId = req.params.id;
  const { action, targetId, reason, durationMinutes, amount } = req.body;
  const uid = req.user.id;
  await withDb(async (db) => {
    const clan = db.clans.find(c => c.id === clanId);
    const actor = db.users.find(u => u.id === uid);
    const target = db.users.find(u => u.id === targetId);
    if (!clan || !actor || !target) return res.status(404).json({ error: 'Not found' });
    const actorMember = clan.members.find(m => m.id === uid);
    if (!actorMember) return res.status(403).json({ error: 'Not in clan' });
    if (!['leader','vice'].includes(actorMember.role) && action !== 'transfer') return res.status(403).json({ error: 'Insufficient rights' });
    const time = new Date().toISOString();
    if (action === 'warn') {
      const member = clan.members.find(m => m.id === targetId);
      if (!member) return res.status(404).json({ error: 'Target not in clan' });
      member.warnings = member.warnings || [];
      member.warnings.push({ by: uid, reason, date: time, active: true });
      db.clanMessages.push({
        id: uuidv4(),
        clanId,
        userId: null,
        nickname: 'СИСТЕМА',
        text: `Пользователь ${member.nickname} получил выговор. Причина: ${reason}. Выполнил: ${actor.nickname}`,
        date: time,
        system: true
      });
      const activeWarnings = member.warnings.filter(w => w.active).length;
      if (activeWarnings >= 3) {
        clan.members = clan.members.filter(m => m.id !== targetId);
        const tu = db.users.find(u => u.id === targetId);
        if (tu) tu.clanId = null;
        db.clanMessages.push({
          id: uuidv4(),
          clanId,
          userId: null,
          nickname: 'СИСТЕМА',
          text: `Пользователь ${member.nickname} был кикнут (3 выговора). Выполнил: ${actor.nickname}`,
          date: time,
          system: true
        });
      }
      return res.json({ ok: true });
    } else if (action === 'kick') {
      clan.members = clan.members.filter(m => m.id !== targetId);
      if (target) target.clanId = null;
      db.clanMessages.push({
        id: uuidv4(),
        clanId,
        userId: null,
        nickname: 'СИСТЕМА',
        text: `Пользователь ${target.nickname} был кикнут. Причина: ${reason || 'не указана'}. Выполнил: ${actor.nickname}`,
        date: time,
        system: true
      });
      return res.json({ ok: true });
    } else if (action === 'mute') {
      db.clanMessages.push({
        id: uuidv4(),
        clanId,
        userId: null,
        nickname: 'СИСТЕМА',
        text: `Пользователь ${target.nickname} был замьючен на ${durationMinutes} минут. Причина: ${reason}. Выполнил: ${actor.nickname}`,
        date: time,
        system: true
      });
      return res.json({ ok: true });
    } else if (action === 'promote') {
      const member = clan.members.find(m => m.id === targetId);
      if (!member) return res.status(404).json({ error: 'Target not in clan' });
      if (actorMember.role !== 'leader') return res.status(403).json({ error: 'Only leader can promote' });
      member.role = 'vice';
      db.clanMessages.push({
        id: uuidv4(),
        clanId,
        userId: null,
        nickname: 'СИСТЕМА',
        text: `Пользователь ${member.nickname} был повышен до заместителя. Выполнил: ${actor.nickname}`,
        date: time,
        system: true
      });
      return res.json({ ok: true });
    } else if (action === 'transfer') {
      if (!amount || amount <= 0) return res.status(400).json({ error: 'Bad amount' });
      const from = db.users.find(u => u.id === uid);
      const to = db.users.find(u => u.id === targetId);
      if (!to) return res.status(404).json({ error: 'Target not found' });
      if (from.balance < amount) return res.status(400).json({ error: 'Not enough funds' });
      from.balance -= amount;
      to.balance += amount;
      db.transactions.push({ id: uuidv4(), userId: uid, type: 'transfer', amount: -amount, date: new Date().toISOString(), info: `Transfer to ${to.nickname}` });
      db.transactions.push({ id: uuidv4(), userId: targetId, type: 'transfer', amount: amount, date: new Date().toISOString(), info: `Transfer from ${from.nickname}` });
      db.clanMessages.push({
        id: uuidv4(),
        clanId,
        userId: null,
        nickname: 'СИСТЕМА',
        text: `Пользователь ${from.nickname} перевел ${amount} пользователю ${to.nickname}.`,
        date: new Date().toISOString(),
        system: true
      });
      return res.json({ ok: true });
    }
    res.status(400).json({ error: 'Unknown action' });
  });
});

// Bank operations
app.post('/api/bank/deposit', authMiddleware, async (req, res) => {
  const { amount } = req.body;
  const uid = req.user.id;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Bad amount' });
  await withDb(async (db) => {
    const u = db.users.find(x => x.id === uid);
    if (!u) return res.status(404).json({ error: 'User not found' });
    if (u.balance < amount) return res.status(400).json({ error: 'Not enough funds' });
    u.balance -= amount;
    u.bankBalance += amount;
    db.transactions.push({ id: uuidv4(), userId: uid, type: 'bank_deposit', amount: amount, date: new Date().toISOString(), info: 'Deposit to bank' });
    res.json({ balance: u.balance, bankBalance: u.bankBalance });
  });
});

app.post('/api/bank/withdraw', authMiddleware, async (req, res) => {
  const { amount } = req.body;
  const uid = req.user.id;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Bad amount' });
  await withDb(async (db) => {
    const u = db.users.find(x => x.id === uid);
    if (!u) return res.status(404).json({ error: 'User not found' });
    if (u.bankBalance < amount) return res.status(400).json({ error: 'Not enough bank funds' });
    u.bankBalance -= amount;
    u.balance += amount;
    db.transactions.push({ id: uuidv4(), userId: uid, type: 'bank_withdraw', amount: amount, date: new Date().toISOString(), info: 'Withdraw from bank' });
    res.json({ balance: u.balance, bankBalance: u.bankBalance });
  });
});

app.post('/api/bank/transfer', authMiddleware, async (req, res) => {
  const { toAccount, amount } = req.body;
  const uid = req.user.id;
  if (!toAccount || !amount || amount <= 0) return res.status(400).json({ error: 'Bad request' });
  await withDb(async (db) => {
    const sender = db.users.find(x => x.id === uid);
    const recipient = db.users.find(x => x.bankAccountNumber === toAccount);
    if (!sender || !recipient) return res.status(404).json({ error: 'User not found' });
    if (sender.balance < amount) return res.status(400).json({ error: 'Not enough funds' });
    sender.balance -= amount;
    recipient.bankBalance += amount;
    db.transactions.push({ id: uuidv4(), userId: uid, type: 'bank_transfer_out', amount: -amount, date: new Date().toISOString(), info: `To account ${toAccount}` });
    db.transactions.push({ id: uuidv4(), userId: recipient.id, type: 'bank_transfer_in', amount: amount, date: new Date().toISOString(), info: `From ${sender.nickname}` });
    res.json({ ok: true });
  });
});

// Games: Slots
app.post('/api/games/slots', authMiddleware, async (req, res) => {
  const { bet } = req.body;
  const uid = req.user.id;
  if (!bet || bet <= 0) return res.status(400).json({ error: 'Bad bet' });
  await withDb(async (db) => {
    const u = db.users.find(x => x.id === uid);
    if (!u) return res.status(404).json({ error: 'User not found' });
    if (u.balance < bet) return res.status(400).json({ error: 'Not enough funds' });
    u.balance -= bet;
    u.gamesPlayed = (u.gamesPlayed || 0) + 1;
    // symbols
    const symbols = ['777','BAR','Виноград','Лимон','Вишня'];
    function pick(){ return symbols[Math.floor(Math.random()*symbols.length)]; }
    const r1 = pick(), r2 = pick(), r3 = pick();
    let multiplier = 0;
    if (r1 === r2 && r2 === r3) {
      if (r1 === '777') multiplier = 10;
      else if (r1 === 'BAR') multiplier = 5;
      else if (r1 === 'Виноград') multiplier = 3;
      else if (r1 === 'Лимон') multiplier = 2;
      else if (r1 === 'Вишня') multiplier = 2;
    }
    const win = Math.floor(bet * multiplier);
    if (win > 0) {
      u.balance += win;
      u.totalEarned += win;
      if (win > (u.maxWin || 0)) u.maxWin = win;
    }
    db.transactions.push({ id: uuidv4(), userId: uid, type: 'slots', amount: win - bet, date: new Date().toISOString(), info: `Slots result ${r1}|${r2}|${r3}` });
    res.json({ symbols: [r1,r2,r3], multiplier, win, balance: u.balance });
  });
});

// Games: Rocket - server decides crash multiplier (simplified flow)
app.post('/api/games/rocket', authMiddleware, async (req, res) => {
  const { bet } = req.body;
  const uid = req.user.id;
  if (!bet || bet <= 0) return res.status(400).json({ error: 'Bad bet' });
  await withDb(async (db) => {
    const u = db.users.find(x => x.id === uid);
    if (!u) return res.status(404).json({ error: 'User not found' });
    if (u.balance < bet) return res.status(400).json({ error: 'Not enough funds' });
    u.balance -= bet;
    u.gamesPlayed = (u.gamesPlayed || 0) + 1;
    // simulate crash: random multiplier between 1.0 and 5.0
    const crash = Math.random() ** 1.3 * 4 + 1;
    const crashRounded = Math.round(crash * 100) / 100;
    // For simplified demo: player auto-cashes out at a random point <= crash
    const cashed = Math.round((1 + Math.random() * (crashRounded - 1)) * 100) / 100;
    const win = Math.floor(bet * cashed);
    if (win > 0) {
      u.balance += win;
      u.totalEarned += win;
      if (win > (u.maxWin || 0)) u.maxWin = win;
    }
    db.transactions.push({ id: uuidv4(), userId: uid, type: 'rocket', amount: win - bet, date: new Date().toISOString(), info: `Rocket crashed at ${crashRounded}, cashed at ${cashed}` });
    res.json({ crash: crashRounded, cashedAt: cashed, win, balance: u.balance });
  });
});

// Games: Basketball
app.post('/api/games/basket', authMiddleware, async (req, res) => {
  const { bet } = req.body;
  const uid = req.user.id;
  if (!bet || bet <= 0) return res.status(400).json({ error: 'Bad bet' });
  await withDb(async (db) => {
    const u = db.users.find(x => x.id === uid);
    if (!u) return res.status(404).json({ error: 'User not found' });
    if (u.balance < bet) return res.status(400).json({ error: 'Not enough funds' });
    u.balance -= bet;
    u.gamesPlayed = (u.gamesPlayed || 0) + 1;
    const r = Math.random();
    let multiplier = 0;
    if (r < 0.25) multiplier = 3;
    else if (r < 0.6) multiplier = 2;
    else multiplier = 0;
    const win = Math.floor(bet * multiplier);
    if (win > 0) {
      u.balance += win;
      u.totalEarned += win;
      if (win > (u.maxWin || 0)) u.maxWin = win;
    }
    db.transactions.push({ id: uuidv4(), userId: uid, type: 'basketball', amount: win - bet, date: new Date().toISOString(), info: `Basket result x${multiplier}` });
    res.json({ multiplier, win, balance: u.balance });
  });
});

// Transactions history
app.get('/api/transactions', authMiddleware, (req, res) => {
  const uid = req.user.id;
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  const tx = db.transactions.filter(t => t.userId === uid).slice().sort((a,b)=> new Date(b.date)-new Date(a.date));
  res.json({ transactions: tx });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`1WIN server listening on port ${PORT}`);
});