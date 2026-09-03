// Reuses the exact same magic-byte content validation as club logos
// (lib/clubs/logo.ts) -- real MIME sniffing, never trusting a declared
// Content-Type or file extension alone.
export { MAX_LOGO_BYTES, detectLogoType, validateLogo } from "../clubs/logo";

/**
 * sponsors/{club_id}/{club_sponsor_id}/{generated_filename} (mission
 * section 10) -- never a user-supplied name as the canonical path, no path
 * traversal possible since every segment is validated as either a UUID we
 * generated/looked up ourselves or a fixed extension from an allow-list.
 * The storage RLS policies key authorization off segment [2] (club_id)
 * alone via has_active_club_role, mirroring clubLogoPath exactly.
 */
export function sponsorLogoPath(clubId: string, clubSponsorId: string, fileId: string, extension: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(clubId) || !/^[0-9a-f-]{36}$/i.test(clubSponsorId) || !/^[0-9a-f-]{36}$/i.test(fileId) || !["png", "jpg", "webp"].includes(extension)) {
    throw new Error("Chemin de logo invalide.");
  }
  return `sponsors/${clubId}/${clubSponsorId}/${fileId}.${extension}`;
}
