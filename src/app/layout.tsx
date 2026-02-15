import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Ultra Doc-Intelligence",
  description: "Logistics document RAG + extraction with confidence and guardrails",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
