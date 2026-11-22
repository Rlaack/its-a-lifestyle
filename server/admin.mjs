// Admin commands for acting on reports. Runs inside the relay's container, against the same database:
//
//   railway ssh --service relay -- node /app/admin.mjs info 472a3f4b
//   railway ssh --service relay -- node /app/admin.mjs close 472a3f4b harassment, report of 2026-11-20 --confirm
//   railway ssh --service relay -- node /app/admin.mjs closed
//
// The ID can be the full account ID or its first 8+ characters, as shown in the app ("Support ID").
// We can't read anyone's messages, so closing acts on the account, not on content.
import { DatabaseSync } from 'node:sqlite';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

// railway ssh logs in as root; act as the relay's own user so database files keep the right owner.
if (process.getuid?.() === 0) { process.setgid('node'); process.setuid('node'); }

const db = new DatabaseSync(process.env.DB_PATH ?? '/data/relay.db');
db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
// railway ssh passes the command through a shell that splits quoted text, so the reason can be any
// number of words and --confirm can go anywhere.
const args = process.argv.slice(2);
const confirmed = args.includes('--confirm');
const [cmd, idArg, ...words] = args.filter(a => a !== '--confirm');
const reason = words.join(' ');
const die = msg => { console.error(msg); process.exit(1); };

function resolve(id) {
  if (!/^[0-9a-f-]{8,36}$/i.test(id ?? '')) die('Give an account ID, or at least its first 8 characters.');
  const like = id.toLowerCase() + '%';
  const rows = db.prepare(`SELECT account FROM devices WHERE account LIKE ? UNION SELECT account FROM hood_members WHERE account LIKE ?
    UNION SELECT account FROM closed_accounts WHERE account LIKE ?`).all(like, like, like);
  if (rows.length === 0) die(`No account starts with ${id}.`);
  if (rows.length > 1) die(`${rows.length} accounts start with ${id}; give more characters:\n${rows.map(r => '  ' + r.account).join('\n')}`);
  return rows[0].account;
}

function info(account) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const devices = db.prepare('SELECT device, created FROM devices WHERE account = ?').all(account);
  const closed = one('SELECT reason, closed FROM closed_accounts WHERE account = ?', account);
  console.log(`Account   ${account}`);
  console.log(`Status    ${closed ? `CLOSED ${new Date(closed.closed).toISOString()} (${closed.reason})` : devices.length ? 'active' : 'deleted by its owner'}`);
  console.log(`Devices   ${devices.map(d => `#${d.device} since ${new Date(d.created).toISOString().slice(0, 10)}`).join(', ') || 'none'}`);
  console.log(`Neighborhoods ${one('SELECT COUNT(*) AS n FROM hood_members WHERE account = ?', account).n}`);
  console.log(`Phone number  ${one('SELECT 1 AS x FROM phones WHERE account = ?', account) ? 'yes (hashed)' : 'no'}`);
  console.log(`Waiting messages ${one('SELECT COUNT(*) AS n FROM queue WHERE account = ?', account).n}`);
}

function close(account, why) {
  if (db.prepare('SELECT 1 AS x FROM closed_accounts WHERE account = ?').get(account)) die('Already closed.');
  const now = Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    const run = (sql, ...a) => db.prepare(sql).run(...a);
    for (const { token_hash } of db.prepare('SELECT token_hash FROM devices WHERE account = ?').all(account))
      run('INSERT OR IGNORE INTO closed_tokens VALUES (?, ?)', token_hash, account);
    for (const { phone_hmac } of db.prepare('SELECT phone_hmac FROM phones WHERE account = ?').all(account))
      run('INSERT OR IGNORE INTO closed_phones VALUES (?, ?)', phone_hmac, account);
    const hoods = db.prepare('SELECT lookup FROM hood_members WHERE account = ?').all(account);
    for (const { lookup } of hoods) {
      run('INSERT OR IGNORE INTO hood_bans VALUES (?, ?)', lookup, account);
      run('DELETE FROM hood_members WHERE lookup = ? AND account = ?', lookup, account);
      if (db.prepare('SELECT COUNT(*) AS n FROM hood_members WHERE lookup = ?').get(lookup).n === 0) run('DELETE FROM hoods WHERE lookup = ?', lookup);
    }
    // Same as the owner deleting it (devices cascade to prekeys, queue and push tokens).
    try { run("UPDATE subs SET account = '' WHERE account = ?", account); } catch { /* older database */ }
    run('DELETE FROM phones WHERE account = ?', account);
    run('DELETE FROM phone_codes WHERE account = ?', account);
    run('DELETE FROM access_keys WHERE account = ?', account);
    try { for (const { lookup } of db.prepare('DELETE FROM backups WHERE account = ? RETURNING lookup').all(account)) rmSync(join(dirname(process.env.DB_PATH ?? '/data/relay.db'), 'attachments', `backup-${lookup}`), { force: true }); } catch { /* older database */ }
    run('DELETE FROM devices WHERE account = ?', account);
    run('INSERT INTO closed_accounts VALUES (?, ?, ?)', account, why, now);
    db.exec('COMMIT');
    console.log(`Closed ${account}: removed from ${hoods.length} neighborhood(s); its phone now shows "account closed".`);
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

switch (cmd) {
  case 'info': info(resolve(idArg)); break;
  case 'close': {
    const account = resolve(idArg);
    if (!reason.trim()) die('Give a reason after the ID (kept with the record).');
    info(account);
    if (!confirmed) die('\nNothing changed. Run again with --confirm at the end to close this account.');
    close(account, reason.trim().slice(0, 200));
    break;
  }
  case 'closed':
    for (const r of db.prepare('SELECT * FROM closed_accounts ORDER BY closed DESC').all())
      console.log(`${new Date(r.closed).toISOString().slice(0, 10)}  ${r.account}  ${r.reason}`);
    break;
  case 'crashes':
    for (const r of db.prepare('SELECT * FROM crash_reports ORDER BY received DESC LIMIT 20').all())
      console.log(`${new Date(r.received).toISOString().slice(0, 16)}  ${r.app}  ${r.os}\n  ${r.message}\n${r.stack.split('\n').slice(0, 6).map(l => '    ' + l).join('\n')}\n`);
    break;
  default: die('Commands: info <id> | close <id> <reason...> --confirm | closed | crashes');
}
