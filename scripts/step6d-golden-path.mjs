// Golden Path E2E against the real step-6d-missing-club Preview (mission
// section 45): search a nonexistent club -> no results -> CTA "Ajouter mon
// club à D3" -> auth -> form -> duplicate search finds nothing strong ->
// submit -> PENDING_REVIEW visible on "Mes demandes" -> Admin opens the
// request -> Admin approves -> club created + OWNER granted -> requester
// opens the new club's Club Studio -> Staff/Sponsors modules reachable ->
// public club page reachable -> another user cannot manage it -> a second
// APPROVE call creates nothing extra (idempotency) -> mobile/desktop clean
// -> 0 console/5xx errors. Uses step6d-e2e-fixture.mjs -- never touches
// real clubs or users.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());

const BASE = process.env.STEP6D_BASE_URL;
const PASSWORD = process.env.STEP6D_PASSWORD;
const REQUESTER_EMAIL = process.env.STEP6D_REQUESTER_EMAIL;
const OTHER_EMAIL = process.env.STEP6D_OTHER_EMAIL;
const ADMIN_EMAIL = process.env.STEP6D_ADMIN_EMAIL;
const ADMIN_ID = process.env.STEP6D_ADMIN_ID;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Deliberately NOT prefixed "AS "/"FC "/etc (this shared Supabase project's
// registry holds thousands of real RNA-imported clubs and search_clubs()'s
// trigram threshold, 0.22, is loose enough to match a generic French
// club-name prefix by chance) AND deliberately NOT sharing SUFFIX with the
// fixture's existingClub name ("FC Test Existant <SUFFIX>") -- an 8-char
// shared substring is itself enough trigram overlap to falsely "find" that
// unrelated club. A second, independent random token keeps this club name
// truly unmatched by anything else in the shared registry.
const CLUB_NAME = `Zorglub Testonia Golden ${crypto.randomUUID().slice(0, 8)}`;
const CLUB_CITY = "Villeurbanne";

const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

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

  await step("1_2_search_nonexistent_no_results", async () => {
    await page.goto(`${BASE}/clubs`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(800); // let the client component hydrate before typing, or fill() races React and gets wiped
    await page.fill("#club-search", CLUB_NAME);
    await page.waitForTimeout(1800);
    return { showsMissingClubCta: (await page.locator(".missing-club-cta").count()) > 0 };
  });

  await step("3_cta_anon_redirects_to_login", async () => {
    await Promise.all([
      page.waitForURL((u) => u.pathname === "/login", { timeout: 20000 }),
      page.locator(".missing-club-cta a.button").click(),
    ]);
    return { onLogin: page.url().includes("/login"), returnToClubsNew: page.url().includes("returnTo") };
  });

  await step("4_login_and_return_to_flow", async () => {
    // Deliberately fill in place rather than calling login()'s goto(/login)
    // helper -- page is already on /login?returnTo=... from the CTA
    // redirect in step 3; re-navigating to a bare /login would drop that
    // returnTo and defeat the very thing this step verifies.
    await page.fill("#email", REQUESTER_EMAIL);
    await page.fill("#password", PASSWORD);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 }),
      page.locator("#password").locator("xpath=ancestor::form").locator("button").click(),
    ]);
    await page.waitForTimeout(400);
    return { onNewClubForm: page.url().includes("/clubs/new") };
  });

  await step("5_6_fill_form_name_city", async () => {
    if (!page.url().includes("/clubs/new")) await page.goto(`${BASE}/clubs/new`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const nameField = page.locator("#club_name");
    if (!(await nameField.inputValue())) await nameField.fill(CLUB_NAME);
    await page.fill("#city", CLUB_CITY);
    return { clubNameValue: await nameField.inputValue() };
  });

  await step("7_representative_confirmation", async () => {
    await page.check("#representative_confirmation");
    return { checked: await page.isChecked("#representative_confirmation") };
  });

  await step("8_9_submit_no_strong_duplicate_pending_review", async () => {
    await Promise.all([
      page.waitForURL((u) => u.pathname === "/my/claims" || u.pathname === "/clubs/new/duplicate", { timeout: 20000 }),
      page.locator("form button.button").click(),
    ]);
    return { landedOn: page.url(), skippedDuplicateScreen: page.url().includes("/my/claims") };
  });

  await step("9b_pending_review_visible", async () => {
    await page.waitForTimeout(500);
    const card = page.locator(".panel", { hasText: CLUB_NAME });
    return { text: await card.first().textContent() };
  });

  let requestId;
  await step("resolve_request_id_for_admin_steps", async () => {
    const { data } = await service.from("club_creation_requests").select("id,status").eq("club_name", CLUB_NAME).eq("city", CLUB_CITY).maybeSingle();
    requestId = data?.id;
    return { requestId, status: data?.status };
  });

  const adminPage = await browser.newPage();
  await step("10_admin_opens_request", async () => {
    await login(ADMIN_EMAIL, PASSWORD, adminPage);
    await adminPage.goto(`${BASE}/admin/club-requests/${requestId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await adminPage.waitForTimeout(500);
    const text = await adminPage.locator("main").textContent();
    return { showsClubName: text?.includes(CLUB_NAME) ?? false };
  });

  await step("11_admin_approves", async () => {
    await adminPage.locator('form:has(button:text("Approuver — créer le club")) button').click();
    // The server action's revalidatePath + soft-refresh round trip can take
    // longer than a fixed wait on a cold Preview instance -- poll instead of
    // a single timed snapshot to avoid a false negative on an otherwise-
    // correct (DB-confirmed by step 12/13) approval.
    let text = "";
    for (let i = 0; i < 10; i++) {
      text = (await adminPage.locator("main").textContent()) ?? "";
      if (text.includes("Approuvée") || text.includes("Club créé")) break;
      await adminPage.waitForTimeout(500);
    }
    return { showsApproved: text.includes("Approuvée") || text.includes("Club créé") };
  });

  let newClubSlug, newClubId;
  await step("12_13_club_and_membership_created", async () => {
    const req = await service.from("club_creation_requests").select("status,created_club_id").eq("id", requestId).single();
    newClubId = req.data?.created_club_id;
    const club = newClubId ? await service.from("clubs").select("slug,source_id").eq("id", newClubId).maybeSingle() : { data: null };
    newClubSlug = club.data?.slug;
    const source = club.data?.source_id ? await service.from("data_sources").select("code").eq("id", club.data.source_id).single() : { data: null };
    const membership = newClubId ? await service.from("club_memberships").select("role,user_id").eq("club_id", newClubId).maybeSingle() : { data: null };
    return { status: req.data?.status, newClubSlug, sourceCode: source.data?.code, ownerRole: membership.data?.role };
  });

  await step("14_requester_sees_approved_and_link", async () => {
    await page.goto(`${BASE}/my/claims`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(500);
    const card = page.locator(".panel", { hasText: CLUB_NAME }).first();
    const text = await card.textContent();
    return { showsApproved: text?.includes("Approuvée") ?? false, hasClubLink: (await card.locator(`a[href="/clubs/${newClubSlug}"]`).count()) > 0 };
  });

  await step("15_club_studio_reachable_and_personalizable", async () => {
    await page.goto(`${BASE}/club-studio`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(700);
    const text = await page.locator("main").textContent();
    return {
      showsNewClub: text?.includes(CLUB_NAME) ?? false,
      hasProfileLink: (await page.locator(`a[href^="/club-studio/profile?club_id=${newClubId}"]`).count()) > 0,
      hasStaffLink: (await page.locator(`a[href="/club-studio/staff?club_id=${newClubId}"]`).count()) > 0,
      hasSponsorsLink: (await page.locator(`a[href="/club-studio/sponsors?club_id=${newClubId}"]`).count()) > 0,
    };
  });

  await step("16_17_staff_and_sponsors_modules_accessible", async () => {
    await page.goto(`${BASE}/club-studio/staff?club_id=${newClubId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const staffOk = (await page.locator("main").textContent())?.includes(CLUB_NAME) ?? false;
    await page.goto(`${BASE}/club-studio/sponsors?club_id=${newClubId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const sponsorsOk = (await page.locator("main").textContent())?.includes(CLUB_NAME) ?? false;
    return { staffOk, sponsorsOk };
  });

  await step("18_public_club_page_accessible", async () => {
    await page.goto(`${BASE}/clubs/${newClubSlug}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(500);
    const text = await page.locator("main").textContent();
    return { showsClubName: text?.includes(CLUB_NAME) ?? false };
  });

  await step("19_another_user_cannot_manage", async () => {
    const otherPage = await browser.newPage();
    await login(OTHER_EMAIL, PASSWORD, otherPage);
    await otherPage.goto(`${BASE}/club-studio/profile?club_id=${newClubId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await otherPage.waitForTimeout(500);
    const text = await otherPage.locator("body").textContent();
    const deniedText = !(text?.includes(CLUB_NAME) ?? false);
    await otherPage.close();
    return { deniedOrRedirected: deniedText };
  });

  await step("20_double_approval_creates_nothing_extra", async () => {
    const before = await service.from("clubs").select("id", { count: "exact", head: true }).eq("slug", newClubSlug);
    const retry = await service.rpc("approve_club_creation_request", { actor_id: ADMIN_ID, p_request_id: requestId });
    const after = await service.from("clubs").select("id", { count: "exact", head: true }).eq("slug", newClubSlug);
    const memberships = await service.from("club_memberships").select("id", { count: "exact", head: true }).eq("club_id", newClubId).eq("role", "OWNER");
    return { retryError: retry.error?.message ?? null, clubCountBefore: before.count, clubCountAfter: after.count, ownerMembershipCount: memberships.count };
  });

  results["23_console_errors"] = [...new Set(consoleErrors)].slice(0, 20);
  results["24_server_5xx_errors"] = serverErrors;

  const authState = await page.context().storageState();

  await step("21_mobile_390x844", async () => {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: authState });
    const mpage = await mobile.newPage();
    const checks = {};
    for (const [name, path] of [["clubs_search", "/clubs"], ["new_club_form", "/clubs/new"], ["my_requests", "/my/claims"], ["club_public", `/clubs/${newClubSlug}`]]) {
      await mpage.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await mpage.waitForTimeout(600);
      checks[name] = { overflow: await mpage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) };
    }
    await mobile.close();
    return checks;
  });

  await step("22_desktop_1440x900", async () => {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: authState });
    const dpage = await desktop.newPage();
    const checks = {};
    for (const [name, path] of [["clubs_search", "/clubs"], ["new_club_form", "/clubs/new"], ["my_requests", "/my/claims"], ["club_public", `/clubs/${newClubSlug}`]]) {
      await dpage.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await dpage.waitForTimeout(600);
      checks[name] = { overflow: await dpage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) };
    }
    await desktop.close();
    return checks;
  });

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})();
