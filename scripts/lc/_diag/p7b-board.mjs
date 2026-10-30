// 只读：列出看板上与 Phase7A 相关的卡（id/title/assignee/status/parents），避免与兄弟卡重复实现。
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';

const dbPath = process.env.HERMES_KANBAN_DB || path.join(os.homedir(), '.hermes', 'kanban.db');
const db = new DatabaseSync(dbPath, { readOnly: true });
console.log('db =', dbPath);
console.log('tables:', db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name).join(', '));
const rows = db
  .prepare(
    `SELECT id, title, assignee, status, created_at FROM tasks ORDER BY created_at DESC LIMIT 40`,
  )
  .all();
for (const r of rows) {
  console.log(`${r.id}  [${r.status}] ${r.assignee}  ${r.title}`);
}
console.log('--- deps ---');
try {
  for (const d of db.prepare(`SELECT * FROM task_deps`).all()) console.log(JSON.stringify(d));
} catch (e) {
  console.log('task_deps:', e.message);
}
