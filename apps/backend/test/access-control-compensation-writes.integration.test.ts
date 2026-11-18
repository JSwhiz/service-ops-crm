import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { todayMoscow } from '../src/modules/object-scheduling/scheduling-calendar';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type CompensationView = {
  capabilities: { manageRates: boolean; manageTeamFund: boolean };
};

test('compensation leaf writes enforce selected foreign objects through HTTP and persisted effects', async (t) => {
  // Fail before creating a client or app: only the isolated local runner may execute this file.
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  assert.match(databaseUrl.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname));
  assert.ok(['postgres:', 'postgresql:'].includes(databaseUrl.protocol));

  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  t.after(async () => {
    try { await closeApp?.(); } finally { await prisma.$disconnect(); }
  });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'manager' } });
  const today = todayMoscow();
  const offsetDate = (days: number) => new Date(new Date(`${today}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
  const effectiveFrom = offsetDate(7);
  const historicalDate = offsetDate(-60);

  for (const operation of ['rates', 'teamFund'] as const) {
    await t.test(operation === 'rates' ? 'objects.rates.manage' : 'objects.budget.edit', async (suite) => {
      const marker = `acl-comp-${randomUUID()}`;
      const actor = await prisma.user.create({ data: {
        login: marker, fullName: marker, passwordHash: template.passwordHash, isActive: true,
        roles: { create: { roleId: role.id } },
      } });
      // One login only: every grant, revoke and parent deny must affect this same cookie.
      const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
      const employee = await prisma.employee.create({ data: { fullName: marker, employmentStatus: 'active' } });
      const objects: Array<{ id: string; createdByUserId: string }> = [];
      for (const label of ['A', 'B']) {
        const object = await prisma.object.create({ data: {
          name: `${marker}-${label}`, address: 'Isolated compensation leaf writes', status: 'active',
          createdByUserId: founder.id, paymentType: 'daily', dailyRate: 1500,
        } });
        const oldVersion = await prisma.objectCompensationVersion.create({ data: {
          objectId: object.id, scope: 'defaults', scopeId: object.id, version: 1, requestKey: randomUUID(),
          effectiveFrom: new Date(`${historicalDate}T00:00:00Z`), createdByUserId: founder.id,
          terms: { ratePolicyType: 'daily_rate', baseAmount: 1500 },
        } });
        await prisma.objectTeamFundVersion.create({ data: {
          objectId: object.id, version: 1, requestKey: randomUUID(), effectiveFrom: new Date(`${historicalDate}T00:00:00Z`),
          monthlyAmount: 50000, allocations: [], reason: 'Historical team fund', createdByUserId: founder.id,
        } });
        await prisma.objectEmployeeAssignment.create({ data: { objectId: object.id, employeeId: employee.id, isActive: true } });
        const policySnapshot = { ratePolicyType: 'daily_rate', baseAmount: 1500, compensationVersionId: oldVersion.id };
        await prisma.objectAttendanceFact.create({ data: {
          objectId: object.id, employeeId: employee.id, operationDate: new Date(`${historicalDate}T12:00:00+03:00`),
          dailyRateSnapshot: 1500, ratePolicySnapshot: policySnapshot, createdByUserId: founder.id,
        } });
        await prisma.objectPayrollCredit.create({ data: {
          objectId: object.id, employeeId: employee.id, operationDate: new Date(`${historicalDate}T00:00:00Z`),
          sourceKey: `historical:${marker}`, amount: 1500, policySnapshot, explanation: marker, createdByUserId: founder.id,
        } });
        const [year, month, dayOfMonth] = historicalDate.split('-').map(Number);
        const container = await prisma.timesheetMonth.create({ data: { objectId: object.id, year, month, createdByUserId: founder.id } });
        const row = await prisma.timesheetEmployeeRow.create({ data: {
          timesheetMonthId: container.id, employeeId: employee.id, employeeNameSnapshot: employee.fullName,
        } });
        await prisma.timesheetDayEntry.create({ data: {
          rowId: row.id, dayOfMonth, autoValue: 1500, dayValue: 1750, manualValue: 1750,
          difference: 250, isChangedManually: true, ratePolicySnapshot: policySnapshot, createdByUserId: founder.id,
        } });
        // A real cancellable B target proves cancellation denies are authorization failures, not missing IDs.
        if (operation === 'rates' && label === 'B') await prisma.objectCompensationVersion.create({ data: {
          objectId: object.id, scope: 'defaults', scopeId: object.id, version: 2, requestKey: randomUUID(),
          effectiveFrom: new Date(`${effectiveFrom}T00:00:00Z`), createdByUserId: founder.id,
          terms: { ratePolicyType: 'daily_rate', baseAmount: 1900 },
        } });
        objects.push(object);
      }
      const [a, b] = objects;
      assert.ok(objects.every((object) => object.createdByUserId !== actor.id));
      assert.equal(await prisma.objectAssignment.count({ where: { objectId: { in: objects.map(({ id }) => id) }, userId: actor.id } }), 0);
      assert.equal(await prisma.userPermission.count({ where: { userId: actor.id } }), 0);
      const rule = (actionCode: string, effect: 'allow' | 'deny', selectedIds: string[]) =>
        prisma.userAccessRule.create({ data: { userId: actor.id, actionCode, effect, scope: 'selected', selectedIds } });
      const rootRead = await rule('objects.read', 'allow', [a.id, b.id]);
      await rule('objects.compensation.read', 'allow', [a.id, b.id]);
      const leaf = operation === 'rates' ? 'objects.rates.manage' : 'objects.budget.edit';
      const endpoint = operation === 'rates' ? 'versions' : 'team-funds';
      const action = operation === 'rates' ? 'compensation.version.created' : 'compensation.team_fund.created';
      const request = (objectId: string, suffix = '', body?: unknown) => fetch(
        `${baseUrl}/api/v1/objects/${objectId}/scheduling/compensation${suffix}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { Cookie: cookie, 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
      );
      const input = (expectedVersion: number, date = effectiveFrom) => operation === 'rates'
        ? { requestKey: randomUUID(), scope: 'defaults', effectiveFrom: date, expectedVersion,
          terms: { ratePolicyType: 'daily_rate', baseAmount: 2300, scheduleCode: '7/0', scheduleCycleStartDate: date } }
        : { requestKey: randomUUID(), effectiveFrom: date, expectedVersion, monthlyAmount: 60000,
          allocations: [], reason: 'Explicit unallocated team fund; no payroll accrual' };
      const capture = async (objectId: string) => {
        const [object, versions, funds, objectAudit, audit, credits, attendance, entries, adjustments, approvals] = await Promise.all([
          prisma.object.findUniqueOrThrow({ where: { id: objectId } }),
          prisma.objectCompensationVersion.findMany({ where: { objectId }, orderBy: { id: 'asc' } }),
          prisma.objectTeamFundVersion.findMany({ where: { objectId }, orderBy: { id: 'asc' } }),
          prisma.objectAuditLog.findMany({ where: { objectId }, orderBy: { id: 'asc' } }),
          prisma.auditEvent.findMany({ where: { entityType: 'object', entityId: objectId }, orderBy: { id: 'asc' } }),
          prisma.objectPayrollCredit.findMany({ where: { objectId }, orderBy: { id: 'asc' } }),
          prisma.objectAttendanceFact.findMany({ where: { objectId }, orderBy: { id: 'asc' } }),
          prisma.timesheetDayEntry.findMany({ where: { row: { timesheetMonth: { objectId } } }, orderBy: { id: 'asc' } }),
          prisma.objectCompensationAdjustment.findMany({ where: { objectId }, orderBy: { id: 'asc' } }),
          prisma.approvalRequest.findMany({ where: { createdByUserId: actor.id }, orderBy: { id: 'asc' } }),
        ]);
        return { object, versions, funds, objectAudit, audit, credits, attendance, entries, adjustments, approvals };
      };
      const initial = await Promise.all(objects.map(({ id }) => capture(id)));
      const assertFinancialHistory = async () => {
        for (const [index, object] of objects.entries()) {
          const state = await capture(object.id);
          for (const key of ['object', 'credits', 'attendance', 'entries', 'adjustments', 'approvals'] as const)
            assert.deepEqual(state[key], initial[index][key], `Object ${index}: ${key} must remain unchanged`);
          assert.deepEqual(state.versions.find(({ version }) => version === 1), initial[index].versions.find(({ version }) => version === 1));
          assert.deepEqual(state.funds.find(({ version }) => version === 1), initial[index].funds.find(({ version }) => version === 1));
        }
      };
      const read = async (objectId: string, allowed: boolean) => {
        const response = await request(objectId);
        assert.equal(response.status, 200, await response.clone().text());
        const view = await response.json() as CompensationView;
        assert.equal(view.capabilities.manageRates, operation === 'rates' && allowed);
        assert.equal(view.capabilities.manageTeamFund, operation === 'teamFund' && allowed);
      };
      const original = input(1);
      let savedId = '';
      const denyWrites = async (objectId: string) => {
        const before = await capture(objectId);
        const expectedVersion = operation === 'rates' ? Math.max(...before.versions.map(({ version }) => version))
          : Math.max(...before.funds.map(({ version }) => version));
        const response = await request(objectId, `/${endpoint}`, input(expectedVersion, offsetDate(14)));
        assert.equal(response.status, 403, await response.clone().text());
        if (objectId === a.id && savedId) {
          const replay = await request(objectId, `/${endpoint}`, original);
          assert.equal(replay.status, 403, await replay.clone().text());
        }
        if (operation === 'rates') {
          const future = before.versions.find((version) => version.effectiveFrom.toISOString().slice(0, 10) === effectiveFrom);
          if (future) {
            const cancel = await request(objectId, `/versions/${future.id}/cancel`, { expectedVersion: future.version, reason: 'Denied cancellation' });
            assert.equal(cancel.status, 403, await cancel.clone().text());
          }
        }
        assert.deepEqual(await capture(objectId), before, 'Denied writes/replays/cancellations must not change versions, money or either audit');
      };

      await suite.test('foreign A/B are readable but manager baseline cannot write either', async () => {
        for (const object of objects) {
          await read(object.id, false);
          await denyWrites(object.id);
        }
      });
      let grantId: string;
      await suite.test('selected leaf A persists exactly one version and both audits; readable B stays forbidden', async () => {
        grantId = (await rule(leaf, 'allow', [a.id])).id;
        assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id, actionCode: 'objects.compensation.manage' } }), 0);
        await read(a.id, true);
        await read(b.id, false);
        const before = await capture(a.id);
        const response = await request(a.id, `/${endpoint}`, original);
        assert.equal(response.status, 201, await response.clone().text());
        const result = await response.json() as { status: string; version?: { id: string }; teamFund?: { id: string } };
        assert.equal(result.status, 'applied');
        savedId = (operation === 'rates' ? result.version : result.teamFund)!.id;
        assert.ok(savedId);
        const after = await capture(a.id);
        assert.equal(after.versions.length, before.versions.length + (operation === 'rates' ? 1 : 0));
        assert.equal(after.funds.length, before.funds.length + (operation === 'teamFund' ? 1 : 0));
        const saved = operation === 'rates' ? after.versions.find(({ id }) => id === savedId) : after.funds.find(({ id }) => id === savedId);
        assert.ok(saved);
        assert.equal(saved.objectId, a.id);
        assert.equal(saved.createdByUserId, actor.id);
        assert.equal(saved.requestKey, original.requestKey);
        assert.equal(saved.version, 2);
        assert.equal(saved.effectiveFrom.toISOString().slice(0, 10), effectiveFrom);
        if ('terms' in saved) assert.equal((saved.terms as { baseAmount: number }).baseAmount, 2300);
        else { assert.equal(saved.monthlyAmount, 60000); assert.deepEqual(saved.allocations, []); }
        assert.equal(after.objectAudit.length, before.objectAudit.length + 1);
        assert.equal(after.audit.length, before.audit.length + 1);
        const objectAudit = after.objectAudit.find(({ id }) => !before.objectAudit.some((row) => row.id === id))!;
        const audit = after.audit.find(({ id }) => !before.audit.some((row) => row.id === id))!;
        assert.equal(objectAudit.actionCode, action);
        assert.equal(audit.action, action);
        assert.equal(objectAudit.actorUserId, actor.id);
        assert.equal(audit.actorUserId, actor.id);
        assert.equal((objectAudit.payload as { id: string }).id, savedId);
        assert.equal((audit.newValues as { id: string }).id, savedId);
        await denyWrites(b.id);
        await assertFinancialHistory();
      });
      await suite.test('requestKey replay returns the same row without another version/audit; changed money conflicts', async () => {
        const before = await capture(a.id);
        const response = await request(a.id, `/${endpoint}`, original);
        assert.equal(response.status, 201, await response.clone().text());
        const result = await response.json() as { version?: { id: string }; teamFund?: { id: string } };
        assert.equal((operation === 'rates' ? result.version : result.teamFund)?.id, savedId);
        const changed = operation === 'rates' ? { ...original, terms: { ...original.terms, baseAmount: 2301 } }
          : { ...original, monthlyAmount: 60001 };
        const conflict = await request(a.id, `/${endpoint}`, changed);
        assert.equal(conflict.status, 409, await conflict.clone().text());
        assert.equal((await conflict.json() as { code: string }).code, 'REQUEST_KEY_REUSED');
        assert.deepEqual(await capture(a.id), before);
      });
      await suite.test('revoke immediately blocks new writes and successful-request replay in the original cookie', async () => {
        await prisma.userAccessRule.delete({ where: { id: grantId } });
        await read(a.id, false);
        await denyWrites(a.id);
        grantId = (await rule(leaf, 'allow', [a.id])).id;
        await read(a.id, true);
      });
      await suite.test('replacing root read allow A/B with deny A blocks writes until the original grant is restored', async () => {
        // There is one rule per user/action: replacement also removes B's only root-read grant.
        await prisma.userAccessRule.update({ where: { id: rootRead.id }, data: { effect: 'deny', selectedIds: [a.id] } });
        try {
          const response = await request(a.id);
          assert.equal(response.status, 403, await response.clone().text());
          await denyWrites(a.id);
          await denyWrites(b.id);
        } finally {
          await prisma.userAccessRule.update({ where: { id: rootRead.id }, data: {
            effect: rootRead.effect, scope: rootRead.scope, selectedIds: rootRead.selectedIds,
          } });
        }
        await read(a.id, true);
        await read(b.id, false);
      });
      await suite.test('objects.compensation.manage deny overrides selected leaf A and leaves B readable', async () => {
        const deny = await rule('objects.compensation.manage', 'deny', [a.id]);
        try {
          await read(a.id, false);
          await denyWrites(a.id);
          await read(b.id, false);
        } finally {
          await prisma.userAccessRule.delete({ where: { id: deny.id } });
        }
        await read(a.id, true);
      });
      if (operation === 'rates') await suite.test('selected rate leaf cancels its future version once and audits without rewriting history', async () => {
        const before = await capture(a.id);
        const body = { expectedVersion: 2, reason: 'Cancel selected future conditions' };
        const response = await request(a.id, `/versions/${savedId}/cancel`, body);
        assert.equal(response.status, 201, await response.clone().text());
        const saved = await prisma.objectCompensationVersion.findUniqueOrThrow({ where: { id: savedId } });
        assert.ok(saved.cancelledAt);
        assert.equal(saved.cancelledByUserId, actor.id);
        assert.equal(saved.cancelReason, body.reason);
        assert.deepEqual(saved, {
          ...before.versions.find(({ id }) => id === savedId), cancelledAt: saved.cancelledAt,
          cancelledByUserId: actor.id, cancelReason: body.reason,
        }, 'Cancellation changes only its cancellation metadata');
        const after = await capture(a.id);
        assert.equal(after.versions.length, before.versions.length);
        assert.deepEqual(after.funds, before.funds);
        assert.equal(after.objectAudit.length, before.objectAudit.length + 1);
        assert.equal(after.audit.length, before.audit.length + 1);
        assert.equal(after.objectAudit.filter((row) => row.actionCode === 'compensation.version.cancelled' && row.actorUserId === actor.id).length, 1);
        assert.equal(after.audit.filter((row) => row.action === 'compensation.version.cancelled' && row.actorUserId === actor.id).length, 1);
        const repeated = await request(a.id, `/versions/${savedId}/cancel`, body);
        assert.equal(repeated.status, 409, await repeated.clone().text());
        assert.deepEqual(await capture(a.id), after, 'A repeated cancellation must not add audit or mutate history');
      });
      await assertFinancialHistory();
      assert.deepEqual(await capture(b.id), initial[1], 'Control B must remain completely unchanged');
      // Fixtures are intentionally owned by integration_PID_index and removed by the isolated runner.
    });
  }
});
