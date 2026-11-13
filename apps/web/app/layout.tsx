import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Hephaestus",
  description: "Agentic software factory: operations ledger",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <strong>Hephaestus</strong>
          <span className="muted">Operations ledger</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
