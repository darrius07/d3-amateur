// Golden Path E2E against the real step-6c-club-sponsors Preview.
// login OWNER -> Club Studio -> Partenaires (empty state) -> add MAIN
// sponsor (HTTPS website, public) -> upload logo -> add a second, private
// sponsor -> refresh/persist -> public Club page shows MAIN sponsor, never
// the private one -> change tier -> replace logo -> delete logo (clean
// placeholder) -> deactivate MAIN sponsor -> disappears publicly -> another
// OWNER denied -> mobile/desktop clean -> 0 console/5xx errors. Uses
// step6c-e2e-fixture.mjs -- never touches real clubs.
import { chromium } from "playwright";

const BASE = process.env.STEP6C_BASE_URL;
const EMAIL = process.env.STEP6C_EMAIL;
const PASSWORD = process.env.STEP6C_PASSWORD;
const CLUB_ID = process.env.STEP6C_CLUB_ID;
const CLUB_SLUG = process.env.STEP6C_CLUB_SLUG;
const INTRUDER_EMAIL = process.env.STEP6C_INTRUDER_EMAIL;
const INTRUDER_PASSWORD = process.env.STEP6C_INTRUDER_PASSWORD;
const LOGO_PATH = process.env.STEP6C_LOGO_PATH;

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

  await step("2_club_studio", async () => {
    await page.goto(`${BASE}/club-studio`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(700);
    return { hasSponsorsLink: (await page.locator(`a[href="/club-studio/sponsors?club_id=${CLUB_ID}"]`).count()) > 0 };
  });

  await step("3_4_open_sponsors_empty_state", async () => {
    await page.locator(`a[href="/club-studio/sponsors?club_id=${CLUB_ID}"]`).first().click();
    await page.waitForURL((u) => u.pathname === "/club-studio/sponsors", { timeout: 20000 });
    await page.waitForTimeout(600);
    return { showsEmptyState: (await page.locator(".studio-empty-cta").count()) > 0 };
  });

  async function openAddForm() {
    const details = page.locator('details.match-form:has(summary:text("Ajouter un partenaire"))').first();
    await details.locator("summary").click();
    await page.waitForTimeout(300);
    return details.locator("form");
  }

  await step("5_6_7_8_add_main_sponsor_with_logo_and_https_url_public", async () => {
    const form = await openAddForm();
    await form.locator('input[name="name"]').fill("Boulangerie Martin");
    await form.locator('select[name="tier"]').selectOption({ value: "MAIN" });
    await form.locator('input[name="website_url"]').fill("https://boulangerie-martin.example.com");
    await form.locator('textarea[name="short_message"]').fill("Partenaire historique du club depuis 2019.");
    await form.locator('input[name="public_visible"]').check();
    await Promise.all([
      page.waitForURL((u) => u.search.includes("message=sponsor-added"), { timeout: 20000 }).catch(() => null),
      form.locator("button.button").click(),
    ]);
    await page.waitForTimeout(700);
    return page.url();
  });

  async function editCardByName(name) {
    await page.goto(`${BASE}/club-studio/sponsors?club_id=${CLUB_ID}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(500);
    const card = page.locator(`.sponsor-card:has-text("${name}")`).first();
    await card.locator("details.staff-edit summary").click();
    await page.waitForTimeout(300);
    return card;
  }

  await step("6b_upload_logo", async () => {
    const card = await editCardByName("Boulangerie Martin");
    const uploadForm = card.locator('form:has(input[name="logo"])');
    await uploadForm.locator('input[name="logo"]').setInputFiles(LOGO_PATH);
    await Promise.all([
      page.waitForURL((u) => u.search.includes("message=sponsor-logo-updated"), { timeout: 20000 }).catch(() => null),
      uploadForm.locator("button.button").click(),
    ]);
    await page.waitForTimeout(700);
    return page.url();
  });

  await step("9_add_second_private_sponsor", async () => {
    await page.goto(`${BASE}/club-studio/sponsors?club_id=${CLUB_ID}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const form = await openAddForm();
    await form.locator('input[name="name"]').fill("Garage Dupont");
    await form.locator('select[name="tier"]').selectOption({ value: "SUPPORTER" });
    await Promise.all([
      page.waitForURL((u) => u.search.includes("message=sponsor-added"), { timeout: 20000 }).catch(() => null),
      form.locator("button.button").click(),
    ]);
    await page.waitForTimeout(700);
    return page.url();
  });

  await step("10_11_refresh_persists", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    const text = await page.locator("main").textContent();
    return { mainSponsorPresent: text?.includes("Boulangerie Martin") ?? false, secondSponsorPresent: text?.includes("Garage Dupont") ?? false };
  });

  await step("12_13_14_public_club_page", async () => {
    await page.goto(`${BASE}/clubs/${CLUB_SLUG}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(700);
    const text = await page.locator("main").textContent();
    return {
      hasSponsorsSection: text?.includes("Nos partenaires") ?? false,
      mainSponsorVisible: text?.includes("Boulangerie Martin") ?? false,
      privateSponsorAbsent: !(text?.includes("Garage Dupont") ?? false),
      hasSponsorLogo: (await page.locator("img.sponsor-logo-public").count()) > 0,
    };
  });

  await step("15_16_change_tier_visible_immediately", async () => {
    const card = await editCardByName("Boulangerie Martin");
    const editForm = card.locator("form.roster-form");
    await editForm.locator('select[name="tier"]').selectOption({ value: "PARTNER" });
    await Promise.all([
      page.waitForURL((u) => u.search.includes("message=sponsor-updated"), { timeout: 20000 }).catch(() => null),
      editForm.locator("button.button").click(),
    ]);
    await page.waitForTimeout(600);
    await page.goto(`${BASE}/clubs/${CLUB_SLUG}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(600);
    const text = await page.locator("main").textContent();
    return { showsAsPartner: text?.includes("Partenaire") ?? false, noLongerMainHeading: !(text?.includes("Partenaire principal") ?? false) };
  });

  await step("17_18_replace_logo_new_visible", async () => {
    const card = await editCardByName("Boulangerie Martin");
    const uploadForm = card.locator('form:has(input[name="logo"])');
    await uploadForm.locator('input[name="logo"]').setInputFiles(LOGO_PATH);
    await Promise.all([
      page.waitForURL((u) => u.search.includes("message=sponsor-logo-updated"), { timeout: 20000 }).catch(() => null),
      uploadForm.locator("button.button").click(),
    ]);
    await page.waitForTimeout(600);
    await page.goto(`${BASE}/clubs/${CLUB_SLUG}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(600);
    return { logoStillVisible: (await page.locator("img.sponsor-logo-public").count()) > 0 };
  });

  await step("19_20_delete_logo_clean_placeholder", async () => {
    const card = await editCardByName("Boulangerie Martin");
    await Promise.all([
      page.waitForURL((u) => u.search.includes("message=sponsor-logo-removed"), { timeout: 20000 }).catch(() => null),
      card.locator('form:has(button.text-danger):has-text("Supprimer le logo") button.text-danger').click(),
    ]);
    await page.waitForTimeout(600);
    await page.goto(`${BASE}/clubs/${CLUB_SLUG}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(600);
    return {
      noLogoImage: (await page.locator("img.sponsor-logo-public").count()) === 0,
      initialsPlaceholderShown: (await page.locator(".staff-avatar", { hasText: "BM" }).count()) > 0,
    };
  });

  await step("21_22_deactivate_disappears_publicly", async () => {
    const card = await editCardByName("Boulangerie Martin");
    await Promise.all([
      page.waitForURL((u) => u.search.includes("message=sponsor-removed"), { timeout: 20000 }).catch(() => null),
      card.locator('form:has(button.text-danger):has-text("Retirer le partenaire") button.text-danger').click(),
    ]);
    await page.waitForTimeout(600);
    await page.goto(`${BASE}/clubs/${CLUB_SLUG}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(600);
    const text = await page.locator("main").textContent();
    return { sponsorGoneFromPublic: !(text?.includes("Boulangerie Martin") ?? false), noSponsorsSectionAtAll: !(text?.includes("Nos partenaires") ?? false) };
  });

  await step("23_other_owner_denied", async () => {
    const intruderPage = await browser.newPage();
    await login(INTRUDER_EMAIL, INTRUDER_PASSWORD, intruderPage);
    const resp = await intruderPage.goto(`${BASE}/club-studio/sponsors?club_id=${CLUB_ID}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const status = resp?.status();
    const bodySnippet = (await intruderPage.textContent("body"))?.slice(0, 200);
    await intruderPage.close();
    return { status, deniedOrNotFound: status === 404 || !bodySnippet?.includes("Les partenaires de") };
  });

  results["26_console_errors"] = [...new Set(consoleErrors)].slice(0, 20);
  results["27_server_5xx_errors"] = serverErrors;

  const authState = await page.context().storageState();

  await step("24_mobile_390x844", async () => {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: authState });
    const mpage = await mobile.newPage();
    const checks = {};
    for (const [name, path] of [["club_studio", "/club-studio"], ["sponsors_module", `/club-studio/sponsors?club_id=${CLUB_ID}`], ["club_public", `/clubs/${CLUB_SLUG}`]]) {
      await mpage.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await mpage.waitForTimeout(700);
      checks[name] = { overflow: await mpage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) };
    }
    await mobile.close();
    return checks;
  });

  await step("25_desktop_1440", async () => {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: authState });
    const dpage = await desktop.newPage();
    const checks = {};
    for (const [name, path] of [["club_studio", "/club-studio"], ["sponsors_module", `/club-studio/sponsors?club_id=${CLUB_ID}`], ["club_public", `/clubs/${CLUB_SLUG}`]]) {
      await dpage.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await dpage.waitForTimeout(700);
      checks[name] = { overflow: await dpage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) };
    }
    await desktop.close();
    return checks;
  });

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})();
