import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getClubCreationRequestForAdmin } from '@/lib/clubs/creation-request-data';
import { STATUS_LABEL_FR, isTerminalStatus } from '@/lib/clubs/creation-request';
import { approveClubCreationRequest, resolveClubCreationRequest } from '../actions';

export default async function AdminClubRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) redirect(`/login?returnTo=${encodeURIComponent(`/admin/club-requests/${id}`)}`);
  const { data: profile } = await auth.from('user_profiles').select('d3_admin_role').eq('id', user.id).maybeSingle();
  if (!profile?.d3_admin_role) redirect('/');

  const request = await getClubCreationRequestForAdmin(id);
  if (!request) notFound();

  const canDecide = !isTerminalStatus(request.status);
  const freshLikelyDuplicate = request.freshDuplicateCandidates.find((c) => c.reviewState === 'LIKELY_DUPLICATE');

  return (
    <main className="main admin-registry">
      <Link className="back-link" href="/admin/club-requests">← Demandes de création de club</Link>
      <p className="eyebrow">Administration D3</p>
      <h1>{request.clubName}</h1>
      <p><strong>{STATUS_LABEL_FR[request.status]}</strong> · Demandé par {request.requesterEmail} le {new Date(request.createdAt).toLocaleDateString('fr-FR')}</p>

      <section className="admin-panel">
        <h2>Informations soumises</h2>
        <dl className="admin-detail-list">
          <dt>Ville</dt><dd>{request.city}</dd>
          {request.postalCode && <><dt>Code postal</dt><dd>{request.postalCode}</dd></>}
          {request.department && <><dt>Département</dt><dd>{request.department}</dd></>}
          {request.shortName && <><dt>Sigle</dt><dd>{request.shortName}</dd></>}
          {request.requestedLevel && <><dt>Niveau</dt><dd>{request.requestedLevel}</dd></>}
          {request.requestedTeamLabel && <><dt>Équipe concernée</dt><dd>{request.requestedTeamLabel}</dd></>}
          {request.websiteUrl && <><dt>Site officiel</dt><dd><a href={request.websiteUrl} target="_blank" rel="noopener noreferrer">{request.websiteUrl}</a></dd></>}
          {request.socialUrl && <><dt>Réseau social</dt><dd><a href={request.socialUrl} target="_blank" rel="noopener noreferrer">{request.socialUrl}</a></dd></>}
          <dt>Confirmation représentant</dt><dd>{request.representativeConfirmation ? 'Oui' : 'Non'}</dd>
        </dl>
      </section>

      {(request.duplicateCandidateClub || request.freshDuplicateCandidates.length > 0) && (
        <section className="admin-panel">
          <h2>Doublons possibles</h2>
          {request.duplicateCandidateClub && (
            <p>Détecté à la soumission : <Link href={`/clubs/${request.duplicateCandidateClub.slug}`}>{request.duplicateCandidateClub.displayName}</Link> ({request.duplicateCandidateClub.city ?? 'ville inconnue'}) · {request.duplicateReviewState}</p>
          )}
          {freshLikelyDuplicate && freshLikelyDuplicate.id !== request.duplicateCandidateClub?.id && (
            <p className="warning">Nouveau doublon probable détecté depuis la soumission : <Link href={`/clubs/${freshLikelyDuplicate.slug}`}>{freshLikelyDuplicate.displayName}</Link> ({freshLikelyDuplicate.city ?? 'ville inconnue'})</p>
          )}
          <ul className="admin-list">
            {request.freshDuplicateCandidates.map((c) => (
              <li key={c.id}><Link href={`/clubs/${c.slug}`}><strong>{c.displayName}</strong><span>{c.city ?? 'ville inconnue'} · {c.reviewState}</span></Link></li>
            ))}
          </ul>
        </section>
      )}

      {request.createdClub && (
        <section className="admin-panel">
          <h2>Club créé</h2>
          <Link href={`/clubs/${request.createdClub.slug}`}>{request.createdClub.displayName} →</Link>
        </section>
      )}

      <section className="admin-panel">
        <h2>Historique de décision</h2>
        {request.reviewedAt ? (
          <p>Revu par {request.reviewerEmail ?? 'inconnu'} le {new Date(request.reviewedAt).toLocaleDateString('fr-FR')}</p>
        ) : (
          <p>Aucune décision pour le moment.</p>
        )}
        {request.adminNote && <p>Note interne : {request.adminNote}</p>}
        {request.publicMessage && <p>Message envoyé à l’utilisateur : {request.publicMessage}</p>}
      </section>

      {canDecide && (
        <section className="admin-panel">
          <h2>Décision</h2>
          <form action={approveClubCreationRequest} className="admin-decision-form">
            <input type="hidden" name="request_id" value={request.id} />
            <button className="button">Approuver — créer le club</button>
          </form>
          <form action={resolveClubCreationRequest} className="admin-decision-form">
            <input type="hidden" name="request_id" value={request.id} />
            <label htmlFor="public_message">Message pour l’utilisateur (visible)</label>
            <textarea className="field" id="public_message" name="public_message" maxLength={500} />
            <label htmlFor="admin_note">Note interne (jamais visible par l’utilisateur)</label>
            <textarea className="field" id="admin_note" name="admin_note" maxLength={2000} />
            {request.freshDuplicateCandidates.length > 0 && (
              <>
                <label htmlFor="duplicate_candidate_club_id">Marquer comme doublon de</label>
                <select className="field" id="duplicate_candidate_club_id" name="duplicate_candidate_club_id" defaultValue={request.duplicateCandidateClub?.id ?? ''}>
                  <option value="">— Choisir un club —</option>
                  {request.freshDuplicateCandidates.map((c) => <option key={c.id} value={c.id}>{c.displayName} ({c.city ?? 'ville inconnue'})</option>)}
                </select>
              </>
            )}
            <div className="admin-decision-buttons">
              <button name="decision" value="NEEDS_INFO">Demander des informations</button>
              <button name="decision" value="DUPLICATE">Marquer doublon</button>
              <button className="danger" name="decision" value="REJECTED">Refuser</button>
            </div>
          </form>
        </section>
      )}
    </main>
  );
}
