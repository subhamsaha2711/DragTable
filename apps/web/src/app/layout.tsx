import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/lib/toast";
import { SessionGuard } from "@/lib/session-guard";

export const metadata: Metadata = {
  title: "DragTable — Relational database workspace",
  description:
    "Visual relational database management for development teams. Self-hosted, collaborative, structured mutations only.",
  icons: {
    icon: [{ url: "/logo.svg", type: "image/svg+xml" }],
    shortcut: "/logo.svg",
    apple: "/logo.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">
        <ToastProvider>
          <SessionGuard>{children}</SessionGuard>
        </ToastProvider>
      </body>
    </html>
  );
}
