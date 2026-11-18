// Specialized local acceptance: never imported by default *.integration.test.ts discovery.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const backend = process.cwd(), repo = path.resolve(backend, '../..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const serial = value => JSON.stringify(value, (_k, x) => typeof x === 'bigint' ? x.toString() : x);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function bounded(promise, ms, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label)), ms); })]).finally(() => clearTimeout(timer));
}
async function poll(fn, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await fn()) return; await wait(100); }
  throw Error(label);
}
async function portUnused(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

test('E496 explanation-only4: explicitly selected unfinished consumers after exact leaf deny', { timeout: 600000 }, async t => {
  // These checks run BEFORE imports that instantiate the application/DB/browser.
  assert.equal(process.env.E496_NATIVE_AUTHORIZED, 'main-explicitly-authorized');
  assert.equal(process.env.E496_NATIVE_BROWSER_SLOT, 'exclusive-main');
  assert.equal(process.env.TEST_ISOLATED_DATABASE, 'true');
  const dbUrl = new URL(process.env.DATABASE_URL);
  assert(['localhost', '127.0.0.1'].includes(dbUrl.hostname));
  assert.equal(dbUrl.port, '55432');
  assert.match(dbUrl.searchParams.get('schema') || '', /^integration_\d+_\d+$/);
  assert.equal(process.env.REDIS_URL, 'redis://127.0.0.1:6393');
  await portUnused(3214); // Darwin must have completed and stopped its owned Next first.
  await portUnused(3216);
  const output = process.env.E496_NATIVE_OUTPUT;
  assert(output && path.isAbsolute(output));
  const dir = path.dirname(output), frontend = process.env.E496_NATIVE_FRONTEND_DIR;
  assert.equal(path.resolve(frontend || ''), path.join(dir, 'frontend-mirror'));
  assert(fs.statSync(frontend).isDirectory());
  const { cohort, create } = require(path.join(dir, 'fixtures.cjs'));
  const selected = (process.env.E496_NATIVE_CASES || 'staffing,schedules,pay_conditions').split(',');
  assert(selected.length && selected.every(k => cohort.some(x => x.key === k)), 'Only explicitly prepared case keys are runnable');
  const req = createRequire(path.join(backend, 'package.json'));
  const { PrismaClient, Prisma } = req('@prisma/client');
  const { createTestApp } = req('./test/helpers/create-test-app.ts');
  const { chromium } = req(process.env.E496_NATIVE_PLAYWRIGHT || '/tmp/crm-acl-browser/node_modules/playwright-core');
  const proof = { reservedEvidenceId: process.env.E496_NATIVE_EVIDENCE_ID || 'E496', status: 'running', authorIsNotReviewer: true,
    sourceOnlyPreparedInitially: true, schema: dbUrl.searchParams.get('schema'), cases: [], sourceManifest: [],
    productionTouched: false, matrixWritten: false, limitation: 'Selected exact native consumer phases only; no automatic whole claim and no old role/geometry/API replay' };
  const save = () => fs.writeFileSync(output, serial(proof) + '\n');
  const db = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const api = baseUrl + '/api/v1', ui = 'http://127.0.0.1:3216';
  let browser, front;
  const log = [], originalConfigs = ['next-env.d.ts', 'tsconfig.json'].map(n => ({ path: repo + '/apps/frontend/' + n, sha256: digest(fs.readFileSync(repo + '/apps/frontend/' + n)) }));
  const gateReleases = new Set();
  t.after(async () => {
    const errors = [];
    for (const release of gateReleases) release();
    try { await browser?.close(); } catch (e) { errors.push(String(e)); }
    try {
      if (front && front.exitCode === null) {
        const exited = new Promise(resolve => front.once('exit', resolve));
        process.kill(-front.pid, 'SIGTERM');
        try { await bounded(exited, 10000, 'owned frontend stop'); }
        catch { process.kill(-front.pid, 'SIGKILL'); await bounded(exited, 3000, 'owned frontend forced stop'); }
      }
    } catch (e) { errors.push(String(e)); }
    try { await app.close(); } catch (e) { errors.push(String(e)); }
    try { await db.$disconnect(); } catch (e) { errors.push(String(e)); }
    proof.cleanup = { errors, mirrorOnly: true, sourceConfigs: originalConfigs.map(x => ({ ...x, afterSHA256: digest(fs.readFileSync(x.path)) })) };
    // Never restore live source configs: another worker owns them. Mirror config changes stay isolated.
    save(); fs.writeFileSync(dir + '/helper-cleanup.json', serial(proof.cleanup) + '\n');
    assert.deepEqual(errors, []);
  });
  function freeze(source) {
    if (proof.sourceManifest.some(x => x.source === source)) return;
    const bytes = fs.readFileSync(source), hash = digest(bytes), dest = dir + '/source-freeze/' + hash + '/' + path.basename(source);
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, bytes);
    const row = { source, path: dest, sha256: hash };
    if (source.startsWith(frontend + '/src/')) {
      row.originalSource = repo + '/apps/frontend/src/' + path.relative(frontend + '/src', source);
      assert.equal(digest(fs.readFileSync(row.originalSource)), hash, 'mirror must equal source before runtime');
    }
    proof.sourceManifest.push(row);
  }
  for (const p of Object.keys(require.cache)) if (p.startsWith(backend + '/src/') || p === __filename) freeze(p);
  function walk(root) { for (const e of fs.readdirSync(root, { withFileTypes: true })) { const p = path.join(root, e.name); if (e.isDirectory()) walk(p); else if (/\.(tsx?|css)$/.test(p)) freeze(p); } }
  walk(frontend + '/src'); freeze(path.join(dir, 'fixtures.cjs'));
  if (fs.existsSync(path.join(dir, 'money-cases.cjs'))) freeze(path.join(dir, 'money-cases.cjs'));
  freeze(backend + '/test/access-control-native-object-write-closeout.acceptance.test.ts');
  function check(row, label, actual, expected) {
    row.assertions.push({ label, actual, expected, matched: serial(actual) === serial(expected) }); save();
    assert.deepEqual(actual, expected, label);
  }
  async function shot(row, phase) {
    const image = dir + '/' + row.key + '-' + phase + '.png';
    await row.page.screenshot({ path: image, fullPage: true });
    fs.writeFileSync(dir + '/' + row.key + '-' + phase + '.html', await row.page.content());
    row.screenshots.push({ phase, path: image }); save();
  }
  // Exact business graph around the phase. Exclude only session/access-admin metadata,
  // NEVER domain audits, assignment history, credits, attendance, approvals or user identities.
  const excluded = new Set(['User', 'AuthSession', 'UserAccessRule', 'UserAccessAudit', 'UserAccessPreview']);
  async function graph() {
    const result = {};
    for (const model of Prisma.dmmf.datamodel.models) {
      if (excluded.has(model.name)) continue;
      const delegate = model.name[0].toLowerCase() + model.name.slice(1);
      let rows = await db[delegate].findMany();
      if (model.name === 'AuditEvent') rows = rows.filter(x => !['user_access', 'user_access_rule'].includes(x.entityType) && !String(x.action).startsWith('user_access'));
      result[model.name] = rows.sort((a, b) => serial(a).localeCompare(serial(b)));
    }
    result.userIdentities = await db.user.findMany({ select: { id: true, login: true, fullName: true, isActive: true, deletedAt: true }, orderBy: { id: 'asc' } });
    return JSON.parse(serial(result));
  }
  async function profile(page, version) {
    // Focus is the real app's auth refresh entry. Do not inject a profile or bump a client epoch.
    const response = page.waitForResponse(async r => r.url() === api + '/auth/me' && r.status() === 200 && (await r.json()).accessVersion > version, { timeout: 20000 });
    const tick = setInterval(() => { void page.evaluate(() => window.dispatchEvent(new Event('focus'))).catch(() => {}); }, 750);
    try {
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      return (await (await response).json()).accessVersion;
    } finally { clearInterval(tick); }
  }
  async function change(admin, actorId, actionCode, effect, objectId) {
    const expectedVersion = (await db.user.findUniqueOrThrow({ where: { id: actorId } })).accessVersion;
    const changes = [{ actionCode, effect, scope: 'selected', selectedIds: Array.isArray(objectId) ? objectId : [objectId] }];
    const data = { expectedVersion, reason: 'E480 owned native exact leaf phase', changes };
    const root = api + '/users-access/admin/users/' + actorId;
    const preview = await admin.post(root + '/preview', { data }); assert.equal(preview.status(), 201, await preview.text());
    const token = await preview.json();
    const response = await admin.post(root + '/save', { data: { ...data, previewToken: token.previewToken, previewHash: token.previewHash } });
    assert.equal(response.status(), 201, await response.text());
    return expectedVersion;
  }
  async function heldReply(page, row, endpoint, method) {
    let reached, release, complete, used = false;
    const ready = new Promise(resolve => reached = resolve), gate = new Promise(resolve => release = resolve), delivered = new Promise(resolve => complete = resolve);
    gateReleases.add(release);
    await page.route('**/api/v1/**', async route => {
      const request = route.request(), url = new URL(request.url());
      if (used || url.pathname !== endpoint || request.method() !== method) return route.continue();
      used = true;
      try {
        const response = await route.fetch();
        const text = await response.text();
        row.held = { method, path: url.pathname, query: url.search, request: request.postData(), status: response.status(), body: JSON.parse(text), bodySHA256: digest(text), capturedAtUTC: new Date().toISOString() };
        save(); reached(); await gate;
        try { await route.fulfill({ response }); complete({ outcome: 'fulfilled-real-response', atUTC: new Date().toISOString() }); }
        catch (error) { complete({ outcome: 'cancelled-by-client', error: String(error) }); }
      } catch (error) { row.heldError = String(error); save(); reached(); complete({ outcome: 'route-failed', error: String(error) }); }
    });
    return { ready, release, delivered };
  }
  async function legacyStaffing(row, f, spec, ctx, page, admin) {
    const isEnd = spec.key === 'legacy_staffing_end', target = f.legacyTarget;
    const explanationOnly = spec.key === 'legacy_staffing_explanation';
    assert(target, 'actual legacy target fixture required');
    row.employeeId = target.id; row.consumer = 'ObjectStaffingPanel legacy employee list/directory in object detail #team';
    row.endReasonApplicability = 'No reason dialog or request field in this current ObjectStaffingPanel DELETE handler; no invented reason test';
    const root = '/api/v1/objects/' + f.A.object.id;
    const read = await ctx.request.get(api + '/objects/' + f.A.object.id);
    check(row, 'initial own object read allowed', read.status(), 200);
    check(row, 'initial exact staffing capability allowed', (await read.json()).capabilities.canManageEmployees, true);
    const beforeB = await ctx.request.get(api + '/objects/' + f.B.object.id + '/employees');
    check(row, 'initial B roster read allowed', beforeB.status(), 200); row.controlBBefore = await beforeB.json();
    const selector = page.getByPlaceholder('Введите ФИО сотрудника', { exact: true });
    await selector.waitFor();
    if (explanationOnly) check(row, 'initial existing roster end control really available', await page.getByRole('button', { name: 'Завершить назначение', exact: true }).count() > 0, true);
    const hold = await heldReply(page, row, root + '/employee-directory', 'GET');
    await selector.fill(target.fullName); // Actual own query identifies the intended Employee; no fake selected state.
    row.draftBefore = { employeeQuery: await selector.inputValue(), intendedEmployeeId: target.id, intendedEmployeeName: target.fullName };
    row.graphBefore = await graph();
    row.assignmentBefore = await db.objectEmployeeAssignment.findUnique({ where: { objectId_employeeId: { objectId: f.A.object.id, employeeId: target.id } } });
    row.historyBefore = await db.employeeObjectAssignmentHistory.findMany({ where: { objectId: f.A.object.id, employeeId: target.id }, orderBy: { id: 'asc' } });
    check(row, 'fixture initial assignment validity', !!row.assignmentBefore?.isActive, isEnd);
    row.checkpoints = [{ phase: 'legacy-own-query-and-target', status: 'recorded', atUTC: new Date().toISOString() }]; await shot(row, 'draft');
    await bounded(hold.ready, 20000, 'actual directory request not captured');
    check(row, 'held actual employee-directory200', row.held?.status, 200);
    check(row, 'held actual directory contains chosen Employee', row.held.body.some(x => x.id === target.id), true);
    const version = await change(admin.request, f.actor.id, 'objects.staffing.manage', 'deny', f.A.object.id);
    row.freshDenyEpoch = await profile(page, version);
    check(row, 'fresh actor epoch after exact staffing deny', row.freshDenyEpoch > version, true);
    const fresh = await ctx.request.get(api + '/objects/' + f.A.object.id);
    check(row, 'own object read remains200 after write deny', fresh.status(), 200);
    row.freshDeniedObject = await fresh.json(); check(row, 'own exact staffing capability denied', row.freshDeniedObject.capabilities.canManageEmployees, false);
    const roster = await ctx.request.get(api + '/objects/' + f.A.object.id + '/employees');
    check(row, 'roster read remains allowed independently', roster.status(), 200);
    const b = await ctx.request.get(api + '/objects/' + f.B.object.id);
    check(row, 'B read stays allowed', b.status(), 200); check(row, 'B staffing capability remains allowed', (await b.json()).capabilities.canManageEmployees, true);
    hold.release(); row.delivery = await bounded(hold.delivered, 10000, 'legacy held directory delivery');
    await poll(async () => await page.getByRole('heading', { name: f.A.object.name, exact: true }).isVisible(), 'readable object heading after fresh epoch');
    await wait(400);
    check(row, 'directory old response genuinely fulfilled', row.delivery.outcome, 'fulfilled-real-response');
    check(row, 'late reply cannot restore add controls', await page.getByRole('button', { name: 'В состав', exact: true }).count(), 0);
    check(row, 'late reply cannot restore end controls', await page.getByRole('button', { name: 'Завершить назначение', exact: true }).count(), 0);
    check(row, 'write-only directory query control is concealed', await selector.count(), 0);
    if (explanationOnly) {
      const message = 'У вас нет доступа к изменению состава объекта. Добавление и снятие сотрудников недоступны; текущий состав можно просматривать.';
      const panel = page.locator('#team');
      await panel.getByText(message, { exact: true }).waitFor({ state: 'visible' });
      check(row, 'exact legacy add/end denial explanation visible', await panel.getByText(message, { exact: true }).isVisible(), true);
      check(row, 'current assigned Employee remains readable', await panel.getByText(f.employees[0].fullName, { exact: true }).first().isVisible(), true);
      row.denialExplanation = message;
    }
    // The component conceals writer search while denied. Retention is measured after explicit regrant,
    // never invented from a nonexistent hidden input. Roster remains readable.
    check(row, 'held reply and exact deny have zero domain effects', await graph(), row.graphBefore);
    row.checkpoints.push({ phase: 'legacy-exact-deny-fresh-epoch-late-reply', status: 'recorded', atUTC: new Date().toISOString() }); await shot(row, 'denied-late');
    const prior = await change(admin.request, f.actor.id, 'objects.staffing.manage', 'allow', [f.A.object.id, f.B.object.id]);
    row.regrantEpoch = await profile(page, prior);
    const access = await ctx.request.get(api + '/objects/' + f.A.object.id);
    check(row, 'separate fresh access check200', access.status(), 200); check(row, 'exact staffing restored', (await access.json()).capabilities.canManageEmployees, true);
    await selector.waitFor(); check(row, 'own employee query retained after regrant', await selector.inputValue(), row.draftBefore.employeeQuery);
    const label = isEnd ? 'Завершить назначение' : 'В состав';
    const card = page.locator('#team div').filter({ has: page.getByText(target.fullName, { exact: true }) }).filter({ has: page.getByRole('button', { name: label, exact: true }) }).last();
    const button = card.getByRole('button', { name: label, exact: true }); await button.waitFor();
    row.selectedTargetAfterRegrant = { employeeId: target.id, visibleName: await card.getByText(target.fullName, { exact: true }).innerText() };
    check(row, 'same intended Employee visible before manual action', row.selectedTargetAfterRegrant.visibleName, target.fullName);
    check(row, 'no automatic assignment/end on regrant', await graph(), row.graphBefore);
    if (explanationOnly) {
      row.graphAfter = await graph();
      check(row, 'explanation-only phase has zero business graph effects', row.graphAfter, row.graphBefore);
      row.recipientAssignmentMutations = row.network.filter(x => (x.path === root + '/employees' || x.path.startsWith(root + '/employees/')) && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(x.method));
      check(row, 'explanation-only phase emits zero assignment mutations', row.recipientAssignmentMutations.length, 0);
      const afterB = await ctx.request.get(api + '/objects/' + f.B.object.id + '/employees');
      check(row, 'B exact roster unchanged without assignment operation', await afterB.json(), row.controlBBefore);
      row.checkpoints.push({ phase: 'missing-legacy-explanation-regrant-query-no-write', status: 'recorded', atUTC: new Date().toISOString() });
      row.status = 'passed-exact-phase'; await shot(row, 'regranted-no-write'); save(); return;
    }
    const method = isEnd ? 'DELETE' : 'POST', mutationPath = root + '/employees' + (isEnd ? '/' + target.id : '');
    const start = row.network.length, response = page.waitForResponse(r => new URL(r.url()).pathname === mutationPath && r.request().method() === method);
    await button.click(); const result = await response;
    check(row, 'one actual manual legacy operation succeeds', result.status(), isEnd ? 200 : 201); row.savedResponse = await result.json();
    check(row, 'one actual legacy mutation intent', row.network.slice(start).filter(x => x.path === mutationPath && x.method === method).length, 1);
    row.assignmentAfter = await db.objectEmployeeAssignment.findUniqueOrThrow({ where: { objectId_employeeId: { objectId: f.A.object.id, employeeId: target.id } } });
    row.historyAfter = await db.employeeObjectAssignmentHistory.findMany({ where: { objectId: f.A.object.id, employeeId: target.id }, orderBy: { id: 'asc' } });
    check(row, 'single exact assignment link', await db.objectEmployeeAssignment.count({ where: { objectId: f.A.object.id, employeeId: target.id } }), 1);
    check(row, 'exact final active state', row.assignmentAfter.isActive, !isEnd);
    check(row, 'one assignment history row', row.historyAfter.length, 1);
    if (isEnd) { check(row, 'same assignment identity ended', row.assignmentAfter.id, row.assignmentBefore.id); check(row, 'same history identity ended', row.historyAfter[0].id, row.historyBefore[0].id); check(row, 'actual history end timestamp present', !!row.historyAfter[0].endedAt, true); }
    else check(row, 'actual history remains open', row.historyAfter[0].endedAt, null);
    const action = isEnd ? 'employee.object_assignment.ended' : 'employee.object_assignment.created';
    check(row, 'one exact domain audit for recipient manual intent', await db.auditEvent.count({ where: { entityType: 'employee', entityId: target.id, actorUserId: f.actor.id, action } }), 1);
    row.graphAfter = await graph();
    for (const model of ['ObjectPayrollCredit', 'ObjectCompensationAdjustment', 'ApprovalRequest', 'ObjectAttendanceFact', 'ObjectShiftAttendance', 'Employee', 'userIdentities']) check(row, model + ' unchanged by legacy assignment change', row.graphAfter[model], row.graphBefore[model]);
    const afterB = await ctx.request.get(api + '/objects/' + f.B.object.id + '/employees'); check(row, 'B exact roster unchanged', await afterB.json(), row.controlBBefore);
    row.checkpoints.push({ phase: 'legacy-regrant-manual-one-assignment-effect', status: 'recorded', atUTC: new Date().toISOString() });
    row.status = 'passed-exact-phase'; await shot(row, 'manual-saved'); save();
  }
  try {
    const nextBin = req.resolve('next/dist/bin/next', { paths: [repo + '/apps/frontend'] });
    front = spawn(process.execPath, [nextBin, 'dev', '--hostname', '127.0.0.1', '--port', '3216'], {
      cwd: frontend, detached: true, env: { ...process.env, CRM_PREVIEW_DIST_DIR: '.next-acl-preview-' + process.pid, NEXT_PUBLIC_API_URL: api, NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const append = b => { log.push(String(b)); fs.writeFileSync(dir + '/frontend.log', log.join('')); };
    front.stdout.on('data', append); front.stderr.on('data', append);
    proof.owner = { frontendPid: front.pid, frontendPort: 3216, api: baseUrl, redis: process.env.REDIS_URL, mirror: frontend }; save();
    await poll(async () => { if (front.exitCode !== null) throw Error('owned frontend exited'); try { return (await fetch(ui + '/login')).ok; } catch { return false; } }, 'owned UI3216 not ready', 120000);
    browser = await chromium.launch({ executablePath: process.env.E496_NATIVE_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    const admin = await browser.newContext();
    assert.equal((await admin.request.post(api + '/auth/login', { data: { login: 'founder', password: 'founder123' } })).status(), 201);
    for (const spec of cohort.filter(x => selected.includes(x.key))) {
      const behavior = spec.behavior || spec.key;
      const f = await create(db, admin.request, api, spec.code, spec.key);
      if (spec.key.startsWith('money_')) await require(path.join(dir, 'money-cases.cjs')).prepareFixture(db, admin.request, api, f, spec);
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      await ctx.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
      assert.equal((await ctx.request.post(api + '/auth/login', { data: { login: f.actor.login, password: f.password } })).status(), 201);
      const page = await ctx.newPage(); page.setDefaultTimeout(20000);
      // page is kept non-enumerable so proof serializes data, not Playwright objects.
      const row = { key: spec.key, id: spec.code + '/K5', status: 'running', phase: spec.phase, actorId: f.actor.id,
        A: f.A.object.id, B: f.B.object.id, positionId: f.A.position.id, assertions: [], screenshots: [], network: [], console: [] };
      Object.defineProperty(row, 'page', { value: page }); proof.cases.push(row);
      page.on('pageerror', e => { row.console.push(String(e)); save(); });
      page.on('request', request => { const u = new URL(request.url()); if (u.origin === new URL(api).origin) row.network.push({ method: request.method(), path: u.pathname, body: request.postData(), atUTC: new Date().toISOString() }); });
      try {
        if (spec.key.startsWith('money_')) {
          await require(path.join(dir, 'money-cases.cjs')).run({ row, f, spec, page, ctx, admin, api, ui, db, check, graph, change, profile, heldReply, bounded, poll, wait, shot, save });
          continue;
        }
        await page.goto(ui + '/objects/' + f.A.object.id + '#team', { waitUntil: 'networkidle' });
        if (spec.key.startsWith('legacy_staffing_')) { await legacyStaffing(row, f, spec, ctx, page, admin); continue; }
        const group = page.getByRole('region', { name: 'Группа 1', exact: true });
        await page.getByRole('button', { name: 'Изменить график', exact: true }).first().click();
        const editor = page.locator('form').filter({ has: page.getByRole('button', { name: 'Сохранить график', exact: true }) });
        const name = editor.getByLabel(/^Название позиции/);
        await name.waitFor();
        // Editing an existing position intentionally starts with an empty effective date.
        // Use the real shared DatePicker, not its validation shim or React state.
        await editor.getByLabel('Действует с', { exact: true }).click();
        await page.getByRole('button', { name: 'Сегодня', exact: true }).click();
        if (behavior === 'schedules') {
          await name.fill(f.marker + '_OWN_DRAFT');
          // Actual native checkbox, not a React state injection.
          await page.getByRole('checkbox', { name: 'Вс', exact: true }).uncheck();
        } else if (behavior === 'staffing') {
          await group.getByRole('button', { name: 'Убрать назначение', exact: true }).first().click();
        } else {
          await page.getByLabel('Условия оплаты позиции', { exact: true }).click();
          await page.getByRole('option', { name: f.A.contours[1].name, exact: true }).click();
        }
        const draft = async () => ({ name: await name.inputValue(), employeeNames: await group.locator('strong').allTextContents(),
          contourLabel: await page.getByLabel('Условия оплаты позиции', { exact: true }).innerText(),
          effectiveDateLabel: await page.getByLabel('Действует с', { exact: true }).innerText(),
          sunday: await page.getByRole('checkbox', { name: 'Вс', exact: true }).isChecked() });
        row.draftBefore = await draft(); row.graphBefore = await graph(); row.checkpoints = [{ phase: 'own-draft', status: 'recorded', atUTC: new Date().toISOString() }]; await shot(row, 'draft');
        const scheduling = '/api/v1/objects/' + f.A.object.id + '/scheduling';
        const endpoint = scheduling + (behavior === 'schedules' ? '/preview' : '/positions');
        const hold = await heldReply(page, row, endpoint, behavior === 'schedules' ? 'POST' : 'GET');
        if (behavior === 'schedules') {
          await page.getByRole('button', { name: 'Показать расписание', exact: true }).first().click();
        } else {
          // Real auth revision reload creates a mounted positions request WHILE preserving this editor.
          // Sentinel only starts a fresh allowed generation; the tested revocation below is the exact leaf.
          const v = await change(admin.request, f.actor.id, 'objects.comments.create', 'deny', f.A.object.id);
          row.sentinelEpoch = await profile(page, v);
        }
        await bounded(hold.ready, 20000, 'mounted real response did not reach the held route');
        check(row, 'held response is actual allowed API result', row.held?.status, behavior === 'schedules' ? 201 : 200);
        const v = await change(admin.request, f.actor.id, spec.code, 'deny', f.A.object.id);
        row.denySavedAtUTC = new Date().toISOString(); row.freshDenyEpoch = await profile(page, v);
        check(row, 'profile epoch really advances after exact deny', row.freshDenyEpoch > v, true);
        const fresh = await ctx.request.get(api + '/objects/' + f.A.object.id + '/scheduling/positions');
        check(row, 'positions read remains allowed', fresh.status(), 200);
        row.freshDeniedPositions = await fresh.json();
        check(row, 'fresh exact write capability denied', row.freshDeniedPositions.capabilities[spec.capability], false);
        const control = await ctx.request.get(api + '/objects/' + f.B.object.id + '/scheduling/positions');
        check(row, 'independent B read remains allowed', control.status(), 200);
        row.controlBBefore = await control.json();
        check(row, 'independent B same write capability remains allowed', row.controlBBefore.capabilities[spec.capability], true);
        hold.release(); row.delivery = await bounded(hold.delivered, 10000, 'held response not released');
        await poll(async () => await name.isVisible(), 'editor visible after current epoch read');
        await wait(250);
        // A cancelled old network request is recorded as cancellation, never called an observed late callback.
        check(row, 'real response delivered or explicitly client-cancelled', ['fulfilled-real-response', 'cancelled-by-client'].includes(row.delivery.outcome), true);
        row.draftAfterDeny = await draft(); check(row, 'own draft retained after fresh epoch and late response', row.draftAfterDeny, row.draftBefore);
        const saveButton = page.getByRole('button', { name: 'Сохранить график', exact: true });
        if (behavior === 'schedules') check(row, 'schedule submit unavailable under deny', await saveButton.isDisabled(), true);
        if (behavior === 'pay_conditions') check(row, 'condition selector disabled under exact select deny', await page.getByLabel('Условия оплаты позиции', { exact: true }).isDisabled(), true);
        if (behavior === 'staffing') {
          const buttons = group.getByRole('button', { name: 'Убрать назначение', exact: true });
          for (let i = 0; i < await buttons.count(); i++) check(row, 'employee assignment edit disabled under exact staffing deny', await buttons.nth(i).isDisabled(), true);
        }
        if (spec.postfixDirty) {
          check(row, 'dirty restricted draft blocks Save schedule button', await saveButton.isDisabled(), true);
          const message = behavior === 'staffing'
            ? 'Право изменять состав недоступно. Изменения назначений сохранены в черновике; отправка заблокирована до возврата права.'
            : 'Право выбирать условия оплаты недоступно. Выбранные условия сохранены в черновике; отправка заблокирована до возврата права.';
          check(row, 'exact Russian restricted-draft denial explanation visible', await page.getByText(message, { exact: true }).isVisible(), true);
          check(row, 'native form is valid so validation cannot mask missing handler guard', await editor.evaluate(form => form.checkValidity()), true);
          const path = scheduling + '/positions/' + f.A.position.id;
          const before = row.network.length;
          // Native form entry bypasses a disabled button. No injected React state or fake API.
          await editor.evaluate(form => form.requestSubmit());
          await wait(600);
          row.nativeDeniedSubmit = { entry: 'HTMLFormElement.requestSubmit()', atUTC: new Date().toISOString(), requests: row.network.slice(before) };
          check(row, 'native denied submit emits zero position mutation requests', row.nativeDeniedSubmit.requests.filter(x => x.path === path && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(x.method)).length, 0);
          check(row, 'native denied submit has zero persisted business effects', await graph(), row.graphBefore);
          check(row, 'native denied submit retains the exact own dirty draft', await draft(), row.draftBefore);
          row.nativeDeniedSubmit.guardObserved = true; save();
        }
        // A schedule submit may legitimately remain enabled for unrelated fields when only select/staffing is denied.
        // Do NOT force that button or fabricate a write; assert the targeted control and zero automatic effects.
        check(row, 'no domain effects from holds/revoke/revalidation', await graph(), row.graphBefore);
        row.checkpoints.push({ phase: 'exact-deny-fresh-epoch-and-late-reply', status: 'recorded', atUTC: new Date().toISOString() });
        await shot(row, 'denied-late');
        const gv = await change(admin.request, f.actor.id, spec.code, 'allow', [f.A.object.id, f.B.object.id]);
        row.regrantEpoch = await profile(page, gv);
        // An explicit ordinary access check, never an automatic submit.
        const access = await ctx.request.get(api + '/objects/' + f.A.object.id + '/scheduling/positions');
        check(row, 'explicit post-regrant access check allowed', access.status(), 200);
        check(row, 'exact capability restored', (await access.json()).capabilities[spec.capability], true);
        await poll(async () => !(await saveButton.isDisabled()), 'fresh enabled editor after regrant');
        check(row, 'draft retained after regrant', await draft(), row.draftBefore);
        check(row, 'regrant alone creates no write', await graph(), row.graphBefore);
        const mutationPath = scheduling + '/positions/' + f.A.position.id;
        const networkStart = row.network.length;
        const response = page.waitForResponse(r => new URL(r.url()).pathname === mutationPath && r.request().method() === 'PUT');
        await saveButton.click();
        const saved = await response; check(row, 'one actual manual save returns200', saved.status(), 200);
        row.savedPosition = await saved.json();
        const after = await db.objectStaffPosition.findUniqueOrThrow({ where: { id: f.A.position.id }, include: { revisions: { orderBy: { version: 'asc' } } } });
        check(row, 'one position revision only', after.revisions.length, f.A.position.revisions.length + 1);
        check(row, 'one browser mutation intent only', row.network.slice(networkStart).filter(x => x.path === mutationPath && x.method === 'PUT').length, 1);
        const last = row.savedPosition.revisions.at(-1);
        if (behavior === 'schedules') check(row, 'own changed name persisted', last.name, f.marker + '_OWN_DRAFT');
        if (behavior === 'staffing') check(row, 'one explicitly removed group assignment', last.groups[0].assignments.map(x => x.employeeId), [f.employees[1].id]);
        if (behavior === 'pay_conditions') check(row, 'own selected ready contour persisted', last.groups[0].timeRanges[0].contourId, f.A.contours[1].id);
        row.graphAfter = await graph();
        for (const model of ['ObjectPayrollCredit', 'ObjectCompensationAdjustment', 'ApprovalRequest', 'ObjectAttendanceFact', 'ObjectShiftAttendance', 'Employee', 'userIdentities']) check(row, model + ' unchanged by planning save', row.graphAfter[model], row.graphBefore[model]);
        const persistedB = await db.objectStaffPosition.findUniqueOrThrow({ where: { id: f.B.position.id }, include: { revisions: { orderBy: { version: 'asc' } } } });
        check(row, 'B revision count unchanged', persistedB.revisions.length, f.B.position.revisions.length);
        const freshB = await ctx.request.get(api + '/objects/' + f.B.object.id + '/scheduling/positions');
        check(row, 'B exact saved position DTO unchanged', await freshB.json(), row.controlBBefore);
        row.status = row.delivery.outcome === 'fulfilled-real-response' ? 'passed-exact-phase' : 'partial-client-cancelled-no-late-callback';
        row.checkpoints.push({ phase: 'regrant-manual-one-revision', status: 'recorded', atUTC: new Date().toISOString() });
        await shot(row, 'manual-saved'); save();
      } catch (error) {
        row.status = 'failed'; row.error = String(error.stack || error); save();
        await shot(row, 'failure').catch(() => {});
        fs.writeFileSync(dir + '/' + row.key + '-defect.json', serial({ kind: 'untriaged real failure, not automatically a product defect', row, fixApplied: false }) + '\n');
        throw error; // Stop before any fix or unrelated phase; Main owns shared application changes.
      } finally { await ctx.close(); }
    }
    proof.status = proof.cases.every(x => x.status === 'passed-exact-phase') ? 'passed-exact-phases-only' : 'partial'; save();
  } catch (error) { proof.status = 'failed'; proof.error = String(error.stack || error); save(); throw error; }
});
