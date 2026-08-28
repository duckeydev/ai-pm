import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ai-pm",
  description: "HQ AI job runner",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
