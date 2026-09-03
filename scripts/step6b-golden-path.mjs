// Golden Path E2E against the real step-6b-club-staff Preview.
// login OWNER -> Club Studio -> Staff module -> add Président (club-wide),
// Coach + Adjoint (Seniors A) -> make Président+Coach public, leave Adjoint
// private -> save/refresh/persist -> public Club page shows Président +
// Coach under Seniors A, never the Adjoint -> edit Coach -> change visible
// publicly -> deactivate Président -> disappears publicly -> another OWNER
// denied -> mobile/desktop clean -> 0 console/5xx errors. Uses
// step6b-e2e-fixture.mjs -- never touches real clubs/players.
import { chromium } from "playwright";

const BASE = process.env.STEP6B_BASE_URL;
const EMAIL = process.env.STEP6B_EMAIL;
const PASSWORD = process.env.STEP6B_PASSWORD;
const CLUB_ID = process.env.STEP6B_CLUB_ID;
const CLUB_SLUG = process.env.STEP6B_CLUB_SLUG;
const TEAM_SEASON_ID = process.env.STEP6B_TEAM_SEASON_ID;
const INTRUDER_EMAIL = process.env.STEP6B_INTRUDER_EMAIL;
const INTRUDER_PASSWORD = process.env.STEP6B_INTRUDER_PASSWORD;

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
    await page.waitForTimeout(800);
    return { hasStaffLink: (await page.locator(`a[href="/club-studio/staff?club_id=${CLUB_ID}"]`).count()) > 0 };
  });

  await step("3_open_staff", async () => {
    await page.locator(`a[href="/club-studio/staff?club_id=${CLUB_ID}"]`).first().click();
    await page.waitForURL((u) => u.pathname === "/club-studio/staff", { timeout: 20000 });
    await page.waitForTimeout(600);
    return { showsEmptyState: (await page.locator(".studio-empty-cta").count()) > 0 };
  });

  async function openAddForm() {
    const details = page.locator('details.match-form:has(summary:text("Ajouter un membre du staff"))').first();
    await details.locator("summary").click();
    await page.waitForTimeout(300);
    return details.locator("form");
  }

  await step("4_add_president_club_wide", async () => {
    const form = await openAddForm();
    await form.locator('input[name="display_name"]').fill("Jean Dupont");
    await form.locator('select[name="role_type"]').selectOption({ value: "PRESIDENT" });
    await form.locator('textarea[name="short_bio"]').fill("Président depuis 2020.");
    await Promise.all([
      page.waitForURL((u) => u.search.includes("message=staff-added"), { timeout: 20000 }).catch(() => null),
      form.locator("button.button").click(),
    ]);
    await page.waitForTimeout(800);
    return page.url();
  });

  await step("5_add_coach_seniors_a", async () => {
    await page.goto(`${BASE}/club-studio/staff?club_id=${CLUB_ID}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const form = await openAddForm();
    await form.locator('input[name="display_name"]').fill("Marc Martin");
    await form.locator('select[name="role_type"]').selectOption({ value: "HEAD_COACH" });
    await form.locator('select[name="team_season_id"]').selectOption({ value: TEAM_SEASON_ID });
    await Promise.all([
      page.waitForURL((u) => u.search.includes("message=staff-added"), { timeout: 20000 }).catch(() => null),
      form.locator("button.button").click(),
    ]);
    await page.waitForTimeout(800);
    return page.url();
  });

  await step("6_add_assistant_seniors_a", async () => {
    await page.goto(`${BASE}/club-studio/staff?club_id=${CLUB_ID}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const form = await openAddForm();
    await form.locator('input[name="display_name"]').fill("Paul Durand");
    await form.locator('select[name="role_type"]').selectOption({ value: "ASSISTANT_COACH" });
    await form.locator('select[name="team_season_id"]').selectOption({ value: TEAM_SEASON_ID });
    await Promise.all([
      page.waitForURL((u) => u.search.includes("message=staff-added"), { timeout: 20000 }).catch(() => null),
      form.locator("button.button").click(),
    ]);
    await page.waitForTimeout(800);
    return page.url();
  });

  async function editCardByName(name) {
    await page.goto(`${BASE}/club-studio/staff?club_id=${CLUB_ID}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(500);
    const card = page.locator(`.staff-card:has-text("${name}")`).first();
    await card.locator("details.staff-edit summary").click();
    await page.waitForTimeout(300);
    return card.locator("form.roster-form");
  }

  await step("7_make_president_public", async () => {
    const form = await editCardByName("Jean Dupont");
    await form.locator('input[name="public_visible"]').check();
    await Promise.all([
      page.waitForURL((u) => u.search.includes("message=staff-updated"), { timeout: 20000 }).catch(() => null),
      form.locator("button.button").click(),
    ]);
    await page.waitForTimeout(800);
    return page.url();
  });

  await step("8_make_coach_public", async () => {
    const form = await editCardByName("Marc Martin");
    await form.locator('input[name="public_visible"]').check();
    await Promise.all([
      page.waitForURL((u) => u.search.includes("message=staff-updated"), { timeout: 20000 }).catch(() => null),
      form.locator("button.button").click(),
    ]);
    await page.waitForTimeout(800);
    return page.url();
  });

  await step("11_12_refresh_persists", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    const text = await page.locator("main").textContent();
    return {
      presidentPresent: text?.includes("Jean Dupont") ?? false,
      coachPresent: text?.includes("Marc Martin") ?? false,
      assistantPresent: text?.includes("Paul Durand") ?? false,
    };
  });

  await step("13_14_15_16_public_club_page", async () => {
    await page.goto(`${BASE}/clubs/${CLUB_SLUG}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(800);
    const text = await page.locator("main").textContent();
    return {
      hasStaffSection: text?.includes("Le staff") ?? false,
      presidentVisible: text?.includes("Jean Dupont") ?? false,
      coachVisibleUnderSeniorsA: text?.includes("Marc Martin") ?? false,
      assistantAbsent: !(text?.includes("Paul Durand") ?? false),
    };
  });

  await step("17_18_edit_coach_bio_visible_publicly", async () => {
    const form = await editCardByName("Marc Martin");
    await form.locator('textarea[name="short_bio"]').fill("Entraîneur de l'équipe Seniors A depuis 2024.");
    await Promise.all([
      page.waitForURL((u) => u.search.includes("message=staff-updated"), { timeout: 20000 }).catch(() => null),
      form.locator("button.button").click(),
    ]);
    await page.waitForTimeout(600);
    await page.goto(`${BASE}/clubs/${CLUB_SLUG}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(600);
    const text = await page.locator("main").textContent();
    return { bioVisiblePublicly: text?.includes("Entraîneur de l'équipe Seniors A depuis 2024.") ?? false };
  });

  await step("19_20_deactivate_president_disappears", async () => {
    await page.goto(`${BASE}/club-studio/staff?club_id=${CLUB_ID}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(500);
    const card = page.locator('.staff-card:has-text("Jean Dupont")').first();
    await card.locator("details.staff-edit summary").click();
    await page.waitForTimeout(300);
    await Promise.all([
      page.waitForURL((u) => u.search.includes("message=staff-removed"), { timeout: 20000 }).catch(() => null),
      card.locator('form:has(button.text-danger) button.text-danger').click(),
    ]);
    await page.waitForTimeout(600);
    await page.goto(`${BASE}/clubs/${CLUB_SLUG}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(600);
    const text = await page.locator("main").textContent();
    return { presidentGoneFromPublic: !(text?.includes("Jean Dupont") ?? false), coachStillThere: text?.includes("Marc Martin") ?? false };
  });

  await step("21_other_owner_denied", async () => {
    const intruderPage = await browser.newPage();
    await login(INTRUDER_EMAIL, INTRUDER_PASSWORD, intruderPage);
    const resp = await intruderPage.goto(`${BASE}/club-studio/staff?club_id=${CLUB_ID}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const status = resp?.status();
    const bodySnippet = (await intruderPage.textContent("body"))?.slice(0, 200);
    await intruderPage.close();
    return { status, deniedOrNotFound: status === 404 || !bodySnippet?.includes("Le staff de") };
  });

  results["24_console_errors"] = [...new Set(consoleErrors)].slice(0, 20);
  results["25_server_5xx_errors"] = serverErrors;

  const authState = await page.context().storageState();

  await step("22_mobile_390x844", async () => {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: authState });
    const mpage = await mobile.newPage();
    const checks = {};
    for (const [name, path] of [["club_studio", "/club-studio"], ["staff_module", `/club-studio/staff?club_id=${CLUB_ID}`], ["club_public", `/clubs/${CLUB_SLUG}`]]) {
      await mpage.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await mpage.waitForTimeout(700);
      checks[name] = { overflow: await mpage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) };
    }
    await mobile.close();
    return checks;
  });

  await step("23_desktop_1440", async () => {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: authState });
    const dpage = await desktop.newPage();
    const checks = {};
    for (const [name, path] of [["club_studio", "/club-studio"], ["staff_module", `/club-studio/staff?club_id=${CLUB_ID}`], ["club_public", `/clubs/${CLUB_SLUG}`]]) {
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
