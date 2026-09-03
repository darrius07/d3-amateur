import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { listClubCreationRequestsForAdmin } from '@/lib/clubs/creation-request-data';
import { STATUS_LABEL_FR, type ClubCreationRequestStatus } from '@/lib/clubs/creation-request';

const FILTERS: { value: ClubCreationRequestStatus | ''; label: string }[] = [
  { value: '', label: 'Toutes' },
  { value: 'PENDING_REVIEW', label: 'En attente' },
  { value: 'NEEDS_INFO', label: 'Infos demandées' },
  { value: 'APPROVED', label: 'Approuvées' },
  { value: 'REJECTED', label: 'Refusées' },
  { value: 'DUPLICATE', label: 'Doublons' },
];

export default async function AdminClubRequestsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) redirect('/login?returnTo=/admin/club-requests');
  const { data: profile } = await auth.from('user_profiles').select('d3_admin_role').eq('id', user.id).maybeSingle();
  if (!profile?.d3_admin_role) redirect('/');

  const activeStatus = (status && FILTERS.some((f) => f.value === status) ? status : '') as ClubCreationRequestStatus | '';
  const requests = await listClubCreationRequestsForAdmin(activeStatus || undefined);

  return (
    <main className="main admin-registry">
      <Link className="back-link" href="/admin">← Admin</Link>
      <p className="eyebrow">Administration D3</p>
      <h1>Demandes de création de club</h1>
      <nav className="admin-filters" aria-label="Filtrer par statut">
        {FILTERS.map((f) => (
          <Link key={f.value || 'all'} href={f.value ? `/admin/club-requests?status=${f.value}` : '/admin/club-requests'} className={activeStatus === f.value ? 'admin-filter-active' : undefined} aria-current={activeStatus === f.value ? 'true' : undefined}>
            {f.label}
          </Link>
        ))}
      </nav>
      <section className="admin-panel">
        {requests.length ? (
          <ul className="admin-list">
            {requests.map((r) => (
              <li key={r.id}>
                <Link href={`/admin/club-requests/${r.id}`}>
                  <strong>{r.clubName}</strong>
                  <span>{r.city} · {r.requesterEmail} · {new Date(r.createdAt).toLocaleDateString('fr-FR')}</span>
                  <small>{STATUS_LABEL_FR[r.status]}{r.duplicateCandidateClub ? ` · Doublon possible : ${r.duplicateCandidateClub.displayName}` : ''}</small>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p>Aucune demande pour ce filtre.</p>
        )}
      </section>
    </main>
  );
}
