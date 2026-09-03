'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { normalizeOptionalText } from '@/lib/clubs/profile';
import { validateClubCreationRequest, type ClubCreationRequestInput } from '@/lib/clubs/creation-request';
import { findDuplicateCandidates, submitClubCreationRequest } from '@/lib/clubs/creation-request-data';

function fieldsFromForm(formData: FormData): ClubCreationRequestInput {
  return {
    clubName: String(formData.get('club_name') || '').trim(),
    shortName: normalizeOptionalText(String(formData.get('short_name') || '')),
    city: String(formData.get('city') || '').trim(),
    postalCode: normalizeOptionalText(String(formData.get('postal_code') || '')),
    department: normalizeOptionalText(String(formData.get('department') || '')),
    websiteUrl: normalizeOptionalText(String(formData.get('website_url') || '')),
    socialUrl: normalizeOptionalText(String(formData.get('social_url') || '')),
    requestedLevel: normalizeOptionalText(String(formData.get('requested_level') || '')),
    requestedTeamLabel: normalizeOptionalText(String(formData.get('requested_team_label') || '')),
    representativeConfirmation: formData.get('representative_confirmation') === 'on',
  };
}

function queryStringFor(input: ClubCreationRequestInput): string {
  const params = new URLSearchParams();
  params.set('club_name', input.clubName);
  if (input.shortName) params.set('short_name', input.shortName);
  params.set('city', input.city);
  if (input.postalCode) params.set('postal_code', input.postalCode);
  if (input.department) params.set('department', input.department);
  if (input.websiteUrl) params.set('website_url', input.websiteUrl);
  if (input.socialUrl) params.set('social_url', input.socialUrl);
  if (input.requestedLevel) params.set('requested_level', input.requestedLevel);
  if (input.requestedTeamLabel) params.set('requested_team_label', input.requestedTeamLabel);
  if (input.representativeConfirmation) params.set('representative_confirmation', 'on');
  return params.toString();
}

/**
 * The single entry point for both the initial form submission and the
 * "Ce n'est pas mon club, je continue" resubmission from the duplicate
 * candidate screen (mission section 13). Auth is required (mission section
 * 8) -- an anonymous submission redirects to login and back. A strong
 * duplicate candidate (mission sections 12-14) is shown once; the request
 * is never blocked outright, but a user who already confirmed they want to
 * continue (confirmed_not_duplicate=1) skips straight to submission -- the
 * BEFORE INSERT trigger still records the duplicate flag either way, so an
 * Admin always sees it regardless of what the user chose on this screen.
 */
export async function submitClubCreationRequestAction(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?returnTo=${encodeURIComponent('/clubs/new')}`);

  const input = fieldsFromForm(formData);
  const validation = validateClubCreationRequest(input);
  if (!validation.valid) {
    redirect(`/clubs/new?${queryStringFor(input)}&message=${encodeURIComponent(validation.error ?? 'Formulaire incomplet')}`);
  }

  const confirmedNotDuplicate = formData.get('confirmed_not_duplicate') === '1';
  if (!confirmedNotDuplicate) {
    const candidates = await findDuplicateCandidates(input.clubName, input.city, input.postalCode);
    const strongMatch = candidates.find((c) => c.reviewState !== 'NONE');
    if (strongMatch) {
      redirect(`/clubs/new/duplicate?${queryStringFor(input)}&candidate_id=${strongMatch.id}`);
    }
  }

  const result = await submitClubCreationRequest(user.id, input);
  if (!result.ok) {
    redirect(`/clubs/new?${queryStringFor(input)}&message=${encodeURIComponent(result.message)}`);
  }
  redirect('/my/claims?submitted=1');
}
