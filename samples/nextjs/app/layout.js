export const metadata = {
  title: 'Next.js on Railpack',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
