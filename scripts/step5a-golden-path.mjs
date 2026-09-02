// Golden Path E2E against the real step-5a-match-foundation Preview.
// login OWNER -> Club Studio -> Seniors A -> add match (free-text opponent)
// -> visible upcoming -> public Club page -> public Match page -> enter
// result from Club Studio -> score public -> match moves to results ->
// mobile pass. Uses one synthetic fixture club/owner
// (scripts/step5a-e2e-fixture.mjs) -- never touches real clubs/players.
import { chromium } from "playwright";

const BASE = process.env.STEP5A_BASE_URL;
const EMAIL = process.env.STEP5A_EMAIL;
const PASSWORD = process.env.STEP5A_PASSWORD;
const CLUB_SLUG = process.env.STEP5A_CLUB_SLUG;
const OPPONENT_NAME = `FC Golden Path ${Date.now().toString().slice(-6)}`;

const results = { opponentName: OPPONENT_NAME };
async function step(name, fn) {
  try { results[name] = await fn(); } catch (e) { results[name] = `ERROR: ${e.message.split("\n")[0]}`; }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleErrors = []; const serverErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  page.on("response", (r) => { if (r.status() >= 500) serverErrors.push(`http${r.status()}:${r.url()}`); });

  await step("login", async () => {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.fill("#email", EMAIL);
    await page.fill("#password", PASSWORD);
    await page.locator("#password").locator("xpath=ancestor::form").locator("button").click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 }).catch(() => null);
    return page.url();
  });

  await step("club_studio_reached", async () => {
    await page.goto(`${BASE}/club-studio`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    return page.url().includes("/club-studio");
  });

  await step("seniors_a_created_or_present", async () => {
    const createBtn = page.locator('form:has(input[name="rank"][value="1"]) button');
    if (await createBtn.count()) { await createBtn.click(); await page.waitForTimeout(1500); }
    return (await page.locator("text=Seniors A").count()) > 0;
  });

  await step("match_created", async () => {
    const addForm = page.locator(".roster-card .match-form").first();
    await addForm.locator("summary").click();
    await page.waitForTimeout(300);
    await addForm.locator('button.text-link:has-text("Adversaire non trouvé")').click();
    await addForm.locator('input[placeholder="FC Exemple"]').fill(OPPONENT_NAME);
    const kickoff = new Date(Date.now() + 5 * 24 * 3600 * 1000);
    const local = `${kickoff.getFullYear()}-${String(kickoff.getMonth() + 1).padStart(2, "0")}-${String(kickoff.getDate()).padStart(2, "0")}T18:30`;
    await addForm.locator('input[type="datetime-local"]').fill(local);
    await addForm.locator('input[placeholder="Stade municipal…"]').fill("Stade Golden Path");
    await Promise.all([
      page.waitForURL((u) => u.search.includes("message=match-created"), { timeout: 20000 }).catch(() => null),
      addForm.locator("button.button").click(),
    ]);
    await page.waitForTimeout(1200);
    return page.url();
  });

  await step("match_visible_upcoming_studio", async () => page.locator(`text=${OPPONENT_NAME}`).count().then((n) => n > 0));

  let matchUrl = null;
  await step("public_club_shows_match", async () => {
    await page.goto(`${BASE}/clubs/${CLUB_SLUG}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    const link = page.locator(`a:has-text("${OPPONENT_NAME}")`).first();
    const found = (await link.count()) > 0;
    if (found) matchUrl = await link.getAttribute("href");
    return { found, matchUrl };
  });

  await step("public_match_page", async () => {
    if (!matchUrl) return "SKIPPED: no match link found on club page";
    await page.goto(`${BASE}${matchUrl}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1200);
    return {
      showsOpponent: (await page.locator(`text=${OPPONENT_NAME}`).count()) > 0,
      showsVenue: (await page.locator("text=Stade Golden Path").count()) > 0,
      compositionEmptyState: (await page.locator("text=Les détails joueurs seront disponibles").count()) >= 3,
      noFakeScoreYet: (await page.locator("text=0 – 0").count()) === 0,
    };
  });

  await step("enter_result", async () => {
    await page.goto(`${BASE}/club-studio`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1200);
    const row = page.locator(`li.match-row:has-text("${OPPONENT_NAME}")`).first();
    await row.locator('details.result-form summary').click();
    await page.waitForTimeout(300);
    const inputs = row.locator('.score-form input[type="number"]');
    await inputs.nth(0).fill("3");
    await inputs.nth(1).fill("1");
    await Promise.all([
      page.waitForURL((u) => u.search.includes("message=result-saved"), { timeout: 20000 }).catch(() => null),
      row.locator(".score-form button.button").click(),
    ]);
    await page.waitForTimeout(1200);
    return page.url();
  });

  await step("match_in_results_studio", async () => page.locator(`text=3 – 1`).count().then((n) => n > 0));

  await step("public_club_shows_result", async () => {
    await page.goto(`${BASE}/clubs/${CLUB_SLUG}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    return (await page.locator("text=3 – 1").count()) > 0;
  });

  await step("public_match_shows_score", async () => {
    if (!matchUrl) return "SKIPPED: no match link found on club page";
    await page.goto(`${BASE}${matchUrl}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1200);
    return {
      showsScore: (await page.locator("text=3 – 1").count()) > 0,
      declaredByClub: (await page.locator("text=Résultat renseigné par le club").count()) > 0,
    };
  });

  results.console_errors = [...new Set(consoleErrors)].slice(0, 20);
  results.server_5xx_errors = serverErrors;

  await step("mobile_390x844", async () => {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mpage = await mobile.newPage();
    const checks = {};
    const paths = [["club_studio", "/club-studio"], ["club_public", `/clubs/${CLUB_SLUG}`], ["match_public", matchUrl ?? "/clubs"]];
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
