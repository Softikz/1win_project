// public/app.js — улучшенная версия
// - robust token handling on boot (don't show auth if valid token present)
// - all API calls include Authorization when token available
// - styled & enhanced leaderboards
// - search UI & logic
// - statuses purchase fallback (try /api/buy-status, else bank withdraw + set-status)
// - fixed create-clan join-clan behavior and clearer errors

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const tokenKey = '1win_token';

function notify(msg, type = 'success', t = 4000) {
  const n = $('#notify');
  if (!n) { console[type === 'success' ? 'log' : 'error'](msg); return; }
  n.textContent = msg;
  n.className = 'notify ' + (type === 'success' ? 'success' : 'error');
  n.classList.remove('hidden');
  clearTimeout(n._hideTimeout);
  n._hideTimeout = setTimeout(() => n.classList.add('hidden'), t);
}

function setToken(token) {
  if (token) localStorage.setItem(tokenKey, token);
  else localStorage.removeItem(tokenKey);
}
function getToken() { return localStorage.getItem(tokenKey); }
function authHeaders() { const t = getToken(); return t ? { Authorization: 'Bearer ' + t } : {}; }
function formatMoney(n) { if (typeof n !== 'number') n = Number(n) || 0; return n.toLocaleString('ru-RU') + '$'; }
function escapeHtml(s){ if (s===null||s===undefined) return ''; return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function showView(id){ document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden')); const el = document.getElementById(id); if (el) el.classList.remove('hidden'); }

/* ---------------- AUTH (register/login) ---------------- */
function setupAuthUI() {
  const tabReg = $('#tab-register'), tabLog = $('#tab-login');
  const formReg = $('#form-register'), formLog = $('#form-login');

  function showReg(on) {
    if (on) { tabReg.classList.add('active'); tabLog.classList.remove('active'); formReg.classList.remove('hidden'); formLog.classList.add('hidden'); }
    else { tabReg.classList.remove('active'); tabLog.classList.add('active'); formReg.classList.add('hidden'); formLog.classList.remove('hidden'); }
  }

  tabReg?.addEventListener('click', ()=> showReg(true));
  tabLog?.addEventListener('click', ()=> showReg(false));
  $('#go-login')?.addEventListener('click', e => { e.preventDefault(); showReg(false); });
  $('#go-register')?.addEventListener('click', e => { e.preventDefault(); showReg(true); });

  // registration validation
  const regNick = $('#reg-nick'), regEmail = $('#reg-email'), regPass = $('#reg-pass'), regPass2 = $('#reg-pass2'), btnReg = $('#btn-register');
  function validateReg() {
    let ok = true;
    if (!regNick.value || regNick.value.trim().length < 3) ok = false;
    if (!/^\S+@\S+\.\S+$/.test(regEmail.value)) ok = false;
    if (!regPass.value || regPass.value.length < 6) ok = false;
    if (regPass2.value !== regPass.value) ok = false;
    if (btnReg) btnReg.disabled = !ok;
  }
  [regNick, regEmail, regPass, regPass2].forEach(i => i?.addEventListener('input', validateReg));

  btnReg?.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/register', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({
        nickname: regNick.value.trim(), email: regEmail.value.trim(), password: regPass.value
      })});
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Ошибка регистрации');
      notify('Регистрация успешна. Войдите в аккаунт', 'success');
      showReg(false);
    } catch (err) {
      console.error('register', err);
      notify(err.message || 'Ошибка регистрации', 'error');
    }
  });

  // login
  $('#btn-login')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const id = $('#login-id').value.trim(); const pw = $('#login-pass').value;
    if (!id || !pw) return notify('Введите логин и пароль', 'error');
    try {
      const res = await fetch('/api/login', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ nicknameOrEmail: id, password: pw })});
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Ошибка входа');
      if (!j.token) throw new Error('No token received');
      setToken(j.token);
      await enterApp(j.token);
    } catch (err) {
      console.error('login', err);
      notify(err.message || 'Ошибка входа', 'error');
    }
  });
}

/* ---------------- BOOT / TOKEN check ---------------- */
let currentUser = null;

