import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import type { AccessActionDefinition, AccessChange, AccessRule, AccessSubject } from '../src/modules/users-access/types/access-policy.type';
import { decideAccess } from '../src/modules/users-access/utils/access-policy.util';
import { canAttachStandaloneInventoryPhoto } from '../src/modules/inventory/utils/inventory-photo.util';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

interface Result {
  accessVersion?: number;
  previewToken?: string;
  previewHash?: string;
  rules: AccessRule[];
  effective: Array<{ actionCode: string; allowed: boolean | null; scope: AccessRule['scope'] | null; selectedIds: string[]; source: string; warnings: string[] }>;
}

// Compare complete rule objects independently of PostgreSQL/Node collation.
// Sorting never projects away fields or mutates the actual payload arrays.
function canonicalRuleRows(value: unknown): unknown[] {
  assert.ok(Array.isArray(value));
  const rows: unknown[] = value;
  const code = (row: unknown): string => {
    assert.ok(row !== null && typeof row === 'object' && 'actionCode' in row && typeof row.actionCode === 'string');
    return row.actionCode;
  };
  return [...rows].sort((a, b) => code(a) < code(b) ? -1 : code(a) > code(b) ? 1 : 0);
}

// Real admin API + DB for every code; this does NOT certify each domain/UI route.
test('entire catalog administrative boundary: all/default/deny, non-grantable codes, immutable sources and exact audit', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  assert.match(new URL(process.env.DATABASE_URL!).searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());
  const { app, baseUrl } = await createTestApp();
  t.after(() => app.close());
  const [template, role, founder] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
    prisma.role.findUniqueOrThrow({ where: { code: 'manager' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
  ]);
  const marker = `acl-catalog-${randomUUID()}`;
  const target = await prisma.user.create({ data: { login: marker, fullName: marker, passwordHash: template.passwordHash,
    isActive: true, roles: { create: { roleId: role.id } } } });
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' });
  const recipientCookie = await loginAndGetCookieHeader({ baseUrl, login: target.login, password: 'manager123' });
  const request = (suffix: string, body?: unknown) => fetch(`${baseUrl}/api/v1/users-access/admin/${suffix}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const effective = async () => {
    const response = await request(`users/${target.id}/effective`);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json() as Promise<Result>;
  };
  const sources = async () => ({
    roles: await prisma.userRole.findMany({ where: { userId: target.id } }),
    permissions: await prisma.userPermission.findMany({ where: { userId: target.id } }),
    objectAssignments: await prisma.objectAssignment.findMany({ where: { userId: target.id } }),
    orderAssignments: await prisma.oneTimeOrderAssignment.findMany({ where: { userId: target.id } }),
    objectsOwned: await prisma.object.count({ where: { createdByUserId: target.id } }),
    ordersOwned: await prisma.oneTimeOrder.count({ where: { createdByUserId: target.id } }),
    memberships: await prisma.chatRoomParticipant.findMany({ where: { userId: target.id } }),
  });
  // Real selected/own resources, created before the immutable source baseline.
  const objectA = await prisma.object.create({ data: { name: `${marker}-A`, address: marker, status: 'active', createdByUserId: founder.id } });
  const objectB = await prisma.object.create({ data: { name: `${marker}-B`, address: marker, status: 'active', createdByUserId: founder.id } });
  const item = await prisma.inventoryItem.create({ data: { name: marker, category: 'consumable', unit: 'шт', createdByUserId: founder.id } });
  const ownMovement = await prisma.inventoryMovement.create({ data: { inventoryItemId: item.id, movementType: 'receipt', quantity: 1, unitPriceSnapshot: 1, totalAmountSnapshot: 1, createdByUserId: target.id } });
  const foreignMovement = await prisma.inventoryMovement.create({ data: { inventoryItemId: item.id, movementType: 'receipt', quantity: 1, unitPriceSnapshot: 1, totalAmountSnapshot: 1, createdByUserId: founder.id } });
  const resourceSnapshot = async () => ({
    objects: await prisma.object.findMany({ where: { id: { in: [objectA.id, objectB.id] } }, orderBy: { id: 'asc' } }),
    item: await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } }),
    movements: await prisma.inventoryMovement.findMany({ where: { id: { in: [ownMovement.id, foreignMovement.id] } }, orderBy: { id: 'asc' } }),
  });
  const originalResources = await resourceSnapshot();
  const originalSources = await sources();
  const baseline = await effective();
  const manageable = ACCESS_ACTION_CATALOG.filter((action) => action.manageable);
  const changeFor = (action: AccessActionDefinition, effect: AccessChange['effect']): AccessChange => {
    const scopes = action.managementScopes ?? action.allowedScopes;
    if (scopes.includes('all')) return { actionCode: action.code, effect, scope: 'all', selectedIds: [] };
    if (action.code === 'objects.substitutions.read') {
      assert.ok(scopes.includes('selected'));
      return { actionCode: action.code, effect, scope: 'selected', selectedIds: [objectA.id] };
    }
    assert.equal(action.code, 'inventory.movement.photos.create', 'A new scoped action needs an explicit real-resource fixture');
    assert.deepEqual(scopes, ['own']);
    return { actionCode: action.code, effect, scope: 'own', selectedIds: [] };
  };
  const changesFor = (effect: AccessChange['effect'], actions = manageable): AccessChange[] => actions.map(action => changeFor(action, effect));
  const assertScopedResources = (rules: AccessRule[], denied: boolean): void => {
    const subject: AccessSubject = { id: target.id, isActive: true, roleCodes: ['manager'], permissionCodes: [], accessRules: rules };
    assert.equal(decideAccess(subject, 'objects.substitutions.read', false, { resourceType: 'object', resourceId: objectA.id }), !denied, 'Exact selected A decision');
    assert.equal(decideAccess(subject, 'objects.substitutions.read', false, { resourceType: 'object', resourceId: objectB.id }), false, 'Unselected B never gains authority');
    assert.equal(canAttachStandaloneInventoryPhoto(subject, ownMovement, false), !denied, 'Current own movement photo decision');
    assert.equal(canAttachStandaloneInventoryPhoto(subject, foreignMovement, false), false, 'Foreign movement never inherits own grant');
  };
  let version = 0;
  const apply = async (changes: AccessChange[], reason: string) => {
    const body = { expectedVersion: version, reason, changes };
    const beforeRules = await prisma.userAccessRule.findMany({ where: { userId: target.id } });
    const beforeAudits = await prisma.userAccessAudit.findMany({ where: { userId: target.id }, orderBy: { versionAfter: 'asc' } });
    const previewResponse = await request(`users/${target.id}/preview`, body);
    assert.equal(previewResponse.status, 201, await previewResponse.clone().text());
    const preview = await previewResponse.json() as Result;
    assert.deepEqual(await prisma.userAccessRule.findMany({ where: { userId: target.id } }), beforeRules, 'Preview cannot issue rules');
    assert.deepEqual(await prisma.userAccessAudit.findMany({ where: { userId: target.id }, orderBy: { versionAfter: 'asc' } }), beforeAudits, 'Preview cannot create or rewrite audit');
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).accessVersion, version);
    const saveBody = { ...body, previewToken: preview.previewToken, previewHash: preview.previewHash };
    const saved = await request(`users/${target.id}/save`, saveBody);
    assert.equal(saved.status, 201, await saved.clone().text());
    const result = await saved.json() as Result;
    version += 1;
    assert.equal(result.accessVersion, version);
    const audit = await prisma.userAccessAudit.findUniqueOrThrow({ where: { userId_versionAfter: { userId: target.id, versionAfter: version } } });
    assert.equal(audit.actorUserId, founder.id);
    assert.equal(audit.reason, reason);
    assert.deepEqual(canonicalRuleRows(audit.before), canonicalRuleRows(beforeRules.map(({ actionCode, effect, scope, selectedIds }) => ({ actionCode, effect, scope, selectedIds }))));
    assert.equal(audit.versionBefore, version - 1);
    assert.deepEqual(canonicalRuleRows(audit.after), canonicalRuleRows(result.rules));
    const replay = await request(`users/${target.id}/save`, saveBody);
    assert.equal(replay.status, 409, await replay.clone().text());
    assert.equal(await prisma.userAccessAudit.count({ where: { userId: target.id } }), version);
    assert.deepEqual(await sources(), originalSources, 'Rules do not create roles, permissions, ownership, assignment or membership');
    assert.deepEqual(await resourceSnapshot(), originalResources, 'Admin rules do not mutate the real resource fixtures');
    return result;
  };
  await t.test('HTTP catalog includes each of the 293 unique definitions and truthful constraints', async () => {
    const response = await request('catalog');
    assert.equal(response.status, 200);
    const body = await response.json() as { actions: typeof ACCESS_ACTION_CATALOG };
    assert.equal(body.actions.length, 293);
    assert.deepEqual(body.actions, ACCESS_ACTION_CATALOG);
  });
  await t.test('unsupported all scope for selected-only and own-only actions is rejected without writes', async () => {
    const beforeRules = await prisma.userAccessRule.findMany({ where: { userId: target.id } });
    const beforeAudit = await prisma.userAccessAudit.findMany({ where: { userId: target.id } });
    for (const action of manageable.filter(entry => !entry.allowedScopes.includes('all'))) {
      for (const effect of ['allow', 'deny'] as const) {
        const input = { expectedVersion: version, reason: marker, changes: [{ actionCode: action.code, effect, scope: 'all' }] };
        for (const endpoint of ['preview', 'save']) {
          const response = await request(`users/${target.id}/${endpoint}`, endpoint === 'preview' ? input : { ...input, previewToken: '0'.repeat(64), previewHash: '0'.repeat(64) });
          assert.equal(response.status, 400, await response.clone().text());
          assert.ok((await response.text()).includes('Unsupported action scope or effect'));
          assert.deepEqual(await prisma.userAccessRule.findMany({ where: { userId: target.id } }), beforeRules);
          assert.deepEqual(await prisma.userAccessAudit.findMany({ where: { userId: target.id } }), beforeAudit);
          assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).accessVersion, version);
          assert.deepEqual(await sources(), originalSources);
          assert.deepEqual(await resourceSnapshot(), originalResources);
        }
      }
    }
  });
  await t.test('all manageable codes persist in one atomic allow, with role gates still reflected', async () => {
    const result = await apply(changesFor('allow'), 'Acceptance: batch all manageable allows');
    assert.equal(result.rules.length, manageable.length);
    for (const action of manageable) {
      const rule = result.rules.find((item) => item.actionCode === action.code);
      assert.deepEqual(rule, changeFor(action, 'allow'), action.code);
      assert.ok(rule);
      const row = result.effective.find((item) => item.actionCode === action.code)!;
      if (['founder_only', 'leadership_only', 'director_only'].includes(action.constraint ?? '')) {
        assert.equal(row.allowed, false, action.code);
      } else if (rule.scope !== 'all') {
        // The current projector reports a surviving selected/own scope as true,
        // not unrestricted access. Concrete A/B and own/foreign checks follow.
        assert.equal(row.allowed, true, `${action.code} surviving scoped allowance`);
        assert.equal(row.scope, rule.scope, 'Scoped allowance must not be advertised as all');
        assert.deepEqual(row.selectedIds, rule.selectedIds);
        assert.equal(row.source, 'personal_allow_scoped');
        assert.equal(row.warnings.includes('requires_legacy_policy_and_resource_context'), false);
      } else assert.equal(row.allowed, true, `${action.code} positive all-scope summary`);
    }
    assertScopedResources(result.rules, false);
    // Cookie predates issuance; JWT must load persisted rules rather than old claims.
    const profile = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Cookie: recipientCookie } });
    assert.equal(profile.status, 200, await profile.clone().text());
    const identity = await profile.json() as { id: string; accessVersion: number; accessRules: Result['rules'] };
    assert.equal(identity.id, target.id);
    assert.equal(identity.accessVersion, version);
    assert.deepEqual(canonicalRuleRows(identity.accessRules.map(({ actionCode, effect, scope, selectedIds }) => ({ actionCode, effect, scope, selectedIds }))), canonicalRuleRows(result.rules));
  });
  await t.test('each individual manageable deny has a negative effective preview over the otherwise permitted catalog', async (t) => {
    for (const action of manageable) await t.test(action.code, async () => {
      const response = await request(`users/${target.id}/preview`, { expectedVersion: version, reason: marker,
        changes: [changeFor(action, 'deny')] });
      assert.equal(response.status, 201, await response.clone().text());
      const result = await response.json() as Result;
      const row = result.effective.find((item) => item.actionCode === action.code)!;
      assert.equal(row.allowed, action.code === 'objects.substitutions.read' ? null : false);
      if (action.code === 'objects.substitutions.read') {
        assert.ok(row.warnings.includes('requires_legacy_policy_and_resource_context'));
        assert.equal(row.warnings.includes('personal_allow_scope_fully_denied'), false, 'Preview replaces the allow with deny; no personal allow remains to label fully denied');
      }
      if (!action.allowedScopes.includes('all')) {
        const subject: AccessSubject = { id: target.id, isActive: true, roleCodes: ['manager'], permissionCodes: [], accessRules: result.rules };
        assert.equal(action.code === 'objects.substitutions.read'
          ? decideAccess(subject, action.code, false, { resourceType: 'object', resourceId: objectA.id })
          : canAttachStandaloneInventoryPhoto(subject, ownMovement, false), false, 'Scoped preview denies the actual protected resource');
      }
      const rule = await prisma.userAccessRule.findUniqueOrThrow({ where: { userId_actionCode: { userId: target.id, actionCode: action.code } } });
      assert.equal(rule.effect, 'allow', 'An individual deny preview must not persist it');
    });
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).accessVersion, version);
    assert.equal(await prisma.userAccessAudit.count({ where: { userId: target.id } }), version);
  });
  await t.test('every manageable deny persists; old recipient session is blocked by auth access, logout remains available', async () => {
    const result = await apply(changesFor('deny'), 'Acceptance: batch all manageable denies');
    for (const action of manageable) {
      assert.equal(result.rules.find((item) => item.actionCode === action.code)?.effect, 'deny', action.code);
      assert.equal(result.effective.find((item) => item.actionCode === action.code)?.allowed, false, action.code);
    }
    assertScopedResources(result.rules, true);
    const profile = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Cookie: recipientCookie } });
    assert.equal(profile.status, 401);
    const logout = await fetch(`${baseUrl}/api/v1/auth/logout`, { method: 'POST', headers: { Cookie: recipientCookie } });
    assert.ok(logout.ok, await logout.clone().text());
  });
  await t.test('default removes all persisted rules, restores baseline and does not mutate sources', async () => {
    const result = await apply(changesFor('default', [...ACCESS_ACTION_CATALOG]), 'Acceptance: restore every catalog default');
    assert.deepEqual(result.rules, []);
    assert.deepEqual(result.effective.map(({ actionCode, allowed }) => ({ actionCode, allowed })),
      baseline.effective.map(({ actionCode, allowed }) => ({ actionCode, allowed })));
  });
  for (const action of ACCESS_ACTION_CATALOG.filter((entry) => !entry.manageable)) {
    await t.test(`${action.code}: new allow/deny is explicitly rejected and has no rule/version/audit effects`, async () => {
      for (const effect of ['allow', 'deny'] as const) {
        const response = await request(`users/${target.id}/preview`, { expectedVersion: version, reason: marker,
          changes: [{ actionCode: action.code, effect, scope: 'all' }] });
        assert.equal(response.status, 400, await response.clone().text());
        assert.ok((await response.text()).includes(`Action is constrained: ${action.code}`));
        assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).accessVersion, version);
        assert.equal(await prisma.userAccessRule.count({ where: { userId: target.id } }), 0);
        assert.equal(await prisma.userAccessAudit.count({ where: { userId: target.id } }), version);
      }
    });
  }
});
