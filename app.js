// ============================================================
// app.js – SelaRNG Shared Logic
// ============================================================

const SLOTS = [
  { index: 0, label: '8:00 AM – 10:00 AM',  shiftStart: 8,  shiftEnd: 10, revealHour: 6,  revealMin: 0 },
  { index: 1, label: '10:00 AM – 12:00 PM', shiftStart: 10, shiftEnd: 12, revealHour: 8,  revealMin: 1 },
  { index: 2, label: '12:00 PM – 2:00 PM',  shiftStart: 12, shiftEnd: 14, revealHour: 10, revealMin: 1 },
  { index: 3, label: '2:00 PM – 4:00 PM',   shiftStart: 14, shiftEnd: 16, revealHour: 12, revealMin: 1 },
  { index: 4, label: '4:00 PM – 6:00 PM',   shiftStart: 16, shiftEnd: 18, revealHour: 14, revealMin: 1 },
];

const ROLE_META = {
  VAC:  { color: '#FF4757', glow: 'rgba(255,71,87,0.6)',   label: 'VAC'  },
  PAC:  { color: '#2ED573', glow: 'rgba(46,213,115,0.6)',  label: 'PAC'  },
  DESK: { color: '#1E90FF', glow: 'rgba(30,144,255,0.6)',  label: 'DESK' },
};

// ── Default seed data ──────────────────────────────────────
const DEFAULT_USERS = [
  { id: 1, name: 'Ahmad',   roles: ['VAC','PAC','DESK'] },
  { id: 2, name: 'Benny',   roles: ['VAC','PAC','DESK'] },
  { id: 3, name: 'Chong',   roles: ['DESK']             },
  { id: 4, name: 'Darvin',  roles: ['VAC','PAC','DESK'] },
  { id: 5, name: 'Elfie',   roles: ['DESK']             },
  { id: 6, name: 'Faizal',  roles: ['VAC','PAC','DESK'] },
  { id: 7, name: 'Grace',   roles: ['VAC','PAC','DESK'] },
  { id: 8, name: 'Hakim',   roles: ['DESK']             },
];

// ── User Storage ───────────────────────────────────────────
function getUsers() {
  const raw = localStorage.getItem('slr_users');
  if (!raw) { saveUsers(DEFAULT_USERS); return [...DEFAULT_USERS]; }
  return JSON.parse(raw);
}

function saveUsers(users) {
  localStorage.setItem('slr_users', JSON.stringify(users));
}

function getNextUserId() {
  const u = getUsers();
  return u.length === 0 ? 1 : Math.max(...u.map(x => x.id)) + 1;
}

// ── Singapore Time (UTC+8) ─────────────────────────────────
function getSGT() {
  const now = new Date();
  return new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
}