async function tryValidateToken(token) {
  // returns profile or null
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1] || '""'));
    if (!payload || !payload.id) return null;
    const r = await fetch('/api/profile/' + payload.id, { headers: { Authorization: 'Bearer ' + token }});
    if (!r.ok) return null;
    const j = await r.json();
    return j.profile || null;
  } catch (err) {
    console.error('validate token error', err);
    return null;
  }
}

async function boot() {
  setupAuthUI();
  bindNavigation();
  bindGames();
  bindBank();
  bindSearch();

  // Don't immediately show auth-stage; first try token auto-login.
  const tk = getToken();
  if (tk) {
    const profile = await tryValidateToken(tk);
    if (profile) {
      // valid token: set currentUser and enter app
      currentUser = profile;
      // call enterApp with current token (enterApp will fetch profile again and setup UI)
      await enterApp(tk);
      return;
    } else {
      // invalid token -> remove it and show auth
      setToken(null);
    }
  }

  // no token -> show auth stage after logo animation
  setTimeout(()=> { $('#auth-stage')?.classList.remove('hidden'); }, 900);
}
document.addEventListener('DOMContentLoaded', boot);

/* ---------------- ENTER APP ---------------- */
async function enterApp(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1] || '""'));
    if (!payload || !payload.id) throw new Error('Invalid token');
    const r = await fetch('/api/profile/' + payload.id, { headers: authHeaders() });
    if (!r.ok) throw new Error('Не удалось загрузить профиль');
    const j = await r.json();
    currentUser = j.profile;

    // UI switch
    $('#hero')?.classList.add('hidden');
    $('#app')?.classList.remove('hidden');
    $('#user-nick').textContent = currentUser.nickname;
    $('#user-balance').textContent = formatMoney(currentUser.balance);
    $('#user-summary')?.classList.remove('hidden');
    if (currentUser.status === 'Админ') $('#btn-admin-panel').classList.remove('hidden'); else $('#btn-admin-panel').classList.add('hidden');

    // load main view
    const first = document.querySelector('.nav-item[data-view="menu"]');
    if (first) { $$('.nav-item').forEach(n=>n.classList.remove('active')); first.classList.add('active'); }
    showView('view-menu');

    // setup admin & initial loads
    setupAdmin();
    loadProfile(); // own profile to set bonus button state
  } catch (err) {
    console.error('enterApp', err);
    setToken(null);
    notify('Не удалось войти по токену', 'error');
    $('#auth-stage')?.classList.remove('hidden');
  }
}

/* ---------------- NAVIGATION ---------------- */
function bindNavigation(){
  $$('.nav-item').forEach(item=>{
    item.onclick = () => {
      $$('.nav-item').forEach(n=>n.classList.remove('active'));
      item.classList.add('active');
      const v = item.dataset.view;
      showView('view-' + v);
      if (v === 'profile') loadProfile();
      if (v === 'clans') loadClans();
      if (v === 'leaders') loadLeaders();
      if (v === 'statuses') loadStatuses();
    };
  });

  $$('.menu-card, .btn.big').forEach(el => {
    el.addEventListener('click', ev=>{
      const t = ev.currentTarget.dataset.view;
      if (t) {
        const nav = document.querySelector('.nav-item[data-view="'+t+'"]');
        if (nav) nav.click(); else showView('view-'+t);
      }
    });
  });

  $('#btn-logout')?.addEventListener('click', ()=> {
    setToken(null);
    location.reload();
  });
}

/* ---------------- PROFILE & BONUS ---------------- */
async function loadProfile(viewingProfile = null) {
  try {
    if (viewingProfile) { fillProfile(viewingProfile, false); return; }
    const tk = getToken(); if (!tk) return;
    const payload = JSON.parse(atob(tk.split('.')[1] || '""'));
    const r = await fetch('/api/profile/' + payload.id, { headers: authHeaders() });
    if (!r.ok) return;
    const j = await r.json();
    currentUser = j.profile;
    fillProfile(currentUser, true);
  } catch (err) { console.error('loadProfile', err); }
}

