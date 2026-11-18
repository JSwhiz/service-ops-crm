import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

interface EffectiveRow {
  actionCode: string; allowed: boolean | null; scope: string | null; selectedIds: string[]; warnings: string[];
  effectiveScopes: { parentDenies: Array<{ actionCode: string; selectedIds: string[] }> };
}

test('admin effective/preview cannot advertise selected grants blocked by real policy constraints or parent scope', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  assert.match(new URL(process.env.DATABASE_URL!).searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());
  const { app, baseUrl } = await createTestApp();
  t.after(() => app.close());
  const [template, role, founder] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
    prisma.role.findUniqueOrThrow({ where: { code: 'hr' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
  ]);
  const marker = `acl-effective-${randomUUID()}`;
  const target = await prisma.user.create({ data: { login: marker, fullName: marker,
    passwordHash: template.passwordHash, isActive: true, roles: { create: { roleId: role.id } } } });
  const objects = await Promise.all(['denied', 'control'].map((suffix) => prisma.object.create({ data: {
    name: `${marker}-${suffix}`, address: 'Scoped administration fixture', status: 'active', createdByUserId: founder.id,
  } })));
  const adjustment = await prisma.objectCompensationAdjustment.create({ data: {
    objectId: objects[0].id, requestKey: randomUUID(), kind: 'extra_work', operationDate: new Date('2026-11-01T00:00:00Z'),
    reason: marker, payload: {}, beforeSnapshot: {}, createdByUserId: founder.id,
  } });
  const approval = await prisma.approvalRequest.create({ data: {
    approvalType: 'object_compensation_confirmation', sourceEntityType: 'object_compensation_adjustment', sourceEntityId: adjustment.id,
    createdByUserId: founder.id, payloadSnapshot: { independentLeadershipRequired: true },
  } });
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' });
  const targetCookie = await loginAndGetCookieHeader({ baseUrl, login: target.login, password: 'manager123' });
  const endpoint = `/users-access/admin/users/${target.id}`;
  const rows = async () => {
    const response = await fetch(`${baseUrl}/api/v1${endpoint}/effective`, { headers: { Cookie: founderCookie } });
    assert.equal(response.status, 200, await response.clone().text());
    return ((await response.json()) as { effective: EffectiveRow[] }).effective;
  };
  const find = (items: EffectiveRow[], action: string) => {
    const row = items.find((item) => item.actionCode === action);
    assert.ok(row, action);
    return row;
  };
  const reset = () => prisma.userAccessRule.deleteMany({ where: { userId: target.id } });
  await t.test('legacy invalid resolver grant stays ineffective; constrained preview rejects without mutation and resolve stays denied', async () => {
    await prisma.userAccessRule.create({ data: { userId: target.id, actionCode: 'approvals.resolve_timesheet',
      effect: 'allow', scope: 'selected', selectedIds: [approval.id] } });
    assert.equal(find(await rows(), 'approvals.resolve_timesheet').allowed, false);
    const snapshot = async () => ({
      version: (await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).accessVersion,
      rules: await prisma.userAccessRule.findMany({ where: { userId: target.id }, orderBy: { actionCode: 'asc' } }),
      auditCount: await prisma.userAccessAudit.count({ where: { userId: target.id } }),
    });
    const beforePreview = await snapshot();
    const response = await fetch(`${baseUrl}/api/v1${endpoint}/preview`, { method: 'POST',
      headers: { Cookie: founderCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({
        expectedVersion: target.accessVersion, reason: marker,
        changes: [{ actionCode: 'approvals.resolve_timesheet', effect: 'allow', scope: 'selected', selectedIds: [approval.id] }],
      }) });
    assert.equal(response.status, 400, await response.clone().text());
    assert.ok((await response.text()).includes('Action is constrained: approvals.resolve_timesheet'));
    assert.deepEqual(await snapshot(), beforePreview, 'Rejected constrained preview must not change rules/version or create access audit');
    assert.equal(find(await rows(), 'approvals.resolve_timesheet').allowed, false);
    const resolve = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}/approve`, { method: 'POST',
      headers: { Cookie: targetCookie, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(resolve.status, 403, await resolve.clone().text());
    assert.equal((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).status, 'pending');
  });
  for (const partial of [false, true]) {
    await t.test(`${partial ? 'partly' : 'fully'} overlapping selected parent deny preserves exact effective blockers/remaining IDs`, async () => {
      await reset();
      await prisma.userAccessRule.createMany({ data: [
        { userId: target.id, actionCode: 'objects.access', effect: 'deny', scope: 'selected', selectedIds: [objects[0].id] },
        { userId: target.id, actionCode: 'objects.materials.manage', effect: 'allow', scope: 'selected',
          selectedIds: partial ? objects.map((object) => object.id) : [objects[0].id] },
      ] });
      const result = find(await rows(), 'objects.materials.manage');
      assert.deepEqual(result.effectiveScopes.parentDenies.map((parent) => ({ actionCode: parent.actionCode, selectedIds: parent.selectedIds })),
        [{ actionCode: 'objects.access', selectedIds: [objects[0].id] }]);
      assert.ok(result.warnings.includes('parent_scope_deny_applies_where_scopes_overlap'));
      if (partial) {
        assert.equal(result.allowed, true);
        assert.deepEqual(result.selectedIds, [objects[1].id]);
      } else {
        assert.notEqual(result.allowed, true, 'A completely ineffective scoped grant must not be advertised as allowed');
        assert.deepEqual(result.selectedIds, []);
        assert.ok(result.warnings.includes('personal_allow_scope_fully_denied'));
      }
    });
  }
});
