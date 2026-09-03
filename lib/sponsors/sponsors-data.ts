import { createAdminClient } from "@/lib/supabase/admin";
import type { SponsorEntry, SponsorTier } from "./sponsors";

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

/** Club Studio management list: every ACTIVE sponsor row (public or not -- the OWNER manages both), never the deactivated ones. Admin client -- this is the OWNER's own management surface. */
export async function getClubSponsorsForStudio(clubId: string): Promise<SponsorEntry[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("club_sponsors")
    .select("id,tier,custom_tier_label,logo_path,short_message,sort_order,public_visible,sponsors(name,website_url)")
    .eq("club_id", clubId)
    .eq("active", true);
  if (error) throw error;
  return (data ?? []).map((row) => {
    const sponsor = one(row.sponsors) as { name: string; website_url: string | null } | null;
    return {
      id: row.id, name: sponsor?.name ?? "", tier: row.tier as SponsorTier, customTierLabel: row.custom_tier_label,
      logoPath: row.logo_path, websiteUrl: sponsor?.website_url ?? null, shortMessage: row.short_message, sortOrder: row.sort_order,
    };
  });
}

/** Studio-only extra: public_visible flag per row, since the pure SponsorEntry shape (shared with the public page) doesn't carry it. */
export async function getClubSponsorVisibilityMap(clubId: string): Promise<Map<string, boolean>> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("club_sponsors").select("id,public_visible").eq("club_id", clubId).eq("active", true);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.id, row.public_visible]));
}

/** Public surface: sponsors_public already filters active+public_visible and hides every internal column. */
export async function getPublicClubSponsors(clubId: string): Promise<SponsorEntry[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("sponsors_public")
    .select("id,name,tier,custom_tier_label,logo_path,website_url,short_message,sort_order")
    .eq("club_id", clubId);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id, name: row.name, tier: row.tier as SponsorTier, customTierLabel: row.custom_tier_label,
    logoPath: row.logo_path, websiteUrl: row.website_url, shortMessage: row.short_message, sortOrder: row.sort_order,
  }));
}

/** Signed URLs for logos, batched -- one Storage call per club, never one per sponsor (mission-wide N+1 discipline established since Step 5C). */
export async function getSponsorLogoUrls(logoPaths: (string | null)[]): Promise<Map<string, string>> {
  const admin = createAdminClient();
  const paths = [...new Set(logoPaths.filter((p): p is string => Boolean(p)))];
  const map = new Map<string, string>();
  if (!paths.length) return map;
  const { data, error } = await admin.storage.from("sponsor-assets").createSignedUrls(paths, 3600);
  if (error) throw error;
  for (const entry of data ?? []) if (entry.signedUrl && entry.path) map.set(entry.path, entry.signedUrl);
  return map;
}