function fillProfile(userObj, isOwn) {
  $('#p-nick').textContent = userObj.nickname;
  $('#p-balance').textContent = formatMoney(userObj.balance);
  $('#p-registered').textContent = new Date(userObj.registrationDate).toLocaleString();
  $('#p-account').textContent = userObj.bankAccountNumber;
  $('#p-bank').textContent = formatMoney(userObj.bankBalance);
  $('#p-earned').textContent = formatMoney(userObj.totalEarned);
  $('#p-clan').textContent = userObj.clanId || 'Нет';
  $('#p-status').textContent = userObj.status || '—';
  $('#p-played').textContent = userObj.gamesPlayed || 0;
  $('#p-maxwin').textContent = formatMoney(userObj.maxWin || 0);

  const btn = $('#btn-bonus');
  const timerEl = $('#bonus-timer');
  if (!btn) return;
  if (!isOwn) { btn.style.display = 'none'; if (timerEl) timerEl.textContent = ''; return; }
  btn.style.display = '';

  // bonus timing
  if (!userObj.lastBonusClaim) { btn.disabled = false; if (timerEl) timerEl.textContent = ''; }
  else {
    const last = new Date(userObj.lastBonusClaim);
    const next = new Date(last.getTime() + 24*3600*1000);
    const now = new Date();
    if (now >= next) { btn.disabled = false; if (timerEl) timerEl.textContent = ''; }
    else {
      btn.disabled = true;
      if (timerEl) {
        if (window._bonusTimer) clearInterval(window._bonusTimer);
        function tick() {
          const rem = Math.max(0, Math.ceil((next - new Date())/1000));
          const h = Math.floor(rem/3600), m = Math.floor((rem%3600)/60), s = rem%60;
          timerEl.textContent = `Доступен через ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
          if (rem <= 0) { btn.disabled = false; timerEl.textContent = ''; clearInterval(window._bonusTimer); }
        }
        tick();
        window._bonusTimer = setInterval(tick, 1000);
      }
    }
  }

  btn.onclick = async () => {
    btn.disabled = true;
    try {
      const r = await fetch('/api/bonus', { method:'POST', headers: { ...authHeaders(), 'Content-Type':'application/json' } });
      const jr = await r.json();
      if (!r.ok) {
        notify(jr.error || 'Бонус недоступен', 'error');
        await loadProfile();
        return;
      }
      notify(`Бонус ${jr.amount}$ зачислен`, 'success');
      await loadProfile();
    } catch (err) {
      console.error('bonus', err);
      notify('Ошибка при получении бонуса', 'error');
      await loadProfile();
    }
  };
}

/* ---------------- LEADERS (players & clans) ---------------- */
async function loadLeaders(){
  const playersContainer = $('#leaders-players'), clansContainer = $('#leaders-clans');
  if (!playersContainer || !clansContainer) return;
  // tabs
  if (!$('#leaders-tabs')) {
    const tabs = document.createElement('div'); tabs.id='leaders-tabs'; tabs.className='leaders-tabs';
    tabs.innerHTML = `<button id="tab-players" class="tab active">Игроки</button><button id="tab-clans" class="tab">Кланы</button>`;
    playersContainer.parentNode.insertBefore(tabs, playersContainer);
    $('#tab-players').addEventListener('click', ()=> { $('#tab-players').classList.add('active'); $('#tab-clans').classList.remove('active'); playersContainer.classList.remove('hidden'); clansContainer.classList.add('hidden'); });
    $('#tab-clans').addEventListener('click', ()=> { $('#tab-clans').classList.add('active'); $('#tab-players').classList.remove('active'); clansContainer.classList.remove('hidden'); playersContainer.classList.add('hidden'); });
  }

  playersContainer.innerHTML = ''; clansContainer.innerHTML = '';
  try {
    const r = await fetch('/api/leaderboard');
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Ошибка загрузки');

    const players = j.players || [];
    const pTable = document.createElement('table'); pTable.className='leader-table enhanced';
    pTable.innerHTML = `<thead><tr><th>№</th><th>Никнейм</th><th>Статус</th><th>Баланс</th></tr></thead><tbody></tbody>`;
    const pBody = pTable.querySelector('tbody');
    players.forEach(pl => {
      const vip = pl.vip ? '<span class="vip-badge" title="VIP">🌈</span>' : '';
      const isAdmin = (pl.status || '').toLowerCase() === 'админ';
      const statusHtml = isAdmin ? `<span class="status-admin">Админ</span>` : escapeHtml(pl.status || '');
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="col-rank">${pl.rank}</td>
        <td class="col-nick">${vip}<a href="#" class="player-link" data-id="${pl.id}">${escapeHtml(pl.nickname)}</a></td>
        <td class="col-status">${statusHtml}</td>
        <td class="col-balance balance-green">${formatMoney(pl.balance)}</td>`;
      pBody.appendChild(tr);
    });
    playersContainer.appendChild(pTable);

    const clans = j.clans || [];
    const cTable = document.createElement('table'); cTable.className='leader-table enhanced';
    cTable.innerHTML = `<thead><tr><th>№</th><th>Клан</th><th>Казна</th><th>Участников</th></tr></thead><tbody></tbody>`;
    const cBody = cTable.querySelector('tbody');
    clans.forEach(cn => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="col-rank">${cn.rank}</td>
        <td class="col-clan"><a href="#" class="clan-link" data-id="${cn.id}">${escapeHtml(cn.name)}</a></td>
        <td class="col-treasury balance-green">${formatMoney(cn.treasury)}</td>
        <td class="col-members">${cn.members}</td>`;
      cBody.appendChild(tr);
    });
    clansContainer.appendChild(cTable);

    // links
    $$('.player-link').forEach(a => a.addEventListener('click', async e=>{
      e.preventDefault(); const id = a.dataset.id;
      try { const r2 = await fetch('/api/profile/' + id); const j2 = await r2.json(); if (j2.profile) { showView('view-profile'); loadProfile(j2.profile); } } catch (err) { console.error(err); }
    }));
    $$('.clan-link').forEach(a => a.addEventListener('click', e=> { e.preventDefault(); const nav = document.querySelector('.nav-item[data-view="clans"]'); if (nav) nav.click(); }));

    playersContainer.classList.remove('hidden'); clansContainer.classList.add('hidden');
  } catch (err) {
    console.error('loadLeaders', err);
    playersContainer.innerHTML = '<div class="card">Не удалось загрузить таблицу лидеров.</div>';
  }
}

/* ---------------- CLANS (load/create/join/chat) ---------------- */
async function loadClans(){
  const listEl = $('#clan-list'), myArea = $('#my-clan-area'), joinArea = $('#clan-join-area');
  if (!listEl) return;
  listEl.innerHTML = '';
  try {
    const r = await fetch('/api/clans');
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Ошибка загрузки кланов');
    const clans = Array.isArray(j.clans) ? j.clans : [];

    clans.forEach(c => {
      const d = document.createElement('div'); d.className='card clan-item'; d.style.margin='8px 0';
      d.innerHTML = `<b>${escapeHtml(c.name)}</b><div class="muted" style="margin-top:6px">${escapeHtml(c.description||'')}</div><div style="margin-top:8px">Казна: ${formatMoney(c.treasury)} — Участников: ${c.members}</div><div style="margin-top:8px"><button class="btn small join-clan" data-id="${c.id}">Вступить</button></div>`;
      listEl.appendChild(d);
    });

    // join handlers
    Array.from(listEl.querySelectorAll('.join-clan')).forEach(btn => {
      btn.onclick = async () => {
        const clanId = btn.dataset.id;
        try {
          const rr = await fetch('/api/join-clan', { method:'POST', headers:{ 'Content-Type':'application/json', ...authHeaders() }, body: JSON.stringify({ clanId })});
          const jb = await rr.json();
          if (!rr.ok) throw new Error(jb.error || 'Ошибка вступления');
          notify('Вы вступили в клан', 'success');
          await loadClans();
        } catch (err) { console.error('join-clan', err); notify(err.message || 'Ошибка вступления', 'error'); }
      };
    });

    $('#btn-create-clan')?.addEventListener('click', async ()=>{
      const name = prompt('Название клана (создание стоит 50 000$)');
      if (!name) return;
      try {
        const rr = await fetch('/api/create-clan', { method:'POST', headers:{ 'Content-Type':'application/json', ...authHeaders() }, body: JSON.stringify({ name, description:'' })});
        const jb = await rr.json();
        if (!rr.ok) throw new Error(jb.error || 'Ошибка создания клана');
        notify('Клан создан', 'success');
        await loadClans();
      } catch (err) { console.error('create-clan', err); notify(err.message || 'Ошибка создания клана', 'error'); }
    });

    // my clan area
    const tk = getToken();
    if (tk) {
      const payload = JSON.parse(atob(tk.split('.')[1] || '""'));
      const pid = payload.id;
      try {
        const pr = await fetch('/api/profile/' + pid, { headers: authHeaders() });
        if (pr.ok) {
          const pj = await pr.json();
          const profile = pj.profile;
          if (profile && profile.clanId) {
            joinArea?.classList.add('hidden'); myArea?.classList.remove('hidden');
            const myClan = clans.find(x => x.id === profile.clanId);
            if (myClan) {
              $('#my-clan-name').textContent = myClan.name;
              $('#my-clan-desc').textContent = myClan.description || '';
              $('#my-clan-treasury').textContent = myClan.treasury;
            }
            // chat poll
            if (window._clanPoll) clearInterval(window._clanPoll);
            window._clanPoll = setInterval(async ()=>{
              try {
                const msgsR = await fetch('/api/clan/' + profile.clanId + '/messages', { headers: authHeaders() });
                if (!msgsR.ok) return;
                const msgsJ = await msgsR.json();
                const cw = $('#clan-chat'); if (!cw) return;
                cw.innerHTML = '';
                (msgsJ.messages || []).forEach(m => {
                  const line = document.createElement('div'); line.className = 'chat-line' + (m.system ? ' system': '');
                  line.innerHTML = `<b>${escapeHtml(m.nickname)}</b> <small class="muted">${new Date(m.date).toLocaleTimeString()}</small><div>${escapeHtml(m.text)}</div>`;
                  cw.appendChild(line);
                });
                cw.scrollTop = cw.scrollHeight;
              } catch (err) { /* ignore */ }
            }, 3000);
          } else {
            joinArea?.classList.remove('hidden'); myArea?.classList.add('hidden');
          }
        }
      } catch (err) { console.error('profile in loadClans', err); }
    }

  } catch (err) {
    console.error('loadClans', err);
    listEl.innerHTML = '<div class="card">Не удалось загрузить кланы.</div>';
    notify('Ошибка загрузки кланов', 'error');
  }
}

/* ---------------- STATUSES (list + buy + set) ---------------- */
async function loadStatuses(){
  const container = $('#statuses-list');
  if (!container) return;
  container.innerHTML = '';

  // try server endpoint first
  let statuses = null;
  try {
    const r = await fetch('/api/statuses');
    if (r.ok) {
      const j = await r.json();
      if (Array.isArray(j.statuses)) statuses = j.statuses;
    }
  } catch (err) { /* ignore */ }

  if (!statuses) {
    // fallback list of statuses (more items)
    statuses = [
      { id:'s1', name:'Новичок', desc:'Статус по умолчанию', price:0, achievement:false },
      { id:'s2', name:'Олд', desc:'За регистрацию >1 года', price:0, achievement:true },
      { id:'s3', name:'Про', desc:'Платный статус (лучше бонусы)', price:50000, achievement:false },
      { id:'s4', name:'Легенда', desc:'Платный статус (особые значки)', price:250000, achievement:false },
      { id:'s5', name:'Премиум', desc:'Особые возможности', price:100000, achievement:false },
      { id:'s6', name:'Элита', desc:'VIP преимущества', price:500000, achievement:false }
    ];
  }

  // get current profile to determine owned statuses
  let profile = null;
  if (getToken()) {
    try {
      const payload = JSON.parse(atob(getToken().split('.')[1] || '""'));
      const r = await fetch('/api/profile/' + payload.id, { headers: authHeaders() });
      if (r.ok) { const j = await r.json(); profile = j.profile; }
    } catch (err) { /* ignore */ }
  }

  statuses.forEach(s => {
    const owned = profile && profile.purchasedStatuses && profile.purchasedStatuses.includes(s.id);
    const achievementReady = s.achievement && checkAchievement(s, profile);
    const card = document.createElement('div'); card.className = 'card status-card'; card.style.margin = '8px 0';
    let rightHtml = '';
    if (owned) rightHtml = `<button class="btn small choose-status" data-id="${s.id}">Выбрать</button>`;
    else if (s.achievement && achievementReady) rightHtml = `<button class="btn small buy-status" data-id="${s.id}" data-price="${s.price}">Получить</button>`;
    else if (s.price && s.price > 0) rightHtml = `<button class="btn small buy-status" data-id="${s.id}" data-price="${s.price}">Купить ${formatMoney(s.price)}</button>`;
    else rightHtml = `<button class="btn small buy-status" disabled>Недоступно</button>`;

    card.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center">
      <div><b>${escapeHtml(s.name)}</b><div class="muted" style="font-size:13px">${escapeHtml(s.desc)}</div></div>
      <div>${rightHtml}</div>
    </div>`;
    container.appendChild(card);

    // hover animation: add class for CSS (styles.css contains hover)
    card.classList.add('status-hover');

    const buyBtn = card.querySelector('.buy-status');
    if (buyBtn) buyBtn.onclick = async () => {
      const sid = buyBtn.dataset.id; const price = Number(buyBtn.dataset.price || 0);
      // try server buy-status first
      try {
        const rr = await fetch('/api/buy-status', { method:'POST', headers:{ ...authHeaders(), 'Content-Type':'application/json' }, body: JSON.stringify({ statusId: sid }) });
        const jb = await rr.json();
        if (!rr.ok) throw new Error(jb.error || 'Ошибка покупки');
        notify('Статус приобретён', 'success');
        await loadStatuses(); await loadProfile();
        return;
      } catch (err) {
        // fallback: try withdraw from bank then set-status
        console.warn('buy-status not supported on server, fallback', err);
        if (!getToken()) { notify('Для покупки требуется вход', 'error'); return; }
        if (!confirm(`Сервер не поддерживает прямую покупку. Попробовать снять ${formatMoney(price)} с баланса и установить статус?`)) return;
        try {
          const w = await fetch('/api/bank/withdraw', { method:'POST', headers:{ ...authHeaders(), 'Content-Type':'application/json' }, body: JSON.stringify({ amount: price }) });
          const jw = await w.json();
          if (!w.ok) throw new Error(jw.error || 'Ошибка списания');
          // now ask server to set status (may or may not exist)
          try {
            const sset = await fetch('/api/set-status', { method:'POST', headers:{ ...authHeaders(), 'Content-Type':'application/json' }, body: JSON.stringify({ statusId: sid }) });
            const js = await sset.json();
            if (!sset.ok) throw new Error(js.error || 'Ошибка установки статуса (сервер не поддерживает)');
            notify('Статус приобретён и установлен', 'success');
            await loadStatuses(); await loadProfile();
            return;
          } catch (err2) {
            // server doesn't support set-status; still balance changed — show info
            notify('Списание выполнено, но сервер не поддерживает установку статуса. Обновите профиль позже.', 'success', 7000);
            await loadProfile();
            return;
          }
        } catch (errw) {
          console.error('withdraw fallback error', errw);
          notify(errw.message || 'Ошибка покупки статуса', 'error');
        }
      }
    };

    const chooseBtn = card.querySelector('.choose-status');
    if (chooseBtn) chooseBtn.onclick = async () => {
      const sid = chooseBtn.dataset.id;
      try {
        const r = await fetch('/api/set-status', { method:'POST', headers:{ ...authHeaders(), 'Content-Type':'application/json' }, body: JSON.stringify({ statusId: sid }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Ошибка выбора');
        notify('Статус выбран', 'success');
        await loadProfile(); await loadStatuses();
      } catch (err) {
        console.error('set-status', err); notify(err.message || 'Ошибка выбора статуса', 'error');
      }
    };
  });
}

function checkAchievement(status, user) {
  if (!user) return false;
  if (status.id === 's2') {
    const reg = new Date(user.registrationDate);
    return (new Date() - reg) >= 365*24*3600*1000;
  }
  return false;
}

/* ---------------- GAMES ---------------- */
function bindGames(){
  $('#btn-spin')?.addEventListener('click', async ()=>{
    const bet = Number($('#slot-bet').value);
    if (!bet) return notify('Введите ставку', 'error');
    if (!getToken()) return notify('No token — войдите', 'error');
    try {
      const r = await fetch('/api/games/slots', { method:'POST', headers:{ ...authHeaders(), 'Content-Type':'application/json' }, body: JSON.stringify({ bet })});
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Ошибка');
      $('#reel1').textContent = j.symbols[0]; $('#reel2').textContent = j.symbols[1]; $('#reel3').textContent = j.symbols[2];
      $('#slot-result').textContent = `Выигрыш: ${j.win}$`;
      notify('Результат: ' + j.win + '$', 'success');
      await loadProfile();
    } catch (err) { console.error('spin', err); notify(err.message || 'Ошибка игры', 'error'); }
  });

  $('#btn-launch')?.addEventListener('click', async ()=>{
    const bet = Number($('#rocket-bet').value);
    if (!bet) return notify('Введите ставку', 'error');
    if (!getToken()) return notify('No token — войдите', 'error');
    try {
      const r = await fetch('/api/games/rocket', { method:'POST', headers:{ ...authHeaders(), 'Content-Type':'application/json' }, body: JSON.stringify({ bet })});
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Ошибка');
      $('#rocket-result').textContent = `Краш ${j.crash}x, выигрыш ${j.win}$`;
      notify('Ракета: ' + j.win + '$', 'success');
      await loadProfile();
    } catch (err) { console.error('rocket', err); notify(err.message || 'Ошибка игры', 'error'); }
  });

  $('#btn-throw')?.addEventListener('click', async ()=>{
    const bet = Number($('#basket-bet').value);
    if (!bet) return notify('Введите ставку', 'error');
    if (!getToken()) return notify('No token — войдите', 'error');
    try {
      const r = await fetch('/api/games/basket', { method:'POST', headers:{ ...authHeaders(), 'Content-Type':'application/json' }, body: JSON.stringify({ bet })});
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Ошибка');
      $('#basket-result').textContent = j.multiplier ? `Выигрыш: ${j.win}$ (x${j.multiplier})` : 'Промах';
      notify(j.win ? `Вы выиграли ${j.win}$` : 'Промах', j.win ? 'success' : 'error');
      await loadProfile();
    } catch (err) { console.error('basket', err); notify(err.message || 'Ошибка игры', 'error'); }
  });
}

/* ---------------- BANK ---------------- */
function bindBank(){
  $('#btn-deposit')?.addEventListener('click', async ()=>{
    const amount = Number($('#bank-amount').value);
    if (!amount) return notify('Введите сумму', 'error');
    try {
      const r = await fetch('/api/bank/deposit', { method:'POST', headers:{ ...authHeaders(), 'Content-Type':'application/json' }, body: JSON.stringify({ amount })});
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Ошибка');
      notify('Пополнение выполнено', 'success'); await loadProfile();
    } catch (err) { console.error('deposit', err); notify(err.message || 'Ошибка', 'error'); }
  });
  $('#btn-withdraw')?.addEventListener('click', async ()=>{
    const amount = Number($('#bank-amount').value);
    if (!amount) return notify('Введите сумму', 'error');
    try {
      const r = await fetch('/api/bank/withdraw', { method:'POST', headers:{ ...authHeaders(), 'Content-Type':'application/json' }, body: JSON.stringify({ amount })});
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Ошибка');
      notify('Вывод выполнен', 'success'); await loadProfile();
    } catch (err) { console.error('withdraw', err); notify(err.message || 'Ошибка', 'error'); }
  });
  $('#btn-transfer')?.addEventListener('click', async ()=>{
    const to = $('#bank-transfer-to').value.trim(); const amount = Number($('#bank-amount').value);
    if (!to || !amount) return notify('Введите данные', 'error');
    try {
      const r = await fetch('/api/bank/transfer', { method:'POST', headers:{ ...authHeaders(), 'Content-Type':'application/json' }, body: JSON.stringify({ toAccount: to, amount })});
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Ошибка');
      notify('Перевод выполнен', 'success'); await loadProfile();
    } catch (err) { console.error('transfer', err); notify(err.message || 'Ошибка', 'error'); }
  });
}

/* ---------------- SEARCH (players) - styled input ---------------- */
function bindSearch(){
  // search control is present in index.html; create nicer search UI behavior
  const searchInput = $('#search-player');
  const btn = $('#btn-search-player');
  if (!searchInput || !btn) return;

  async function doSearch() {
    const q = searchInput.value.trim();
    const out = $('#search-results');
    out.innerHTML = '';
    if (!q) { out.innerHTML = '<div class="muted">Введите никнейм для поиска</div>'; return; }
    try {
      const r = await fetch('/api/search-user?q=' + encodeURIComponent(q));
      if (!r.ok) {
        const jb = await r.json().catch(()=>({}));
        notify(jb.error || 'Ошибка поиска', 'error'); return;
      }
      const j = await r.json();
      const results = j.results || [];
      if (!results.length) { out.innerHTML = '<div class="muted">Ничего не найдено</div>'; return; }
      results.forEach(u => {
        const d = document.createElement('div'); d.className='card'; d.style.margin='8px 0';
        d.innerHTML = `<b>${escapeHtml(u.nickname)}</b> — <span class="balance-green">${formatMoney(u.balance)}</span> <button class="btn small view-player" data-id="${u.id}">Открыть</button>`;
        out.appendChild(d);
      });
      $$('.view-player').forEach(b => b.onclick = async ()=>{
        const id = b.dataset.id;
        const r2 = await fetch('/api/profile/' + id);
        const jp = await r2.json();
        if (jp.profile) { showView('view-profile'); loadProfile(jp.profile); }
      });
    } catch (err) {
      console.error('search', err);
      notify('Ошибка поиска', 'error');
    }
  }

  btn.addEventListener('click', doSearch);
  // support Enter key
  searchInput.addEventListener('keydown', (e)=> { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
}

/* ---------------- ADMIN ---------------- */
function setupAdmin(){
  const tk = getToken(); if (!tk) return;
  $('#btn-admin-panel').onclick = ()=> $('#admin-modal').classList.remove('hidden');
  $('#btn-close-admin').onclick = ()=> $('#admin-modal').classList.add('hidden');

  $('#btn-toggle-admin-mode').onclick = async ()=>{
    try {
      const r = await fetch('/api/admin/toggle-mode', { method:'POST', headers: authHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Ошибка');
      notify('Режим админа переключён', 'success'); updateAdminUI();
    } catch (err) { console.error('toggle-mode', err); notify(err.message || 'Ошибка', 'error'); }
  };

  $('#btn-predict').onclick = async ()=>{
    try {
      const r = await fetch('/api/admin/predict', { headers: authHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Ошибка');
      $('#predict-result').textContent = `Прогноз: ${j.prediction} (доверие ${j.confidence}%)`;
    } catch (err) { console.error('predict', err); notify(err.message || 'Ошибка', 'error'); }
  };

  $('#btn-grant').onclick = async ()=>{
    try {
      const amount = Number($('#admin-grant-amount').value || 0);
      if (!amount) return notify('Введите сумму', 'error');
      const r = await fetch('/api/admin/grant', { method:'POST', headers:{ ...authHeaders(), 'Content-Type':'application/json' }, body: JSON.stringify({ amount })});
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Ошибка');
      $('#grant-result').textContent = `Начислено ${amount}$. Новый баланс: ${j.newBalance}$`;
      notify('Средства начислены', 'success'); await loadProfile();
    } catch (err) { console.error('grant', err); notify(err.message || 'Ошибка', 'error'); }
  };
}

async function updateAdminUI(){
  try {
    const tk = getToken(); if (!tk) return;
    const payload = JSON.parse(atob(tk.split('.')[1] || '""'));
    const r = await fetch('/api/profile/' + payload.id, { headers: authHeaders() });
    if (!r.ok) return;
    const j = await r.json();
    $('#admin-mode-status').textContent = j.profile && j.profile.adminMode ? 'Режим: ADMIN' : 'Режим: PLAYER';
  } catch (err) { console.error('updateAdminUI', err); }
}

/* expose for debugging */
window._1win = { loadClans, loadLeaders, loadStatuses, loadProfile };

/* End of public/app.js */