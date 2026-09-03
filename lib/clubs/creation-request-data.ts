import { createAdminClient } from "@/lib/supabase/admin";
import type { ClubCreationRequestStatus, DuplicateReviewState } from "./creation-request";

export interface DuplicateCandidate {
  id: string;
  displayName: string;
  slug: string;
  city: string | null;
  postalCode: string | null;
  claimStatus: string;
  reviewState: DuplicateReviewState;
}

interface DuplicateCandidateRow {
  id: string;
  display_name: string;
  slug: string;
  city: string | null;
  postal_code: string | null;
  claim_status: string;
  review_state: DuplicateReviewState;
}

/** Read-only duplicate preview -- same RPC the DB trigger uses, called ahead of submission so the form can show "Ce club est peut-être déjà dans D3" (mission section 13) before the row even exists. */
export async function findDuplicateCandidates(name: string, city?: string | null, postalCode?: string | null): Promise<DuplicateCandidate[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("find_duplicate_club_candidates", { p_name: name, p_city: city ?? null, p_postal_code: postalCode ?? null });
  if (error) throw error;
  return ((data ?? []) as DuplicateCandidateRow[]).map((row) => ({
    id: row.id, displayName: row.display_name, slug: row.slug, city: row.city, postalCode: row.postal_code,
    claimStatus: row.claim_status, reviewState: row.review_state,
  }));
}

export interface SubmitClubCreationRequestInput {
  clubName: string;
  shortName?: string | null;
  city: string;
  postalCode?: string | null;
  department?: string | null;
  websiteUrl?: string | null;
  socialUrl?: string | null;
  requestedLevel?: string | null;
  requestedTeamLabel?: string | null;
  representativeConfirmation: boolean;
}

export type SubmitClubCreationRequestResult =
  | { ok: true; id: string }
  | { ok: false; code: "DUPLICATE_REQUEST" | "VALIDATION"; message: string };

/**
 * Mirrors app/clubs/[slug]/claim/actions.ts's submitClaim exactly: the
 * caller resolves the real user server-side and passes requestedBy in --
 * this function never trusts a client-supplied identity. The insert goes
 * through the admin/service_role client with the same explicit,
 * server-verified requested_by (mission section 3: this alone never
 * creates a club -- RLS's own INSERT policy exists purely as defense in
 * depth for a hypothetical direct-client call). The BEFORE INSERT trigger
 * still computes duplicate_candidate_club_id/duplicate_review_state
 * unconditionally, regardless of which client performs the insert.
 */
export async function submitClubCreationRequest(requestedBy: string, input: SubmitClubCreationRequestInput): Promise<SubmitClubCreationRequestResult> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("club_creation_requests")
    .insert({
      requested_by: requestedBy,
      club_name: input.clubName,
      short_name: input.shortName,
      city: input.city,
      postal_code: input.postalCode,
      department: input.department,
      website_url: input.websiteUrl,
      social_url: input.socialUrl,
      requested_level: input.requestedLevel,
      requested_team_label: input.requestedTeamLabel,
      representative_confirmation: input.representativeConfirmation,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, code: "DUPLICATE_REQUEST", message: "Une demande active existe déjà pour ce club." };
    return { ok: false, code: "VALIDATION", message: "Impossible d’envoyer la demande — vérifiez les informations saisies." };
  }
  return { ok: true, id: data.id };
}

export interface MyClubCreationRequest {
  id: string;
  status: ClubCreationRequestStatus;
  clubName: string;
  city: string;
  createdAt: string;
  publicMessage: string | null;
  createdClub: { slug: string; displayName: string } | null;
  duplicateCandidateClub: { slug: string; displayName: string } | null;
}

/** "Mes demandes" (mission section 17) -- a status view, never the full admin picture. Never selects admin_note. */
export async function getMyClubCreationRequests(userId: string): Promise<MyClubCreationRequest[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("club_creation_requests")
    .select("id,status,club_name,city,created_at,public_message,created_club_id,duplicate_candidate_club_id")
    .eq("requested_by", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  const clubIds = [...new Set(rows.flatMap((r) => [r.created_club_id, r.duplicate_candidate_club_id]).filter((id): id is string => Boolean(id)))];
  const clubs = clubIds.length
    ? (await admin.from("clubs").select("id,slug,display_name").in("id", clubIds).throwOnError()).data ?? []
    : [];
  const clubById = new Map(clubs.map((c) => [c.id, { slug: c.slug, displayName: c.display_name }]));
  return rows.map((r) => ({
    id: r.id, status: r.status, clubName: r.club_name, city: r.city, createdAt: r.created_at, publicMessage: r.public_message,
    createdClub: r.created_club_id ? clubById.get(r.created_club_id) ?? null : null,
    duplicateCandidateClub: r.duplicate_candidate_club_id ? clubById.get(r.duplicate_candidate_club_id) ?? null : null,
  }));
}

export interface AdminClubCreationRequestListItem {
  id: string;
  status: ClubCreationRequestStatus;
  clubName: string;
  city: string;
  createdAt: string;
  requesterEmail: string;
  duplicateCandidateClub: { id: string; displayName: string; city: string | null } | null;
  duplicateReviewState: DuplicateReviewState;
}

const ADMIN_LIST_COLUMNS = "id,status,club_name,city,created_at,requested_by,duplicate_candidate_club_id,duplicate_review_state";

/** Admin list (mission section 18), optionally filtered by a single status. */
export async function listClubCreationRequestsForAdmin(status?: ClubCreationRequestStatus): Promise<AdminClubCreationRequestListItem[]> {
  const admin = createAdminClient();
  let query = admin.from("club_creation_requests").select(ADMIN_LIST_COLUMNS).order("created_at", { ascending: false }).limit(100);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];
  const candidateIds = [...new Set(rows.map((r) => r.duplicate_candidate_club_id).filter((id): id is string => Boolean(id)))];
  const [candidateClubs, emails] = await Promise.all([
    candidateIds.length ? (await admin.from("clubs").select("id,display_name,city").in("id", candidateIds).throwOnError()).data ?? [] : [],
    resolveEmails(admin, [...new Set(rows.map((r) => r.requested_by))]),
  ]);
  const candidateById = new Map(candidateClubs.map((c) => [c.id, { id: c.id, displayName: c.display_name, city: c.city }]));
  return rows.map((r) => ({
    id: r.id, status: r.status, clubName: r.club_name, city: r.city, createdAt: r.created_at,
    requesterEmail: emails.get(r.requested_by) ?? "E-mail indisponible",
    duplicateCandidateClub: r.duplicate_candidate_club_id ? candidateById.get(r.duplicate_candidate_club_id) ?? null : null,
    duplicateReviewState: r.duplicate_review_state,
  }));
}

