import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Live status | Amsterdam Roleplay",
  description: "Bekijk de actuele status en beschikbaarheid van Amsterdam Roleplay-diensten.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nl">
      <body className="antialiased">{children}</body>
    </html>
  );
}
