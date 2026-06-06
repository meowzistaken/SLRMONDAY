// db.js – SelaRNG Database Layer
// Uses Supabase when configured, otherwise falls back to localStorage.

const _live = typeof SUPABASE_URL !== 'undefined' &&
              SUPABASE_URL !== 'YOUR_SUPABASE_URL';

let _sb = null;
if (_live) {
  _sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('[SelaRNG] Supabase connected');
} else {
  console.warn('[SelaRNG] Supabase not configured — using localStorage fallback');
}

// ── localStorage helpers (fallback only) ──────────────────
const _ls = {
  getUsers()       { const r = localStorage.getItem('slr_users'); return r ? JSON.parse(r) : []; },
  setUsers(u)      { localStorage.setItem('slr_users', JSON.stringify(u)); },
  getDraw(d, si)   {
    const r  = localStorage.getItem(`slr_drawn_${d}_${si}`);
    const rc = localStorage.getItem(`slr_respin_${d}_${si}`);
    return r ? { roster: JSON.parse(r), respin_count: parseInt(rc || '0') } : null;
  },
  saveDraw(d, si, roster, rc) {
    if (roster) localStorage.setItem(`slr_drawn_${d}_${si}`, JSON.stringify(roster));
    else        localStorage.removeItem(`slr_drawn_${d}_${si}`);
    localStorage.setItem(`slr_respin_${d}_${si}`, rc || 0);
  },
};

// ── USERS ──────────────────────────────────────────────────

async function dbGetUsers() {
  if (!_live) return _ls.getUsers();
  const { data, error } = await _sb.from('users').select('*').order('id');
  if (error) { console.error(error); return []; }
  return data;
}

async function dbAddUser(name, roles) {
  if (!_live) {
    const users = _ls.getUsers();
    const id = users.length ? Math.max(...users.map(u => u.id)) + 1 : 1;
    const user = { id, name, roles };
    _ls.setUsers([...users, user]);
    return user;
  }
  const { data, error } = await _sb
    .from('users').insert([{ name, roles }]).select().single();
  if (error) throw error;
  return data;
}

async function dbUpdateUser(id, name, roles) {
  if (!_live) {
    const users = _ls.getUsers();
    const i = users.findIndex(u => u.id === id);
    if (i >= 0) users[i] = { id, name, roles };
    _ls.setUsers(users);
    return;
  }
  const { error } = await _sb.from('users').update({ name, roles }).eq('id', id);
  if (error) throw error;
}

async function dbDeleteUser(id) {
  if (!_live) {
    _ls.setUsers(_ls.getUsers().filter(u => u.id !== id));
    return;
  }
  const { error } = await _sb.from('users').delete().eq('id', id);
  if (error) throw error;
}

// Bulk replace — used by Excel import
async function dbSetAllUsers(list) {
  if (!_live) {
    let n = 1;
    const withIds = list.map(u => ({ id: n++, name: u.name, roles: u.roles }));
    _ls.setUsers(withIds);
    return withIds;
  }
  // Delete everyone then re-insert
  await _sb.from('users').delete().gte('id', 0);
  if (!list.length) return [];
  const { data, error } = await _sb
    .from('users')
    .insert(list.map(({ name, roles }) => ({ name, roles })))
    .select();
  if (error) throw error;
  return data;
}

// Merge — add new, update existing by name
async function dbMergeUsers(list) {
  const existing = await dbGetUsers();
  const results  = [...existing];
  for (const u of list) {
    const match = results.find(e => e.name.toLowerCase() === u.name.toLowerCase());
    if (match) {
      await dbUpdateUser(match.id, u.name, u.roles);
      match.roles = u.roles;
    } else {
      const added = await dbAddUser(u.name, u.roles);
      results.push(added);
    }
  }
  return results;
}

// ── DRAWS ──────────────────────────────────────────────────

async function dbGetDraw(date, slotIndex) {
  if (!_live) return _ls.getDraw(date, slotIndex);
  const { data, error } = await _sb
    .from('draws').select('*')
    .eq('date', date).eq('slot_index', slotIndex)
    .maybeSingle();
  if (error) { console.error(error); return null; }
  return data;  // { date, slot_index, roster, respin_count } | null
}

async function dbSaveDraw(date, slotIndex, roster, respinCount) {
  if (!_live) { _ls.saveDraw(date, slotIndex, roster, respinCount); return; }
  const { error } = await _sb.from('draws').upsert(
    { date, slot_index: slotIndex, roster, respin_count: respinCount || 0 },
    { onConflict: 'date,slot_index' }
  );
  if (error) throw error;
}

async function dbRespin(date, slotIndex) {
  const draw    = await dbGetDraw(date, slotIndex);
  const newCount = (draw?.respin_count || 0) + 1;
  if (!_live) { _ls.saveDraw(date, slotIndex, null, newCount); return newCount; }
  const { error } = await _sb.from('draws').upsert(
    { date, slot_index: slotIndex, roster: null, respin_count: newCount },
    { onConflict: 'date,slot_index' }
  );
  if (error) throw error;
  return newCount;
}

// ── REALTIME ───────────────────────────────────────────────
// Returns an unsubscribe function.

function dbOnDrawChange(cb) {
  if (!_live) return () => {};
  const ch = _sb.channel('draws-rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'draws' }, cb)
    .subscribe();
  return () => _sb.removeChannel(ch);
}

function dbOnUserChange(cb) {
  if (!_live) return () => {};
  const ch = _sb.channel('users-rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, cb)
    .subscribe();
  return () => _sb.removeChannel(ch);
}
