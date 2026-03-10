import db, { DB_PATH } from "./db";

const PORT = process.env.PORT || 3000;

// ---------- Types ----------
interface Task {
  id: number;
  title: string;
  description: string;
  status: string;
  priority: number;
  category_id: number | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

interface Category {
  id: number;
  name: string;
  color: string;
  created_at: string;
}

// ---------- Helpers ----------
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function err(message: string, status = 400) {
  return json({ error: message }, status);
}

async function body<T>(req: Request): Promise<T> {
  return req.json() as Promise<T>;
}

function getTaskWithTags(taskId: number) {
  const task = db.query<Task, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!task) return null;
  const tags = db
    .query<{ tag: string }, [number]>("SELECT tag FROM task_tags WHERE task_id = ?")
    .all(taskId)
    .map((r) => r.tag);
  return { ...task, tags };
}

// ---------- Router ----------
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // Health
    if (path === "/health") return new Response("OK");

    // ---------- Categories ----------
    if (path === "/api/categories" && method === "GET") {
      const rows = db.query<Category, []>("SELECT * FROM categories ORDER BY name").all();
      return json(rows);
    }

    if (path === "/api/categories" && method === "POST") {
      const { name, color } = await body<{ name: string; color?: string }>(req);
      if (!name) return err("name required");
      try {
        const result = db
          .query<Category, [string, string]>(
            "INSERT INTO categories (name, color) VALUES (?, ?) RETURNING *"
          )
          .get(name, color || "#6366f1");
        return json(result, 201);
      } catch (e: any) {
        if (e.message?.includes("UNIQUE")) return err("category already exists", 409);
        throw e;
      }
    }

    const catMatch = path.match(/^\/api\/categories\/(\d+)$/);
    if (catMatch && method === "DELETE") {
      const id = parseInt(catMatch[1]);
      db.run("DELETE FROM categories WHERE id = ?", [id]);
      return new Response(null, { status: 204 });
    }

    // ---------- Tasks ----------
    if (path === "/api/tasks" && method === "GET") {
      // Query params: status, category_id, priority, tag, search, sort, limit, offset
      const status = url.searchParams.get("status");
      const categoryId = url.searchParams.get("category_id");
      const priority = url.searchParams.get("priority");
      const tag = url.searchParams.get("tag");
      const search = url.searchParams.get("search");
      const sort = url.searchParams.get("sort") || "created_at";
      const order = url.searchParams.get("order") === "asc" ? "ASC" : "DESC";
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
      const offset = parseInt(url.searchParams.get("offset") || "0");

      const validSorts = ["created_at", "updated_at", "priority", "due_date", "title"];
      const sortCol = validSorts.includes(sort) ? sort : "created_at";

      let where = "1=1";
      const params: any[] = [];

      if (status) {
        where += " AND t.status = ?";
        params.push(status);
      }
      if (categoryId) {
        where += " AND t.category_id = ?";
        params.push(parseInt(categoryId));
      }
      if (priority) {
        where += " AND t.priority = ?";
        params.push(parseInt(priority));
      }
      if (tag) {
        where += " AND EXISTS (SELECT 1 FROM task_tags tt WHERE tt.task_id = t.id AND tt.tag = ?)";
        params.push(tag);
      }
      if (search) {
        where += " AND (t.title LIKE ? OR t.description LIKE ?)";
        params.push(`%${search}%`, `%${search}%`);
      }

      const countResult = db
        .query<{ total: number }, any[]>(`SELECT COUNT(*) as total FROM tasks t WHERE ${where}`)
        .get(...params)!;

      const tasks = db
        .query<Task, any[]>(
          `SELECT t.* FROM tasks t WHERE ${where} ORDER BY t.${sortCol} ${order} LIMIT ? OFFSET ?`
        )
        .all(...params, limit, offset);

      // Batch load tags
      const taskIds = tasks.map((t) => t.id);
      const tagMap = new Map<number, string[]>();
      if (taskIds.length > 0) {
        const placeholders = taskIds.map(() => "?").join(",");
        const tagRows = db
          .query<{ task_id: number; tag: string }, any[]>(
            `SELECT task_id, tag FROM task_tags WHERE task_id IN (${placeholders})`
          )
          .all(...taskIds);
        for (const row of tagRows) {
          if (!tagMap.has(row.task_id)) tagMap.set(row.task_id, []);
          tagMap.get(row.task_id)!.push(row.tag);
        }
      }

      return json({
        tasks: tasks.map((t) => ({ ...t, tags: tagMap.get(t.id) || [] })),
        total: countResult.total,
        limit,
        offset,
      });
    }

    if (path === "/api/tasks" && method === "POST") {
      const { title, description, status, priority, category_id, due_date, tags } = await body<{
        title: string;
        description?: string;
        status?: string;
        priority?: number;
        category_id?: number;
        due_date?: string;
        tags?: string[];
      }>(req);

      if (!title) return err("title required");

      const task = db.transaction(() => {
        const row = db
          .query<Task, any[]>(
            `INSERT INTO tasks (title, description, status, priority, category_id, due_date)
             VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
          )
          .get(
            title,
            description || "",
            status || "todo",
            priority ?? 0,
            category_id ?? null,
            due_date ?? null
          )!;

        if (tags?.length) {
          const tagInsert = db.prepare("INSERT OR IGNORE INTO task_tags (task_id, tag) VALUES (?, ?)");
          for (const t of tags) tagInsert.run(row.id, t);
        }

        return row;
      })();

      return json(getTaskWithTags(task.id), 201);
    }

    const taskMatch = path.match(/^\/api\/tasks\/(\d+)$/);
    if (taskMatch && method === "GET") {
      const task = getTaskWithTags(parseInt(taskMatch[1]));
      if (!task) return err("not found", 404);
      return json(task);
    }

    if (taskMatch && method === "PATCH") {
      const id = parseInt(taskMatch[1]);
      const existing = db.query<Task, [number]>("SELECT * FROM tasks WHERE id = ?").get(id);
      if (!existing) return err("not found", 404);

      const updates = await body<Partial<{
        title: string;
        description: string;
        status: string;
        priority: number;
        category_id: number | null;
        due_date: string | null;
        tags: string[];
      }>>(req);

      db.transaction(() => {
        const fields: string[] = [];
        const params: any[] = [];

        if (updates.title !== undefined) { fields.push("title = ?"); params.push(updates.title); }
        if (updates.description !== undefined) { fields.push("description = ?"); params.push(updates.description); }
        if (updates.status !== undefined) { fields.push("status = ?"); params.push(updates.status); }
        if (updates.priority !== undefined) { fields.push("priority = ?"); params.push(updates.priority); }
        if (updates.category_id !== undefined) { fields.push("category_id = ?"); params.push(updates.category_id); }
        if (updates.due_date !== undefined) { fields.push("due_date = ?"); params.push(updates.due_date); }

        if (fields.length > 0) {
          fields.push("updated_at = datetime('now')");
          params.push(id);
          db.run(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`, params);
        }

        if (updates.tags !== undefined) {
          db.run("DELETE FROM task_tags WHERE task_id = ?", [id]);
          const tagInsert = db.prepare("INSERT OR IGNORE INTO task_tags (task_id, tag) VALUES (?, ?)");
          for (const t of updates.tags) tagInsert.run(id, t);
        }
      })();

      return json(getTaskWithTags(id));
    }

    if (taskMatch && method === "DELETE") {
      const id = parseInt(taskMatch[1]);
      db.run("DELETE FROM tasks WHERE id = ?", [id]);
      return new Response(null, { status: 204 });
    }

    // ---------- Bulk operations ----------
    if (path === "/api/tasks/bulk-status" && method === "POST") {
      const { ids, status } = await body<{ ids: number[]; status: string }>(req);
      if (!ids?.length || !status) return err("ids and status required");
      const valid = ["todo", "in_progress", "done", "archived"];
      if (!valid.includes(status)) return err(`status must be one of: ${valid.join(", ")}`);

      const placeholders = ids.map(() => "?").join(",");
      db.run(
        `UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id IN (${placeholders})`,
        [status, ...ids]
      );
      return json({ updated: ids.length });
    }

    // ---------- Stats ----------
    if (path === "/api/stats" && method === "GET") {
      const byStatus = db
        .query<{ status: string; count: number }, []>(
          "SELECT status, COUNT(*) as count FROM tasks GROUP BY status"
        )
        .all();

      const byCategory = db
        .query<{ name: string; color: string; count: number }, []>(
          `SELECT c.name, c.color, COUNT(t.id) as count
           FROM categories c LEFT JOIN tasks t ON t.category_id = c.id
           GROUP BY c.id ORDER BY count DESC`
        )
        .all();

      const byPriority = db
        .query<{ priority: number; count: number }, []>(
          "SELECT priority, COUNT(*) as count FROM tasks GROUP BY priority ORDER BY priority DESC"
        )
        .all();

      const topTags = db
        .query<{ tag: string; count: number }, []>(
          "SELECT tag, COUNT(*) as count FROM task_tags GROUP BY tag ORDER BY count DESC LIMIT 10"
        )
        .all();

      const overdue = db
        .query<{ count: number }, []>(
          "SELECT COUNT(*) as count FROM tasks WHERE due_date < datetime('now') AND status NOT IN ('done','archived')"
        )
        .get()!;

      const total = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM tasks").get()!;

      return json({
        total: total.count,
        overdue: overdue.count,
        by_status: byStatus,
        by_category: byCategory,
        by_priority: byPriority,
        top_tags: topTags,
      });
    }

    // ---------- Tags autocomplete ----------
    if (path === "/api/tags" && method === "GET") {
      const q = url.searchParams.get("q");
      let rows;
      if (q) {
        rows = db
          .query<{ tag: string; count: number }, [string]>(
            "SELECT tag, COUNT(*) as count FROM task_tags WHERE tag LIKE ? GROUP BY tag ORDER BY count DESC LIMIT 20"
          )
          .all(`%${q}%`);
      } else {
        rows = db
          .query<{ tag: string; count: number }, []>(
            "SELECT tag, COUNT(*) as count FROM task_tags GROUP BY tag ORDER BY count DESC LIMIT 20"
          )
          .all();
      }
      return json(rows);
    }

    // ---------- DB backup endpoint (for volume backup pre-hook testing) ----------
    if (path === "/api/backup" && method === "POST") {
      const backupPath = `${DB_PATH}.bak`;
      db.run(`VACUUM INTO '${backupPath}'`);
      return json({ message: "backup created", path: backupPath });
    }

    // ---------- Dashboard UI ----------
    if (path === "/" || path === "/index.html") {
      return new Response(dashboardHTML(), {
        headers: { "Content-Type": "text/html" },
      });
    }

    return err("not found", 404);
  },
});

