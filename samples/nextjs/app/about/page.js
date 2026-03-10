export default function AboutPage() {
  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>About</h1>

      <div style={{
        padding: '1.5rem', borderRadius: 8,
        border: '1px solid #333', background: '#161616',
        lineHeight: 1.8,
      }}>
        <p>
          A sample <strong>Next.js 14</strong> application deployed on{' '}
          <strong>MyServer</strong> via <strong>Railpack</strong> auto-detection.
        </p>

        <h2 style={{ fontSize: '1.1rem', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Tech Stack</h2>
        <ul style={{ paddingLeft: '1.5rem', color: '#888' }}>
          <li>Next.js 14 — App Router with React Server Components</li>
          <li>PostgreSQL — Notes CRUD via <code style={{ background: '#222', padding: '0.15rem 0.4rem', borderRadius: 4 }}>pg</code> driver</li>
          <li>Standalone output — optimized production build</li>
          <li>Railpack — zero-config build &amp; deploy</li>
        </ul>

        <h2 style={{ fontSize: '1.1rem', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Pages</h2>
        <ul style={{ paddingLeft: '1.5rem', color: '#888' }}>
          <li><a href="/">/</a> — Home with dashboard cards</li>
          <li><a href="/notes">/notes</a> — CRUD notes stored in PostgreSQL</li>
          <li><a href="/status">/status</a> — Server health &amp; DB connectivity</li>
          <li><a href="/health">/health</a> — Simple health check (API route)</li>
        </ul>
      </div>
    </div>
  )
}
