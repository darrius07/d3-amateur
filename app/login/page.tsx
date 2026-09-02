import { login } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { message } = await searchParams;
  return <main className="main"><section className="card"><p className="eyebrow">Espace sécurisé</p><h1>Connexion</h1><form action={login}><label htmlFor="email">Adresse e-mail</label><input className="field" id="email" name="email" type="email" autoComplete="email" required /><label htmlFor="password" className="block mt-4">Mot de passe</label><input className="field" id="password" name="password" type="password" autoComplete="current-password" required /><button className="button" type="submit">Se connecter</button>{message && <p className="message" role="status">{message}</p>}</form></section></main>;
}
