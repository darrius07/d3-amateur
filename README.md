# D3 Amateur

Fondation technique indépendante de D3 Amateur : Next.js, TypeScript, Tailwind et Supabase.

## Déploiement et environnement

- Repo GitHub dédié : `darrius07/d3-amateur`
- Projet Vercel dédié : `d3-amateur`
- Supabase D3 Amateur : à créer séparément depuis un accès Supabase authentifié
- Les secrets ne sont jamais commités ; les variables sont déclarées dans `.env.example` et renseignées localement dans `.env.local` ou dans les variables d’environnement Vercel/Supabase.

## Développement local

1. Copier `.env.example` vers `.env.local` et renseigner les valeurs du projet Supabase D3 Amateur.
2. Installer les dépendances avec `npm install`.
3. Démarrer Supabase localement avec `npx supabase start` (ou `npx supabase db reset` après `supabase link` sur le projet distant si le CLI est connecté).
4. Appliquer les migrations avec `npx supabase db reset`.
5. Lancer l'application avec `npm run dev`.

Les migrations SQL sont la source de vérité du schéma. Aucune clé `service_role` n'est utilisée côté client.

## Foundation Step 1

- Base App Router Next.js + TypeScript + Tailwind
- Client Supabase navigateur et serveur séparés
- Auth baseline avec création automatique de `user_profiles`
- Schéma DB fondamental versionné dans `supabase/migrations`
- RLS et grants minimaux prévus dans les migrations
- Extensions de recherche `pg_trgm` et `unaccent` activées
- Préparation d’architecture provider adapter vide

## Blocage actuel

Le projet Vercel dédié a bien été créé. L’étape Supabase cloud est bloquée tant que le CLI Supabase n’est pas authentifié (flux interactif / SSO / 2FA requis par l’outil), sans soumettre de secret dans le chat ; les migrations et tests SQL sont néanmoins préparés dans le dépôt pour continuer dès que ce point est validé.
