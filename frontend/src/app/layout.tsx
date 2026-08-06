import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: '防災マップシステム',
  description: '防災関連情報および現場の活動状況を地図上で可視化するWebマップ',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#3b82f6',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  )
}
