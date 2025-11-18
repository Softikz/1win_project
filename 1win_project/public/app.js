// Simple SPA logic and client interactions (complete client script)
// Note: keep this file in public/app.js

const API = '';

function el(id){ return document.getElementById(id); }
function show(selector){ document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden')); el(selector).classList.remove('hidden'); }
function notify(msg, type='success', timeout=5000){
  const n = el('notify');
  n.textContent = msg;
  n.className = 'notify ' + (type==='success'?'success':'error');
  n.classList.remove('hidden');
  setTimeout(()=>n.classList.add('hidden'), timeout);
}

document.addEventListener('DOMContentLoaded', ()=> {
  const token = localStorage.getItem('1win_token');
  if (token) {
    initAfterLogin(token);
  } else {
    setTimeout(()=> {
      el('auth-block').classList.remove('hidden');
      el('register-form').classList.remove('hidden');
    }, 600);
  }
  setupAuth();
  setupMenu();
});

function setupAuth(){
  const regNick = el('reg-nick'), regEmail = el('reg-email'), regPass = el('reg-pass'), regPass2 = el('reg-pass2'), btnReg = el('btn-register');
  function checkReg(){
    let ok = true;
    if (!regNick.value || regNick.value.length < 3) { el('reg-nick-hint').textContent = 'Минимум 3 символа'; ok = false; } else el('reg-nick-hint').textContent = '';
    if (!/^\S+@\S+\.\S+$/.test(regEmail.value)) { el('reg-email-hint').textContent = 'Некорректная почта'; ok = false; } else el('reg-email-hint').textContent = '';
    if (regPass.value.length < 6) { el('reg-pass-hint').textContent = 'Минимум 6 символов'; ok = false; } else el('reg-pass-hint').textContent = '';
    if (regPass2.value !== regPass.value) { el('reg-pass2-hint').textContent = 'Пароли не совпадают'; ok = false; } else el('reg-pass2-hint').textContent = '';
    btnReg.disabled = !ok;
  }
  [regNick,regEmail,regPass,regPass2].forEach(i=> i.addEventListener('input', checkReg));
  document.getElementById('show-login').addEventListener('click', (e)=>{ e.preventDefault(); el('register-form').classList.add('hidden'); el('login-form').classList.remove('hidden'); });
  document.getElementById('show-register').addEventListener('click', (e)=>{ e.preventDefault(); el('login-form').classList.add('hidden'); el('register-form').classList.remove('hidden'); });

  btnReg.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({
        nickname: regNick.value, email: regEmail.value, password: regPass.value
      })});
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Ошибка регистрации');
      notify('Вы зарегистрированы, теперь войдите в аккаунт', 'success', 5000);
      el('register-form').classList.add('hidden');
      el('login-form').classList.remove('hidden');
    } catch (err) {
      notify(err.message || 'Ошибка', 'error', 5000);
    }
  });

  el('btn-login').addEventListener('click', async (e) => {
    e.preventDefault();
    const id = el('login-id').value;
    const pw = el('login-pass').value;
    try {
      const res = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ nicknameOrEmail: id, password: pw })});
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Ошибка входа');
      localStorage.setItem('1win_token', j.token);
      initAfterLogin(j.token);
    } catch (err) {
      notify(err.message || 'Ошибка', 'error', 5000);
    }
  });
}

function setupMenu(){
  document.querySelectorAll('.menu-item').forEach(mi => {
    mi.addEventListener('click', () => {
      const view = 'view-' + mi.dataset.view;
      document.querySelectorAll('.menu-item').forEach(m=>m.classList.remove('active'));
      mi.classList.add('active');
      show(view);
      if (mi.dataset.view === 'profile') loadProfile();
      if (mi.dataset.view === 'leaders') loadLeaders();
      if (mi.dataset.view === 'clans') loadClans();
      if (mi.dataset.view === 'games') setupGames();
      if (mi.dataset.view === 'bank') loadBank();
      if (mi.dataset.view === 'players') setupPlayers();
    });
  });
  el('btn-logout').addEventListener('click', () => {
    localStorage.removeItem('1win_token');
    location.reload();
  });
}

