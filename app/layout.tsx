import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "D3 Amateur",
  description: "La fondation numérique du football amateur français.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>
        <div className="shell">
          <header className="nav">
            <Link className="brand" href="/">
              <span className="mark">D3</span>
              D3 Amateur
            </Link>
            <nav className="links" aria-label="Navigation principale">
              <Link href="/clubs">Clubs</Link>
              <Link href="/admin">Admin</Link>
              <Link href="/login">Connexion</Link>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
