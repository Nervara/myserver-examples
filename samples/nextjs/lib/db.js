import { Pool } from 'pg'

let pool

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) return null
    pool = new Pool({ connectionString, max: 5 })
  }
  return pool
}

export async function query(text, params) {
  const p = getPool()
  if (!p) return null
  return p.query(text, params)
}

export async function initDB() {
  const p = getPool()
  if (!p) return false
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS notes (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    return true
  } catch (err) {
    console.error('Failed to initialize DB:', err.message)
    return false
  }
}
