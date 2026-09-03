import { createAdminClient } from "@/lib/supabase/admin";
import type { ClubCompletenessInput } from "./profile";

export interface ClubProfileRow {
  shortDescription: string | null;
  longDescription: string | null;
  foundedYear: number | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  websiteUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  xUrl: string | null;
  tiktokUrl: string | null;
  youtubeUrl: string | null;
  publicEmail: string | null;
  publicPhone: string | null;
  venueName: string | null;
  venueAddress: string | null;
  venuePostalCode: string | null;
  venueCity: string | null;
}

const EMPTY_PROFILE: ClubProfileRow = {
  shortDescription: null, longDescription: null, foundedYear: null, primaryColor: null, secondaryColor: null,
  websiteUrl: null, facebookUrl: null, instagramUrl: null, xUrl: null, tiktokUrl: null, youtubeUrl: null,
  publicEmail: null, publicPhone: null, venueName: null, venueAddress: null, venuePostalCode: null, venueCity: null,
};

/** club_profiles is entirely public by design (every column is something an OWNER chose to publish) -- this same shape backs both the Club Studio editor's pre-fill and the public /clubs/[slug] sections. No row yet is a valid, empty state, never an error. */
export async function getClubProfile(clubId: string): Promise<ClubProfileRow> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("club_profiles")
    .select("short_description,long_description,founded_year,primary_color,secondary_color,website_url,facebook_url,instagram_url,x_url,tiktok_url,youtube_url,public_email,public_phone,venue_name,venue_address,venue_postal_code,venue_city")
    .eq("club_id", clubId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return EMPTY_PROFILE;
  return {
    shortDescription: data.short_description, longDescription: data.long_description, foundedYear: data.founded_year,
    primaryColor: data.primary_color, secondaryColor: data.secondary_color,
    websiteUrl: data.website_url, facebookUrl: data.facebook_url, instagramUrl: data.instagram_url, xUrl: data.x_url, tiktokUrl: data.tiktok_url, youtubeUrl: data.youtube_url,
    publicEmail: data.public_email, publicPhone: data.public_phone,
    venueName: data.venue_name, venueAddress: data.venue_address, venuePostalCode: data.venue_postal_code, venueCity: data.venue_city,
  };
}

/**
 * Every input the completeness model needs, gathered in a small, constant
 * number of batched queries per club (never one query per player/match --
 * mission section 24). Reuses getClubProfile rather than re-querying
 * club_profiles a second time.
 */
export async function getClubCompletenessInputs(clubId: string): Promise<ClubCompletenessInput> {
  const admin = createAdminClient();
  const [{ data: club }, profile, { data: teams }] = await Promise.all([
    admin.from("clubs").select("logo_path").eq("id", clubId).maybeSingle(),
    getClubProfile(clubId),
    admin.from("teams").select("id,active").eq("club_id", clubId),
  ]);

  const activeTeamIds = (teams ?? []).filter((t) => t.active).map((t) => t.id);
  let hasRosterOrMatch = false;
  if (activeTeamIds.length) {
    const { data: teamSeasons } = await admin.from("team_seasons").select("id").in("team_id", activeTeamIds);
    const teamSeasonIds = (teamSeasons ?? []).map((ts) => ts.id);
    if (teamSeasonIds.length) {
      const orFilter = teamSeasonIds.map((id) => `home_team_season_id.eq.${id}`).concat(teamSeasonIds.map((id) => `away_team_season_id.eq.${id}`)).join(",");
      const [{ count: rosterCount }, { count: matchCount }] = await Promise.all([
        admin.from("team_roster_members").select("id", { count: "exact", head: true }).in("team_season_id", teamSeasonIds).eq("active", true),
        admin.from("matches").select("id", { count: "exact", head: true }).or(orFilter),
      ]);
      hasRosterOrMatch = (rosterCount ?? 0) > 0 || (matchCount ?? 0) > 0;
    }
  }

  return {
    hasLogo: Boolean(club?.logo_path),
    hasShortDescription: Boolean(profile.shortDescription),
    hasColors: Boolean(profile.primaryColor && profile.secondaryColor),
    hasWebOrSocial: Boolean(profile.websiteUrl || profile.facebookUrl || profile.instagramUrl || profile.xUrl || profile.tiktokUrl || profile.youtubeUrl),
    hasPublicContact: Boolean(profile.publicEmail || profile.publicPhone),
    hasVenue: Boolean(profile.venueName),
    hasActiveTeam: activeTeamIds.length > 0,
    hasRosterOrMatch,
  };
}