function getSGTDateStr(d) {
  d = d || getSGT();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatSGTDate(d) {
  d = d || getSGT();
  const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// ── Seeded PRNG (FNV-1a hash + Mulberry32) ─────────────────
function strHash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function mulberry32(a) {
  a = (a || 1) >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function shuffleSeeded(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Roster Generation ──────────────────────────────────────
function generateRoster(dateStr, slotIndex, respinCount) {
  const users = getUsers();
  if (!users.length) return { VAC: '—', PAC: '—', DESK: '—' };

  const spin  = respinCount || 0;
  const rand  = mulberry32(strHash(`${dateStr}|${slotIndex}|${spin}`));
  const taken = new Set();

  function pick(pool) {
    const avail = shuffleSeeded(pool.filter(u => !taken.has(u.id)), rand);
    if (!avail.length) return null;
    taken.add(avail[0].id);
    return avail[0];
  }

  const vac  = pick(users.filter(u => u.roles.includes('VAC')));
  const pac  = pick(users.filter(u => u.roles.includes('PAC')));
  const desk = pick(users.filter(u => u.roles.includes('DESK')));

  return {
    VAC:  vac  ? vac.name  : '—',
    PAC:  pac  ? pac.name  : '—',
    DESK: desk ? desk.name : '—',
  };
}

// ── Drawn roster storage ──────────────────────────────────
function getDrawnRoster(dateStr, slotIndex) {
  const raw = localStorage.getItem(`slr_drawn_${dateStr}_${slotIndex}`);
  return raw ? JSON.parse(raw) : null;
}

function saveDrawnRoster(dateStr, slotIndex, roster) {
  localStorage.setItem(`slr_drawn_${dateStr}_${slotIndex}`, JSON.stringify(roster));
}

function clearDrawnRoster(dateStr, slotIndex) {
  localStorage.removeItem(`slr_drawn_${dateStr}_${slotIndex}`);
}

// ── Respin counter (admin override) ───────────────────────
function getRespinCount(dateStr, slotIndex) {
  return parseInt(localStorage.getItem(`slr_respin_${dateStr}_${slotIndex}`) || '0');
}

function incrementRespin(dateStr, slotIndex) {
  localStorage.setItem(`slr_respin_${dateStr}_${slotIndex}`,
    getRespinCount(dateStr, slotIndex) + 1);
}

// Generate once and store; return stored copy on every subsequent call.
// Includes respin count in seed so admin overrides produce different names.
function getOrCreateRoster(dateStr, slotIndex) {
  const stored = getDrawnRoster(dateStr, slotIndex);
  if (stored) return stored;
  const roster = generateRoster(dateStr, slotIndex, getRespinCount(dateStr, slotIndex));
  saveDrawnRoster(dateStr, slotIndex, roster);
  return roster;
}

// ── Current slot helpers ───────────────────────────────────
function getCurrentSlot() {
  const sgt = getSGT();
  // After 6 PM all shifts are done — nothing to display
  if (sgt.getHours() >= 18) return null;
  const nowMs = sgt.getHours() * 3600000 + sgt.getMinutes() * 60000
              + sgt.getSeconds() * 1000   + sgt.getMilliseconds();
  const revealed = SLOTS.filter(s => nowMs >= s.revealHour * 3600000 + s.revealMin * 60000);
  return revealed.length ? revealed[revealed.length - 1] : null;
}

function getSlotStatus(slot) {
  const sgt  = getSGT();
  const nowH = sgt.getHours() + sgt.getMinutes() / 60;
  if (nowH < slot.shiftStart) return 'UPCOMING';
  if (nowH < slot.shiftEnd)   return 'ACTIVE';
  return 'COMPLETED';
}

// ── Reveal State & Countdown ───────────────────────────────
function getRevealState() {
  const sgt   = getSGT();
  const nowMs = sgt.getHours() * 3600000
              + sgt.getMinutes() * 60000
              + sgt.getSeconds() * 1000
              + sgt.getMilliseconds();

  function slotRevealMs(s) {
    return s.revealHour * 3600000 + (s.revealMin || 0) * 60000;
  }

  const revealed = SLOTS.filter(s => nowMs >= slotRevealMs(s));
  const next     = SLOTS.find(s  => nowMs <  slotRevealMs(s));

  let msUntilNext;
  let nextLabel;
  if (next) {
    msUntilNext = slotRevealMs(next) - nowMs;
    nextLabel   = next.label;
  } else {
    // All revealed — next is tomorrow at 6:00 AM
    const tomorrowRevealMs = (24 + SLOTS[0].revealHour) * 3600000
                           + (SLOTS[0].revealMin || 0) * 60000;
    msUntilNext = tomorrowRevealMs - nowMs;
    nextLabel   = 'Tomorrow ' + SLOTS[0].label;
  }

  return { revealed, next, msUntilNext, nextLabel };
}

function formatCountdown(ms) {
  if (ms <= 0) return '00:00:00';
  const t = Math.ceil(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// ── Admin Auth ─────────────────────────────────────────────
function verifyPin(pin) {
  return pin === (localStorage.getItem('slr_pin') || '1234');
}

// ── Starfield Canvas ───────────────────────────────────────
function initStars(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const stars = Array.from({ length: 220 }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: Math.random() * 1.4 + 0.2,
    a: Math.random(),
    da: (Math.random() - 0.5) * 0.008,
  }));

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    stars.forEach(s => {
      s.a += s.da;
      if (s.a > 1 || s.a < 0.1) s.da = -s.da;
      ctx.beginPath();
      ctx.arc(s.x * canvas.width, s.y * canvas.height, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${s.a.toFixed(2)})`;
      ctx.fill();
    });
    requestAnimationFrame(draw);
  }
  draw();
}
