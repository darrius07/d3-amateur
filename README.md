# D3 Amateur

Fondation technique indépendante de D3 Amateur : Next.js, TypeScript, Tailwind et Supabase.

## Développement local

1. Copier `.env.example` vers `.env.local` et renseigner les clés publiques du projet Supabase D3 Amateur.
2. Installer les dépendances avec `npm install`.
3. Démarrer Supabase localement avec `npx supabase start`, puis appliquer les migrations avec `npx supabase db reset`.
4. Lancer l'application avec `npm run dev`.

Les migrations SQL sont la source de vérité du schéma. Aucune clé `service_role` n'est utilisée par l'application.
