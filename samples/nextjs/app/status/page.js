import { query } from '../../lib/db'

export const dynamic = 'force-dynamic'

export default async function StatusPage() {
  let dbStatus = { connected: false, version: null, uptime: null, noteCount: null }

  try {
    const versionRes = await query('SELECT version()')
    const uptimeRes = await query("SELECT date_trunc('second', current_timestamp - pg_postmaster_start_time()) AS uptime FROM pg_stat_activity LIMIT 1")
    const countRes = await query('SELECT COUNT(*) FROM notes')

    if (versionRes) {
      dbStatus.connected = true
      dbStatus.version = versionRes.rows[0].version.split(' ').slice(0, 2).join(' ')
      dbStatus.uptime = uptimeRes?.rows[0]?.uptime || 'unknown'
      dbStatus.noteCount = parseInt(countRes.rows[0].count, 10)
    }
  } catch {}

  const checks = [
    { name: 'Next.js Server', status: 'ok', detail: `PID ${process.pid}` },
    { name: 'Node.js', status: 'ok', detail: process.version },
    { name: 'PostgreSQL', status: dbStatus.connected ? 'ok' : 'error', detail: dbStatus.version || 'Not connected' },
    { name: 'DB Uptime', status: dbStatus.connected ? 'ok' : 'error', detail: dbStatus.uptime || '-' },
    { name: 'Notes Count', status: dbStatus.connected ? 'ok' : 'error', detail: dbStatus.noteCount !== null ? String(dbStatus.noteCount) : '-' },
    { name: 'Memory', status: 'ok', detail: `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB RSS` },
  ]

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Status</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {checks.map(c => (
          <div key={c.name} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '0.75rem 1rem', borderRadius: 8,
            border: '1px solid #333', background: '#161616',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: c.status === 'ok' ? '#22c55e' : '#f87171',
              }} />
              <span>{c.name}</span>
            </div>
            <span style={{ color: '#888', fontSize: '0.85rem' }}>{c.detail}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
