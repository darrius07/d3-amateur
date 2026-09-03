// Golden Path E2E against the real step-5b2-match-events Preview.
// login OWNER -> match with lineup -> Gérer les événements -> goal+assist,
// yellow card, substitution -> refresh -> persisted -> edit minute ->
// delete an event -> public timeline + scorers -> score unchanged ->
// intruder denied -> mobile pass. Uses step5b2-e2e-fixture.mjs -- never
// touches real clubs/players.
import { chromium } from "playwright";

const BASE = process.env.STEP5B2_BASE_URL;
const EMAIL = process.env.STEP5B2_EMAIL;
const PASSWORD = process.env.STEP5B2_PASSWORD;
const MATCH_ID = process.env.STEP5B2_MATCH_ID;
const INTRUDER_EMAIL = process.env.STEP5B2_INTRUDER_EMAIL;
const INTRUDER_PASSWORD = process.env.STEP5B2_INTRUDER_PASSWORD;

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

  await step("login", async () => { await login(EMAIL, PASSWORD, page); return page.url(); });

  await step("open_events_page", async () => {
    await page.goto(`${BASE}/club-studio/matches/${MATCH_ID}/events`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    return page.url();
  });

  await step("add_goal_with_assist", async () => {
    const details = page.locator('details.match-form:has(summary:text("Ajouter un but")):not(:has(summary:text("camp")))').first();
    await details.locator("summary").click();
    await page.waitForTimeout(300);
    const form = details.locator("form");
    const scorerOptions = await form.locator('select[name="primary_player_id"] option').allTextContents();
    // secondary_player_id has a leading "Aucun" placeholder option, so
    // index 1 there is actually the *first* real player (same as
    // primary_player_id's index 0) -- index 2 is the second real player.
    await form.locator('select[name="primary_player_id"]').selectOption({ index: 0 });
    await form.locator('select[name="secondary_player_id"]').selectOption({ index: 2 });
    await form.locator('input[name="minute"]').fill("23");
    await Promise.all([
      page.waitForURL((u) => u.search.includes("message=event-created"), { timeout: 20000 }).catch(() => null),
      form.locator("button.button").click(),
    ]);
    await page.waitForTimeout(1200);
    return { scorerOptions, urlAfter: page.url() };
  });

  await step("add_yellow_card", async () => {
    const details = page.locator('details.match-form:has(summary:text("Ajouter un carton"))').first();
    await details.locator("summary").click();
    await page.waitForTimeout(300);
    const form = details.locator("form");
    await form.locator('select[name="primary_player_id"]').selectOption({ index: 2 });
    await form.locator('select[name="event_type"]').selectOption("YELLOW_CARD");
    await form.locator('input[name="minute"]').fill("30");
    await Promise.all([
      page.waitForURL((u) => u.search.includes("message=event-created"), { timeout: 20000 }).catch(() => null),
      form.locator("button.button").click(),
    ]);
    await page.waitForTimeout(1200);
    return page.url();
  });

  await step("add_substitution", async () => {
    const details = page.locator('details.match-form:has(summary:text("Ajouter un remplacement"))').first();
    await details.locator("summary").click();
    await page.waitForTimeout(300);
    const form = details.locator("form");
    await form.locator('select[name="primary_player_id"]').selectOption({ index: 0 });
    await form.locator('select[name="secondary_player_id"]').selectOption({ index: 3 });
    await form.locator('input[name="minute"]').fill("67");
    await Promise.all([
      page.waitForURL((u) => u.search.includes("message=event-created"), { timeout: 20000 }).catch(() => null),
      form.locator("button.button").click(),
    ]);
    await page.waitForTimeout(1200);
    return page.url();
  });

  await step("timeline_after_reload", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    return { eventCount: await page.locator(".event-list > li").count(), text: (await page.locator(".events-timeline").textContent())?.slice(0, 400) };
  });

  let deletedEventCount = null;
  await step("edit_first_event_minute", async () => {
    const first = page.locator(".event-list > li").first();
    await first.locator("details.edit-event-form summary").click();
    await page.waitForTimeout(300);
    await first.locator('.edit-event-form input[name="minute"]').fill("24");
    await first.locator('.edit-event-form button.button').click();
    await page.waitForTimeout(1200);
    return true;
  });

  await step("delete_last_event", async () => {
    const before = await page.locator(".event-list > li").count();
    const last = page.locator(".event-list > li").last();
    await last.locator('button.text-danger').click();
    await page.waitForTimeout(1200);
    const after = await page.locator(".event-list > li").count();
    deletedEventCount = { before, after };
    return deletedEventCount;
  });

  await step("public_match_timeline_and_scorers", async () => {
    await page.goto(`${BASE}/matches/${MATCH_ID}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    return {
      timelineShown: (await page.locator(".event-timeline-list li").count()) > 0,
      scorersShown: (await page.locator(".scorers-list li").count()) > 0,
      scoreStillTwoOne: (await page.locator("text=2 – 1").count()) > 0,
      minuteFormatted: (await page.locator("text=24'").count()) > 0,
    };
  });

  await step("intruder_denied", async () => {
    const intruderPage = await browser.newPage();
    await login(INTRUDER_EMAIL, INTRUDER_PASSWORD, intruderPage);
    const resp = await intruderPage.goto(`${BASE}/club-studio/matches/${MATCH_ID}/events`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const status = resp?.status();
    const bodySnippet = (await intruderPage.textContent("body"))?.slice(0, 200);
    await intruderPage.close();
    return { status, notFoundOrRedirected: status === 404 || !bodySnippet?.includes("Chronologie") };
  });

  results.console_errors = [...new Set(consoleErrors)].slice(0, 20);
  results.server_5xx_errors = serverErrors;

  await step("mobile_390x844", async () => {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mpage = await mobile.newPage();
    const checks = {};
    const paths = [["events_editor", `/club-studio/matches/${MATCH_ID}/events`], ["match_public", `/matches/${MATCH_ID}`]];
    for (const [name, path] of paths) {
      await mpage.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await mpage.waitForTimeout(1000);
      checks[name] = { overflow: await mpage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) };
    }
    await mobile.close();
    return checks;
  });

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})();
