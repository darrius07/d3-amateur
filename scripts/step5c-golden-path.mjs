// Golden Path E2E against the real step-5c-derived-player-stats Preview.
// login OWNER -> events page -> substitution brings B on -> goal by A
// assisted by B -> Player A/B pages show live derived stats -> delete the
// goal -> Player A's goal count drops immediately -> delete the
// substitution -> Player B's appearance drops to 0 immediately -> Club
// roster reflects the (now zeroed) stats -> mobile 390x844 -> no
// console/5xx errors. Uses step5c-e2e-fixture.mjs -- never touches real
// clubs/players. Substitution is created BEFORE the goal (mission section
// 35's own "adapt the event order" note) so B is a genuine, documented
// substitute appearance at the moment they are credited with the assist.
import { chromium } from "playwright";

const BASE = process.env.STEP5C_BASE_URL;
const EMAIL = process.env.STEP5C_EMAIL;
const PASSWORD = process.env.STEP5C_PASSWORD;
const MATCH_ID = process.env.STEP5C_MATCH_ID;
const CLUB_SLUG = process.env.STEP5C_CLUB_SLUG;
const SLUG_A = process.env.STEP5C_SLUG_A; // scorer, starter
const SLUG_B = process.env.STEP5C_SLUG_B; // bench -> substitute -> assist

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

  await step("login", async () => {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.fill("#email", EMAIL);
    await page.fill("#password", PASSWORD);
    await page.locator("#password").locator("xpath=ancestor::form").locator("button").click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 }).catch(() => null);
    return page.url();
  });

  await step("open_events_page", async () => {
    await page.goto(`${BASE}/club-studio/matches/${MATCH_ID}/events`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1000);
    return page.url();
  });

  await step("add_substitution_bringing_B_on", async () => {
    const details = page.locator('details.match-form:has(summary:text("Ajouter un remplacement"))').first();
    await details.scrollIntoViewIfNeeded();
    await details.locator("summary").click();
    await page.waitForTimeout(300);
    const form = details.locator("form");
    await form.locator('select[name="primary_player_id"]').selectOption({ index: 2 }); // a filler starter goes out
    await form.locator('select[name="secondary_player_id"]').selectOption({ index: 3 }); // B comes on
    await form.locator('input[name="minute"]').fill("60");
    await Promise.all([
      page.waitForURL((u) => u.search.includes("message=event-created"), { timeout: 20000 }).catch(() => null),
      form.locator("button.button").click(),
    ]);
    await page.waitForTimeout(1000);
    return page.url();
  });

  let goalEventCreated = false;
  await step("add_goal_by_A_assisted_by_B", async () => {
    await page.goto(`${BASE}/club-studio/matches/${MATCH_ID}/events`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const details = page.locator('details.match-form:has(summary:text("Ajouter un but")):not(:has(summary:text("camp")))').first();
    await details.locator("summary").click();
    await page.waitForTimeout(300);
    const form = details.locator("form");
    await form.locator('select[name="primary_player_id"]').selectOption({ index: 0 }); // A scores
    await form.locator('select[name="secondary_player_id"]').selectOption({ index: 4 }); // B assists (index 0 is the "Aucun" placeholder)
    await form.locator('input[name="minute"]').fill("65");
    await Promise.all([
      page.waitForURL((u) => u.search.includes("message=event-created"), { timeout: 20000 }).catch(() => null),
      form.locator("button.button").click(),
    ]);
    await page.waitForTimeout(1000);
    goalEventCreated = true;
    return page.url();
  });

  await step("player_A_page_shows_derived_stats", async () => {
    await page.goto(`${BASE}/players/${SLUG_A}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1000);
    const text = await page.locator("main").textContent();
    return {
      appearance: text?.includes("1 apparition documentée") ?? false,
      goal: text?.includes("1 but documenté") ?? false,
      coverageSentence: text?.includes("Feuilles de match disponibles sur") ?? false,
    };
  });

  await step("player_B_page_shows_substitute_appearance_and_assist", async () => {
    await page.goto(`${BASE}/players/${SLUG_B}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1000);
    const text = await page.locator("main").textContent();
    return {
      appearance: text?.includes("1 apparition documentée") ?? false,
      subEntryMentioned: text?.includes("1 entrée en jeu") ?? false,
      assist: text?.includes("1 passe décisive renseignée") ?? false,
    };
  });

  await step("club_roster_reflects_stats_before_correction", async () => {
    await page.goto(`${BASE}/clubs/${CLUB_SLUG}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1000);
    const text = await page.locator(".public-rosters").textContent();
    return { showsAGoal: text?.includes("1 but documenté") ?? false };
  });

  let deletedGoal = false;
  await step("delete_the_goal_event", async () => {
    await page.goto(`${BASE}/club-studio/matches/${MATCH_ID}/events`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(800);
    const goalRow = page.locator('.event-list > li:has-text("But")').first();
    await goalRow.locator("button.text-danger").click();
    await page.waitForTimeout(1000);
    deletedGoal = true;
    return page.url();
  });

  await step("player_A_goal_count_drops_immediately", async () => {
    await page.goto(`${BASE}/players/${SLUG_A}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1000);
    const text = await page.locator("main").textContent();
    return { goalNowZero: text?.includes("0 but documenté") ?? false, stillAppeared: text?.includes("1 apparition documentée") ?? false };
  });

  let deletedSub = false;
  await step("delete_the_substitution_event", async () => {
    await page.goto(`${BASE}/club-studio/matches/${MATCH_ID}/events`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(800);
    const subRow = page.locator('.event-list > li:has-text("Remplacement")').first();
    await subRow.locator("button.text-danger").click();
    await page.waitForTimeout(1000);
    deletedSub = true;
    return page.url();
  });

  await step("player_B_appearance_drops_to_zero_immediately", async () => {
    await page.goto(`${BASE}/players/${SLUG_B}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1000);
    const text = await page.locator("main").textContent();
    return { noDataMessageShown: text?.includes("Aucune statistique documentée pour le moment") ?? false };
  });

  await step("club_roster_reflects_corrected_stats", async () => {
    await page.goto(`${BASE}/clubs/${CLUB_SLUG}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1000);
    const text = await page.locator(".public-rosters").textContent();
    return { noLongerShowsGoal: !(text?.includes("1 but documenté") ?? false) };
  });

  results.console_errors = [...new Set(consoleErrors)].slice(0, 20);
  results.server_5xx_errors = serverErrors;
  results.event_lifecycle = { goalEventCreated, deletedGoal, deletedSub };

  await step("mobile_390x844", async () => {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mpage = await mobile.newPage();
    const checks = {};
    const paths = [["player_page", `/players/${SLUG_A}`], ["club_page", `/clubs/${CLUB_SLUG}`]];
    for (const [name, path] of paths) {
      await mpage.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await mpage.waitForTimeout(800);
      checks[name] = { overflow: await mpage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) };
    }
    await mobile.close();
    return checks;
  });

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})();
