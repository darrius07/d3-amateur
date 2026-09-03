'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

async function requireAdmin() {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) throw new Error('Non authentifié');
  const { data: profile } = await auth.from('user_profiles').select('d3_admin_role').eq('id', user.id).maybeSingle();
  if (!profile?.d3_admin_role) throw new Error('Accès refusé');
  return user.id;
}

export async function approveClubCreationRequest(formData: FormData) {
  const actorId = await requireAdmin();
  const requestId = String(formData.get('request_id'));
  const admin = createAdminClient();
  const { error } = await admin.rpc('approve_club_creation_request', { actor_id: actorId, p_request_id: requestId });
  if (error) throw error;
  revalidatePath('/admin/club-requests');
  revalidatePath(`/admin/club-requests/${requestId}`);
}

export async function resolveClubCreationRequest(formData: FormData) {
  const actorId = await requireAdmin();
  const requestId = String(formData.get('request_id'));
  const decision = String(formData.get('decision'));
  if (!['NEEDS_INFO', 'REJECTED', 'DUPLICATE'].includes(decision)) throw new Error('Décision invalide');
  const adminNote = String(formData.get('admin_note') || '').trim();
  const publicMessage = String(formData.get('public_message') || '').trim();
  const duplicateCandidateClubId = String(formData.get('duplicate_candidate_club_id') || '').trim();
  if (decision === 'DUPLICATE' && !duplicateCandidateClubId) throw new Error('Un club correspondant est requis pour marquer un doublon');

  const admin = createAdminClient();
  const { error } = await admin.rpc('resolve_club_creation_request', {
    actor_id: actorId,
    p_request_id: requestId,
    p_decision: decision,
    p_admin_note: adminNote || null,
    p_public_message: publicMessage || null,
    p_duplicate_candidate_club_id: duplicateCandidateClubId || null,
  });
  if (error) throw error;
  revalidatePath('/admin/club-requests');
  revalidatePath(`/admin/club-requests/${requestId}`);
}
