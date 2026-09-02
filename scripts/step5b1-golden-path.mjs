// Golden Path E2E against the real step-5b1-match-lineups Preview.
// login OWNER -> Club Studio -> match -> Gérer la composition -> add
// players -> set starters/bench -> save -> refresh -> data persists ->
// public Match page shows lineup -> player link works -> cross-club
// (intruder) denied -> mobile pass. Uses the step5b1-e2e-fixture.mjs
// fixture -- never touches real clubs/players.
import { chromium } from "playwright";

const BASE = process.env.STEP5B1_BASE_URL;
const EMAIL = process.env.STEP5B1_EMAIL;
const PASSWORD = process.env.STEP5B1_PASSWORD;
const MATCH_ID = process.env.STEP5B1_MATCH_ID;
const OPPONENT_NAME = process.env.STEP5B1_OPPONENT_NAME;
const INTRUDER_EMAIL = process.env.STEP5B1_INTRUDER_EMAIL;
const INTRUDER_PASSWORD = process.env.STEP5B1_INTRUDER_PASSWORD;

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

  async function login(email, password) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.locator("#password").locator("xpath=ancestor::form").locator("button").click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 }).catch(() => null);
  }

  await step("login", async () => { await login(EMAIL, PASSWORD); return page.url(); });

  await step("club_studio_shows_manage_lineup_link", async () => {
    await page.goto(`${BASE}/club-studio`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    return (await page.locator('a:has-text("Gérer la composition")').count()) > 0;
  });

  await step("open_lineup_page", async () => {
    await page.locator('a:has-text("Gérer la composition")').first().click();
    await page.waitForTimeout(1500);
    return page.url();
  });

  await step("add_three_players", async () => {
    const search = page.locator('input[placeholder="Chercher dans l\'effectif du club…"]');
    await search.fill("Fixture");
    await page.waitForTimeout(400);
    const candidates = page.locator(".candidate-list li button");
    const count = await candidates.count();
    for (let i = 0; i < count; i++) {
      await page.locator('input[placeholder="Chercher dans l\'effectif du club…"]').fill("Fixture");
      await page.waitForTimeout(300);
      await page.locator(".candidate-list li button").first().click();
      await page.waitForTimeout(200);
    }
    return { candidatesFoundInitially: count };
  });

  await step("starters_count_after_adding", async () => (await page.locator("h3:has-text(\"Titulaires\")").textContent()));

  await step("move_one_to_bench", async () => {
    const moveButtons = page.locator('.lineup-columns section:first-child li button:has-text("→ Banc")');
    if (await moveButtons.count()) { await moveButtons.first().click(); await page.waitForTimeout(300); }
    return (await page.locator('.lineup-columns section:nth-child(2) h3').textContent());
  });

  await step("set_squad_number", async () => {
    const input = page.locator('.lineup-columns input[type="number"]').first();
    await input.fill("10");
    return true;
  });

  await step("save_lineup", async () => {
    await Promise.all([
      page.waitForURL((u) => u.search.includes("message=lineup-saved"), { timeout: 20000 }).catch(() => null),
      page.locator('form:has(input[name="entries"]) button.button').click(),
    ]);
    await page.waitForTimeout(1200);
    return page.url();
  });

  await step("saved_banner_shown", async () => (await page.locator("text=Composition enregistrée").count()) > 0);

  await step("data_persists_after_reload", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    return {
      starterCount: await page.locator('.lineup-columns section:first-child li').count(),
      benchCount: await page.locator('.lineup-columns section:nth-child(2) li').count(),
    };
  });

  await step("public_match_page_shows_lineup", async () => {
    await page.goto(`${BASE}/matches/${MATCH_ID}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1200);
    return {
      showsStarters: (await page.locator("text=Titulaires").count()) > 0,
      showsBench: (await page.locator("text=Remplaçants").count()) > 0,
      showsFixturePlayer: (await page.locator("text=Fixture").count()) > 0,
      opponentSideEmpty: (await page.locator("text=Composition non renseignée").count()) === 0, // both sides are the same team here (external opponent), so N/A but recorded
    };
  });

  await step("player_link_works", async () => {
    const link = page.locator('.public-lineup-list a').first();
    if ((await link.count()) === 0) return "NO_LINK_FOUND";
    const href = await link.getAttribute("href");
    await link.click();
    await page.waitForTimeout(1000);
    return { href, landedOn: page.url() };
  });

  await step("intruder_denied", async () => {
    const intruderPage = await browser.newPage();
    await intruderPage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await intruderPage.fill("#email", INTRUDER_EMAIL);
    await intruderPage.fill("#password", INTRUDER_PASSWORD);
    await intruderPage.locator("#password").locator("xpath=ancestor::form").locator("button").click();
    await intruderPage.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 }).catch(() => null);
    const resp = await intruderPage.goto(`${BASE}/club-studio/matches/${MATCH_ID}/lineup`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const status = resp?.status();
    const bodySnippet = (await intruderPage.textContent("body"))?.slice(0, 200);
    await intruderPage.close();
    return { status, notFoundOrRedirected: status === 404 || !bodySnippet?.includes("Titulaires") };
  });

  results.opponentName = OPPONENT_NAME;
  results.console_errors = [...new Set(consoleErrors)].slice(0, 20);
  results.server_5xx_errors = serverErrors;

  await step("mobile_390x844", async () => {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mpage = await mobile.newPage();
    const checks = {};
    const paths = [["club_studio", "/club-studio"], ["lineup_editor", `/club-studio/matches/${MATCH_ID}/lineup`], ["match_public", `/matches/${MATCH_ID}`]];
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
