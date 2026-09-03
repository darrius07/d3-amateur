import Image from 'next/image';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { submitClubCreationRequestAction } from '../actions';

type SearchParams = {
  candidate_id?: string;
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

/**
 * Mission sections 13/14: a strong duplicate candidate is shown before the
 * request is ever created -- "Ce club est peut-être déjà dans D3", with a
 * direct path to the existing Claim flow (never a new OWNER path of its
 * own), and a secondary "Ce n'est pas mon club" that resubmits the exact
 * same form values plus confirmed_not_duplicate=1 to the real submission
 * action (mission section 12: never auto-merge, the user always decides
 * whether to continue).
 */
export default async function DuplicateCandidatePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  if (!params.candidate_id || !params.club_name || !params.city) redirect('/clubs/new');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?returnTo=${encodeURIComponent('/clubs/new')}`);

  const admin = createAdminClient();
  const { data: candidate } = await admin.from('clubs').select('slug,display_name,city,logo_path').eq('id', params.candidate_id).maybeSingle();
  if (!candidate) notFound();
  let logoUrl: string | null = null;
  if (candidate.logo_path) {
    const { data } = await admin.storage.from('club-assets').createSignedUrl(candidate.logo_path, 3600);
    logoUrl = data?.signedUrl ?? null;
  }

  return (
    <main className="main">
      <Link className="back-link" href="/clubs/new">← Modifier ma demande</Link>
      <section className="card duplicate-candidate-card">
        <p className="eyebrow">Vérification anti-doublon</p>
        <h1>Ce club est peut-être déjà dans D3</h1>
        <div className="identity-card">
          {logoUrl ? <Image unoptimized className="identity-card-logo" src={logoUrl} alt={`Logo ${candidate.display_name}`} width={84} height={84} /> : <div className="identity-card-logo identity-card-logo-placeholder" aria-hidden="true">D3</div>}
          <div className="identity-card-body">
            <h2>{candidate.display_name}</h2>
            <p className="identity-card-meta">{candidate.city ?? 'Ville non renseignée'}</p>
          </div>
        </div>
        <div className="duplicate-candidate-actions">
          <Link className="button" href={`/clubs/${candidate.slug}/claim`}>Revendiquer ce club</Link>
          <Link className="text-link" href={`/clubs/${candidate.slug}`}>Voir la page du club</Link>
        </div>
        <hr className="duplicate-candidate-divider" />
        <p>Ce n’est pas votre club ? Vous pouvez continuer votre demande — un Admin D3 vérifiera tout de même les deux fiches avant toute création.</p>
        <form action={submitClubCreationRequestAction}>
          <input type="hidden" name="confirmed_not_duplicate" value="1" />
          <input type="hidden" name="club_name" value={params.club_name} />
          <input type="hidden" name="short_name" value={params.short_name ?? ''} />
          <input type="hidden" name="city" value={params.city} />
          <input type="hidden" name="postal_code" value={params.postal_code ?? ''} />
          <input type="hidden" name="department" value={params.department ?? ''} />
          <input type="hidden" name="website_url" value={params.website_url ?? ''} />
          <input type="hidden" name="social_url" value={params.social_url ?? ''} />
          <input type="hidden" name="requested_level" value={params.requested_level ?? ''} />
          <input type="hidden" name="requested_team_label" value={params.requested_team_label ?? ''} />
          <input type="hidden" name="representative_confirmation" value="on" />
          <button className="button button-secondary">Ce n’est pas mon club — continuer ma demande</button>
        </form>
      </section>
    </main>
  );
}