let currentUser = null;

async function initAfterLogin(token){
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const uid = payload.id;
    const p = await fetch('/api/profile/' + uid, { headers: { Authorization: 'Bearer ' + token } });
    if (!p.ok) throw new Error('Auth failed');
    const jp = await p.json();
    currentUser = jp.profile;
    el('user-nick').textContent = currentUser.nickname;
    document.querySelector('main').classList.remove('hidden');
    document.getElementById('loading-screen').classList.add('hidden');
    document.querySelectorAll('.menu-item')[0].click();
    if (currentUser.status === 'Админ') {
      el('btn-admin-panel').classList.remove('hidden');
      setupAdminPanel();
    } else {
      el('btn-admin-panel').classList.add('hidden');
    }
  } catch (err) {
    console.error(err);
    localStorage.removeItem('1win_token');
    location.reload();
  }
}

async function loadProfile(){
  const token = localStorage.getItem('1win_token');
  if (!token) return;
  const payload = JSON.parse(atob(token.split('.')[1]));
  const p = await fetch('/api/profile/' + payload.id, { headers: { Authorization: 'Bearer ' + token }});
  if (!p.ok) return;
  const j = await p.json();
  currentUser = j.profile;
  el('p-nick').textContent = currentUser.nickname;
  el('p-balance').textContent = currentUser.balance;
  el('p-registered').textContent = new Date(currentUser.registrationDate).toLocaleString();
  el('p-account').textContent = currentUser.bankAccountNumber;
  el('p-bank').textContent = currentUser.bankBalance;
  el('p-earned').textContent = currentUser.totalEarned;
  el('p-clan').textContent = currentUser.clanId || 'Нет';
  el('p-played').textContent = currentUser.gamesPlayed;
  el('p-maxwin').textContent = currentUser.maxWin;
  el('btn-bonus').onclick = async () => {
    try {
      const r = await fetch('/api/bonus', { method:'POST', headers: { 'Content-Type':'application/json', Authorization: 'Bearer ' + token }});
      const jr = await r.json();
      if (!r.ok) throw new Error(jr.error || 'Ошибка');
      notify(`Вы получили бонус ${jr.amount}$`, 'success');
      loadProfile();
    } catch (err) {
      if (err.message.includes('Too early')) {
        notify('Бонус еще недоступен', 'error', 4000);
      } else notify(err.message || 'Ошибка', 'error', 3000);
    }
  };
}

async function loadLeaders(){
  const r = await fetch('/api/leaderboard');
  const j = await r.json();
  const p = el('leaders-players'); p.innerHTML = '';
  j.players.slice(0,50).forEach(pl => {
    const div = document.createElement('div'); div.className='card'; div.style.margin='8px 0';
    div.innerHTML = `${pl.rank}. ${pl.nickname} ${pl.vip?'<span style="color:gold">★</span>':''} — ${pl.status} — ${pl.balance}$`;
    p.appendChild(div);
  });
  const c = el('leaders-clans'); c.innerHTML='';
  j.clans.slice(0,50).forEach(cl => {
    const d = document.createElement('div'); d.className='card'; d.style.margin='8px 0';
    d.innerHTML = `${cl.rank}. ${cl.name} — Казна: ${cl.treasury}$ — Участников: ${cl.members}`;
    c.appendChild(d);
  });
}

