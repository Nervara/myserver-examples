import { query, initDB } from '../../lib/db'
import { NoteForm, DeleteButton } from './client'

export const dynamic = 'force-dynamic'

export default async function NotesPage() {
  const dbReady = await initDB()

  let notes = []
  if (dbReady) {
    const res = await query('SELECT * FROM notes ORDER BY created_at DESC')
    if (res) notes = res.rows
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Notes</h1>

      {!dbReady ? (
        <p style={{ color: '#f87171', padding: '1rem', background: '#1c1c1c', borderRadius: 8 }}>
          Database not connected. Set <code>DATABASE_URL</code> environment variable.
        </p>
      ) : (
        <>
          <NoteForm />

          <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {notes.length === 0 && (
              <p style={{ color: '#888' }}>No notes yet. Create one above!</p>
            )}
            {notes.map(note => (
              <div key={note.id} style={{
                padding: '1rem', borderRadius: 8,
                border: '1px solid #333', background: '#161616',
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'
              }}>
                <div>
                  <h3 style={{ marginBottom: '0.25rem' }}>{note.title}</h3>
                  {note.content && <p style={{ color: '#888', fontSize: '0.9rem' }}>{note.content}</p>}
                  <p style={{ color: '#555', fontSize: '0.75rem', marginTop: '0.5rem' }}>
                    {new Date(note.created_at).toLocaleString()}
                  </p>
                </div>
                <DeleteButton id={note.id} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