export interface AdminClubCreationRequestDetail {
  id: string;
  status: ClubCreationRequestStatus;
  clubName: string;
  shortName: string | null;
  city: string;
  postalCode: string | null;
  department: string | null;
  websiteUrl: string | null;
  socialUrl: string | null;
  requestedLevel: string | null;
  requestedTeamLabel: string | null;
  representativeConfirmation: boolean;
  adminNote: string | null;
  publicMessage: string | null;
  createdAt: string;
  reviewedAt: string | null;
  requesterEmail: string;
  reviewerEmail: string | null;
  createdClub: { id: string; slug: string; displayName: string } | null;
  duplicateCandidateClub: { id: string; slug: string; displayName: string; city: string | null; claimStatus: string } | null;
  duplicateReviewState: DuplicateReviewState;
  freshDuplicateCandidates: DuplicateCandidate[];
}

/** Admin detail (mission section 19): every submitted field, decision history, and a FRESH duplicate re-check (mission section 43) -- never relying only on the submission-time snapshot the list/trigger already captured. */
export async function getClubCreationRequestForAdmin(id: string): Promise<AdminClubCreationRequestDetail | null> {
  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("club_creation_requests")
    .select("id,status,club_name,short_name,city,postal_code,department,website_url,social_url,requested_level,requested_team_label,representative_confirmation,admin_note,public_message,created_at,reviewed_at,requested_by,reviewed_by,created_club_id,duplicate_candidate_club_id,duplicate_review_state")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!row) return null;

  const clubIds = [row.created_club_id, row.duplicate_candidate_club_id].filter((v): v is string => Boolean(v));
  const [clubs, emails, freshDuplicates] = await Promise.all([
    clubIds.length ? (await admin.from("clubs").select("id,slug,display_name,city,claim_status").in("id", clubIds).throwOnError()).data ?? [] : [],
    resolveEmails(admin, [row.requested_by, row.reviewed_by].filter((v): v is string => Boolean(v))),
    findDuplicateCandidates(row.club_name, row.city, row.postal_code),
  ]);
  const clubById = new Map(clubs.map((c) => [c.id, c]));
  const createdClub = row.created_club_id ? clubById.get(row.created_club_id) : undefined;
  const duplicateClub = row.duplicate_candidate_club_id ? clubById.get(row.duplicate_candidate_club_id) : undefined;

  return {
    id: row.id, status: row.status, clubName: row.club_name, shortName: row.short_name, city: row.city, postalCode: row.postal_code,
    department: row.department, websiteUrl: row.website_url, socialUrl: row.social_url, requestedLevel: row.requested_level,
    requestedTeamLabel: row.requested_team_label, representativeConfirmation: row.representative_confirmation,
    adminNote: row.admin_note, publicMessage: row.public_message, createdAt: row.created_at, reviewedAt: row.reviewed_at,
    requesterEmail: emails.get(row.requested_by) ?? "E-mail indisponible",
    reviewerEmail: row.reviewed_by ? emails.get(row.reviewed_by) ?? null : null,
    createdClub: createdClub ? { id: createdClub.id, slug: createdClub.slug, displayName: createdClub.display_name } : null,
    duplicateCandidateClub: duplicateClub
      ? { id: duplicateClub.id, slug: duplicateClub.slug, displayName: duplicateClub.display_name, city: duplicateClub.city, claimStatus: duplicateClub.claim_status }
      : null,
    duplicateReviewState: row.duplicate_review_state,
    freshDuplicateCandidates: freshDuplicates,
  };
}

async function resolveEmails(admin: ReturnType<typeof createAdminClient>, userIds: string[]): Promise<Map<string, string>> {
  const emails = new Map<string, string>();
  for (const id of userIds) {
    const { data } = await admin.auth.admin.getUserById(id);
    emails.set(id, data.user?.email ?? "E-mail indisponible");
  }
  return emails;
}
