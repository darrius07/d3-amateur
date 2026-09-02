import type { Metadata } from "next";
import Link from "next/link";
import {createClient} from '@/lib/supabase/server';
import {logout} from '@/app/login/actions';
import "./globals.css";

export const metadata: Metadata = {
  title: "D3 Amateur",
  description: "La fondation numérique du football amateur français.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();
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
              {user&&<Link href="/my/claims">Mes demandes</Link>}
              {user&&<Link href="/club-studio">Club Studio</Link>}
              <Link href="/admin">Admin</Link>
              {user?<form action={logout}><button className="nav-button">Déconnexion</button></form>:<Link href="/login">Connexion</Link>}
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
