import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getClubSponsorVisibilityMap, getClubSponsorsForStudio, getSponsorLogoUrls } from '@/lib/sponsors/sponsors-data';
import { NO_SPONSORS_STUDIO_MESSAGE, SPONSOR_TIERS, SPONSOR_TIER_LABELS, groupSponsorsByTier, sponsorInitials, tierDisplayLabel } from '@/lib/sponsors/sponsors';
import { addClubSponsor, deactivateClubSponsor, deleteSponsorLogo, updateClubSponsor, uploadSponsorLogo } from '../actions';

export const metadata: Metadata = { title: 'Partenaires · Club Studio' };

const MESSAGES: Record<string, string> = {
  'sponsor-added': 'Partenaire ajouté.', 'sponsor-updated': 'Partenaire mis à jour.', 'sponsor-removed': 'Partenaire retiré.',
  'sponsor-logo-updated': 'Logo mis à jour.', 'sponsor-logo-removed': 'Logo supprimé.',
};

type Props = { searchParams: Promise<{ club_id?: string; message?: string }> };

function TierSelect({ name, defaultValue }: { name: string; defaultValue?: string }) {
  return (
    <select name={name} defaultValue={defaultValue ?? 'PARTNER'} required>
      {SPONSOR_TIERS.map((tier) => <option key={tier} value={tier}>{SPONSOR_TIER_LABELS[tier]}</option>)}
    </select>
  );
}

