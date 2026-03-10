export const metadata = {
  title: 'Next.js on Railpack',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: system-ui, -apple-system, sans-serif; background: #0a0a0a; color: #ededed; }
          a { color: #0070f3; text-decoration: none; }
          a:hover { text-decoration: underline; }
        `}</style>
      </head>
      <body>
        <nav style={{
          display: 'flex', gap: '1.5rem', padding: '1rem 2rem',
          borderBottom: '1px solid #333', background: '#111'
        }}>
          <a href="/" style={{ fontWeight: 700, color: '#fff' }}>Next.js Sample</a>
          <a href="/notes">Notes</a>
          <a href="/status">Status</a>
          <a href="/about">About</a>
        </nav>
        <main style={{ maxWidth: 800, margin: '0 auto', padding: '2rem' }}>
          {children}
        </main>
      </body>
    </html>
  )
}
