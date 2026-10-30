import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { ExecutionContext, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import {
  normalizeObjectSetup, normalizeObjectSetupFields, normalizeObjectSetupPatch,
  OBJECT_SETUP_BUDGET_CATEGORIES, ObjectSetupDto, PatchObjectSetupDto,
  type ObjectSetupBudget, type ObjectSetupResponseDto,
} from '../src/modules/objects/dto/object-setup.dto';
import { ObjectSetupController } from '../src/modules/objects/object-setup.controller';
import {
  createInTransaction, ObjectSetupService, objectSetupMonthlyPlan,
  type ObjectSetupActor,
} from '../src/modules/objects/object-setup.service';
import { moscowMonthWindow } from '../src/modules/objects/utils/object-season.util';
import { PrismaService } from '../src/modules/prisma/prisma.service';

const line = (input: Partial<ObjectSetupBudget> = {}): ObjectSetupBudget => ({
  category: 'windows', amount: null, period: 'monthly',
  monthlyAllocation: null, targetMonth: null, plannedOccurrences: null,
  label: null, notes: null, ...input,
});

test('setup normalizers preserve null/omission, reject JSON extras and calendar/money errors', () => {
  assert.ok(Object.values(normalizeObjectSetup()).every((value) => value === null));
  assert.deepEqual(normalizeObjectSetupFields({ legalName: '  ООО Объект  ', areaSqM: 0 }), { legalName: 'ООО Объект', areaSqM: 0 });
  assert.deepEqual(normalizeObjectSetupPatch({ expectedVersion: 0, coefficient: null }), { expectedVersion: 0, changes: { coefficient: null } });
  assert.equal(normalizeObjectSetup({ plannedLaunchDate: '2028-02-29' }).plannedLaunchDate, '2028-02-29');
  for (const input of [
    null, [], { counterpartyId: randomUUID() }, { legalName: ' ' },
    { legalName: 'a'.repeat(301) }, { legalName: 'secret\u0000' },
    { plannedLaunchDate: '2026-02-29' }, { contractEndsOn: '2026-04-31' },
    { contractStartsOn: '2026-12-01', contractEndsOn: '2026-01-01' },
    { contractMonthlyAmount: 1.001 }, { contractMonthlyAmount: '10' },
    { contractMonthlyAmount: -1 }, { contractMonthlyAmount: Infinity },
    { contractMonthlyAmount: 1000000000000 }, { areaSqM: 0.001 },
    { coefficient: 0.00001 }, { coefficient: -1 }, { salesResponsibleUserId: 'employee-name' },
    { budgets: [line({ notes: 'a'.repeat(2001) })] },
    { budgets: [{ ...line(), actualAmount: 0 }] },
    { budgets: [line(), line()] }, { budgets: [line({ category: 'made_up' as never })] },
    { budgets: [line({ period: 'once' })] },
    { budgets: [line({ period: 'once', targetMonth: '2026-13' })] },
    { budgets: [line({ targetMonth: '2026-10' })] },
    { budgets: [line({ category: 'payroll', plannedOccurrences: 2 })] },
    { budgets: [line({ plannedOccurrences: 1.5 })] },
  ]) assert.throws(() => normalizeObjectSetup(input), { status: 400 });
  for (const input of [{}, { expectedVersion: null, legalName: 'a' }, { expectedVersion: -1, legalName: 'a' }, { expectedVersion: 0 }, { expectedVersion: 0, data: {} }]) {
    assert.throws(() => normalizeObjectSetupPatch(input), { status: 400 });
  }
  assert.throws(() => normalizeObjectSetup({ expectedVersion: 0 }), { status: 400 });
  const old = normalizeObjectSetup({ contractMonthlyAmount: 12345.67, coefficient: 1.2, contractStartsOn: '2026-10-01' });
  const { changes } = normalizeObjectSetupPatch({ expectedVersion: 1, legalName: 'New', contractEndsOn: null });
  assert.equal(normalizeObjectSetup({ ...old, ...changes }).contractMonthlyAmount, 12345.67);
  assert.equal(normalizeObjectSetup({ ...old, ...changes }).coefficient, 1.2);
  assert.throws(() => normalizeObjectSetup({ ...old, contractEndsOn: '2026-09-30' }), { status: 400 });
});

test('all workbook categories, annual allocations and occurrence/month attribution are explicit', () => {
  const rows = OBJECT_SETUP_BUDGET_CATEGORIES.map((category) => line({ category }));
  assert.equal(normalizeObjectSetup({ budgets: rows }).budgets?.length, 11);
  for (const category of ['windows', 'carpets', 'deep_cleaning', 'waste_removal', 'equipment'] as const) {
    const row = line({ category, amount: 12.34, period: 'per_occurrence', plannedOccurrences: 3 });
    assert.equal(objectSetupMonthlyPlan(row, 9, '2026-10'), 37.02);
    assert.equal(objectSetupMonthlyPlan({ ...row, plannedOccurrences: null }, 9, '2026-10'), null);
    assert.equal(objectSetupMonthlyPlan({ ...row, plannedOccurrences: 0 }, 9, '2026-10'), 0);
  }
  const once = line({ period: 'once', amount: 123, targetMonth: '2026-11' });
  assert.equal(objectSetupMonthlyPlan(once, 9, '2026-10'), null);
  assert.equal(objectSetupMonthlyPlan(once, 10, '2026-11'), 123);
  const annual = line({ period: 'annual', amount: 1200 });
  assert.equal(objectSetupMonthlyPlan(annual, 9, '2026-10'), 100);
  assert.equal(objectSetupMonthlyPlan({ ...annual, amount: 100 }, 9, '2026-10'), 8.33);
  const allocation = Array<number | null>(12).fill(null); allocation[9] = 123.45;
  assert.equal(objectSetupMonthlyPlan({ ...annual, monthlyAllocation: allocation }, 9, '2026-10'), 123.45);
  assert.equal(objectSetupMonthlyPlan({ ...annual, monthlyAllocation: allocation }, 10, '2026-11'), null);
  assert.doesNotThrow(() => normalizeObjectSetup({ budgets: [line({ ...annual, amount: 1.2, monthlyAllocation: Array(12).fill(0.1) })] }));
  for (const row of [
    line({ monthlyAllocation: Array(12).fill(0) }),
    line({ ...annual, monthlyAllocation: [] }),
    line({ ...annual, monthlyAllocation: Array(12).fill(99) }),
    line({ ...annual, monthlyAllocation: Array(12).fill(101) }),
    line({ ...annual, amount: null, monthlyAllocation: Array(12).fill(1) }),
  ]) assert.throws(() => normalizeObjectSetup({ budgets: [row] }), { status: 400 });
});

test('DTO whitelist retains omission and nullable nested budgets while rejecting unknown outer keys', async () => {
  const dto = plainToInstance(PatchObjectSetupDto, { expectedVersion: 0, legalName: null, budgets: [{ category: 'carpets', amount: null, period: 'annual' }] });
  assert.deepEqual(await validate(dto, { whitelist: true, forbidNonWhitelisted: true }), []);
  assert.deepEqual(normalizeObjectSetupPatch(dto).changes.budgets, [line({ category: 'carpets', period: 'annual' })]);
  const empty = plainToInstance(ObjectSetupDto, {});
  assert.deepEqual(normalizeObjectSetupFields(empty), {});
  const extra = plainToInstance(PatchObjectSetupDto, { expectedVersion: 0, unknown: true });
  assert.ok((await validate(extra, { whitelist: true, forbidNonWhitelisted: true })).length);
});

const isolated = process.env.TEST_ISOLATED_DATABASE === 'true';
test('object setup HTTP and PostgreSQL transaction integration', { skip: !isolated ? 'Requires isolated local integration runner' : false }, async (t) => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Local database only');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_[a-zA-Z0-9_]+$/, 'Dedicated integration schema required');
  const prisma = new PrismaService();
  t.after(() => prisma.$disconnect());
  const service = new ObjectSetupService(prisma);
  const actors: Record<string, ObjectSetupActor> = {};
  for (const roleCode of ['founder', 'director', 'deputy_founder', 'corporate_director', 'deputy_director', 'manager', 'outsider', 'hr']) {
    const user = await prisma.user.create({ data: { login: `setup-${roleCode}-${randomUUID()}`, fullName: roleCode } });
    actors[roleCode] = { id: user.id, roleCode, isActive: true, permissionCodes: roleCode === 'hr' ? ['objects.view_hr'] : [] };
  }
  const founder = actors.founder;
  const object = await prisma.object.create({ data: {
    name: 'Setup integration', address: 'Москва', status: 'active', createdByUserId: founder.id,
    assignments: { create: { userId: actors.manager.id, assignmentRoleCode: 'manager', isActive: true } },
  } });
  const module = await Test.createTestingModule({
    controllers: [ObjectSetupController],
    providers: [{ provide: ObjectSetupService, useValue: service }],
  }).overrideGuard(JwtAuthGuard).useValue({
    canActivate(context: ExecutionContext) {
      const request = context.switchToHttp().getRequest();
      const actor = actors[request.headers['x-test-user']];
      if (!actor) throw new UnauthorizedException();
      request.user = actor;
      return true;
    },
  }).compile();
  const app = module.createNestApplication();
  t.after(() => app.close());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  const base = `http://127.0.0.1:${address.port}/objects/${object.id}/setup`;
  const api = (actor = 'founder', payload?: unknown) => fetch(base, {
    method: payload === undefined ? 'GET' : 'PATCH',
    headers: { 'x-test-user': actor, 'Content-Type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const json = async (response: Response): Promise<ObjectSetupResponseDto> => {
    assert.equal(response.status, 200, await response.clone().text());
    return response.json() as Promise<ObjectSetupResponseDto>;
  };
  let saved: ObjectSetupResponseDto;

  await t.test('missing record reads null without creating setup, timesheets or audit', async () => {
    const before = await prisma.auditEvent.count({ where: { entityId: object.id } });
    saved = await json(await api());
    assert.equal(saved.version, 0);
    assert.ok(Object.values(saved.data).every((value) => value === null));
    assert.equal(await prisma.objectSetup.count({ where: { objectId: object.id } }), 0);
    assert.equal(await prisma.timesheetMonth.count({ where: { objectId: object.id } }), 0);
    assert.equal(await prisma.auditEvent.count({ where: { entityId: object.id } }), before);
    assert.equal((await api('unknown')).status, 401);
    assert.equal((await api('outsider')).status, 404);
    assert.equal((await api('hr')).status, 200);
  });

  await t.test('leadership contract visibility is separate from budgets and permission-only coefficient', async () => {
    saved = await json(await api('founder', { expectedVersion: 0, legalName: ' ООО Независимое ', contractMonthlyAmount: 12345.67, contractStartsOn: '2026-01-01', budgets: [line({ category: 'payroll', amount: 1000 })] }));
    assert.equal(saved.version, 1);
    assert.equal(saved.data.legalName, 'ООО Независимое');
    assert.equal(saved.budgets.rows.find((row) => row.category === 'payroll')?.actualAmount, null);
    assert.equal((await prisma.object.findUniqueOrThrow({ where: { id: object.id } })).counterpartyId, null);
    for (const role of ['founder', 'director', 'deputy_founder', 'corporate_director']) {
      assert.equal((await json(await api(role))).data.contractMonthlyAmount, 12345.67);
    }
    for (const role of ['manager', 'deputy_director', 'hr']) {
      const read = await json(await api(role));
      assert.equal(read.data.contractMonthlyAmount, null);
      assert.equal(read.capabilities.canViewContractAmount, false);
      assert.equal((await api(role, { expectedVersion: saved.version, contractMonthlyAmount: null })).status, 403);
    }
    for (const role of ['deputy_founder', 'corporate_director', 'deputy_director', 'manager']) {
      assert.equal((await api(role, { expectedVersion: saved.version, budgets: [] })).status, 403);
    }
    assert.equal((await api('founder', { expectedVersion: saved.version, coefficient: 1.25 })).status, 403);
    actors.manager.permissionCodes = ['object.coefficient_edit', 'object.budget_edit'];
    saved = await json(await api('manager', { expectedVersion: saved.version, coefficient: 1.25 }));
    assert.equal(saved.data.contractMonthlyAmount, null);
    assert.equal(saved.data.coefficient, 1.25);
    assert.equal((await json(await api())).data.contractMonthlyAmount, 12345.67);
    saved = await json(await api('manager', { expectedVersion: saved.version, budgets: [line({ category: 'payroll', amount: null })] }));
    assert.equal((await api('manager', { expectedVersion: saved.version, legalName: 'Forged', coefficient: 2 })).status, 403);
    assert.equal((await json(await api())).data.coefficient, 1.25);
    actors.outsider.permissionCodes = ['object.coefficient_edit', 'object.budget_edit'];
    assert.equal((await api('outsider', { expectedVersion: saved.version, coefficient: 2 })).status, 404);
    const hr = await json(await api('hr'));
    assert.equal(hr.data.budgets, null); assert.equal(hr.data.coefficient, null);
    assert.equal(hr.budgets.consumablesActualAmount, null); assert.deepEqual(hr.budgets.rows, []);
  });

  await t.test('version lock serializes first saves and concurrent patches; validation and audit are atomic', async () => {
    const version = saved.version;
    const results = await Promise.all([api('founder', { expectedVersion: version, legalName: 'Concurrent A' }), api('founder', { expectedVersion: version, legalName: 'Concurrent B' })]);
    assert.deepEqual(results.map((response) => response.status).sort(), [200, 409]);
    saved = await json(results.find((response) => response.status === 200)!);
    const auditCount = await prisma.objectAuditLog.count({ where: { objectId: object.id } });
    for (const changes of [
      { contractEndsOn: '2025-12-31' }, { contractMonthlyAmount: 1.001 },
      { unknown: true }, { salesResponsibleUserId: actors.outsider.id, budgets: [{ ...line(), injected: true }] },
      { salesResponsibleUserId: randomUUID() },
    ]) assert.equal((await api('founder', { expectedVersion: saved.version, ...changes })).status, 400);
    assert.equal(await prisma.objectAuditLog.count({ where: { objectId: object.id } }), auditCount);
    assert.equal((await json(await api())).version, saved.version);
    const firstObject = await prisma.object.create({ data: { name: 'Concurrent first save', address: 'Test', status: 'active', createdByUserId: founder.id } });
    const first = await Promise.allSettled([
      service.patchSetup(founder, firstObject.id, { expectedVersion: 0, legalName: 'A' }),
      service.patchSetup(founder, firstObject.id, { expectedVersion: 0, legalName: 'B' }),
    ]);
    assert.equal(first.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = first.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    assert.equal(rejected.reason.status, 409);
  });

  await t.test('active User reference and explicit clearing; archived/frozen/inactive boundaries', async () => {
    await prisma.user.update({ where: { id: actors.outsider.id }, data: { isActive: false } });
    assert.equal((await api('founder', { expectedVersion: saved.version, salesResponsibleUserId: actors.outsider.id })).status, 400);
    saved = await json(await api('founder', { expectedVersion: saved.version, salesResponsibleUserId: actors.manager.id, contractEndsOn: null }));
    saved = await json(await api('founder', { expectedVersion: saved.version, salesResponsibleUserId: null }));
    assert.equal(saved.data.salesResponsibleUserId, null);
    await prisma.object.update({ where: { id: object.id }, data: { status: 'frozen' } });
    assert.equal((await api('corporate_director', { expectedVersion: saved.version, legalName: 'Frozen' })).status, 403);
    assert.equal((await api('manager', { expectedVersion: saved.version, coefficient: 2 })).status, 403);
    saved = await json(await api('founder', { expectedVersion: saved.version, legalName: 'Frozen override' }));
    await prisma.object.update({ where: { id: object.id }, data: { status: 'archived' } });
    assert.equal((await api('founder', { expectedVersion: saved.version, legalName: 'Archived' })).status, 403);
    assert.equal((await json(await api())).capabilities.canEditCore, false);
    actors.founder.isActive = false;
    assert.equal((await api()).status, 403);
    actors.founder.isActive = true;
    await prisma.object.update({ where: { id: object.id }, data: { status: 'active' } });
  });

  await t.test('restricted snapshots preserve old money; public audit has no secret values', async () => {
    const publicRows = await prisma.objectAuditLog.findMany({ where: { objectId: object.id } });
    const publicText = JSON.stringify(publicRows);
    assert.ok(!publicText.includes('12345.67'));
    assert.ok(!publicText.includes('1.25'));
    assert.ok(publicText.includes('contractMonthlyAmount'));
    const snapshots = await prisma.auditEvent.findMany({ where: { entityType: 'object_setup', entityId: object.id } });
    assert.equal(snapshots.length, publicRows.length);
    assert.ok(snapshots.some((row) => (row.newValues as any).contractMonthlyAmount === 12345.67));
    assert.ok(snapshots.some((row) => (row.oldValues as any).coefficient === 1.25));
    saved = await json(await api('founder', { expectedVersion: saved.version, contractMonthlyAmount: null }));
    assert.equal(saved.data.contractMonthlyAmount, null);
    assert.ok(await prisma.auditEvent.findFirst({ where: { entityType: 'object_setup', entityId: object.id, metadata: { path: ['version'], equals: saved.version } } }));
  });

  await t.test('plan/fact sources use saved snapshots, no fake category totals or implicit monthlyBudget', async () => {
    const { month, start } = moscowMonthWindow();
    const [year, monthNumber] = month.split('-').map(Number);
    await prisma.objectPlanningSettings.create({ data: { objectId: object.id, monthlyBudget: 777 } });
    const employee = await prisma.employee.create({ data: { fullName: 'Historical employee', employmentStatus: 'inactive' } });
    await prisma.timesheetMonth.create({ data: {
      objectId: object.id, year, month: monthNumber,
      rows: { create: { employeeId: employee.id, employeeNameSnapshot: employee.fullName,
        entries: { create: [{ dayOfMonth: 1, dayValue: 300, autoValue: 999 }, { dayOfMonth: 2, dayValue: 0, autoValue: 999 }] } } },
    } });
    const inventoryItem = await prisma.inventoryItem.create({ data: { name: 'Item', category: 'cleaning', unit: 'pcs', createdByUserId: founder.id } });
    const order = await prisma.oneTimeOrder.create({ data: { title: 'Linked order', executionAddress: 'Test', contactName: 'Client', status: 'in_progress', agreedSum: 0, createdByUserId: founder.id, linkedObjectId: object.id } });
    const movement = { inventoryItemId: inventoryItem.id, quantity: 1, unitPriceSnapshot: 100, createdByUserId: founder.id, createdAt: new Date(start.getTime() + 1000) };
    await prisma.inventoryMovement.createMany({ data: [
      { ...movement, movementType: 'issue_to_object', relatedObjectId: object.id, totalAmountSnapshot: 100 },
      { ...movement, movementType: 'return', relatedObjectId: object.id, totalAmountSnapshot: 20 },
      { ...movement, movementType: 'issue_to_one_time_order', relatedOneTimeOrderId: order.id, totalAmountSnapshot: 50 },
      { ...movement, movementType: 'issue_to_object', relatedObjectId: object.id, totalAmountSnapshot: 999, requiresApprovalBridge: true },
      { ...movement, movementType: 'issue_to_object', relatedObjectId: object.id, totalAmountSnapshot: 999, status: 'cancelled' },
      { ...movement, movementType: 'issue_to_object', relatedObjectId: object.id, totalAmountSnapshot: 999, createdAt: new Date(start.getTime() - 1) },
    ] });
    saved = await json(await api('founder', { expectedVersion: saved.version, budgets: [
      line({ category: 'payroll', amount: 5000 }),
      line({ category: 'consumables_cleaning', amount: 100 }),
      line({ category: 'consumables_household', amount: 200 }),
      line({ category: 'carpets', period: 'per_occurrence', amount: 100, plannedOccurrences: 2 }),
      line({ category: 'equipment', period: 'once', amount: 123, targetMonth: year + '-01' }),
    ] }));
    assert.equal(saved.budgets.consumablesActualAmount, 130);
    const byCategory = Object.fromEntries(saved.budgets.rows.map((row) => [row.category, row]));
    assert.equal(byCategory.payroll.actualAmount, 300);
    for (const category of ['consumables_cleaning', 'consumables_household', 'carpets', 'equipment']) {
      assert.equal(byCategory[category].actualAmount, null); assert.ok(byCategory[category].source);
    }
    assert.equal(byCategory.carpets.planAmount, 200);
    assert.equal((await prisma.objectPlanningSettings.findUniqueOrThrow({ where: { objectId: object.id } })).monthlyBudget?.toNumber(), 777);
    assert.equal(await prisma.timesheetMonth.count({ where: { objectId: object.id } }), 1);
    await prisma.timesheetDayEntry.updateMany({ where: { row: { timesheetMonth: { objectId: object.id } } }, data: { dayValue: 0 } });
    const savedZero = await json(await api());
    assert.equal(savedZero.budgets.rows.find((row) => row.category === 'payroll')?.actualAmount, 0);
  });

  await t.test('create helper runs before assignments and rolls back object/setup/audits on failure', async () => {
    const create = (id: string) => ({ id, name: 'Atomic create', address: 'Test', status: 'active', createdByUserId: founder.id });
    const id = randomUUID();
    await prisma.$transaction(async (tx) => {
      await tx.object.create({ data: create(id) });
      const result = await createInTransaction(tx, founder, id, { legalName: 'Atomic', contractMonthlyAmount: 100 });
      assert.equal(result?.version, 1);
    });
    assert.equal((await service.getSetup(founder, id)).data.contractMonthlyAmount, 100);
    for (const input of [{ coefficient: 2 }, { contractMonthlyAmount: 0.001 }, { unknown: true }]) {
      const failedId = randomUUID();
      await assert.rejects(prisma.$transaction(async (tx) => {
        await tx.object.create({ data: create(failedId) });
        await createInTransaction(tx, founder, failedId, input);
      }));
      assert.equal(await prisma.object.count({ where: { id: failedId } }), 0);
      assert.equal(await prisma.objectSetup.count({ where: { objectId: failedId } }), 0);
      assert.equal(await prisma.auditEvent.count({ where: { entityId: failedId } }), 0);
    }
    const emptyId = randomUUID();
    await prisma.$transaction(async (tx) => {
      await tx.object.create({ data: create(emptyId) });
      assert.equal((await createInTransaction(tx, founder, emptyId, {}))?.version, 1);
    });
    assert.ok(Object.values((await service.getSetup(founder, emptyId)).data).every((value) => value === null));
    await assert.rejects(prisma.$transaction((tx) => createInTransaction(tx, founder, id, {})), { status: 409 });
    await assert.rejects(prisma.$transaction((tx) => createInTransaction(tx, actors.manager, id, {})), { status: 403 });
    const rolledBackId = randomUUID();
    await assert.rejects(prisma.$transaction(async (tx) => {
      await tx.object.create({ data: create(rolledBackId) });
      await createInTransaction(tx, founder, rolledBackId, { contractMonthlyAmount: 456 });
      assert.equal(await tx.auditEvent.count({ where: { entityId: rolledBackId } }), 1);
      throw new Error('Later object-create part failed');
    }), /Later object-create part failed/);
    assert.equal(await prisma.object.count({ where: { id: rolledBackId } }), 0);
    assert.equal(await prisma.objectSetup.count({ where: { objectId: rolledBackId } }), 0);
    assert.equal(await prisma.objectAuditLog.count({ where: { objectId: rolledBackId } }), 0);
    assert.equal(await prisma.auditEvent.count({ where: { entityId: rolledBackId } }), 0);
    await prisma.object.update({ where: { id: object.id }, data: { deletedAt: new Date() } });
    assert.equal((await api()).status, 404);
  });
});
