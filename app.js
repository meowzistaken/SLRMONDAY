// ============================================================
// app.js – SelaRNG Shared Logic
// Data operations are in db.js; this file is pure logic.
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

// ── Roster Generation (pure — no DB calls) ─────────────────
// users: array of user objects from DB
// respinCount: incremented by admin to change the seed
function generateRoster(users, dateStr, slotIndex, respinCount) {
  if (!users || !users.length) return { VAC: '—', PAC: '—', DESK: '—' };

  const spin = respinCount || 0;
  const rand = mulberry32(strHash(`${dateStr}|${slotIndex}|${spin}`));
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

// ── Shared async: fetch or generate+store the draw ─────────
async function getOrCreateRoster(dateStr, slotIndex) {
  const draw = await dbGetDraw(dateStr, slotIndex);
  if (draw && draw.roster) return draw.roster;          // already stored

  const users      = await dbGetUsers();
  const respinCount = draw?.respin_count || 0;
  const roster     = generateRoster(users, dateStr, slotIndex, respinCount);
  await dbSaveDraw(dateStr, slotIndex, roster, respinCount);
  return roster;
}

// ── Current slot helpers ───────────────────────────────────
function getCurrentSlot() {
  const sgt = getSGT();
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
  const nowMs = sgt.getHours() * 3600000 + sgt.getMinutes() * 60000
              + sgt.getSeconds() * 1000   + sgt.getMilliseconds();

  function slotRevealMs(s) { return s.revealHour * 3600000 + (s.revealMin || 0) * 60000; }

  const revealed = SLOTS.filter(s => nowMs >= slotRevealMs(s));
  const next     = SLOTS.find(s  => nowMs <  slotRevealMs(s));

  let msUntilNext, nextLabel;
  if (next) {
    msUntilNext = slotRevealMs(next) - nowMs;
    nextLabel   = next.label;
  } else {
    msUntilNext = (24 + SLOTS[0].revealHour) * 3600000 + (SLOTS[0].revealMin || 0) * 60000 - nowMs;
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
  function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize);
  const stars = Array.from({ length: 220 }, () => ({
    x: Math.random(), y: Math.random(),
    r: Math.random() * 1.4 + 0.2,
    a: Math.random(), da: (Math.random() - 0.5) * 0.008,
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
