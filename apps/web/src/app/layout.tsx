import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Claude Pocket Console",
  description: "AI-powered browser development console",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}