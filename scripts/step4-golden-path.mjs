// Golden Path E2E against the real step-4-players-roster Preview deployment.
// OWNER -> Club Studio -> Seniors A -> search -> create player -> roster ->
// public Club page -> public Player page -> homepage global search.
// Uses one synthetic fixture club/owner (scripts/step4-e2e-fixture.mjs) --
// never touches real production clubs/players. Each step is independently
// try/caught so one flaky assertion under real network latency doesn't
// lose the results of every step that already succeeded.
import {chromium} from 'playwright';
const BASE = process.env.STEP4_BASE_URL;
const EMAIL = process.env.STEP4_EMAIL;
const PASSWORD = process.env.STEP4_PASSWORD;
const CLUB_SLUG = process.env.STEP4_CLUB_SLUG;
const PLAYER_FIRST='Amara', PLAYER_LAST=`Traore${Date.now().toString().slice(-6)}`;

const results = {player_first:PLAYER_FIRST,player_last:PLAYER_LAST};
async function step(name, fn){try{results[name]=await fn()}catch(e){results[name]=`ERROR: ${e.message.split('\n')[0]}`}}

(async () => {
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage();
  const consoleErrors=[];const serverErrors=[];
  page.on('pageerror',e=>consoleErrors.push(e.message));
  page.on('response',r=>{if(r.status()>=500)serverErrors.push(`http${r.status()}:${r.url()}`)});

  await step('login', async () => {
    await page.goto(`${BASE}/login`,{waitUntil:'domcontentloaded',timeout:60000});
    await page.fill('#email',EMAIL);
    await page.fill('#password',PASSWORD);
    await page.locator('#password').locator('xpath=ancestor::form').locator('button').click();
    await page.waitForURL(u=>!u.pathname.includes('/login'),{timeout:20000}).catch(()=>null);
    return page.url();
  });

  await step('club_studio_reached', async () => {
    await page.goto(`${BASE}/club-studio`,{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForSelector('h1',{timeout:15000});
    return page.url().includes('/club-studio');
  });

  await step('seniors_a_created_or_present', async () => {
    const createBtn = page.locator('form:has(input[name="rank"][value="1"]) button');
    if (await createBtn.count()) { await createBtn.click(); await page.waitForLoadState('domcontentloaded'); await page.waitForTimeout(1500); }
    return (await page.locator('text=Seniors A').count()) > 0;
  });

  await step('search_no_result_before_create', async () => {
    await page.locator('details.player-adder summary').first().click();
    await page.waitForTimeout(300);
    const box = page.locator('details.player-adder').first().locator('input[placeholder="Jean Dupont"]');
    await box.click();
    await box.fill('Zzz Nobody Matches Xyz Query');
    await page.waitForTimeout(600);
    return (await page.locator('.candidate-list li').count()) === 0;
  });

  await step('player_created', async () => {
    const details = page.locator('details.player-adder').first();
    const searchBox = details.locator('input[placeholder="Jean Dupont"]');
    await searchBox.click();
    await searchBox.fill('');
    await details.locator('input[name="first_name"]').fill(PLAYER_FIRST);
    await details.locator('input[name="last_name"]').fill(PLAYER_LAST);
    await details.locator('select[name="primary_position"]').selectOption('FORWARD');
    await details.locator('input[name="squad_number"]').fill('17');
    await details.locator('.roster-form button.button').click();
    await page.waitForURL(u=>u.search.includes('player=')||u.search.includes('message='),{timeout:20000}).catch(()=>null);
    await page.waitForTimeout(1000);
    return page.url();
  });

  await step('player_in_roster_studio', async () => page.locator(`text=${PLAYER_FIRST} ${PLAYER_LAST}`).count().then(n=>n>0));

  await step('search_finds_created_player_with_classification', async () => {
    const details = page.locator('details.player-adder').first();
    const isOpen = await details.evaluate(el=>el.open).catch(()=>false);
    if (!isOpen) await details.locator('summary').click();
    await page.waitForTimeout(300);
    const searchBox = details.locator('input[placeholder="Jean Dupont"]');
    await searchBox.click();
    await searchBox.fill(PLAYER_LAST);
    await page.waitForTimeout(700);
    const found = (await page.locator(`.candidate-list :text("${PLAYER_LAST}")`).count()) > 0;
    const classified = (await page.locator('text=Candidat très probable').count()) > 0;
    return {found, classified};
  });

  await step('public_club_page', async () => {
    await page.goto(`${BASE}/clubs/${CLUB_SLUG}`,{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForTimeout(1200);
    const showsPlayer = (await page.locator(`text=${PLAYER_FIRST} ${PLAYER_LAST}`).count()) > 0;
    return {showsPlayer};
  });

  await step('public_player_page', async () => {
    await page.click(`text=${PLAYER_FIRST} ${PLAYER_LAST}`);
    await page.waitForTimeout(1200);
    const url = page.url();
    const showsClub = (await page.locator('text=D3 Test Club Step4 E2E').count()) > 0;
    const showsPlaceholderStats = (await page.locator('text=Statistiques disponibles après ajout des matchs').count()) > 0;
    const noFakeZero = (await page.locator('text=0 match').count()) === 0;
    const claimCta = (await page.locator("text=Revendiquer ce profil").count()) > 0;
    return {url, showsClub, showsPlaceholderStats, noFakeZero, claimCta};
  });

  await step('homepage_global_search', async () => {
    await page.goto(`${BASE}/`,{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForTimeout(1000);
    const searchBox = page.locator('#home-club-search, #club-search').first();
    await searchBox.fill(PLAYER_LAST);
    await page.waitForTimeout(800);
    const found = (await page.locator(`text=${PLAYER_FIRST} ${PLAYER_LAST}`).count()) > 0;
    const labeled = (await page.locator('b:text("Joueur")').count()) > 0;
    return {found, labeled};
  });

  results.console_errors = [...new Set(consoleErrors)].slice(0,20);
  results.server_5xx_errors = serverErrors;

  await step('mobile_390x844', async () => {
    const mobile = await browser.newContext({viewport:{width:390,height:844}});
    const mpage = await mobile.newPage();
    const checks = {};
    const playerPath = results.public_player_page?.url ? new URL(results.public_player_page.url).pathname : `/players/${PLAYER_FIRST}-${PLAYER_LAST}`.toLowerCase();
    for (const [name,path] of [['club_studio','/club-studio'],['player_page',playerPath],['homepage','/']]) {
      await mpage.goto(`${BASE}${path}`,{waitUntil:'domcontentloaded',timeout:60000});
      await mpage.waitForTimeout(800);
      checks[name] = {overflow: await mpage.evaluate(()=>document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)};
    }
    await mobile.close();
    return checks;
  });

  console.log(JSON.stringify(results,null,2));
  await browser.close();
})();