async function loadClans(){
  const token = localStorage.getItem('1win_token');
  const r = await fetch('/api/clans');
  const j = await r.json();
  const list = el('clan-list'); list.innerHTML='';
  j.clans.forEach(cl => {
    const d = document.createElement('div'); d.className='card'; d.style.margin='6px 0';
    d.innerHTML = `<b>${cl.name}</b> — ${cl.description || ''} <div>Казна: ${cl.treasury}$ — Участников: ${cl.members}</div><button class="btn join-clan" data-clan="${cl.id}">Вступить</button>`;
    list.appendChild(d);
  });
  document.querySelectorAll('.join-clan').forEach(btn => btn.addEventListener('click', async (e) => {
    const id = btn.dataset.clan;
    try {
      const res = await fetch('/api/join-clan', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ clanId: id })});
      const js = await res.json();
      if (!res.ok) throw new Error(js.error || 'Ошибка');
      notify('Вступление успешно', 'success');
      loadClans();
    } catch (err) { notify(err.message || 'Ошибка', 'error'); }
  }));
  el('btn-create-clan').onclick = async () => {
    const name = prompt('Название клана');
    if (!name) return;
    try {
      const res = await fetch('/api/create-clan', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ name, description: '' })});
      const js = await res.json();
      if (!res.ok) throw new Error(js.error || 'Ошибка');
      notify('Клан создан', 'success');
      loadClans();
    } catch (err) { notify(err.message || 'Ошибка', 'error'); }
  };

  const payload = JSON.parse(atob(localStorage.getItem('1win_token').split('.')[1]));
  const p = await fetch('/api/profile/' + payload.id, { headers:{ Authorization:'Bearer ' + localStorage.getItem('1win_token') }});
  const jp = await p.json();
  if (jp.profile.clanId) {
    el('clan-join-area').classList.add('hidden');
    el('my-clan-area').classList.remove('hidden');
    const clanId = jp.profile.clanId;
    const clansRes = await fetch('/api/clans');
    const clans = await clansRes.json();
    const clan = clans.clans.find(c=>c.id===clanId);
    if (clan) {
      el('my-clan-name').textContent = clan.name;
      el('my-clan-desc').textContent = clan.description;
      el('my-clan-treasury').textContent = clan.treasury;
    }
    setInterval(async ()=> {
      const msgs = await (await fetch('/api/clan/' + clanId + '/messages', { headers:{ Authorization:'Bearer ' + localStorage.getItem('1win_token') } })).json();
      const cw = el('clan-chat'); cw.innerHTML = '';
      msgs.messages.forEach(m => {
        const line = document.createElement('div'); line.className='chat-line' + (m.system? ' system':'');
        line.innerHTML = `<b>${m.nickname}</b> <small class="muted">${new Date(m.date).toLocaleTimeString()}</small><div>${m.text}</div>`;
        cw.appendChild(line);
      });
      cw.scrollTop = cw.scrollHeight;
    }, 3000);
    el('btn-send-clan').onclick = async () => {
      const text = el('clan-msg').value;
      if (!text) return;
      await fetch('/api/clan/' + clanId + '/message', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + localStorage.getItem('1win_token') }, body: JSON.stringify({ text })});
      el('clan-msg').value = '';
    };
  } else {
    el('clan-join-area').classList.remove('hidden');
    el('my-clan-area').classList.add('hidden');
  }
}

