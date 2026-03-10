import { query } from '../lib/db'

export const dynamic = 'force-dynamic'

export default async function Home() {
  let noteCount = null
  try {
    const res = await query('SELECT COUNT(*) FROM notes')
    if (res) noteCount = parseInt(res.rows[0].count, 10)
  } catch {}

  return (
    <div>
      <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>
        Hello from Next.js on Railpack!
      </h1>
      <p style={{ color: '#888', marginBottom: '2rem' }}>
        App Router &middot; React Server Components &middot; PostgreSQL
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <Card title="Notes" href="/notes"
          desc={noteCount !== null ? `${noteCount} notes stored in PostgreSQL` : 'Database not connected'} />
        <Card title="Status" href="/status" desc="Server health & database connectivity" />
        <Card title="About" href="/about" desc="Tech stack & environment info" />
        <Card title="Health" href="/health" desc="Simple health check endpoint" />
      </div>
    </div>
  )
}

function Card({ title, href, desc }) {
  return (
    <a href={href} style={{
      display: 'block', padding: '1.5rem', borderRadius: 8,
      border: '1px solid #333', background: '#161616',
      transition: 'border-color 0.2s',
    }}>
      <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>{title} &rarr;</h2>
      <p style={{ color: '#888', fontSize: '0.9rem' }}>{desc}</p>
    </a>
  )
}
