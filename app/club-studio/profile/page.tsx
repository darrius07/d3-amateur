import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getClubCompletenessInputs, getClubProfile } from '@/lib/clubs/profile-data';
import { updateClubProfile } from '../actions';
import { ProfileEditor } from './profile-editor';

export const metadata: Metadata = { title: 'Personnaliser mon club · Club Studio' };

const MESSAGES: Record<string, string> = { 'profile-updated': 'Profil mis à jour.' };

type Props = { searchParams: Promise<{ club_id?: string; message?: string }> };

export default async function ClubProfilePage({ searchParams }: Props) {
  const { club_id: clubId, message } = await searchParams;
  if (!clubId) notFound();

  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) redirect(`/login?returnTo=${encodeURIComponent(`/club-studio/profile?club_id=${clubId}`)}`);

  const admin = createAdminClient();
  const [{ data: membership }, { data: adminProfile }] = await Promise.all([
    admin.from('club_memberships').select('id').eq('club_id', clubId).eq('user_id', user.id).eq('role', 'OWNER').eq('active', true).maybeSingle(),
    admin.from('user_profiles').select('d3_admin_role').eq('id', user.id).maybeSingle(),
  ]);
  if (!membership && !adminProfile?.d3_admin_role) notFound();

  const { data: club } = await admin.from('clubs').select('id,slug,display_name,logo_path,city').eq('id', clubId).maybeSingle();
  if (!club) notFound();

  let logoUrl: string | null = null;
  if (club.logo_path) {
    const { data } = await admin.storage.from('club-assets').createSignedUrl(club.logo_path, 3600);
    logoUrl = data?.signedUrl ?? null;
  }

  const [profile, completenessInputs] = await Promise.all([getClubProfile(clubId), getClubCompletenessInputs(clubId)]);

  return (
    <main className="main studio">
      <Link className="back-link" href="/club-studio">← Retour au Club Studio</Link>
      <p className="eyebrow">Personnalisation</p>
      <h1>Votre identité D3</h1>
      <p className="lead">Complétez la vitrine publique de {club.display_name}. Chaque élément renseigné rend votre fiche plus crédible et plus complète.</p>
      {message && MESSAGES[message] && <p className="success">{MESSAGES[message]}</p>}
      <ProfileEditor
        clubId={club.id}
        displayName={club.display_name}
        city={club.city}
        logoUrl={logoUrl}
        profile={profile}
        hasActiveTeam={completenessInputs.hasActiveTeam}
        hasRosterOrMatch={completenessInputs.hasRosterOrMatch}
        action={updateClubProfile}
      />
    </main>
  );
}
