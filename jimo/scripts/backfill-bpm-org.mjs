// One-time backfill: push existing sys_departments + sys_users into BPM.
// Run when BPM is empty or re-sync is needed.
//   cd release/jimo/apps/server && set -a && . ./.env && set +a
//   node ../../scripts/backfill-bpm-org.mjs
//
// Order: (1) depts without lead, (2) users (get EMP ids, store bpm_user_id),
// (3) re-sync depts with lead (now resolvable). BPM createDept is upsert.
import postgres from 'postgres';

const DBURL = process.env.DATABASE_URL;
const BPM = (process.env.BPM_SERVICE_URL || 'http://localhost:8090').replace(/\/$/, '');
const SYNC_USER = process.env.BPM_SYNC_USER_ID || 'EMP008';
if (!DBURL) { console.error('DATABASE_URL missing'); process.exit(1); }
const sql = postgres(DBURL, { max: 1, prepare: false });

async function bpm(method, path, body) {
  const res = await fetch(`${BPM}/bpm/api/admin/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-user-id': SYNC_USER },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let j = null; try { j = JSON.parse(text); } catch { /* non-JSON */ }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 120)}`);
  return j;
}

const depts = await sql`SELECT id, name, code, parent_id, lead_id FROM sys_departments WHERE deleted_at IS NULL`;
const deptById = new Map(depts.map((d) => [d.id, d]));
const parentCodeOf = (d) => (d.parent_id ? deptById.get(d.parent_id)?.code ?? null : null);

console.log(`== departments: ${depts.length} (pass 1, no lead) ==`);
for (const d of depts) {
  try { await bpm('POST', 'departments', { id: d.code, name: d.name, parentId: parentCodeOf(d), leadId: null }); console.log('  ok', d.code); }
  catch (e) { console.warn('  FAIL', d.code, e.message); }
}

console.log(`== users ==`);
// Roles live in sys_user_roles (many-to-many) — there is no denormalized `role`
// column on sys_users anymore. Derive BPM's cosmetic `title` from role names,
// mirroring BpmOrgSyncService.syncUser. Also pull the employee position so the
// Server-side candidate resolver (which reads sys_employees.position) is in
// sync with whatever BPM stores.
const users = await sql`
  SELECT u.id, u.username, u.nickname, u.email, u.dept_id, u.bpm_user_id,
         COALESCE(string_agg(r.name, '/'), '') AS role_titles,
         e.position AS employee_position
  FROM sys_users u
  LEFT JOIN sys_user_roles ur ON ur.user_id = u.id
  LEFT JOIN sys_roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
  LEFT JOIN sys_employees e ON e.id = u.employee_id AND e.deleted_at IS NULL
  WHERE u.deleted_at IS NULL
  GROUP BY u.id, e.position
`;
for (const u of users) {
  if (!u.dept_id) { console.log('  skip (no dept)', u.username); continue; }
  const dept = deptById.get(u.dept_id);
  if (!dept) { console.warn('  skip (dept missing)', u.username); continue; }
  const title = u.role_titles || u.employee_position || '';
  const payload = { name: u.nickname || u.username, deptId: dept.code, email: u.email ?? '', title };
  try {
    if (u.bpm_user_id) {
      await bpm('PUT', `users/${u.bpm_user_id}`, payload);
      console.log('  update', u.username, u.bpm_user_id);
    } else {
      const r = await bpm('POST', 'users', payload);
      const empId = r?.data?.id;
      if (empId) { await sql`UPDATE sys_users SET bpm_user_id=${empId} WHERE id=${u.id}`; console.log('  create', u.username, empId); }
    }
  } catch (e) { console.warn('  FAIL', u.username, e.message); }
}

console.log(`== departments: ${depts.length} (pass 2, with lead) ==`);
for (const d of depts) {
  let leadBpm = null;
  if (d.lead_id) {
    const lu = await sql`SELECT bpm_user_id FROM sys_users WHERE id=${d.lead_id}`;
    leadBpm = lu[0]?.bpm_user_id ?? null;
  }
  try { await bpm('POST', 'departments', { id: d.code, name: d.name, parentId: parentCodeOf(d), leadId: leadBpm }); console.log('  ok', d.code, leadBpm ? `(lead ${leadBpm})` : ''); }
  catch (e) { console.warn('  FAIL', d.code, e.message); }
}

await sql.end();
console.log('backfill done');
