'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function NoteForm() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    const form = new FormData(e.target)
    await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: form.get('title'),
        content: form.get('content'),
      }),
    })
    e.target.reset()
    setLoading(false)
    router.refresh()
  }

  const inputStyle = {
    width: '100%', padding: '0.5rem 0.75rem', borderRadius: 6,
    border: '1px solid #333', background: '#1c1c1c', color: '#ededed',
    fontSize: '0.9rem',
  }

  return (
    <form onSubmit={handleSubmit} style={{
      display: 'flex', flexDirection: 'column', gap: '0.75rem',
      padding: '1rem', borderRadius: 8, border: '1px solid #333', background: '#111',
    }}>
      <input name="title" placeholder="Note title" required style={inputStyle} />
      <textarea name="content" placeholder="Content (optional)" rows={3} style={inputStyle} />
      <button type="submit" disabled={loading} style={{
        padding: '0.5rem 1rem', borderRadius: 6, border: 'none',
        background: '#0070f3', color: '#fff', cursor: 'pointer',
        fontSize: '0.9rem', alignSelf: 'flex-start',
        opacity: loading ? 0.6 : 1,
      }}>
        {loading ? 'Saving...' : 'Add Note'}
      </button>
    </form>
  )
}

export function DeleteButton({ id }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleDelete() {
    setLoading(true)
    await fetch(`/api/notes?id=${id}`, { method: 'DELETE' })
    setLoading(false)
    router.refresh()
  }

  return (
    <button onClick={handleDelete} disabled={loading} style={{
      padding: '0.25rem 0.5rem', borderRadius: 4, border: '1px solid #333',
      background: 'transparent', color: '#f87171', cursor: 'pointer',
      fontSize: '0.8rem', flexShrink: 0,
      opacity: loading ? 0.5 : 1,
    }}>
      {loading ? '...' : 'Delete'}
    </button>
  )
}