function setupGames(){
  el('btn-spin').onclick = async () => {
    const bet = Number(el('slot-bet').value);
    if (!bet || bet <= 0) return notify('Введите ставку', 'error');
    try {
      const res = await fetch('/api/games/slots', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + localStorage.getItem('1win_token') }, body: JSON.stringify({ bet })});
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Ошибка');
      const r1 = el('reel1'), r2 = el('reel2'), r3 = el('reel3');
      r1.textContent = r2.textContent = r3.textContent = '...';
      setTimeout(()=> r1.textContent = j.symbols[0], 400);
      setTimeout(()=> r2.textContent = j.symbols[1], 800);
      setTimeout(()=> r3.textContent = j.symbols[2], 1200);
      setTimeout(()=> {
        el('slot-result').textContent = `Выигрыш: ${j.win}$ (x${j.multiplier})`;
        notify('Результат: ' + j.win + '$', 'success', 3000);
        loadProfile();
      }, 1400);
    } catch (err) { notify(err.message || 'Ошибка', 'error'); }
  };

  el('btn-launch').onclick = async () => {
    const bet = Number(el('rocket-bet').value);
    try {
      const res = await fetch('/api/games/rocket', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + localStorage.getItem('1win_token') }, body: JSON.stringify({ bet })});
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Ошибка');
      const rocket = el('rocket');
      rocket.style.transition = 'transform 2s linear';
      rocket.style.transform = 'translate(-50%, -220px)';
      setTimeout(()=> {
        el('rocket-result').textContent = `Ракета взорвалась на ${j.crash}x, вы зафиксировали ${j.cashedAt}x. Выигрыш: ${j.win}$`;
        notify('Ракета: ' + j.win + '$', 'success');
        rocket.style.transition = '';
        rocket.style.transform = 'translateX(-50%)';
        loadProfile();
      }, 2200);
    } catch (err) { notify(err.message || 'Ошибка', 'error'); }
  };

  el('btn-throw').onclick = async () => {
    const bet = Number(el('basket-bet').value);
    try {
      const res = await fetch('/api/games/basket', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + localStorage.getItem('1win_token') }, body: JSON.stringify({ bet })});
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Ошибка');
      const ball = el('ball');
      ball.style.transform = 'translateY(-60px) translateX(20px)';
      setTimeout(()=> {
        ball.style.transform = 'translateY(0) translateX(0)';
        el('basket-result').textContent = j.multiplier ? `Выигрыш: ${j.win}$ (x${j.multiplier})` : 'Промах';
        if (j.win) notify('Вы выиграли ' + j.win + '$', 'success'); else notify('Промах', 'error');
        loadProfile();
      }, 900);
    } catch (err) { notify(err.message || 'Ошибка', 'error'); }
  };
}

async function loadBank(){
  const token = localStorage.getItem('1win_token');
  const payload = JSON.parse(atob(token.split('.')[1]));
  const p = await fetch('/api/profile/' + payload.id, { headers:{ Authorization:'Bearer ' + token }});
  const jp = await p.json();
  el('bank-account').textContent = jp.profile.bankAccountNumber;
  el('bank-balance').textContent = jp.profile.bankBalance;
  el('main-balance').textContent = jp.profile.balance;
  const tx = await (await fetch('/api/transactions', { headers:{ Authorization:'Bearer ' + token } })).json();
  const txlist = el('tx-history'); txlist.innerHTML = '';
  tx.transactions.forEach(t => {
    const d = document.createElement('div'); d.className='card'; d.style.margin='6px 0';
    d.textContent = `${new Date(t.date).toLocaleString()} — ${t.type} — ${t.amount}$ — ${t.info || ''}`;
    txlist.appendChild(d);
  });
  el('btn-deposit').onclick = async () => {
    const amount = Number(el('bank-amount').value);
    const res = await fetch('/api/bank/deposit', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + token }, body: JSON.stringify({ amount })});
    const j = await res.json();
    if (!res.ok) return notify(j.error || 'Ошибка', 'error');
    notify('Пополнение выполнено', 'success');
    loadBank();
  };
  el('btn-withdraw').onclick = async () => {
    const amount = Number(el('bank-amount').value);
    const res = await fetch('/api/bank/withdraw', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + token }, body: JSON.stringify({ amount })});
    const j = await res.json();
    if (!res.ok) return notify(j.error || 'Ошибка', 'error');
    notify('Вывод выполнен', 'success');
    loadBank();
  };
  el('btn-transfer').onclick = async () => {
    const to = el('bank-transfer-to').value;
    const amount = Number(el('bank-amount').value);
    const res = await fetch('/api/bank/transfer', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + token }, body: JSON.stringify({ toAccount: to, amount })});
    const j = await res.json();
    if (!res.ok) return notify(j.error || 'Ошибка', 'error');
    notify('Перевод выполнен', 'success');
    loadBank();
  };
}

