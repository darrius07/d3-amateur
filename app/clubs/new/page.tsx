import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { submitClubCreationRequestAction } from './actions';

type SearchParams = {
  message?: string;
  club_name?: string;
  short_name?: string;
  city?: string;
  postal_code?: string;
  department?: string;
  website_url?: string;
  social_url?: string;
  requested_level?: string;
  requested_team_label?: string;
};

export const metadata = { title: 'Ajouter mon club à D3 · D3 Amateur', description: 'Votre club mérite sa place sur D3 — soumettez une demande de création, vérifiée par un Admin D3.' };

export default async function NewClubRequestPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]).toString();
    redirect(`/login?returnTo=${encodeURIComponent(qs ? `/clubs/new?${qs}` : '/clubs/new')}`);
  }
  return (
    <main className="main">
      <Link className="back-link" href="/clubs">← Retour au registre</Link>
      <section className="card missing-club-form">
        <p className="eyebrow">Vestiaire numérique</p>
        <h1>Votre club mérite sa place sur D3.</h1>
        <p>Un Admin D3 vérifiera que le club n’existe pas déjà avant de créer sa page. Cette étape ne prend que quelques minutes.</p>
        <form action={submitClubCreationRequestAction}>
          <label htmlFor="club_name">Nom du club *</label>
          <input className="field" id="club_name" name="club_name" defaultValue={params.club_name} required minLength={2} maxLength={120} />

          <label htmlFor="short_name">Sigle / nom court</label>
          <input className="field" id="short_name" name="short_name" defaultValue={params.short_name} maxLength={40} placeholder="ex. FCB" />

          <label htmlFor="city">Ville *</label>
          <input className="field" id="city" name="city" defaultValue={params.city} required minLength={2} maxLength={80} />

          <label htmlFor="postal_code">Code postal</label>
          <input className="field" id="postal_code" name="postal_code" defaultValue={params.postal_code} maxLength={10} inputMode="numeric" />

          <label htmlFor="department">Département</label>
          <input className="field" id="department" name="department" defaultValue={params.department} maxLength={80} />

          <label htmlFor="requested_level">Niveau / division</label>
          <input className="field" id="requested_level" name="requested_level" defaultValue={params.requested_level} maxLength={80} placeholder="ex. Départemental 3" />

          <label htmlFor="requested_team_label">Équipe concernée</label>
          <input className="field" id="requested_team_label" name="requested_team_label" defaultValue={params.requested_team_label} maxLength={80} placeholder="ex. Seniors A" />

          <label htmlFor="website_url">Site officiel</label>
          <input className="field" id="website_url" name="website_url" type="url" defaultValue={params.website_url} placeholder="https://…" />

          <label htmlFor="social_url">Réseau social officiel</label>
          <input className="field" id="social_url" name="social_url" type="url" defaultValue={params.social_url} placeholder="https://…" />

          <p className="missing-club-scope-note">D3 se concentre actuellement sur le football senior masculin amateur. Votre club peut aussi avoir des équipes jeunes ou féminines — elles ne sont pas encore gérées sur D3, mais cela ne bloque pas votre demande.</p>

          <label className="confirmation-toggle" htmlFor="representative_confirmation">
            <input type="checkbox" id="representative_confirmation" name="representative_confirmation" required />
            Je confirme représenter ce club ou agir avec son autorisation.
          </label>

          <button className="button">Envoyer la demande</button>
          {params.message && <p className="message" role="alert">{params.message}</p>}
        </form>
      </section>
    </main>
  );
}
