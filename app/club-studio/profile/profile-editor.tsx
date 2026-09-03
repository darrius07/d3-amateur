'use client';
import { useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  LONG_DESCRIPTION_MAX,
  SHORT_DESCRIPTION_MAX,
  computeClubCompleteness,
  pickReadableTextColor,
  validateDisplayName,
  validateEmail,
  validateExternalUrl,
  validateFoundedYear,
  validateHexColor,
  validateLongDescription,
  validatePhone,
  validatePostalCode,
  validateShortDescription,
  type ValidationResult,
} from '@/lib/clubs/profile';
import type { ClubProfileRow } from '@/lib/clubs/profile-data';
import { socialLinksFrom } from '@/lib/clubs/social-icons';
import { CompletenessChecklist, CompletenessRing } from '@/lib/clubs/completeness-ring';

interface Props {
  clubId: string;
  displayName: string;
  city: string | null;
  logoUrl: string | null;
  profile: ClubProfileRow;
  hasActiveTeam: boolean;
  hasRosterOrMatch: boolean;
  action: (formData: FormData) => Promise<void>;
}

interface FormState {
  displayName: string;
  shortDescription: string;
  longDescription: string;
  foundedYear: string;
  primaryColor: string;
  secondaryColor: string;
  websiteUrl: string;
  facebookUrl: string;
  instagramUrl: string;
  xUrl: string;
  tiktokUrl: string;
  youtubeUrl: string;
  publicEmail: string;
  publicPhone: string;
  venueName: string;
  venueAddress: string;
  venuePostalCode: string;
  venueCity: string;
}

function initialState(displayName: string, profile: ClubProfileRow): FormState {
  return {
    displayName,
    shortDescription: profile.shortDescription ?? '',
    longDescription: profile.longDescription ?? '',
    foundedYear: profile.foundedYear ? String(profile.foundedYear) : '',
    primaryColor: profile.primaryColor ?? '',
    secondaryColor: profile.secondaryColor ?? '',
    websiteUrl: profile.websiteUrl ?? '',
    facebookUrl: profile.facebookUrl ?? '',
    instagramUrl: profile.instagramUrl ?? '',
    xUrl: profile.xUrl ?? '',
    tiktokUrl: profile.tiktokUrl ?? '',
    youtubeUrl: profile.youtubeUrl ?? '',
    publicEmail: profile.publicEmail ?? '',
    publicPhone: profile.publicPhone ?? '',
    venueName: profile.venueName ?? '',
    venueAddress: profile.venueAddress ?? '',
    venuePostalCode: profile.venuePostalCode ?? '',
    venueCity: profile.venueCity ?? '',
  };
}

function TextField({ label, hint, error, ...rest }: { label: string; hint?: string; error?: ValidationResult } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="profile-field">
      {label}
      <input type="text" {...rest} />
      {hint && <span className="profile-field-sub">{hint}</span>}
      {error && !error.valid && <span className="color-error">{error.error}</span>}
    </label>
  );
}

function ColorField({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error: ValidationResult }) {
  const pickerValue = /^#[0-9A-Fa-f]{6}$/.test(value) ? value : '#14261D';
  return (
    <div>
      <label className="profile-field">
        {label}
        <div className="color-field-control">
          <input type="color" className="color-swatch" value={pickerValue} onChange={(e) => onChange(e.target.value.toUpperCase())} aria-label={`${label} — sélecteur de couleur`} />
          <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="#0057B8" maxLength={7} aria-label={`${label} — code hexadécimal`} />
        </div>
      </label>
      {!error.valid && <span className="color-error">{error.error}</span>}
    </div>
  );
}