function setupPlayers(){
  el('btn-search-player').onclick = async () => {
    const q = el('search-player').value.trim();
    if (!q) return;
    const r = await fetch('/api/search-user?q=' + encodeURIComponent(q));
    const j = await r.json();
    const out = el('search-results'); out.innerHTML = '';
    j.results.forEach(u => {
      const d = document.createElement('div'); d.className='card'; d.style.margin='6px 0';
      d.innerHTML = `<b>${u.nickname}</b> — ${u.balance}$ <button class="btn" data-id="${u.id}">Открыть профиль</button>`;
      out.appendChild(d);
    });
    out.querySelectorAll('.btn').forEach(b => b.addEventListener('click', async (ev) => {
      const id = b.dataset.id;
      const p = await fetch('/api/profile/' + id);
      const jp = await p.json();
      document.querySelectorAll('.menu-item').forEach(m=>m.classList.remove('active'));
      document.querySelector('.menu-item[data-view="profile"]').classList.add('active');
      show('view-profile');
      el('p-nick').textContent = jp.profile.nickname;
      el('p-balance').textContent = jp.profile.balance;
      el('p-registered').textContent = new Date(jp.profile.registrationDate).toLocaleString();
      el('p-account').textContent = jp.profile.bankAccountNumber;
      el('p-bank').textContent = jp.profile.bankBalance;
      el('p-earned').textContent = jp.profile.totalEarned;
      el('p-clan').textContent = jp.profile.clanId || 'Нет';
      el('p-played').textContent = jp.profile.gamesPlayed;
      el('p-maxwin').textContent = jp.profile.maxWin;
    }));
  };
}

/* ADMIN UI */
function setupAdminPanel(){
  const token = localStorage.getItem('1win_token');
  el('btn-admin-panel').onclick = () => {
    el('admin-modal').classList.remove('hidden');
    updateAdminModeStatus();
  };
  el('btn-close-admin').onclick = () => el('admin-modal').classList.add('hidden');

  el('btn-toggle-admin-mode').onclick = async () => {
    try {
      const r = await fetch('/api/admin/toggle-mode', { method: 'POST', headers: { Authorization: 'Bearer ' + token }});
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Ошибка');
      updateAdminModeStatus();
      notify('Режим админа переключён', 'success');
    } catch (err) { notify(err.message || 'Ошибка', 'error'); }
  };

  el('btn-predict').onclick = async () => {
    try {
      const r = await fetch('/api/admin/predict', { headers: { Authorization: 'Bearer ' + token }});
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Ошибка');
      el('predict-result').textContent = `Прогноз: ${j.prediction} (доверие ${j.confidence}%)`;
    } catch (err) { notify(err.message || 'Ошибка', 'error'); }
  };

  el('btn-grant').onclick = async () => {
    try {
      const amount = Number(el('admin-grant-amount').value || 0);
      if (!amount || amount <= 0) return notify('Введите корректную сумму', 'error');
      const r = await fetch('/api/admin/grant', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ amount })});
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Ошибка');
      el('grant-result').textContent = `Начислено ${amount}$. Новый баланс: ${j.newBalance}$`;
      notify('Средства начислены', 'success');
      loadProfile();
    } catch (err) { notify(err.message || 'Ошибка', 'error'); }
  };
}

async function updateAdminModeStatus(){
  const token = localStorage.getItem('1win_token');
  const payload = JSON.parse(atob(token.split('.')[1]));
  const p = await fetch('/api/profile/' + payload.id, { headers: { Authorization: 'Bearer ' + token }});
  if (!p.ok) return;
  const jp = await p.json();
  currentUser = jp.profile;
  el('admin-mode-status').textContent = currentUser.adminMode ? 'Режим: ADMIN' : 'Режим: PLAYER';
}