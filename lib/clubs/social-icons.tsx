// Sober, monochrome, hand-authored icons -- no icon library added just for
// six glyphs (mission section 18). currentColor throughout so callers set
// color via CSS. Used by both the public club page and the live preview.
import type { ClubProfileRow } from "./profile-data";

const ICON_PROPS = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export function WebsiteIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3Z" />
    </svg>
  );
}
export function InstagramIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}
export function FacebookIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M15 4h-2.2C10.7 4 9.5 5.3 9.5 7.4V10H7v3.4h2.5V21h3.4v-7.6h2.6l.5-3.4h-3.1V7.7c0-.9.4-1.4 1.5-1.4H16V4Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
export function XIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 4l7.2 8.6L4.4 20H6l6.1-6.7L17 20h3l-7.5-9L19.6 4H18l-5.6 6.2L7 4H4Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
export function TikTokIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M14 3v10.6a3.1 3.1 0 1 1-2.6-3.06M14 3c.4 2.4 2 4 4.6 4.3" />
    </svg>
  );
}
export function YoutubeIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="3" y="6" width="18" height="12" rx="4" />
      <path d="M10.5 9.5v5l4.3-2.5-4.3-2.5Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export interface SocialLink {
  key: string;
  label: string;
  url: string;
  Icon: () => React.ReactElement;
}

/** Only the ones actually filled in -- mission section 18: never show an empty/placeholder icon row. */
export function socialLinksFrom(profile: Pick<ClubProfileRow, "websiteUrl" | "instagramUrl" | "facebookUrl" | "xUrl" | "tiktokUrl" | "youtubeUrl">): SocialLink[] {
  const links: SocialLink[] = [];
  if (profile.websiteUrl) links.push({ key: "website", label: "Site officiel", url: profile.websiteUrl, Icon: WebsiteIcon });
  if (profile.instagramUrl) links.push({ key: "instagram", label: "Instagram", url: profile.instagramUrl, Icon: InstagramIcon });
  if (profile.facebookUrl) links.push({ key: "facebook", label: "Facebook", url: profile.facebookUrl, Icon: FacebookIcon });
  if (profile.xUrl) links.push({ key: "x", label: "X", url: profile.xUrl, Icon: XIcon });
  if (profile.tiktokUrl) links.push({ key: "tiktok", label: "TikTok", url: profile.tiktokUrl, Icon: TikTokIcon });
  if (profile.youtubeUrl) links.push({ key: "youtube", label: "YouTube", url: profile.youtubeUrl, Icon: YoutubeIcon });
  return links;
}