export default async function ClubSponsorsPage({ searchParams }: Props) {
  const { club_id: clubId, message } = await searchParams;
  if (!clubId) notFound();

  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) redirect(`/login?returnTo=${encodeURIComponent(`/club-studio/sponsors?club_id=${clubId}`)}`);

  const admin = createAdminClient();
  const [{ data: membership }, { data: adminProfile }] = await Promise.all([
    admin.from('club_memberships').select('id').eq('club_id', clubId).eq('user_id', user.id).eq('role', 'OWNER').eq('active', true).maybeSingle(),
    admin.from('user_profiles').select('d3_admin_role').eq('id', user.id).maybeSingle(),
  ]);
  if (!membership && !adminProfile?.d3_admin_role) notFound();

  const { data: club } = await admin.from('clubs').select('id,display_name').eq('id', clubId).maybeSingle();
  if (!club) notFound();

  const [sponsors, visibility] = await Promise.all([getClubSponsorsForStudio(clubId), getClubSponsorVisibilityMap(clubId)]);
  const logoUrls = await getSponsorLogoUrls(sponsors.map((s) => s.logoPath));
  const groups = groupSponsorsByTier(sponsors);

  const sponsorCard = (sponsor: (typeof sponsors)[number]) => {
    const logoUrl = sponsor.logoPath ? logoUrls.get(sponsor.logoPath) : undefined;
    const isPublic = visibility.get(sponsor.id) ?? false;
    return (
      <li className="sponsor-card" key={sponsor.id}>
        {logoUrl ? <Image unoptimized src={logoUrl} alt={`Logo ${sponsor.name}`} width={44} height={44} className="sponsor-logo" /> : <span className="staff-avatar" aria-hidden="true">{sponsorInitials(sponsor.name)}</span>}
        <div className="staff-card-body">
          <strong>{sponsor.name}</strong>
          <small>{tierDisplayLabel(sponsor.tier, sponsor.customTierLabel)}</small>
          <span className={isPublic ? 'staff-visibility is-public' : 'staff-visibility'}>{isPublic ? 'Public' : 'Privé'}</span>
        </div>
        <details className="staff-edit">
          <summary>Modifier</summary>
          <form action={updateClubSponsor} className="roster-form">
            <input type="hidden" name="sponsor_id" value={sponsor.id} />
            <label className="profile-field">Nom du partenaire<input type="text" name="name" defaultValue={sponsor.name} maxLength={120} required /></label>
            <label className="profile-field">Niveau<TierSelect name="tier" defaultValue={sponsor.tier} /></label>
            <label className="profile-field">Si &quot;Autre&quot;, précisez<input type="text" name="custom_tier_label" defaultValue={sponsor.customTierLabel ?? ''} maxLength={120} /></label>
            <label className="profile-field">Site web<input type="text" name="website_url" defaultValue={sponsor.websiteUrl ?? ''} placeholder="https://" /></label>
            <label className="profile-field">Message court (160 caractères maximum)<textarea name="short_message" defaultValue={sponsor.shortMessage ?? ''} maxLength={160} rows={2} /></label>
            <label className="staff-visible-toggle"><input type="checkbox" name="public_visible" defaultChecked={isPublic} /> Afficher sur la page publique</label>
            <p className="profile-field-sub">Le nom, le niveau et le logo de ce partenaire seront visibles par tous les visiteurs de la fiche club. D3 ne garantit aucune exposition, portée ou visibilité mesurée.</p>
            <button className="button">Enregistrer</button>
          </form>
          <form action={uploadSponsorLogo} encType="multipart/form-data">
            <input type="hidden" name="sponsor_id" value={sponsor.id} />
            <label className="upload-label">{sponsor.logoPath ? 'Remplacer le logo' : 'Ajouter un logo'}<input name="logo" type="file" accept="image/png,image/jpeg,image/webp" required /></label>
            <small>PNG, JPEG ou WebP · 5 Mo maximum</small>
            <button className="button">Enregistrer le logo</button>
          </form>
          {sponsor.logoPath && (
            <form action={deleteSponsorLogo}>
              <input type="hidden" name="sponsor_id" value={sponsor.id} />
              <button className="text-danger">Supprimer le logo</button>
            </form>
          )}
          <form action={deactivateClubSponsor}>
            <input type="hidden" name="sponsor_id" value={sponsor.id} />
            <button className="text-danger">Retirer le partenaire</button>
          </form>
        </details>
      </li>
    );
  };

  return (
    <main className="main studio">
      <Link className="back-link" href="/club-studio">← Retour au Club Studio</Link>
      <p className="eyebrow">Partenaires</p>
      <h1>Les partenaires de {club.display_name}</h1>
      <p className="lead">Voici les partenaires qui soutiennent votre club. D3 Amateur n&apos;est pas une régie publicitaire — ces partenariats restent les vôtres.</p>
      {message && MESSAGES[message] && <p className="success">{MESSAGES[message]}</p>}

      {sponsors.length === 0 && (
        <div className="studio-empty-cta">
          <span>{NO_SPONSORS_STUDIO_MESSAGE}</span>
        </div>
      )}

      {groups.map(({ tier, label, sponsors: tierSponsors }) => (
        <section className="profile-section" key={tier}>
          <h2>{label}</h2>
          <ul className="staff-list">{tierSponsors.map(sponsorCard)}</ul>
        </section>
      ))}

      <section className="profile-section">
        <details className="match-form">
          <summary>Ajouter un partenaire</summary>
          <form action={addClubSponsor} className="roster-form">
            <input type="hidden" name="club_id" value={clubId} />
            <label className="profile-field">Nom du partenaire<input type="text" name="name" maxLength={120} required placeholder="Boulangerie Martin" /></label>
            <label className="profile-field">Niveau<TierSelect name="tier" /></label>
            <label className="profile-field">Si &quot;Autre&quot;, précisez<input type="text" name="custom_tier_label" maxLength={120} placeholder="Fournisseur officiel" /></label>
            <label className="profile-field">Site web (facultatif)<input type="text" name="website_url" placeholder="https://" /></label>
            <label className="profile-field">Message court (facultatif, 160 caractères maximum)<textarea name="short_message" maxLength={160} rows={2} placeholder="Partenaire historique du club depuis 2019." /></label>
            <label className="staff-visible-toggle"><input type="checkbox" name="public_visible" /> Afficher sur la page publique</label>
            <p className="profile-field-sub">Le nom, le niveau et le logo de ce partenaire seront visibles par tous les visiteurs de la fiche club. D3 ne garantit aucune exposition, portée ou visibilité mesurée.</p>
            <button className="button">Ajouter le partenaire</button>
          </form>
        </details>
      </section>
    </main>
  );
}
