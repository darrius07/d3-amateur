// Duplicate Golden Path E2E against the real step-6d-missing-club Preview
// (mission section 46, mandatory second scenario): user searches a club
// that already exists in D3 -> results show it, but the user still reaches
// "Ajouter mon club" via the secondary path -> submits a request with the
// SAME name + city -> D3 flags a LIKELY_DUPLICATE candidate before the
// request is even created -> candidate shown with "Revendiquer ce club" ->
// user continues anyway -> request created carrying the duplicate flag ->
// Admin opens it, marks DUPLICATE -> no new clubs row, no OWNER membership
// -> requester sees a link to the EXISTING club and its real Claim CTA ->
// the existing Claim flow works. Uses step6d-e2e-fixture.mjs.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());

const BASE = process.env.STEP6D_BASE_URL;
const PASSWORD = process.env.STEP6D_PASSWORD;
const REQUESTER_EMAIL = process.env.STEP6D_REQUESTER_EMAIL;
const ADMIN_EMAIL = process.env.STEP6D_ADMIN_EMAIL;
const EXISTING_CLUB_SLUG = process.env.STEP6D_EXISTING_CLUB_SLUG;
const EXISTING_CLUB_NAME = process.env.STEP6D_EXISTING_CLUB_NAME;
const EXISTING_CLUB_CITY = process.env.STEP6D_EXISTING_CLUB_CITY;
const EXISTING_CLUB_ID = process.env.STEP6D_EXISTING_CLUB_ID;
const REQUESTER_ID = process.env.STEP6D_REQUESTER_ID;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

  await step("1_login_requester", async () => { await login(REQUESTER_EMAIL, PASSWORD, page); return page.url(); });

  await step("2_search_finds_the_existing_club", async () => {
    await page.goto(`${BASE}/clubs`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(800); // let the client component hydrate before typing, or fill() races React and gets wiped
    await page.fill("#club-search", EXISTING_CLUB_NAME);
    await page.waitForTimeout(1800);
    const text = await page.locator(".club-results").textContent().catch(() => "");
    return { foundExistingClub: text?.includes(EXISTING_CLUB_NAME) ?? false, hasSecondaryCta: (await page.locator(".missing-club-secondary a").count()) > 0 };
  });

  await step("3_secondary_path_to_add_my_club", async () => {
    await page.locator(".missing-club-secondary a").click();
    await page.waitForURL((u) => u.pathname === "/clubs/new", { timeout: 20000 });
    return page.url();
  });

  await step("4_fill_same_name_and_city_as_existing_club", async () => {
    await page.fill("#club_name", EXISTING_CLUB_NAME);
    await page.fill("#city", EXISTING_CLUB_CITY);
    await page.check("#representative_confirmation");
    return { ready: true };
  });

  await step("5_submit_lands_on_duplicate_candidate_screen", async () => {
    await Promise.all([
      page.waitForURL((u) => u.pathname === "/clubs/new/duplicate", { timeout: 20000 }),
      page.locator("form button.button").click(),
    ]);
    return page.url();
  });

  await step("6_candidate_shown_with_claim_cta", async () => {
    const text = await page.locator("main").textContent();
    return {
      showsCandidateName: text?.includes(EXISTING_CLUB_NAME) ?? false,
      hasClaimCta: (await page.locator(`a[href="/clubs/${EXISTING_CLUB_SLUG}/claim"]`).count()) > 0,
    };
  });

  let requestId;
  await step("7_continue_anyway_creates_request", async () => {
    await Promise.all([
      page.waitForURL((u) => u.pathname === "/my/claims", { timeout: 20000 }),
      page.locator('form:has-text("Ce n’est pas mon club") button').click(),
    ]);
    const { data } = await service.from("club_creation_requests").select("id,duplicate_candidate_club_id,duplicate_review_state").eq("requested_by", REQUESTER_ID).eq("club_name", EXISTING_CLUB_NAME).eq("city", EXISTING_CLUB_CITY).order("created_at", { ascending: false }).limit(1).maybeSingle();
    requestId = data?.id;
    return { requestId, duplicateCandidateClubId: data?.duplicate_candidate_club_id, matchesExisting: data?.duplicate_candidate_club_id === EXISTING_CLUB_ID, reviewState: data?.duplicate_review_state };
  });

  const adminPage = await browser.newPage();
  await step("8_admin_opens_and_sees_duplicate_flag", async () => {
    await login(ADMIN_EMAIL, PASSWORD, adminPage);
    await adminPage.goto(`${BASE}/admin/club-requests/${requestId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await adminPage.waitForTimeout(500);
    const text = await adminPage.locator("main").textContent();
    return { showsDuplicateSection: text?.includes("Doublons possibles") ?? false, showsExistingClub: text?.includes(EXISTING_CLUB_NAME) ?? false };
  });

  await step("9_admin_marks_duplicate", async () => {
    const form = adminPage.locator('form:has(button[value="DUPLICATE"])');
    await form.locator("textarea#public_message").fill("Ce club existe déjà dans D3.");
    await form.locator('button[value="DUPLICATE"]').click();
    await adminPage.waitForTimeout(2500);
    const text = await adminPage.locator("main").textContent();
    return { showsDuplicateStatus: text?.includes("Doublon") ?? false };
  });

  await step("10_11_no_new_club_no_owner_membership", async () => {
    const req = await service.from("club_creation_requests").select("status,created_club_id").eq("id", requestId).single();
    const membership = await service.from("club_memberships").select("id").eq("club_id", EXISTING_CLUB_ID).eq("user_id", REQUESTER_ID).eq("role", "OWNER");
    return { status: req.data?.status, createdClubId: req.data?.created_club_id, noOwnerMembershipGranted: (membership.data?.length ?? 0) === 0 };
  });

  await step("12_13_requester_sees_link_to_existing_club_and_claim_cta", async () => {
    await page.goto(`${BASE}/my/claims`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(500);
    const card = page.locator(".panel", { hasText: EXISTING_CLUB_NAME }).first();
    const text = await card.textContent();
    const claimLink = card.locator(`a[href="/clubs/${EXISTING_CLUB_SLUG}/claim"]`);
    const hasClaimLink = (await claimLink.count()) > 0;
    if (hasClaimLink) {
      await Promise.all([
        page.waitForURL((u) => u.pathname === `/clubs/${EXISTING_CLUB_SLUG}/claim`, { timeout: 20000 }),
        claimLink.click(),
      ]);
    }
    const claimPageText = hasClaimLink ? await page.locator("main").textContent() : null;
    return {
      showsExistsMessage: text?.includes("existe déjà") ?? false,
      hasClaimLink,
      claimFlowWorks: claimPageText?.includes(EXISTING_CLUB_NAME) ?? false,
    };
  });

  results["console_errors"] = [...new Set(consoleErrors)].slice(0, 20);
  results["server_5xx_errors"] = serverErrors;

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})();
