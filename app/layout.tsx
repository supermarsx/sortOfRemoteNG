import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = { // eslint-disable-line react-refresh/only-export-components
  title: 'sortOfRemoteNG',
  description: 'A remote management tool',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  )
}