export function ProfileEditor({ clubId, displayName, city, logoUrl, profile, hasActiveTeam, hasRosterOrMatch, action }: Props) {
  const [state, setState] = useState<FormState>(() => initialState(displayName, profile));
  const [saving, setSaving] = useState(false);
  const dirty = useMemo(() => JSON.stringify(state) !== JSON.stringify(initialState(displayName, profile)), [state, displayName, profile]);

  const set = <K extends keyof FormState>(key: K) => (value: string) => setState((s) => ({ ...s, [key]: value }));

  const errors = {
    displayName: validateDisplayName(state.displayName),
    shortDescription: validateShortDescription(state.shortDescription),
    longDescription: validateLongDescription(state.longDescription),
    foundedYear: validateFoundedYear(state.foundedYear),
    primaryColor: validateHexColor(state.primaryColor),
    secondaryColor: validateHexColor(state.secondaryColor),
    websiteUrl: validateExternalUrl(state.websiteUrl),
    facebookUrl: validateExternalUrl(state.facebookUrl),
    instagramUrl: validateExternalUrl(state.instagramUrl),
    xUrl: validateExternalUrl(state.xUrl),
    tiktokUrl: validateExternalUrl(state.tiktokUrl),
    youtubeUrl: validateExternalUrl(state.youtubeUrl),
    publicEmail: validateEmail(state.publicEmail),
    publicPhone: validatePhone(state.publicPhone),
    venuePostalCode: validatePostalCode(state.venuePostalCode),
  };
  const hasErrors = Object.values(errors).some((e) => !e.valid);

  const liveCompleteness = computeClubCompleteness({
    hasLogo: Boolean(logoUrl),
    hasShortDescription: state.shortDescription.trim().length > 0,
    hasColors: Boolean(state.primaryColor.trim() && state.secondaryColor.trim()),
    hasWebOrSocial: Boolean(state.websiteUrl.trim() || state.facebookUrl.trim() || state.instagramUrl.trim() || state.xUrl.trim() || state.tiktokUrl.trim() || state.youtubeUrl.trim()),
    hasPublicContact: Boolean(state.publicEmail.trim() || state.publicPhone.trim()),
    hasVenue: state.venueName.trim().length > 0,
    hasActiveTeam,
    hasRosterOrMatch,
  });

  const previewLinks = socialLinksFrom({
    websiteUrl: state.websiteUrl.trim() || null, instagramUrl: state.instagramUrl.trim() || null, facebookUrl: state.facebookUrl.trim() || null,
    xUrl: state.xUrl.trim() || null, tiktokUrl: state.tiktokUrl.trim() || null, youtubeUrl: state.youtubeUrl.trim() || null,
  });
  const accentColor = errors.primaryColor.valid && state.primaryColor.trim() ? state.primaryColor.trim() : undefined;
  const badgeTextColor = accentColor ? pickReadableTextColor(accentColor) : undefined;

  return (
    <div className="profile-editor">
      <form className="profile-editor-form" action={action} onSubmit={() => setSaving(true)}>
        <input type="hidden" name="club_id" value={clubId} />

        <section className="identity-card" style={{ marginTop: 0 }}>
          <CompletenessRing completeness={liveCompleteness} />
          <div className="identity-card-body">
            <span className="eyebrow">{liveCompleteness.percent === 100 ? 'Profil D3 complet' : 'Votre club prend forme'}</span>
            <CompletenessChecklist completeness={liveCompleteness} />
          </div>
        </section>

        <section className="profile-section">
          <h2>Identité</h2>
          <p className="profile-section-hint">Le nom qui apparaît partout sur D3 — sur la page publique, les matchs, les classements.</p>
          <TextField label="Nom affiché" name="display_name" value={state.displayName} onChange={(e) => set('displayName')(e.target.value)} error={errors.displayName} required maxLength={120} />
          <TextField label="Année de fondation (facultatif)" name="founded_year" value={state.foundedYear} onChange={(e) => set('foundedYear')(e.target.value.replace(/[^0-9]/g, ''))} error={errors.foundedYear} inputMode="numeric" maxLength={4} hint="Apparaîtra près du nom de votre club." />
        </section>

        <section className="profile-section">
          <h2>Présentation</h2>
          <p className="profile-section-hint">Présentez votre club en quelques mots.</p>
          <label className="profile-field">
            Accroche courte
            <textarea name="short_description" value={state.shortDescription} onChange={(e) => set('shortDescription')(e.target.value)} maxLength={SHORT_DESCRIPTION_MAX + 40} rows={2} />
            <span className="profile-field-sub">Cette phrase apparaîtra près du nom de votre club.</span>
            <span className={`char-counter${state.shortDescription.length > SHORT_DESCRIPTION_MAX ? ' is-over' : ''}`}>{state.shortDescription.length} / {SHORT_DESCRIPTION_MAX}</span>
            {!errors.shortDescription.valid && <span className="color-error">{errors.shortDescription.error}</span>}
          </label>
          <label className="profile-field">
            Présentation détaillée
            <textarea name="long_description" value={state.longDescription} onChange={(e) => set('longDescription')(e.target.value)} maxLength={LONG_DESCRIPTION_MAX + 40} rows={5} />
            <span className="profile-field-sub">L&apos;histoire, les valeurs, le projet de votre club.</span>
            <span className={`char-counter${state.longDescription.length > LONG_DESCRIPTION_MAX ? ' is-over' : ''}`}>{state.longDescription.length} / {LONG_DESCRIPTION_MAX}</span>
            {!errors.longDescription.valid && <span className="color-error">{errors.longDescription.error}</span>}
          </label>
        </section>

        <section className="profile-section">
          <h2>Identité visuelle</h2>
          <p className="profile-section-hint">Votre logo se gère depuis le tableau de bord Club Studio.</p>
          <div className="color-field-control">
            {logoUrl ? <Image unoptimized src={logoUrl} alt="" width={48} height={48} style={{ borderRadius: 12, border: '1px solid var(--line)', objectFit: 'contain' }} /> : <div className="identity-card-logo-placeholder" style={{ width: 48, height: 48, borderRadius: 12 }} aria-hidden="true">D3</div>}
            <Link className="button" href="/club-studio" style={{ marginTop: 0 }}>{logoUrl ? 'Modifier le logo' : 'Ajouter un logo'}</Link>
          </div>
          <p className="profile-section-hint" style={{ marginTop: 20, marginBottom: 6 }}>Couleurs du club</p>
          <div className="color-fields">
            <ColorField label="Principale" value={state.primaryColor} onChange={set('primaryColor')} error={errors.primaryColor} />
            <ColorField label="Secondaire" value={state.secondaryColor} onChange={set('secondaryColor')} error={errors.secondaryColor} />
          </div>
          <input type="hidden" name="primary_color" value={state.primaryColor} />
          <input type="hidden" name="secondary_color" value={state.secondaryColor} />
        </section>

        <section className="profile-section">
          <h2>En ligne</h2>
          <p className="profile-section-hint">Les liens renseignés seront affichés sur votre page publique.</p>
          <div className="field-grid">
            <TextField label="Site officiel" name="website_url" value={state.websiteUrl} onChange={(e) => set('websiteUrl')(e.target.value)} error={errors.websiteUrl} placeholder="https://" />
            <TextField label="Instagram" name="instagram_url" value={state.instagramUrl} onChange={(e) => set('instagramUrl')(e.target.value)} error={errors.instagramUrl} placeholder="https://instagram.com/…" />
            <TextField label="Facebook" name="facebook_url" value={state.facebookUrl} onChange={(e) => set('facebookUrl')(e.target.value)} error={errors.facebookUrl} placeholder="https://facebook.com/…" />
            <TextField label="X" name="x_url" value={state.xUrl} onChange={(e) => set('xUrl')(e.target.value)} error={errors.xUrl} placeholder="https://x.com/…" />
            <TextField label="TikTok" name="tiktok_url" value={state.tiktokUrl} onChange={(e) => set('tiktokUrl')(e.target.value)} error={errors.tiktokUrl} placeholder="https://tiktok.com/@…" />
            <TextField label="YouTube" name="youtube_url" value={state.youtubeUrl} onChange={(e) => set('youtubeUrl')(e.target.value)} error={errors.youtubeUrl} placeholder="https://youtube.com/…" />
          </div>
        </section>

        <section className="profile-section">
          <h2>Contact public</h2>
          <p className="profile-section-hint">Ces informations seront visibles publiquement — jamais votre email de connexion.</p>
          <div className="field-grid">
            <TextField label="Email public" name="public_email" value={state.publicEmail} onChange={(e) => set('publicEmail')(e.target.value)} error={errors.publicEmail} type="email" placeholder="contact@monclub.fr" />
            <TextField label="Téléphone public" name="public_phone" value={state.publicPhone} onChange={(e) => set('publicPhone')(e.target.value)} error={errors.publicPhone} placeholder="02 40 00 00 00" />
          </div>
        </section>

        <section className="profile-section">
          <h2>Votre terrain</h2>
          <p className="profile-section-hint">Où vos équipes reçoivent leurs adversaires.</p>
          <TextField label="Nom du stade" name="venue_name" value={state.venueName} onChange={(e) => set('venueName')(e.target.value)} placeholder="Stade Municipal" />
          <div className="field-grid" style={{ marginTop: 16 }}>
            <TextField label="Adresse" name="venue_address" value={state.venueAddress} onChange={(e) => set('venueAddress')(e.target.value)} />
            <TextField label="Code postal" name="venue_postal_code" value={state.venuePostalCode} onChange={(e) => set('venuePostalCode')(e.target.value)} error={errors.venuePostalCode} inputMode="numeric" />
          </div>
          <TextField label="Ville" name="venue_city" value={state.venueCity} onChange={(e) => set('venueCity')(e.target.value)} />
        </section>

        <div className="save-bar">
          <span className={`save-bar-status${dirty ? ' is-dirty' : ''}`}>{dirty ? 'Modifications non enregistrées' : 'Tout est enregistré'}</span>
          <button className="button" type="submit" disabled={hasErrors || saving}>{saving ? 'Enregistrement…' : 'Enregistrer les modifications'}</button>
        </div>
      </form>

      <aside className="preview-card">
        <span className="preview-card-label">Aperçu de votre page club</span>
        <div className="preview-body" style={{ borderTopColor: accentColor ?? 'var(--line)' }}>
          <div className="preview-header">
            {logoUrl ? <div className="preview-logo"><Image unoptimized src={logoUrl} alt="" width={64} height={64} /></div> : <div className="preview-logo">D3</div>}
            <div>
              <h3>{state.displayName.trim() || 'Nom du club'}</h3>
              <p>{city ?? 'Ville non renseignée'}{liveCompleteness.items.find(i => i.key === 'hasVenue')?.done && state.venueCity ? ` · ${state.venueCity}` : ''}</p>
            </div>
          </div>
          {accentColor && (
            <span style={{ display: 'inline-block', marginTop: 14, padding: '5px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', background: accentColor, color: badgeTextColor }}>
              Club vérifié D3
            </span>
          )}
          {state.shortDescription.trim() && <p className="preview-tagline">{state.shortDescription.trim()}</p>}
          {(state.primaryColor || state.secondaryColor) && (
            <div className="preview-swatches">
              {errors.primaryColor.valid && state.primaryColor.trim() && <span className="preview-swatch" style={{ background: state.primaryColor.trim() }} title="Couleur principale" />}
              {errors.secondaryColor.valid && state.secondaryColor.trim() && <span className="preview-swatch" style={{ background: state.secondaryColor.trim() }} title="Couleur secondaire" />}
            </div>
          )}
          {previewLinks.length > 0 && (
            <div className="preview-social-row">
              {previewLinks.map(({ key, Icon }) => <span key={key}><Icon /></span>)}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
