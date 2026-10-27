import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createCoreTestObject } from './helpers/core-fixtures';
import configuration from '../src/config/configuration';
import { configureApp } from '../src/bootstrap';
import { AuthModule } from '../src/modules/auth/auth.module';
import { RubberMatsModule } from '../src/modules/rubber-mats/rubber-mats.module';
import { replacementTotals, RubberMatAggregateService } from '../src/modules/rubber-mats/rubber-mat-aggregate.service';
import { objectDelegationContext } from '../src/modules/user-substitutions/object-delegation.context';

// The runner creates a disposable schema and drops it after this file. Never run
// the migration replay/reset portion against a shared development database.
test('aggregate rubber mats: conversion, decimal totals, revision history and access boundaries', async (t) => {
  assert.equal(process.env.TEST_ISOLATED_DATABASE, 'true', 'Use the isolated integration runner');
  const schema = new URL(process.env.DATABASE_URL!).searchParams.get('schema');
  assert.match(schema ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  const resources: { closeApp?: () => Promise<void> } = {};
  t.after(async () => { await resources.closeApp?.(); await prisma.$disconnect(); });
  const [source, target, privateObject] = await Promise.all([
    createCoreTestObject(prisma, { includeManagerAssignment: true }),
    createCoreTestObject(prisma, { includeManagerAssignment: true }),
    createCoreTestObject(prisma),
  ]);
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });

  // Re-run only the documented data conversion after simulating a pre-conversion
  // fixture. DDL and constraints must come from the parent's real migration.
  await prisma.$executeRawUnsafe('DELETE FROM "ObjectRubberMatQuantityChange"');
  await prisma.$executeRawUnsafe('DELETE FROM "ObjectRubberMatQuantity"');
  await prisma.$executeRawUnsafe('DELETE FROM "RubberMatSizeChange"');
  await prisma.$executeRawUnsafe('DELETE FROM "RubberMatSize"');
  await prisma.$executeRawUnsafe('DELETE FROM "RubberMatAggregateMigration"');
  const makeLegacy = (objectId: string | null, condition: string, lengthCm = 120, widthCm = 80) =>
    prisma.rubberMat.create({ data: { objectId, condition, lengthCm, widthCm, zone: 'Вход', createdByUserId: founder.id } });
  const [legacy] = await Promise.all([
    makeLegacy(source.objectId, 'good'), makeLegacy(source.objectId, 'worn'),
    makeLegacy(source.objectId, 'damaged'), makeLegacy(source.objectId, 'retired'),
    makeLegacy(null, 'good'), makeLegacy(source.objectId, 'good', 90, 60),
    makeLegacy(target.objectId, 'good'), makeLegacy(privateObject.objectId, 'good'),
  ]);
  await prisma.rubberMatEvent.createMany({ data: [
    { rubberMatId: legacy.id, action: 'registered', note: 'Старая регистрация', actorUserId: founder.id },
    { rubberMatId: legacy.id, action: 'assigned', toObjectId: source.objectId, toZone: 'Вход', note: 'На исходном объекте', actorUserId: founder.id },
    { rubberMatId: legacy.id, action: 'serviced', fromObjectId: source.objectId, toObjectId: source.objectId, note: 'Прежнее обслуживание', actorUserId: founder.id },
    { rubberMatId: legacy.id, action: 'moved', fromObjectId: source.objectId, toObjectId: target.objectId, note: 'Прежнее перемещение', actorUserId: founder.id },
  ] });
  const legacyBefore = await prisma.rubberMat.findMany({ orderBy: { id: 'asc' } });
  const eventsBefore = await prisma.rubberMatEvent.findMany({ orderBy: { id: 'asc' } });
  const contract = await readFile('src/modules/rubber-mats/AGGREGATE-INTEGRATION.md', 'utf8');
  const sql = contract.match(/\x60\x60\x60sql\n([\s\S]*?)\x60\x60\x60/)?.[1];
  assert.ok(sql);
  const conversion = async () => prisma.$transaction(async (tx) => {
    // PostgreSQL prepared statements accept one statement per call.
    await tx.$executeRawUnsafe(sql.slice(0, sql.indexOf('DO $$')));
    await tx.$executeRawUnsafe(sql.slice(sql.indexOf('DO $$')));
  });
  await conversion();
  await conversion();

  const moduleRef = await Test.createTestingModule({ imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [configuration] }),
    AuthModule, RubberMatsModule,
  ] }).compile();
  const app = moduleRef.createNestApplication();
  resources.closeApp = () => app.close();
  await configureApp(app);
  await app.listen(0, '127.0.0.1');
  const baseUrl = 'http://127.0.0.1:' + (app.getHttpServer().address() as { port: number }).port;
  const [founderCookie, managerCookie, outsiderCookie] = await Promise.all([
    loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'manager1', password: 'manager123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'manager2', password: 'manager123' }),
  ]);
  const request = (path: string, method = 'GET', body?: object, cookie = managerCookie) =>
    fetch(baseUrl + '/api/v1' + path, { method, headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const aggregatePath = '/objects/' + source.objectId + '/rubber-mats/aggregate';
  type Aggregate = { canManage: boolean; totalReplacementCost: string | null; knownReplacementCost: string; items: Array<{ id: string; lengthCm: number; widthCm: number; quantity: number; quantityVersion: number; replacementCost: string | null; version: number }> };
  const readAggregate = async (): Promise<Aggregate> => {
    const response = await request(aggregatePath); assert.equal(response.status, 200); return response.json() as Promise<Aggregate>;
  };
  let aggregate = await readAggregate();
  const size = aggregate.items.find((item) => item.lengthCm === 120 && item.widthCm === 80)!;
  const otherSize = aggregate.items.find((item) => item.lengthCm === 90)!;
  assert.ok(size); assert.ok(otherSize);

  await t.test('migration groups only currently assigned non-retired mats, preserves every legacy row and stays idempotent', async () => {
    assert.equal(size.quantity, 3);
    assert.equal(otherSize.quantity, 1);
    assert.ok(aggregate.items.every((item) => item.replacementCost === null));
    assert.equal(aggregate.totalReplacementCost, null);
    assert.equal(aggregate.knownReplacementCost, '0.00');
    assert.deepEqual(await prisma.rubberMat.findMany({ orderBy: { id: 'asc' } }), legacyBefore);
    assert.deepEqual(await prisma.rubberMatEvent.findMany({ orderBy: { id: 'asc' } }), eventsBefore);
    const response = await request(aggregatePath + '/history');
    assert.equal(response.status, 200);
    const history = await response.json() as Array<{ source: string; actorUserId: string | null; replacementCostSnapshot: string | null }>;
    assert.equal(history.length, 2);
    assert.ok(history.every((event) => event.source === 'legacy_migration' && event.actorUserId === null && event.replacementCostSnapshot === null));
  });

  await t.test('catalog permissions, validation, explicit zero, null and duplicate dimensions', async () => {
    assert.equal((await request('/rubber-mats/catalog', 'POST', { lengthCm: 1, widthCm: 2 })).status, 403);
    assert.equal((await request('/rubber-mats/catalog/' + size.id, 'PATCH', { version: 1, replacementCost: '10.25' })).status, 403);
    assert.equal((await request('/rubber-mats/catalog', 'POST', { lengthCm: 120, widthCm: 80, replacementCost: null }, founderCookie)).status, 409);
    for (const cost of ['-1', '1.001', 'NaN', '1000000000000']) {
      assert.equal((await request('/rubber-mats/catalog/' + size.id, 'PATCH', { version: 1, replacementCost: cost }, founderCookie)).status, 400);
    }
    assert.equal((await request('/rubber-mats/catalog/' + size.id, 'PATCH', { version: 1 }, founderCookie)).status, 400);
    const response = await request('/rubber-mats/catalog', 'POST', { lengthCm: 1, widthCm: 2, replacementCost: '0' }, founderCookie);
    assert.equal(response.status, 201);
    const created = await response.json() as { id: string; replacementCost: string };
    assert.equal(created.replacementCost, '0.00');
    const noPrice = await request('/rubber-mats/catalog', 'POST', { lengthCm: 3, widthCm: 4 }, founderCookie);
    assert.equal(noPrice.status, 201);
    assert.equal((await noPrice.json() as { replacementCost: null }).replacementCost, null);
    assert.equal((await request('/rubber-mats/catalog', 'POST', { lengthCm: 0, widthCm: 1 }, founderCookie)).status, 400);
  });

  await t.test('quantity access is object-scoped; malformed inputs and stale/concurrent writes cannot overwrite', async () => {
    assert.equal((await request('/objects/' + privateObject.objectId + '/rubber-mats/aggregate')).status, 403);
    assert.equal((await request(aggregatePath, 'GET', undefined, outsiderCookie)).status, 403);
    assert.equal((await request(aggregatePath + '/' + size.id, 'PUT', { version: 1, quantity: 5 }, outsiderCookie)).status, 403);
    for (const quantity of [-1, 1.5, null, 2147483648]) {
      assert.equal((await request(aggregatePath + '/' + size.id, 'PUT', { version: 1, quantity })).status, 400);
    }
    assert.equal((await request(aggregatePath + '/' + size.id, 'PUT', { version: 0, quantity: 5 })).status, 409);
    const writes = await Promise.all([
      request(aggregatePath + '/' + size.id, 'PUT', { version: 1, quantity: 5 }),
      request(aggregatePath + '/' + size.id, 'PUT', { version: 1, quantity: 8 }),
    ]);
    assert.deepEqual(writes.map((r) => r.status).sort(), [200, 409]);
    aggregate = await readAggregate();
    const current = aggregate.items.find((item) => item.id === size.id)!;
    assert.equal(current.quantityVersion, 2);
    const response = await request(aggregatePath + '/history');
    const events = await response.json() as Array<{ source: string; actorUserId: string | null; beforeQuantity: number; afterQuantity: number; occurredAt: string; replacementCostSnapshot: string | null }>;
    const change = events.find((event) => event.source === 'user')!;
    assert.equal(change.beforeQuantity, 3);
    assert.equal(change.afterQuantity, current.quantity);
    assert.ok(change.actorUserId); assert.ok(change.occurredAt);
    assert.equal(change.replacementCostSnapshot, null);
    await conversion();
    assert.equal((await readAggregate()).items.find((item) => item.id === size.id)?.quantityVersion, 2);
  });

  await t.test('replacement sum uses exact decimal quantity × cost, keeps unknown partial totals, and retains old snapshots', async () => {
    const costPath = '/rubber-mats/catalog/' + size.id;
    assert.equal((await request(costPath, 'PATCH', { version: 1, replacementCost: '10.25' }, founderCookie)).status, 200);
    assert.equal((await request(costPath, 'PATCH', { version: 1, replacementCost: '20' }, founderCookie)).status, 409);
    aggregate = await readAggregate();
    const quantity = aggregate.items.find((item) => item.id === size.id)!.quantity;
    assert.equal(aggregate.totalReplacementCost, null);
    assert.equal(aggregate.knownReplacementCost, new Prisma.Decimal('10.25').mul(quantity).toFixed(2));
    assert.equal((await request('/rubber-mats/catalog/' + otherSize.id, 'PATCH', { version: 1, replacementCost: '0.10' }, founderCookie)).status, 200);
    aggregate = await readAggregate();
    assert.equal(aggregate.totalReplacementCost, new Prisma.Decimal('10.25').mul(quantity).plus('0.10').toFixed(2));
    assert.equal((await request(aggregatePath + '/' + size.id, 'PUT', { version: 2, quantity: 2 })).status, 200);
    assert.equal((await readAggregate()).totalReplacementCost, '20.60');
    assert.equal((await request(costPath, 'PATCH', { version: 2, replacementCost: '100' }, founderCookie)).status, 200);
    const history = await (await request(aggregatePath + '/history')).json() as Array<{ replacementCostSnapshot: string | null; afterQuantity: number }>;
    assert.ok(history.some((event) => event.afterQuantity === 2 && event.replacementCostSnapshot === '10.25'));
    assert.ok(history.some((event) => event.replacementCostSnapshot === null));
    const costs = await (await request(costPath + '/history')).json() as Array<{ beforeCost: string | null; afterCost: string | null; actorName: string | null }>;
    assert.ok(costs.some((event) => event.beforeCost === '10.25' && event.afterCost === '100.00' && !!event.actorName));
    assert.equal((await request(costPath, 'PATCH', { version: 3, replacementCost: null }, founderCookie)).status, 200);
    assert.equal((await readAggregate()).totalReplacementCost, null);
    assert.deepEqual(replacementTotals([{ quantity: 0, replacementCost: null }]), { totalReplacementCost: '0.00', knownReplacementCost: '0.00' });
    assert.deepEqual(replacementTotals([{ quantity: 3, replacementCost: new Prisma.Decimal('0.10') }, { quantity: 2, replacementCost: new Prisma.Decimal('0.20') }]), { totalReplacementCost: '0.70', knownReplacementCost: '0.70' });
    const maxCents = 99999999999999n * 2147483647n;
    const maxTotal = String(maxCents / 100n) + '.' + String(maxCents % 100n).padStart(2, '0');
    assert.equal(replacementTotals([{ quantity: 2147483647, replacementCost: new Prisma.Decimal('999999999999.99') }]).totalReplacementCost, maxTotal);
  });

  await t.test('frozen and archived restrictions and scoped registry', async () => {
    await prisma.object.update({ where: { id: source.objectId }, data: { status: 'frozen' } });
    assert.equal((await readAggregate()).canManage, false);
    assert.equal((await request(aggregatePath + '/' + size.id, 'PUT', { version: 3, quantity: 4 })).status, 403);
    assert.equal((await request(aggregatePath + '/' + size.id, 'PUT', { version: 3, quantity: 4 }, founderCookie)).status, 200);
    await prisma.object.update({ where: { id: source.objectId }, data: { status: 'archived' } });
    assert.equal((await request(aggregatePath + '/' + size.id, 'PUT', { version: 4, quantity: 4 }, founderCookie)).status, 403);
    assert.equal((await request(aggregatePath)).status, 200);
    await prisma.object.update({ where: { id: source.objectId }, data: { status: 'active' } });
    const response = await request('/rubber-mats/aggregate?objectId=' + source.objectId, 'GET', undefined, outsiderCookie);
    assert.equal(response.status, 200);
    const page = await response.json() as { total: number; items: unknown[] };
    assert.equal(page.total, 0); assert.equal(page.items.length, 0);
    const visible = await (await request('/rubber-mats/aggregate?objectId=' + source.objectId)).json() as { total: number; items: Array<{ quantity: number; totalReplacementCost: string | null }> };
    assert.equal(visible.total, 1); assert.equal(visible.items[0].quantity, 5);
    assert.equal(visible.items[0].totalReplacementCost, null);
  });

  await t.test('delegation needs operate permission, global catalog management is not inherited, and inactive actors are denied', async () => {
    const service = moduleRef.get(RubberMatAggregateService);
    const outsider = await prisma.user.findUniqueOrThrow({ where: { login: 'manager2' } });
    const actor = { id: outsider.id, roleCode: 'manager', isActive: true };
    const grant = { substitutionId: 'test-substitution', principalUserId: founder.id, objectId: privateObject.objectId, endsAt: Date.now() + 60000, taskWideAccess: false };
    await objectDelegationContext.run({ actorUserId: outsider.id, grants: [{ ...grant, actions: ['view'] }], used: new Map() }, async () => {
      assert.equal((await service.aggregate(actor, privateObject.objectId)).canManage, false);
      await assert.rejects(service.setQuantity(actor, privateObject.objectId, size.id, { version: 1, quantity: 2 }), /Изменение количества недоступно/);
      await assert.rejects(service.createSize(actor, { lengthCm: 5, widthCm: 6 }), /Нет права управления каталогом/);
    });
    await objectDelegationContext.run({ actorUserId: outsider.id, grants: [{ ...grant, actions: ['view', 'operate'] }], used: new Map() }, async () => {
      assert.equal((await service.aggregate(actor, privateObject.objectId)).canManage, true);
      await service.setQuantity(actor, privateObject.objectId, size.id, { version: 1, quantity: 2 });
      const history = await service.quantityHistory(actor, privateObject.objectId) as Array<{ source: string; actorUserId: string | null }>;
      assert.ok(history.some((event) => event.source === 'user' && event.actorUserId === outsider.id));
    });
    await assert.rejects(service.catalog({ ...actor, isActive: false }), /Активный пользователь/);
    await assert.rejects(service.aggregate({ ...actor, isActive: false }, source.objectId), /Активный пользователь/);
    const deputy = { id: founder.id, roleCode: 'deputy_director', isActive: true };
    assert.equal((await service.catalog(deputy)).canManage, true);
    await prisma.object.update({ where: { id: source.objectId }, data: { status: 'frozen' } });
    await assert.rejects(service.setQuantity(deputy, source.objectId, size.id, { version: 4, quantity: 4 }), /Изменение количества недоступно/);
    await prisma.object.update({ where: { id: source.objectId }, data: { status: 'active' } });
  });

  await t.test('legacy reads/history retain scope and mutations explicitly return 410 without changing history', async () => {
    const sourcePath = '/objects/' + source.objectId + '/rubber-mats';
    const privatePath = '/objects/' + privateObject.objectId + '/rubber-mats';
    assert.equal((await request(sourcePath)).status, 200);
    assert.equal((await request(privatePath)).status, 403);
    assert.equal((await request(sourcePath, 'GET', undefined, outsiderCookie)).status, 403);
    const sourceHistory = await (await request(sourcePath + '/' + legacy.id + '/history')).json() as Array<{ action: string; fromObjectId: string | null; toObjectId: string | null }>;
    assert.ok(sourceHistory.some((event) => event.action === 'serviced'));
    assert.ok(sourceHistory.every((event) => event.fromObjectId === null || event.fromObjectId === source.objectId));
    assert.ok(sourceHistory.every((event) => event.toObjectId === null || event.toObjectId === source.objectId));
    // A visible object with no relation to this mat cannot see its registered event.
    const unrelated = await createCoreTestObject(prisma, { includeManagerAssignment: true });
    assert.equal((await request('/objects/' + unrelated.objectId + '/rubber-mats/' + legacy.id + '/history')).status, 404);
    assert.equal((await request(sourcePath + '/' + legacy.id, 'PATCH', { condition: 'worn', note: 'Старое изменение' })).status, 410);
    assert.equal((await request(sourcePath + '/' + legacy.id + '/service', 'POST', { note: 'Старое обслуживание' })).status, 410);
    assert.equal((await request(sourcePath + '/' + legacy.id + '/assign', 'POST', { zone: 'Вход', note: 'Старое назначение' })).status, 410);
    assert.equal((await request(sourcePath + '/' + legacy.id + '/return-to-stock', 'POST', { note: 'Старый возврат' })).status, 410);
    assert.equal((await request(sourcePath + '/' + legacy.id + '/move', 'POST', { targetObjectId: privateObject.objectId, zone: 'Вход', note: 'Недопустимое перемещение' })).status, 403);
    assert.equal((await request(sourcePath + '/' + legacy.id + '/move', 'POST', { targetObjectId: target.objectId, zone: 'Вход', note: 'Старое перемещение' })).status, 410);
    assert.equal((await request('/rubber-mats', 'POST', { lengthCm: 1, widthCm: 2, note: 'Старая регистрация' }, founderCookie)).status, 410);
    assert.equal((await request('/rubber-mats', 'POST', { lengthCm: 1, widthCm: 2, note: 'Не разрешено' })).status, 403);
    const hidden = await (await request('/rubber-mats?objectId=' + source.objectId, 'GET', undefined, outsiderCookie)).json() as { total: number };
    assert.equal(hidden.total, 0);
    assert.deepEqual(await prisma.rubberMat.findMany({ orderBy: { id: 'asc' } }), legacyBefore);
    assert.deepEqual(await prisma.rubberMatEvent.findMany({ orderBy: { id: 'asc' } }), eventsBefore);
  });
});
