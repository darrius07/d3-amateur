import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getClubStaffForStudio, getClubTeamsForStaff } from '@/lib/staff/staff-data';
import { NO_STAFF_STUDIO_MESSAGE, STAFF_ROLES, STAFF_ROLE_LABELS, groupStaffForDisplay, roleDisplayLabel, staffInitials } from '@/lib/staff/staff';
import { addClubStaff, deactivateClubStaff, updateClubStaff } from '../actions';

export const metadata: Metadata = { title: 'Staff · Club Studio' };

const MESSAGES: Record<string, string> = { 'staff-added': 'Membre du staff ajouté.', 'staff-updated': 'Membre du staff mis à jour.', 'staff-removed': 'Membre retiré du staff.' };

type Props = { searchParams: Promise<{ club_id?: string; message?: string }> };

function RoleSelect({ name, defaultValue }: { name: string; defaultValue?: string }) {
  return (
    <select name={name} defaultValue={defaultValue ?? 'HEAD_COACH'} required>
      {STAFF_ROLES.map((role) => <option key={role} value={role}>{STAFF_ROLE_LABELS[role]}</option>)}
    </select>
  );
}

function TeamSelect({ name, teams, defaultValue }: { name: string; teams: { id: string; label: string }[]; defaultValue?: string | null }) {
  return (
    <select name={name} defaultValue={defaultValue ?? ''}>
      <option value="">Aucune (fonction pour tout le club)</option>
      {teams.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
    </select>
  );
}

export default async function ClubStaffPage({ searchParams }: Props) {
  const { club_id: clubId, message } = await searchParams;
  if (!clubId) notFound();

  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) redirect(`/login?returnTo=${encodeURIComponent(`/club-studio/staff?club_id=${clubId}`)}`);

  const admin = createAdminClient();
  const [{ data: membership }, { data: adminProfile }] = await Promise.all([
    admin.from('club_memberships').select('id').eq('club_id', clubId).eq('user_id', user.id).eq('role', 'OWNER').eq('active', true).maybeSingle(),
    admin.from('user_profiles').select('d3_admin_role').eq('id', user.id).maybeSingle(),
  ]);
  if (!membership && !adminProfile?.d3_admin_role) notFound();

  const { data: club } = await admin.from('clubs').select('id,display_name').eq('id', clubId).maybeSingle();
  if (!club) notFound();

  const [staff, teams] = await Promise.all([getClubStaffForStudio(clubId), getClubTeamsForStaff(clubId)]);
  const grouped = groupStaffForDisplay(staff, teams);

  const staffCard = (member: (typeof staff)[number]) => (
    <li className="staff-card" key={member.id}>
      <span className="staff-avatar" aria-hidden="true">{staffInitials(member.displayName)}</span>
      <div className="staff-card-body">
        <strong>{member.displayName}</strong>
        <small>{roleDisplayLabel(member.role, member.customRole)}</small>
        <span className={member.publicVisible ? 'staff-visibility is-public' : 'staff-visibility'}>{member.publicVisible ? 'Public' : 'Privé'}</span>
      </div>
      <details className="staff-edit">
        <summary>Modifier</summary>
        <form action={updateClubStaff} className="roster-form">
          <input type="hidden" name="club_id" value={clubId} />
          <input type="hidden" name="staff_id" value={member.id} />
          <label className="profile-field">Nom affiché<input type="text" name="display_name" defaultValue={member.displayName} maxLength={120} required /></label>
          <label className="profile-field">Fonction<RoleSelect name="role_type" defaultValue={member.role} /></label>
          <label className="profile-field">Si &quot;Autre&quot;, précisez<input type="text" name="custom_role" defaultValue={member.customRole ?? ''} maxLength={120} /></label>
          <label className="profile-field">Équipe<TeamSelect name="team_season_id" teams={teams} defaultValue={member.teamSeasonId} /></label>
          <label className="profile-field">Courte présentation (280 caractères maximum)<textarea name="short_bio" defaultValue={member.shortBio ?? ''} maxLength={280} rows={2} /></label>
          <label className="staff-visible-toggle"><input type="checkbox" name="public_visible" defaultChecked={member.publicVisible} /> Afficher sur la page publique</label>
          <p className="profile-field-sub">Le nom et la fonction de cette personne seront visibles par tous les visiteurs de la fiche club.</p>
          <button className="button">Enregistrer</button>
        </form>
        <form action={deactivateClubStaff}>
          <input type="hidden" name="club_id" value={clubId} />
          <input type="hidden" name="staff_id" value={member.id} />
          <button className="text-danger">Retirer du staff</button>
        </form>
      </details>
    </li>
  );

  return (
    <main className="main studio">
      <Link className="back-link" href="/club-studio">← Retour au Club Studio</Link>
      <p className="eyebrow">Staff</p>
      <h1>Le staff de {club.display_name}</h1>
      <p className="lead">Voici les personnes qui font vivre votre club — direction, encadrement sportif, et toutes celles qui font tourner la maison.</p>
      {message && MESSAGES[message] && <p className="success">{MESSAGES[message]}</p>}

      {staff.length === 0 && (
        <div className="studio-empty-cta">
          <span>{NO_STAFF_STUDIO_MESSAGE}</span>
        </div>
      )}

      {grouped.clubWide.length > 0 && (
        <section className="profile-section">
          <h2>Direction du club</h2>
          <ul className="staff-list">{grouped.clubWide.map(staffCard)}</ul>
        </section>
      )}

      {grouped.byTeam.map(({ team, members }) => (
        <section className="profile-section" key={team.id}>
          <h2>{team.label}</h2>
          <ul className="staff-list">{members.map(staffCard)}</ul>
        </section>
      ))}

      <section className="profile-section">
        <details className="match-form">
          <summary>Ajouter un membre du staff</summary>
          <form action={addClubStaff} className="roster-form">
            <input type="hidden" name="club_id" value={clubId} />
            <label className="profile-field">Nom affiché<input type="text" name="display_name" maxLength={120} required placeholder="Jean Dupont" /></label>
            <label className="profile-field">Fonction<RoleSelect name="role_type" /></label>
            <label className="profile-field">Si &quot;Autre&quot;, précisez<input type="text" name="custom_role" maxLength={120} placeholder="Responsable buvette" /></label>
            <label className="profile-field">Équipe<TeamSelect name="team_season_id" teams={teams} /></label>
            <label className="profile-field">Courte présentation (facultatif, 280 caractères maximum)<textarea name="short_bio" maxLength={280} rows={2} placeholder="Entraîneur de l'équipe Seniors A depuis 2024." /></label>
            <label className="staff-visible-toggle"><input type="checkbox" name="public_visible" /> Afficher sur la page publique</label>
            <p className="profile-field-sub">Le nom et la fonction de cette personne seront visibles par tous les visiteurs de la fiche club.</p>
            <button className="button">Ajouter au staff</button>
          </form>
        </details>
      </section>
    </main>
  );
}
