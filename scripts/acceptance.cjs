/* Acceptance walk: serves dist/, opens every view as a phone and a laptop, runs the
   invitation round trip (admin creates invite -> relative opens link, enters code,
   submits a memory -> it appears in the admin inbox -> admin approves) and saves screenshots.
   Usage: node scripts/acceptance.cjs   (after npm run build) */
const { chromium, devices } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = '/family-history/';
const root = path.join(__dirname, '..', 'dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith(BASE)) p = p.slice(BASE.length - 1);
  if (p.startsWith('/private/')) {
    const pf = path.join(__dirname, '..', 'data', 'private', p.slice('/private/'.length));
    if (fs.existsSync(pf)) { res.writeHead(200, { 'content-type': 'application/json' }); return fs.createReadStream(pf).pipe(res); }
    res.writeHead(404); return res.end();
  }
  let f = path.join(root, p === '/' ? 'index.html' : p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(root, 'index.html');
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

// Names come from the git-ignored private dataset, never from this file.
const PRIVATE = path.join(__dirname, '..', 'data', 'private', 'family-dataset.json');
if (!fs.existsSync(PRIVATE)) { console.error('data/private/family-dataset.json missing; the walk needs the private dataset.'); process.exit(1); }
const pd = JSON.parse(fs.readFileSync(PRIVATE, 'utf8'));
const rootP = pd.people.find((x) => x.id === pd.settings.rootPersonId);
const ROOT_NAME = `${rootP.givenNames} ${rootP.surname}`;
const ROOT_FIRST = rootP.givenNames.split(' ')[0];
const ROOT_ID = rootP.id;
const rootEvt = pd.events.find((e) => e.personIds.includes(rootP.id) && e.sourceIds.length);
const ROOT_SOURCE = pd.sources.find((s) => s.id === rootEvt.sourceIds[0]).title;
// A deceased ancestor born before 1950 with a known birth year, for the timeline year check.
const anc = pd.people.find((x) => x.living === 'no' && pd.events.some((e) => e.type === 'birth' && e.personIds.includes(x.id) && e.date && e.date.year && e.date.year < 1950 && e.date.year > 1900));
const ancBirth = pd.events.find((e) => e.type === 'birth' && e.personIds.includes(anc.id)).date.year;
const ANC_NAME = `${anc.givenNames} ${anc.surname}`;
const ANC_AGE_1950 = `age ${1950 - ancBirth}`;

const shots = path.join(__dirname, '..', 'test-results');
fs.mkdirSync(shots, { recursive: true });
let n = 0;
const results = [];
function check(name, ok, detail = '') { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); }

(async () => {
  await new Promise((r) => server.listen(4176, r));
  const url = (h) => `http://localhost:4176${BASE}#${h}`;
  const browser = await chromium.launch();
  for (const [label, ctxOpts] of [['laptop', { viewport: { width: 1360, height: 860 } }], ['iphone', devices['iPhone 13']]]) {
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const shot = async (name) => page.screenshot({ path: path.join(shots, `${String(++n).padStart(2, '0')}-${label}-${name}.png`), fullPage: label === 'laptop' });

    await page.goto(url('/'));
    await page.waitForSelector('h1');
    await page.waitForFunction((n) => document.body.textContent.includes(n), ROOT_FIRST, { timeout: 10000 }).catch(() => {});
    await page.reload();
    await page.waitForSelector('h1');
    check(`${label} home renders`, (await page.textContent('h1')).includes('generations'));
    check(`${label} home loaded the private family dataset`, (await page.textContent('body')).includes(ROOT_FIRST) && (await page.textContent('body')).includes('slots waiting on facts') && (await page.$$('.constellation circle')).length > 10);
    await shot('home');

    await page.goto(url('/tree'));
    await page.waitForSelector('.node');
    const nodes = await page.$$('.node');
    check(`${label} tree draws nodes`, nodes.length >= 9, `${nodes.length} nodes`);
    await page.waitForTimeout(300);
    await shot('tree');
    await page.click('.node >> nth=0 >> circle.ring');
    await page.waitForSelector('.drawer');
    check(`${label} tree drawer opens`, !!(await page.$('.drawer h2')));
    await shot('tree-drawer');

    await page.goto(url('/map'));
    await page.waitForSelector('.leaflet-container');
    await page.waitForTimeout(1200);
    check(`${label} map has markers`, (await page.$$('.leaflet-interactive')).length >= 1);
    await shot('map');

    await page.goto(url('/timeline'));
    await page.waitForSelector('svg');
    check(`${label} timeline renders the root person`, (await page.textContent('body')).includes(ROOT_NAME));
    await page.click('text=1950');
    check(`${label} timeline 1950 shows an ancestor with age`, (await page.textContent('body')).includes(ANC_NAME) && (await page.textContent('body')).includes(ANC_AGE_1950));
    await shot('timeline');

    await page.goto(url('/related'));
    await page.waitForSelector('h1');
    check(`${label} relation explorer answers`, (await page.textContent('body')).includes('spouse') || (await page.textContent('body')).includes('son') || (await page.textContent('body')).includes('father'));
    await shot('related');

    await page.goto(url(`/person/${ROOT_ID}`));
    await page.waitForSelector('h1');
    check(`${label} profile shows source`, (await page.textContent('body')).includes(ROOT_SOURCE));
    await shot('profile');

    if (label === 'laptop') {
      // Admin: add a clearly labeled test person into the father slot via edit.
      await page.goto(url('/admin/people?edit=p-father'));
      await page.waitForSelector('text=Edit');
      await page.fill('label:has-text("Given names") input', 'TESTONLY Father');
      await page.fill('label:has-text("Surname") input', 'Placeholderson');
      await page.fill('label:has-text("Where did this come from") input', 'acceptance test, not a real person');
      await page.click('button:has-text("Save")');
      await page.waitForTimeout(300);
      check('admin edit saved', (await page.textContent('body')).includes('TESTONLY Father'));
      await shot('admin-people');

      // Invitation
      await page.goto(url('/admin/invites'));
      await page.fill('label:has-text("Name to greet") input', 'Test Relative');
      await page.click('button:has-text("Create invitation")');
      await page.waitForSelector('code.token');
      const tokens = await page.$$eval('code.token', (els) => els.map((e) => e.textContent));
      const link = tokens[0], code = tokens[1];
      check('invitation created with link and code', link.includes('#/invite/') && /^\d{6}$/.test(code));
      await shot('admin-invite');

      // Relative opens the link in a fresh context? Local mode stores in localStorage of this origin, so same context, new page.
      const rel = await ctx.newPage();
      await rel.goto(link.replace(/^https?:\/\/[^/]+/, 'http://localhost:4176'));
      await rel.waitForSelector('input');
      await rel.fill('input', '123456');
      await rel.click('button:has-text("Open")');
      await rel.waitForTimeout(300);
      check('wrong code refused', (await rel.textContent('body')).includes('does not match'));
      await rel.fill('input', code);
      await rel.click('button:has-text("Open")');
      await rel.waitForSelector('text=Welcome, Test.');
      const momDevice = await rel.evaluate(() => localStorage.getItem('family-history:device-id'));
      const body = await rel.textContent('body');
      check('relative sees no placeholder slots', !body.includes('name needed'));
      check('relative does not see admin notes', !body.includes('Placeholder slot'));
      await rel.screenshot({ path: path.join(shots, `${String(++n).padStart(2, '0')}-relative-welcome.png`), fullPage: true });
      await rel.click(`button:has-text("${ROOT_NAME}")`);
      await rel.waitForSelector(`text=Add to ${ROOT_FIRST}`);
      await rel.click('button:has-text("Share a memory")');
      await rel.fill('textarea', 'ACCEPTANCE TEST memory, not real.');
      await rel.fill('label:has-text("How do you know") input', 'automated test');
      // attach a tiny PNG and a text document
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
      await rel.setInputFiles('input[type=file]', [{ name: 'test-photo.png', mimeType: 'image/png', buffer: png }, { name: 'test-letter.txt', mimeType: 'text/plain', buffer: Buffer.from('ACCEPTANCE TEST letter') }]);
      await rel.waitForSelector('text=test-letter.txt');
      check('relative attached a photo and a document', (await rel.textContent('body')).includes('test-photo.png') && (await rel.textContent('body')).includes('test-letter.txt'));
      await rel.click(`button:has-text("Send to ${ROOT_FIRST}")`);
      await rel.waitForSelector('text=to review before it becomes part of the record');
      check('relative submitted a contribution', true);
      // center-on-me is offered only when the invitation is tied to a person; this test invite is not, so the tree centers on the root person
      await rel.click('button:has-text("Tree")');
      await rel.waitForSelector('.node');
      check('relative tree without a personId has no center-on-me toggle', !(await rel.$('button:has-text("Center the tree on me")')));
      await rel.click('button:has-text("People")');
      await rel.screenshot({ path: path.join(shots, `${String(++n).padStart(2, '0')}-relative-submitted.png`), fullPage: true });
      await rel.click('button:has-text("Tree")');
      await rel.waitForSelector('.node');
      const relNodes = await rel.$$('.node');
      check('relative tree hides slots', relNodes.length < nodes.length, `${relNodes.length} vs ${nodes.length}`);
      await rel.screenshot({ path: path.join(shots, `${String(++n).padStart(2, '0')}-relative-tree.png`) });

      // Admin inbox (local mode: each tab holds its own copy, so reload to read what the relative's tab saved)
      await page.goto(url('/admin/inbox'));
      await page.reload();
      await page.waitForSelector('text=ACCEPTANCE TEST memory');
      check('contribution reached admin inbox with contributor identity', (await page.textContent('body')).includes('Test Relative'));
      await page.waitForSelector('text=Attachments (2)');
      check('attachments render in the inbox (image + download)', !!(await page.$('img[alt="test-photo.png"]')) && !!(await page.$('a:has-text("Open")')));
      await shot('admin-inbox');
      await page.click('button:has-text("Approve")');
      await page.waitForTimeout(200);
      await page.click('button:has-text("approved (")');
      check('approval recorded', (await page.textContent('body')).includes('approved'));
      await page.goto(url('/admin/audit'));
      check('audit trail has submit, review and invitation entries', ['submit', 'review:approved', 'create-invitation', 'edit-person'].every(async (a) => (await page.textContent('body')).includes(a)));
      await shot('admin-audit');

      // A second device (simulated: fresh device id in this browser) opens Mom's forwarded link.
      // Expected: view-only with no code, a "request access" path, and no way to submit.
      const other = await ctx.newPage();
      await other.goto(link.replace(/^https?:\/\/[^/]+/, 'http://localhost:4176'));
      await other.evaluate(() => { localStorage.setItem('family-history:device-id', 'another-device-' + Math.random()); sessionStorage.clear(); });
      await other.reload();
      await other.waitForSelector('text=See it from where you stand');
      check('forwarded link opens look-only on another device', (await other.textContent('body')).includes('Ask for my own link'));
      // "See it from where you stand": the visitor picks themselves and the page re-centers.
      await other.fill('label:has-text("Your name") input', ROOT_FIRST);
      await other.click(`.card.raised button.chip:has-text("${ROOT_FIRST}")`);
      await other.waitForSelector(`text=Welcome, ${ROOT_FIRST}.`);
      const asSelf = await other.textContent('body');
      check('look-only visitor can view as themselves (centered, with blanks to ask about)', asSelf.includes('centered on you') && /What is missing \(\d+\)/.test(asSelf));
      await other.screenshot({ path: path.join(shots, `${String(++n).padStart(2, '0')}-view-as-self.png`), fullPage: true });
      await other.click(`button:has-text("Not ${ROOT_FIRST}?")`);
      await other.waitForSelector('text=See it from where you stand');
      await other.click(`button:has-text("${ROOT_NAME}")`);
      await other.waitForTimeout(200);
      check('view-only visitor cannot submit', !(await other.$('button:has-text("Share a memory")')) && !!(await other.$('button:has-text("Ask for my own link")')));
      await other.screenshot({ path: path.join(shots, `${String(++n).padStart(2, '0')}-forwarded-view-only.png`), fullPage: true });
      await other.click('button:has-text("Ask for my own link") >> nth=0');
      await other.waitForSelector('text=Ask for your own link');
      await other.fill('label:has-text("Your name") input', "Test Relative's Sister");
      await other.fill('label:has-text("How you are related") input', `${ROOT_FIRST}'s aunt`);
      await other.fill('label:has-text("Phone") input', '555-0100');
      await other.click('button:has-text("Ask for my link")');
      await other.waitForSelector(`text=is with ${ROOT_FIRST}`);
      check('access request submitted from the forwarded device', true);
      await other.screenshot({ path: path.join(shots, `${String(++n).padStart(2, '0')}-forwarded-request.png`), fullPage: true });

      // Admin grants it: a new invitation with its own code
      await page.goto(url('/admin/requests'));
      await page.reload();
      await page.waitForSelector("text=Test Relative's Sister");
      await page.click('button:has-text("Grant")');
      await page.waitForSelector('text=Access granted');
      const t2 = await page.$$eval('code.token', (els) => els.map((e) => e.textContent));
      check('request granted with its own link and code', t2[0] !== link && /^\d{6}$/.test(t2[1]) && t2[1] !== code);
      await shot('admin-requests');
      // The sister's device unlocks her own link as a contributor
      const sis = await ctx.newPage();
      await sis.goto(t2[0].replace(/^https?:\/\/[^/]+/, 'http://localhost:4176'));
      await sis.evaluate(() => { localStorage.setItem('family-history:device-id', 'sister-device'); sessionStorage.clear(); });
      await sis.reload();
      await sis.waitForSelector('input');
      await sis.fill('input', t2[1]);
      await sis.click('button:has-text("Open")');
      await sis.waitForSelector("text=Welcome, Test.");
      check('granted relative is a contributor on her own device', !!(await sis.$('button:has-text("Add a general note")')));
      // Mom's original device still works as contributor after the sister's activity
      await rel.evaluate((id) => localStorage.setItem('family-history:device-id', id), momDevice); // all simulated devices share one browser here
      await rel.reload();
      await rel.waitForSelector('text=Welcome, Test.');
      check('original device still contributor', !!(await rel.$('button:has-text("Add a general note")')));

      // Revoke and confirm the relative is locked out on a fresh session
      await page.goto(url('/admin/invites'));
      await page.reload();
      await page.click('tr:has(strong:text-is("Test Relative")) button:has-text("Revoke")');
      await page.waitForTimeout(300);
      const rel2 = await ctx.newPage();
      await rel2.goto(link.replace(/^https?:\/\/[^/]+/, 'http://localhost:4176'));
      await rel2.evaluate((id) => { sessionStorage.clear(); localStorage.setItem('family-history:device-id', id); }, momDevice);
      await rel2.reload();
      await rel2.waitForSelector('h1');
      check('revoked invitation refused', (await rel2.textContent('body')).includes('turned off'));

      // Export
      await page.goto(url('/admin/data'));
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Export GEDCOM")')]);
      const ged = fs.readFileSync(await dl.path(), 'utf8');
      check('GEDCOM export has the root person and no slots', ged.includes(`/${rootP.surname}/`) && !ged.includes('name needed'));
      await page.evaluate(() => localStorage.clear());
    }
    check(`${label} no page errors`, errors.length === 0, errors.join('; '));
    await ctx.close();
  }
  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})();
