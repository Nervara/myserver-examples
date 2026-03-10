import { query, initDB } from '../../../lib/db'

export async function POST(request) {
  const dbReady = await initDB()
  if (!dbReady) return Response.json({ error: 'Database not connected' }, { status: 503 })

  const { title, content } = await request.json()
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return Response.json({ error: 'Title is required' }, { status: 400 })
  }

  const res = await query(
    'INSERT INTO notes (title, content) VALUES ($1, $2) RETURNING *',
    [title.trim(), (content || '').trim()]
  )
  return Response.json(res.rows[0], { status: 201 })
}

export async function DELETE(request) {
  const dbReady = await initDB()
  if (!dbReady) return Response.json({ error: 'Database not connected' }, { status: 503 })

  const { searchParams } = new URL(request.url)
  const id = parseInt(searchParams.get('id'), 10)
  if (!id) return Response.json({ error: 'Invalid id' }, { status: 400 })

  await query('DELETE FROM notes WHERE id = $1', [id])
  return Response.json({ deleted: true })
}