console.log(`Task API running on http://localhost:${server.port}`);
console.log(`Database: ${DB_PATH}`);

// ---------- Dashboard HTML ----------
function dashboardHTML() {
  const stats = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM tasks").get()!;
  const cats = db.query<Category, []>("SELECT * FROM categories ORDER BY name").all();
  const recent = db.query<Task, []>("SELECT * FROM tasks ORDER BY created_at DESC LIMIT 5").all();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Task Manager | Bun + SQLite</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
    .container { max-width: 800px; margin: 0 auto; padding: 2rem; }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; background: linear-gradient(135deg, #38bdf8, #a78bfa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .subtitle { color: #94a3b8; margin-bottom: 2rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .card { background: #1e293b; border-radius: 12px; padding: 1.5rem; border: 1px solid #334155; }
    .card h3 { font-size: 0.875rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; }
    .card .value { font-size: 2rem; font-weight: 700; }
    .badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }
    .section { margin-bottom: 2rem; }
    .section h2 { font-size: 1.25rem; margin-bottom: 1rem; color: #cbd5e1; }
    .task-list { list-style: none; }
    .task-list li { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 1rem; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center; }
    .task-title { font-weight: 500; }
    .task-meta { font-size: 0.75rem; color: #64748b; }
    .priority-3 { border-left: 3px solid #ef4444; }
    .priority-2 { border-left: 3px solid #f59e0b; }
    .priority-1 { border-left: 3px solid #3b82f6; }
    .priority-0 { border-left: 3px solid #334155; }
    .categories { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .cat-badge { padding: 0.375rem 0.75rem; border-radius: 8px; font-size: 0.8rem; font-weight: 500; }
    .api-info { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 1.5rem; }
    .api-info code { background: #0f172a; padding: 0.125rem 0.375rem; border-radius: 4px; font-size: 0.8rem; color: #38bdf8; }
    .api-row { display: flex; gap: 0.5rem; align-items: center; padding: 0.375rem 0; font-size: 0.875rem; }
    .method { font-weight: 700; font-size: 0.7rem; padding: 0.125rem 0.5rem; border-radius: 4px; }
    .method-get { background: #065f46; color: #34d399; }
    .method-post { background: #1e3a5f; color: #38bdf8; }
    .method-patch { background: #713f12; color: #fbbf24; }
    .method-delete { background: #7f1d1d; color: #fca5a5; }
    .tech { display: flex; gap: 1rem; margin-top: 2rem; justify-content: center; }
    .tech span { background: #1e293b; padding: 0.5rem 1rem; border-radius: 8px; font-size: 0.8rem; border: 1px solid #334155; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Task Manager</h1>
    <p class="subtitle">Bun ${Bun.version} + SQLite — deployed on myserver</p>

    <div class="grid">
      <div class="card">
        <h3>Total Tasks</h3>
        <div class="value">${stats.count}</div>
      </div>
      <div class="card">
        <h3>Categories</h3>
        <div class="value">${cats.length}</div>
      </div>
      <div class="card">
        <h3>Database</h3>
        <div class="value" style="font-size:1rem; color:#38bdf8;">SQLite WAL</div>
      </div>
    </div>

    <div class="section">
      <h2>Categories</h2>
      <div class="categories">
        ${cats.map((c) => `<span class="cat-badge" style="background:${c.color}20;color:${c.color}">${c.name}</span>`).join("")}
      </div>
    </div>

    ${
      recent.length > 0
        ? `<div class="section">
      <h2>Recent Tasks</h2>
      <ul class="task-list">
        ${recent.map((t) => `<li class="priority-${t.priority}"><div><span class="task-title">${t.title}</span><div class="task-meta">${t.status} · priority ${t.priority} · ${t.created_at}</div></div></li>`).join("")}
      </ul>
    </div>`
        : ""
    }

    <div class="section">
      <h2>API Endpoints</h2>
      <div class="api-info">
        <div class="api-row"><span class="method method-get">GET</span> <code>/api/tasks</code> List tasks (filter: status, category_id, tag, search)</div>
        <div class="api-row"><span class="method method-post">POST</span> <code>/api/tasks</code> Create task</div>
        <div class="api-row"><span class="method method-get">GET</span> <code>/api/tasks/:id</code> Get task</div>
        <div class="api-row"><span class="method method-patch">PATCH</span> <code>/api/tasks/:id</code> Update task</div>
        <div class="api-row"><span class="method method-delete">DELETE</span> <code>/api/tasks/:id</code> Delete task</div>
        <div class="api-row"><span class="method method-post">POST</span> <code>/api/tasks/bulk-status</code> Bulk status update</div>
        <div class="api-row"><span class="method method-get">GET</span> <code>/api/categories</code> List categories</div>
        <div class="api-row"><span class="method method-post">POST</span> <code>/api/categories</code> Create category</div>
        <div class="api-row"><span class="method method-get">GET</span> <code>/api/stats</code> Dashboard stats</div>
        <div class="api-row"><span class="method method-get">GET</span> <code>/api/tags</code> Tag autocomplete</div>
        <div class="api-row"><span class="method method-post">POST</span> <code>/api/backup</code> Trigger SQLite backup</div>
        <div class="api-row"><span class="method method-get">GET</span> <code>/health</code> Health check</div>
      </div>
    </div>

    <div class="tech">
      <span>🥟 Bun ${Bun.version}</span>
      <span>🗄️ SQLite</span>
      <span>📦 Zero deps</span>
    </div>
  </div>
</body>
</html>`;
}
