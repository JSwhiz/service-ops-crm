import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type List = { capabilities: { canCreate: boolean; canCreateForOthers: boolean }; total: number; totalPages: number; items: Array<{
  id: string; principalUserId: string; replacementUserId: string; status: string; canRevoke: boolean;
  objects: Array<{ id: string }>;
}> };
type ExpectedDelegation = { substitutionId: string; principalUserId: string; objectId: string };

test('substitution personal grants constrain object scopes without forwarding borrowed or global rights', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(databaseUrl.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname));
  assert.equal(databaseUrl.port, '55432');
  assert.match(databaseUrl.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  t.after(async () => {
    try { await closeApp?.(); } finally { await prisma.$disconnect(); }
  });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const actorQuery = { where: { login: 'manager1' }, include: {
    roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    permissions: { include: { permission: true } },
  } } as const;
  const actor = await prisma.user.findUniqueOrThrow(actorQuery);
  const [source, other, founder] = await Promise.all(['manager2', 'eliseeva', 'founder'].map((login) => prisma.user.findUniqueOrThrow({ where: { login } })));
  assert.deepEqual(actor.roles.map(({ role }) => role.code), ['manager']);
  const permissions = [...actor.permissions.map(({ permission }) => permission.code),
    ...actor.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.code))];
  assert.equal(permissions.includes('objects.substitution.manage'), false);
  assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id, actionCode: { startsWith: 'user_substitutions.' } } }), 0);
  const marker = `acl-substitution-${randomUUID()}`;
  // An active User with no roles, not an invented role or a broader principal.
  const replacement = await prisma.user.create({ data: {
    login: marker, fullName: marker, passwordHash: source.passwordHash, isActive: true,
  }, include: { roles: true, permissions: true } });
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const replacementCookie = await loginAndGetCookieHeader({ baseUrl, login: replacement.login, password: 'manager123' });
  const objects: Array<{ id: string }> = [];
  for (const [label, userIds] of [['A', [actor.id, source.id]], ['B', [source.id]], ['outside', []]] as const) {
    objects.push(await prisma.object.create({ data: {
      name: `${marker}-${label}`, address: 'Isolated substitution fixture', status: 'active', createdByUserId: founder.id,
      assignments: { create: userIds.map((userId) => ({ userId, assignmentRoleCode: 'manager', isActive: true })) },
    } }));
  }
  const [a, b, outside] = objects;
  const ruleIds = new Set<string>();
  const rule = async (actionCode: string, effect: 'allow' | 'deny', selectedIds?: string[], userId = actor.id) => {
    const saved = await prisma.userAccessRule.create({ data: {
      userId, actionCode, effect, scope: selectedIds ? 'selected' : 'all', selectedIds: selectedIds ?? [],
    } });
    ruleIds.add(saved.id);
    return saved;
  };
  const removeRule = async (id: string) => { await prisma.userAccessRule.delete({ where: { id } }); ruleIds.delete(id); };
  const resetRules = async () => { for (const id of [...ruleIds]) await removeRule(id); };
  const request = (path = '/user-substitutions', method = 'GET', body?: unknown, auth = cookie) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: auth, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const status = async (response: Response, expected: number) => { assert.equal(response.status, expected, await response.clone().text()); };
  const list = async (query = '', auth = cookie) => {
    const response = await request(`/user-substitutions${query}`, 'GET', undefined, auth);
    await status(response, 200);
    return await response.json() as List;
  };
  const period = (days = 2) => {
    const start = Date.now() + (days ? days * 86400000 : -500);
    return { startsAt: new Date(start).toISOString(), endsAt: new Date(start + 3600000).toISOString() };
  };
  const payload = (objectIds = [a.id], days = 2) => ({ replacementUserId: replacement.id, objectIds, ...period(days), reason: marker });
  const fixture = (ids: string[], days: number) => {
    const dates = period(days);
    return prisma.userSubstitution.create({ data: {
      principalUserId: source.id, replacementUserId: other.id, createdByUserId: founder.id,
      startsAt: new Date(dates.startsAt), endsAt: new Date(dates.endsAt),
      reason: marker, objects: { create: ids.map((objectId) => ({ objectId })) },
    } });
  };
  const capture = async () => {
    const [records, scopes, audit, objectRows, assignments, staffing, staffingHistory, objectAudit] = await Promise.all([
      prisma.userSubstitution.findMany({ orderBy: { id: 'asc' } }),
      prisma.userSubstitutionObject.findMany({ orderBy: { id: 'asc' } }),
      prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
      prisma.object.findMany({ where: { id: { in: objects.map(({ id }) => id) } }, orderBy: { id: 'asc' } }),
      prisma.objectAssignment.findMany({ where: { objectId: { in: objects.map(({ id }) => id) } }, orderBy: { id: 'asc' } }),
      prisma.objectEmployeeAssignment.findMany({ where: { objectId: { in: objects.map(({ id }) => id) } }, orderBy: { id: 'asc' } }),
      prisma.employeeObjectAssignmentHistory.findMany({ where: { objectId: { in: objects.map(({ id }) => id) } }, orderBy: { id: 'asc' } }),
      prisma.objectAuditLog.findMany({ where: { objectId: { in: objects.map(({ id }) => id) } }, orderBy: { id: 'asc' } }),
    ]);
    return { records, scopes, audit, objectRows, assignments, staffing, staffingHistory, objectAudit };
  };
  const assertSecurityAttempt = (
    before: Awaited<ReturnType<typeof capture>>, after: Awaited<ReturnType<typeof capture>>,
    delegation: ExpectedDelegation, path: string, method: string,
    completion: 'user_substitution.action_failed' | 'user_substitution.own_action', businessAuditIds: string[] = [],
  ) => {
    // Do not ignore an action prefix or all security audit. Only these two new,
    // fully checked rows may differ from the original immutable audit snapshot.
    const added = after.audit.filter((row) => !before.audit.some(({ id }) => id === row.id) && !businessAuditIds.includes(row.id));
    assert.equal(added.length, 2, 'Exactly one security intent and one completion are expected');
    const started = added.find((row) => row.action === 'user_substitution.action_started');
    const completed = added.find((row) => row.action === completion);
    assert.ok(started);
    assert.ok(completed);
    const metadata = started.metadata as { operationId?: unknown } | null;
    assert.equal(typeof metadata?.operationId, 'string');
    const operationId = metadata!.operationId as string;
    assert.match(operationId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    for (const row of [started, completed]) {
      assert.deepEqual(row, {
        id: row.id, createdAt: row.createdAt, entityType: 'user_substitution', entityId: delegation.substitutionId,
        actorUserId: replacement.id, action: row === started ? 'user_substitution.action_started' : completion,
        oldValues: null, newValues: null,
        metadata: { operationId, method, path: `/api/v1${path}`,
          ...(row === started ? { candidateDelegations: [delegation] } : { delegations: [] }) },
      });
    }
    assert.ok(started.createdAt <= completed.createdAt);
    const securityIds = new Set([started.id, completed.id]);
    assert.deepEqual(after.audit.filter(({ id }) => !securityIds.has(id) && !businessAuditIds.includes(id)), before.audit,
      'Every pre-existing audit row and all business audit remain unchanged');
    return securityIds;
  };
  const rejected = async (path: string, method = 'GET', body?: unknown, expected = 403, auth = cookie, security?: ExpectedDelegation) => {
    const before = await capture();
    await status(await request(path, method, body, auth), expected);
    const after = await capture();
    if (security) {
      assert.equal(auth, replacementCookie);
      assert.equal(method, 'POST');
      const securityIds = assertSecurityAttempt(before, after, security, path, method, 'user_substitution.action_failed');
      assert.deepEqual({ ...after, audit: after.audit.filter(({ id }) => !securityIds.has(id)) }, before,
        'Denied attempt changes only its exact security pair, not records, scopes, objects, staffing or business audit');
    } else assert.deepEqual(after, before, 'Rejected request changes no delegation, scope, audit, object or staffing');
  };
  const assertAudit = (before: Awaited<ReturnType<typeof capture>>, after: Awaited<ReturnType<typeof capture>>, id: string, action: string) => {
    const added = after.audit.filter((row) => !before.audit.some(({ id }) => id === row.id));
    assert.equal(added.length, 1);
    assert.equal(added[0].actorUserId, actor.id);
    assert.equal(added[0].entityId, id);
    assert.equal(added[0].action, action);
    assert.deepEqual(after.audit.filter(({ id }) => id !== added[0].id), before.audit);
    assert.deepEqual(after.objectRows, before.objectRows);
    assert.deepEqual(after.assignments, before.assignments);
    return added[0];
  };
  const create = async (body: ReturnType<typeof payload> & { principalUserId?: string }) => {
    const before = await capture();
    await status(await request('/user-substitutions', 'POST', body), 201);
    const after = await capture();
    const added = after.records.filter((row) => !before.records.some(({ id }) => id === row.id));
    assert.equal(added.length, 1);
    const saved = added[0];
    assert.equal(saved.principalUserId, body.principalUserId ?? actor.id);
    assert.equal(saved.replacementUserId, body.replacementUserId);
    assert.equal(saved.createdByUserId, actor.id);
    assert.equal(saved.reason, body.reason);
    assert.equal(saved.startsAt.toISOString(), body.startsAt);
    assert.equal(saved.endsAt.toISOString(), body.endsAt);
    assert.equal(saved.revokedAt, null);
    assert.deepEqual(after.records.filter(({ id }) => id !== saved.id), before.records);
    assert.deepEqual(after.scopes.filter(({ substitutionId }) => substitutionId !== saved.id), before.scopes);
    assert.deepEqual(after.scopes.filter(({ substitutionId }) => substitutionId === saved.id).map(({ objectId }) => objectId).sort(), [...body.objectIds].sort());
    const event = assertAudit(before, after, saved.id, 'user_substitution.created');
    assert.deepEqual((event.newValues as { objectIds: string[] }).objectIds, body.objectIds);
    return saved;
  };

  await t.test('read/access: selected A never discloses B or mixed A+B; pagination and parent denies are applied first', async (suite) => {
    suite.after(resetRules);
    const ra = await fixture([a.id], 8), rb = await fixture([b.id], 9), mixed = await fixture([a.id, b.id], 10);
    const before = await capture();
    assert.equal((await list()).total, 0);
    const allow = await rule('user_substitutions.read', 'allow', [a.id]);
    assert.deepEqual((await list()).items.map(({ id }) => id), [ra.id]);
    assert.equal((await list()).items[0].canRevoke, false);
    assert.equal((await list('?limit=1&page=1')).total, 1);
    assert.deepEqual((await list('?limit=1&page=2')).items, []);
    await prisma.userAccessRule.update({ where: { id: allow.id }, data: { effect: 'deny' } });
    assert.equal((await list()).total, 0);
    await removeRule(allow.id);
    assert.equal((await list()).total, 0);
    await rule('user_substitutions.read', 'allow', [a.id, b.id]);
    assert.deepEqual(new Set((await list()).items.map(({ id }) => id)), new Set([ra.id, rb.id, mixed.id]));
    for (const code of ['user_substitutions.access', 'objects.read']) {
      const deny = await rule(code, 'deny', [a.id]);
      assert.deepEqual((await list()).items.map(({ id }) => id), [rb.id]);
      await removeRule(deny.id);
    }
    assert.deepEqual(await capture(), before, 'Listing/grants do not create operational effects');
  });

  await t.test('revoke: every object must match; selected deny/default/revoke and parent override the grant', async (suite) => {
    suite.after(resetRules);
    const ra = await fixture([a.id], 11), rb = await fixture([b.id], 12), mixed = await fixture([a.id, b.id], 13);
    await rule('user_substitutions.read', 'allow', [a.id, b.id]);
    const body = { reason: 'Revoke the isolated selected scope' };
    const path = (id: string) => `/user-substitutions/${id}/revoke`;
    await rejected(path(ra.id), 'POST', body);
    let grant = await rule('user_substitutions.revoke', 'allow', [a.id]);
    assert.equal((await list()).items.find(({ id }) => id === ra.id)?.canRevoke, true);
    for (const record of [rb, mixed]) { assert.equal((await list()).items.find(({ id }) => id === record.id)?.canRevoke, false); await rejected(path(record.id), 'POST', body); }
    await prisma.userAccessRule.update({ where: { id: grant.id }, data: { effect: 'deny' } });
    await rejected(path(ra.id), 'POST', body);
    await removeRule(grant.id);
    await rejected(path(ra.id), 'POST', body);
    grant = await rule('user_substitutions.revoke', 'allow', [a.id]);
    const parent = await rule('user_substitutions.access', 'deny', [a.id]);
    await rejected(path(ra.id), 'POST', body);
    await removeRule(parent.id);
    const before = await capture();
    await status(await request(path(ra.id), 'POST', body), 201);
    const after = await capture();
    const saved = after.records.find(({ id }) => id === ra.id)!;
    assert.ok(saved.revokedAt);
    assert.deepEqual(saved, { ...ra, revokedAt: saved.revokedAt, revokedByUserId: actor.id, revocationReason: body.reason, updatedAt: saved.updatedAt });
    assert.deepEqual(after.records.filter(({ id }) => id !== ra.id), before.records.filter(({ id }) => id !== ra.id));
    assert.deepEqual(after.scopes, before.scopes);
    assertAudit(before, after, ra.id, 'user_substitution.revoked');
    const snapshot = await capture();
    await status(await request(path(ra.id), 'POST', body), 201);
    assert.deepEqual(await capture(), snapshot, 'Repeated authorized revoke is idempotent');
    await removeRule(grant.id);
    await rejected(path(ra.id), 'POST', body);
  });

  await t.test('create: default self scope, global leaf deny/default, no foreign-principal or outside-object expansion', async (suite) => {
    suite.after(resetRules);
    const body = payload();
    assert.equal((await list()).capabilities.canCreate, true, 'Discovery includes actual assigned own access');
    const manageOnlyDeny = await rule('user_substitutions.manage', 'deny');
    assert.equal((await list()).capabilities.canCreate, true, 'Own creation does not require foreign administration');
    assert.equal((await list()).capabilities.canCreateForOthers, false);
    await removeRule(manageOnlyDeny.id);
    const noMatches = await request(`/user-substitutions/options?objectSearch=${randomUUID()}`);
    await status(noMatches, 200);
    const searched = await noMatches.json() as { objects: unknown[]; capabilities: { canCreate: boolean } };
    assert.deepEqual(searched.objects, []);
    assert.equal(searched.capabilities.canCreate, true, 'Eligibility is independent of the current search result');
    const deny = await rule('user_substitutions.create', 'deny');
    assert.equal((await list()).capabilities.canCreate, false, 'Same session discovers live create denial');
    await rejected('/user-substitutions', 'POST', body);
    await removeRule(deny.id);
    assert.equal((await list('?page=100')).capabilities.canCreate, true, 'Restored capability is independent of list pagination');
    const allow = await rule('user_substitutions.create', 'allow'); // Catalog permits all only.
    await rejected('/user-substitutions', 'POST', { ...body, principalUserId: source.id });
    await rejected('/user-substitutions', 'POST', payload([b.id]));
    await rejected('/user-substitutions', 'POST', { ...body, replacementUserId: actor.id }, 400);
    await rejected('/user-substitutions', 'POST', { ...body, endsAt: body.startsAt }, 400);
    await removeRule(allow.id); // Existing self authority returns on default.
    const parent = await rule('user_substitutions.access', 'deny');
    assert.equal((await list()).capabilities.canCreate, false);
    await rejected('/user-substitutions', 'POST', body);
    await removeRule(parent.id);
    const rootDeny = await rule('objects.read', 'deny');
    assert.equal((await list()).capabilities.canCreate, false, 'Root read denial excludes every eligible object');
    await rejected('/user-substitutions', 'POST', body);
    await removeRule(rootDeny.id);
    await create(body);
    await rejected('/user-substitutions', 'POST', body, 409);
  });

  await t.test('global manage administers another ordinary manager but cannot delegate beyond that source scope', async (suite) => {
    suite.after(resetRules);
    const body = { ...payload([a.id], 3), principalUserId: source.id };
    await rejected('/user-substitutions', 'POST', body);
    const grant = await rule('user_substitutions.manage', 'allow');
    await rejected('/user-substitutions', 'POST', { ...body, objectIds: [outside.id] });
    const createDeny = await rule('user_substitutions.create', 'deny');
    await rejected('/user-substitutions', 'POST', body);
    await removeRule(createDeny.id);
    await create(body);
    await prisma.userAccessRule.update({ where: { id: grant.id }, data: { effect: 'deny' } });
    await rejected('/user-substitutions', 'POST', { ...body, ...period(4) });
    await removeRule(grant.id);
    await rejected('/user-substitutions', 'POST', { ...body, ...period(4) });
  });

  await t.test('active delegation is object-bound, keeps identity, cannot be forwarded and disappears in the same replacement cookie on revoke', async (suite) => {
    suite.after(resetRules);
    await rejected(`/objects/${a.id}`, 'GET', undefined, 404, replacementCookie);
    await rule('user_substitutions.manage', 'allow');
    const saved = await create({ ...payload([a.id], 0), principalUserId: source.id });
    await status(await request(`/objects/${a.id}`, 'GET', undefined, replacementCookie), 200);
    await rejected(`/objects/${b.id}`, 'GET', undefined, 404, replacementCookie);
    for (const path of ['/employees', '/inventory/items', '/equipment/catalog', `/objects/${a.id}/attendance/today`])
      await rejected(path, 'GET', undefined, 403, replacementCookie);
    const forward = { ...payload([a.id], 0), replacementUserId: other.id };
    const extra = await rule('user_substitutions.create', 'allow', undefined, replacement.id);
    const delegation = { substitutionId: saved.id, principalUserId: source.id, objectId: a.id };
    await rejected('/user-substitutions', 'POST', forward, 403, replacementCookie, delegation);
    await removeRule(extra.id);
    const options = await request('/user-substitutions/options', 'GET', undefined, replacementCookie);
    await status(options, 200);
    const borrowed = await options.json() as { objects: unknown[]; capabilities: { canCreate: boolean } };
    assert.deepEqual(borrowed.objects, []);
    assert.equal(borrowed.capabilities.canCreate, false, 'Borrowed visibility cannot be offered for forwarding');
    assert.equal((await list('', replacementCookie)).capabilities.canCreate, false);
    const before = await capture();
    const revokePath = `/user-substitutions/${saved.id}/revoke`;
    await status(await request(revokePath, 'POST', { reason: 'End borrowed access' }, replacementCookie), 201);
    const after = await capture();
    const added = after.audit.filter((row) => !before.audit.some(({ id }) => id === row.id) && row.action === 'user_substitution.revoked');
    assert.equal(added.length, 1);
    assert.equal(added[0].actorUserId, replacement.id);
    assert.equal(added[0].entityType, 'user_substitution');
    assert.equal(added[0].entityId, saved.id);
    assert.equal(added[0].action, 'user_substitution.revoked');
    assert.equal(added[0].oldValues, null);
    assert.equal(added[0].newValues, null);
    assert.deepEqual(added[0].metadata, { principalUserId: source.id, replacementUserId: replacement.id, reason: 'End borrowed access' });
    const securityIds = assertSecurityAttempt(before, after, delegation, revokePath, 'POST', 'user_substitution.own_action', [added[0].id]);
    const revoked = after.records.find(({ id }) => id === saved.id)!;
    assert.ok(revoked.revokedAt);
    assert.deepEqual(revoked, { ...saved, revokedAt: revoked.revokedAt, revokedByUserId: replacement.id,
      revocationReason: 'End borrowed access', updatedAt: revoked.updatedAt });
    assert.deepEqual({ ...after,
      records: after.records.map((row) => row.id === saved.id ? saved : row),
      audit: after.audit.filter(({ id }) => !securityIds.has(id) && id !== added[0].id),
    }, before, 'Successful revoke changes only its record and exact business/security audit entries');
    await rejected(`/objects/${a.id}`, 'GET', undefined, 404, replacementCookie);
    assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: replacement.id }, include: { roles: true, permissions: true } }), replacement);
  });

  await t.test('selected administration must not inherit the source manager broader B scope', async (suite) => {
    suite.after(resetRules);
    await rule('user_substitutions.manage', 'allow', [a.id]);
    const body = { ...payload([a.id], 5), principalUserId: source.id };
    await rejected('/user-substitutions', 'POST', { ...body, objectIds: [b.id] });
    await rejected('/user-substitutions', 'POST', { ...body, objectIds: [a.id, b.id] });
    // The A-only grant must work without becoming all-scope.
    await create(body);
  });

  await t.test('selected section deny on A must block self-create of A even with a global create grant', async (suite) => {
    suite.after(resetRules);
    await rule('user_substitutions.create', 'allow');
    await rule('user_substitutions.access', 'deny', [a.id]);
    await rejected('/user-substitutions', 'POST', payload([a.id], 6));
  });
  await t.test('selected administration options filter before the 100-result limit and respect source selected denies', async (suite) => {
    suite.after(resetRules);
    const fillers = Array.from({ length: 101 }, (_, index) => ({ id: randomUUID(), name: `A-${marker}-${index.toString().padStart(3, '0')}`,
      address: 'Pagination fixture', status: 'active', createdByUserId: founder.id }));
    const target = { id: randomUUID(), name: `zzzz-${marker}`, address: 'Authorized beyond first 100', status: 'active', createdByUserId: founder.id };
    await prisma.object.createMany({ data: [...fillers, target] });
    await prisma.objectAssignment.createMany({ data: [...fillers, target].map((object) => ({ objectId: object.id, userId: source.id, assignmentRoleCode: 'manager', isActive: true })) });
    objects.push(...fillers, target);
    await rule('user_substitutions.manage', 'allow', [target.id]);
    await rule('user_substitutions.create', 'allow');
    const optionsPath = `/user-substitutions/options?principalUserId=${source.id}`;
    const before = await capture();
    const response = await request(optionsPath);
    await status(response, 200);
    assert.deepEqual((await response.json() as { objects: Array<{ id: string }> }).objects.map((object) => object.id), [target.id]);
    assert.deepEqual(await capture(), before);
    await rejected('/user-substitutions', 'POST', { ...payload([fillers[0].id], 12), principalUserId: source.id });
    await rejected('/user-substitutions', 'POST', { ...payload([target.id, fillers[0].id], 12), principalUserId: source.id });
    await rule('objects.read', 'deny', [target.id]);
    const hidden = await request(optionsPath);
    await status(hidden, 200);
    assert.deepEqual((await hidden.json() as { objects: unknown[] }).objects, []);
    await rejected('/user-substitutions', 'POST', { ...payload([target.id], 12), principalUserId: source.id });
  });
  await t.test('principal discovery scans past ineligible batches, retains canonical wide baseline and excludes denied/borrowed/B controls', async (suite) => {
    suite.after(resetRules);
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { code: 'manager' } });
    const wideRole = await prisma.role.findUniqueOrThrow({ where: { code: 'deputy_director' } });
    const principal = async (label: string, roleId?: string) => prisma.user.create({ data: {
      login: `${marker}-${label}`, fullName: `zzz-${marker}-${label}`, isActive: true,
      ...(roleId ? { roles: { create: { roleId } } } : {}),
    } });
    const owner = await principal('owner'), assigned = await principal('assigned', managerRole.id);
    const wide = await principal('wide', wideRole.id), denied = await principal('denied', managerRole.id);
    const deniedWide = await principal('denied-wide', wideRole.id), bOnly = await principal('B-only', managerRole.id);
    const borrower = await principal('borrower');
    const discoveryObject = await prisma.object.create({ data: { name: `${marker}-discovery-A`, address: 'Discovery only', status: 'active',
      createdByUserId: owner.id, assignments: { create: [assigned.id, denied.id].map(userId => ({ userId, isActive: true, assignmentRoleCode: 'manager' })) } } });
    objects.push(discoveryObject);
    await prisma.objectAssignment.create({ data: { objectId: b.id, userId: bOnly.id, assignmentRoleCode: 'manager', isActive: true } });
    await rule('objects.access', 'deny', undefined, denied.id);
    await rule('objects.read', 'deny', [discoveryObject.id], deniedWide.id);
    await rule('objects.read', 'allow', [discoveryObject.id], bOnly.id);
    await prisma.userSubstitution.create({ data: { principalUserId: owner.id, replacementUserId: borrower.id, createdByUserId: owner.id,
      startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 3600000), reason: marker,
      objects: { create: { objectId: discoveryObject.id } } } });
    await prisma.user.createMany({ data: Array.from({ length: 103 }, (_, index) => ({
      login: `${marker}-filler-${index}`, fullName: `000-${marker}-${index.toString().padStart(3, '0')}`, isActive: true,
    })) });
    const manage = await rule('user_substitutions.manage', 'allow', [discoveryObject.id], replacement.id);
    type Options = { principals: Array<{ id: string }>; objects: Array<{ id: string }>; capabilities: { canCreate: boolean; canCreateForOthers: boolean } };
    const options = async (query: string) => {
      const response = await request(`/user-substitutions/options?${query}`, 'GET', undefined, replacementCookie);
      await status(response, 200); return await response.json() as Options;
    };
    const before = await capture();
    const discovery = await options(`principalSearch=${marker}`);
    assert.deepEqual(new Set(discovery.principals.map(({ id }) => id)), new Set([owner.id, assigned.id, wide.id]));
    assert.equal(discovery.capabilities.canCreate, false, 'Foreign manage does not invent own object access');
    assert.equal(discovery.capabilities.canCreateForOthers, true);
    const noMatches = await options(`principalSearch=${randomUUID()}`);
    assert.deepEqual(noMatches.principals, []);
    assert.equal(noMatches.capabilities.canCreateForOthers, true, 'Existence is independent of principal search');
    for (const target of [owner, assigned, wide]) {
      const response = await options(`principalUserId=${target.id}&principalSearch=${marker}`);
      assert.deepEqual(response.objects.map(({ id }) => id), [discoveryObject.id]);
      assert.equal(response.capabilities.canCreate, true);
    }
    for (const target of [denied, deniedWide, borrower, bOnly]) {
      const response = await options(`principalUserId=${target.id}&principalSearch=${marker}`);
      assert.deepEqual(response.objects, []);
      assert.equal(response.capabilities.canCreate, false);
    }
    assert.equal((await list('', replacementCookie)).capabilities.canCreateForOthers, true);
    assert.deepEqual(await capture(), before, 'Discovery has no operational or audit effects');
    const createDeny = await rule('user_substitutions.create', 'deny', undefined, replacement.id);
    assert.equal((await options(`principalSearch=${marker}`)).capabilities.canCreateForOthers, false);
    await removeRule(createDeny.id);
    assert.equal((await options(`principalSearch=${marker}`)).capabilities.canCreateForOthers, true);
    await removeRule(manage.id);
    const revoked = await options(`principalSearch=${marker}`);
    assert.deepEqual(revoked.principals, []);
    assert.equal(revoked.capabilities.canCreateForOthers, false);
    assert.equal((await list('', replacementCookie)).capabilities.canCreateForOthers, false);
    await rejected('/user-substitutions', 'POST', { ...payload([discoveryObject.id], 19), principalUserId: owner.id, replacementUserId: other.id }, 403, replacementCookie);
    assert.deepEqual(await capture(), before, 'Revoked same-cookie discovery/attempt changes no business state');
  });

  await t.test('object own/assigned parent denies gate administration options, create and direct revoke using actual object identity', async (suite) => {
    suite.after(resetRules);
    const own = await prisma.object.create({ data: { name: `${marker}-owned-parent`, address: 'Owned source fixture', status: 'active', createdByUserId: actor.id,
      assignments: { create: { userId: source.id, assignmentRoleCode: 'manager' } } } });
    const assigned = await prisma.object.create({ data: { name: `${marker}-assigned-parent`, address: 'Assigned source fixture', status: 'active', createdByUserId: founder.id,
      assignments: { create: [source.id, actor.id].map((userId) => ({ userId, assignmentRoleCode: 'manager' })) } } });
    objects.push(own, assigned);
    await rule('user_substitutions.manage', 'allow', [own.id, assigned.id]);
    const existing = await create({ ...payload([own.id], 13), principalUserId: source.id });
    for (const scope of ['own', 'assigned'] as const) {
      const deny = await prisma.userAccessRule.create({ data: { userId: actor.id, actionCode: 'objects.read', effect: 'deny', scope, selectedIds: [] } });
      ruleIds.add(deny.id);
      const blockedId = scope === 'own' ? own.id : assigned.id;
      const allowedId = scope === 'own' ? assigned.id : own.id;
      const response = await request(`/user-substitutions/options?principalUserId=${source.id}`);
      await status(response, 200);
      assert.deepEqual((await response.json() as { objects: Array<{ id: string }> }).objects.map((object) => object.id), [allowedId]);
      await rejected('/user-substitutions', 'POST', { ...payload([blockedId], 14), principalUserId: source.id });
      if (scope === 'own') await rejected(`/user-substitutions/${existing.id}/revoke`, 'POST', { reason: 'Must respect source deny' });
      await removeRule(deny.id);
    }
  });
  assert.deepEqual(await prisma.user.findUniqueOrThrow(actorQuery), actor, 'No role or legacy permission changes');
  assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: source.id } }), source, 'No source identity changes');
  // Main executes serially and drops the isolated schema. No external writes.
});
