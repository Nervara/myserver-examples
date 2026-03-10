import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";

const DATA_DIR = process.env.DATA_DIR || "/data";
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = `${DATA_DIR}/tasks.db`;
const db = new Database(DB_PATH, { create: true });

// Enable WAL mode for concurrent reads + better performance
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA busy_timeout = 5000");
db.run("PRAGMA synchronous = NORMAL");
db.run("PRAGMA foreign_keys = ON");

// Schema
db.run(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#6366f1',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','done','archived')),
    priority INTEGER NOT NULL DEFAULT 0 CHECK(priority BETWEEN 0 AND 3),
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    due_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS task_tags (
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (task_id, tag)
  )
`);

db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority DESC)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag)`);

// Seed default categories if empty
const count = db.query<{ c: number }, []>("SELECT COUNT(*) as c FROM categories").get()!;
if (count.c === 0) {
  const insert = db.prepare("INSERT INTO categories (name, color) VALUES (?, ?)");
  const seeds: [string, string][] = [
    ["Backend", "#ef4444"],
    ["Frontend", "#3b82f6"],
    ["DevOps", "#22c55e"],
    ["Design", "#a855f7"],
    ["Documentation", "#f59e0b"],
  ];
  db.transaction(() => {
    for (const [name, color] of seeds) insert.run(name, color);
  })();
}

export default db;
export { DB_PATH };
