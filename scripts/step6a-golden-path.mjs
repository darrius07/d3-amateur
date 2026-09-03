// Golden Path E2E against the real step-6a-club-profile Preview.
// login OWNER -> Club Studio shows progression -> Personnaliser mon club ->
// edit identity/description/colors/social/contact/venue -> save -> refresh
// -> persisted, progression increased, live preview + public page reflect
// the new identity -> sports modules (roster) still work -> another OWNER
// denied -> mobile + desktop clean -> 0 console/5xx errors. Uses
// step6a-e2e-fixture.mjs -- never touches real clubs/players.
import { chromium } from "playwright";

const BASE = process.env.STEP6A_BASE_URL;
const EMAIL = process.env.STEP6A_EMAIL;
const PASSWORD = process.env.STEP6A_PASSWORD;
const CLUB_ID = process.env.STEP6A_CLUB_ID;
const CLUB_SLUG = process.env.STEP6A_CLUB_SLUG;
const INTRUDER_EMAIL = process.env.STEP6A_INTRUDER_EMAIL;
const INTRUDER_PASSWORD = process.env.STEP6A_INTRUDER_PASSWORD;

const results = {};
async function step(name, fn) {
  try { results[name] = await fn(); } catch (e) { results[name] = `ERROR: ${e.message.split("\n")[0]}`; }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleErrors = []; const serverErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  page.on("response", (r) => { if (r.status() >= 500) serverErrors.push(`http${r.status()}:${r.url()}`); });

  async function login(email, password, target) {
    await target.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await target.fill("#email", email);
    await target.fill("#password", password);
    await target.locator("#password").locator("xpath=ancestor::form").locator("button").click();
    await target.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 }).catch(() => null);
  }

  await step("1_login", async () => { await login(EMAIL, PASSWORD, page); return page.url(); });

  await step("2_3_club_studio_shows_progression", async () => {
    await page.goto(`${BASE}/club-studio`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1000);
    const text = await page.locator(".identity-card").first().textContent();
    return { showsIdentityCard: Boolean(text), showsProgressPercent: /%/.test(text ?? "") };
  });

  await step("4_open_personalization", async () => {
    await page.locator(`a[href="/club-studio/profile?club_id=${CLUB_ID}"]`).first().click();
    await page.waitForURL((u) => u.pathname === "/club-studio/profile", { timeout: 20000 });
    await page.waitForTimeout(800);
    return page.url();
  });

  await step("5_11_fill_identity_and_details", async () => {
    await page.fill('input[name="display_name"]', "AS Fixture Golden Path");
    await page.fill('textarea[name="short_description"]', "Le club qui monte, saison après saison.");
    await page.fill('textarea[name="long_description"]', "Une histoire fondée sur la formation et la fidélité à notre territoire.");
    await page.fill('input[name="founded_year"]', "1968");
    await page.fill('input[aria-label="Principale — code hexadécimal"]', "#0057B8");
    await page.fill('input[aria-label="Secondaire — code hexadécimal"]', "#FFD400");
    await page.fill('input[name="website_url"]', "https://asfixture.example.com");
    await page.fill('input[name="instagram_url"]', "https://instagram.com/asfixture");
    await page.fill('input[name="public_email"]', "contact@asfixture.example.com");
    await page.fill('input[name="public_phone"]', "02 40 00 00 00");
    await page.fill('input[name="venue_name"]', "Stade Fixture");
    await page.fill('input[name="venue_city"]', "Nantes");
    const progressText = await page.locator(".identity-card .eyebrow").first().textContent();
    return { progressAfterTyping: progressText };
  });

  await step("12_save", async () => {
    await Promise.all([
      page.waitForURL((u) => u.search.includes("message=profile-updated"), { timeout: 20000 }).catch(() => null),
      page.locator(".save-bar button[type=submit]").click(),
    ]);
    await page.waitForTimeout(1000);
    return { url: page.url(), successBanner: (await page.locator(".success").first().textContent().catch(() => null)) };
  });

  await step("13_14_refresh_data_persists", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    return {
      displayNamePersisted: await page.locator('input[name="display_name"]').inputValue(),
      colorPersisted: await page.locator('input[aria-label="Principale — code hexadécimal"]').inputValue(),
      venuePersisted: await page.locator('input[name="venue_name"]').inputValue(),
    };
  });

  await step("15_progression_increased", async () => {
    const text = await page.locator(".identity-card").first().textContent();
    return { showsHighProgress: /[5-9]\d%|100%/.test(text ?? ""), raw: text?.slice(0, 120) };
  });

  await step("16_live_preview_reflects_identity", async () => {
    const previewText = await page.locator(".preview-card").textContent();
    return {
      showsNewName: previewText?.includes("AS Fixture Golden Path") ?? false,
      showsTagline: previewText?.includes("Le club qui monte") ?? false,
      hasSocialIcon: (await page.locator(".preview-social-row span").count()) > 0,
    };
  });

  await step("17_public_club_page_reflects_changes", async () => {
    await page.goto(`${BASE}/clubs/${CLUB_SLUG}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1000);
    const text = await page.locator("main").textContent();
    return {
      showsNewName: text?.includes("AS Fixture Golden Path") ?? false,
      showsFoundedYear: text?.includes("1968") ?? false,
      showsTagline: text?.includes("Le club qui monte") ?? false,
      showsVenue: text?.includes("Stade Fixture") ?? false,
      showsSocialSection: text?.includes("Nous suivre") ?? false,
      showsContact: text?.includes("contact@asfixture.example.com") ?? false,
    };
  });

  await step("18_sports_modules_still_work", async () => {
    const text = await page.locator(".public-rosters").textContent();
    return { rosterSectionPresent: Boolean(text), hasFixturePlayer: text?.includes("Fixture") ?? false };
  });

  await step("19_other_owner_denied", async () => {
    const intruderPage = await browser.newPage();
    await login(INTRUDER_EMAIL, INTRUDER_PASSWORD, intruderPage);
    const resp = await intruderPage.goto(`${BASE}/club-studio/profile?club_id=${CLUB_ID}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const status = resp?.status();
    const bodySnippet = (await intruderPage.textContent("body"))?.slice(0, 200);
    await intruderPage.close();
    return { status, deniedOrNotFound: status === 404 || !bodySnippet?.includes("Votre identité D3") };
  });

  results["22_console_errors"] = [...new Set(consoleErrors)].slice(0, 20);
  results["23_server_5xx_errors"] = serverErrors;

  const authState = await page.context().storageState();

  await step("20_mobile_390x844", async () => {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: authState });
    const mpage = await mobile.newPage();
    const checks = {};
    const paths = [["club_studio", "/club-studio"], ["profile_editor", `/club-studio/profile?club_id=${CLUB_ID}`], ["club_public", `/clubs/${CLUB_SLUG}`]];
    for (const [name, path] of paths) {
      await mpage.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await mpage.waitForTimeout(800);
      checks[name] = { overflow: await mpage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) };
    }
    await mobile.close();
    return checks;
  });

  await step("21_desktop_1440", async () => {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: authState });
    const dpage = await desktop.newPage();
    const checks = {};
    for (const [name, path] of [["club_studio", "/club-studio"], ["profile_editor", `/club-studio/profile?club_id=${CLUB_ID}`], ["club_public", `/clubs/${CLUB_SLUG}`]]) {
      await dpage.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await dpage.waitForTimeout(800);
      checks[name] = { overflow: await dpage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) };
    }
    await desktop.close();
    return checks;
  });

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})();
