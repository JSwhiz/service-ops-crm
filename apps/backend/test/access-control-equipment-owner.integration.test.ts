import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { EquipmentUnitResponseDto } from '../src/modules/equipment/dto/equipment-response.dto';
import { equipmentContext } from '../src/modules/equipment/utils/equipment-policy.util';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('equipment create cannot return an unreadable card; creator facts and supported deny scopes stay consistent', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  const ruleIds = new Set<string>();
  const reset = async () => {
    await prisma.userAccessRule.deleteMany({ where: { id: { in: [...ruleIds] } } });
    ruleIds.clear();
  };
  t.after(async () => {
    try { await reset(); } finally { try { await closeApp?.(); } finally { await prisma.$disconnect(); } }
  });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'director' } });
  const marker = `equipment-owner-${randomUUID()}`;
  // Real canonical role on our own synthetic User; no Employee or holder invented.
  const actor = await prisma.user.create({ data: {
    login: marker, fullName: marker, passwordHash: template.passwordHash, isActive: true,
    roles: { create: { roleId: role.id } },
  } });
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const catalog = await prisma.equipmentCatalogItem.create({ data: {
    name: `${marker}-model`, category: 'Owner boundary fixture', createdByUserId: founder.id,
  } });
  const makeUnit = (label: string, creator = actor.id) => prisma.equipmentUnit.create({ data: {
    catalogItemId: catalog.id, inventoryNumber: `${marker}-${label}`, createdByUserId: creator,
  } });
  const a = await makeUnit('creator-A');
  const b = await makeUnit('foreign-B', founder.id);
  assert.equal(equipmentContext(a).ownerUserId, actor.id);
  assert.equal(equipmentContext(b).ownerUserId, founder.id);
  const rule = async (actionCode: string, effect: 'allow' | 'deny', scope: 'all' | 'selected' | 'own' = 'all', selectedIds: string[] = [], userId = actor.id) => {
    const saved = await prisma.userAccessRule.upsert({
      where: { userId_actionCode: { userId, actionCode } },
      create: { userId, actionCode, effect, scope, selectedIds }, update: { effect, scope, selectedIds },
    });
    ruleIds.add(saved.id);
  };
  const request = (path: string, method = 'GET', body?: unknown, session = cookie) => fetch(`${baseUrl}/api/v1/equipment${path}`, {
    method, headers: { Cookie: session, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, expected = 200): Promise<T> => {
    assert.equal(response.status, expected, await response.clone().text());
    return await response.json() as T;
  };
  const capture = async () => ({
    catalogs: await prisma.equipmentCatalogItem.findMany({ orderBy: { id: 'asc' } }),
    units: await prisma.equipmentUnit.findMany({ orderBy: { id: 'asc' } }),
    movements: await prisma.equipmentMovement.findMany({ orderBy: { id: 'asc' } }),
    audit: await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
    approvals: await prisma.approvalRequest.findMany({ where: { sourceEntityType: 'equipment_movement' }, orderBy: { id: 'asc' } }),
    attachments: await prisma.fileAttachment.findMany({ where: { entityType: 'equipment_movement' }, orderBy: { id: 'asc' } }),
  });
  const rejected = async (path: string, method = 'GET', body?: unknown) => {
    const before = await capture();
    const response = await request(path, method, body);
    assert.equal(response.status, 403, await response.text());
    assert.deepEqual(await capture(), before, 'Forbidden request must not persist a unit/movement/approval/audit/attachment');
  };
  const newUnitPayload = () => ({ catalogItemId: catalog.id, inventoryNumber: `${marker}-new-${randomUUID()}`, serialNumber: 'private serial', notes: 'private unit note' });

  for (const actionCode of ['equipment.access', 'equipment.read']) await t.test(`${actionCode} all deny defeats independent unit.create and leaves zero effects`, async (suite) => {
    suite.after(reset);
    await rule('equipment.unit.create', 'allow');
    await rule(actionCode, 'deny');
    await rejected('/units', 'POST', newUnitPayload());
    if (actionCode === 'equipment.read') {
      const before = await capture();
      const models = await json<Array<{ id: string }>>(await request('/catalog'));
      assert.ok(models.some(({ id }) => id === catalog.id), 'Unit read deny must not become catalog read deny');
      assert.deepEqual(await capture(), before);
    }
  });

  await t.test('positive create returns the same readable persisted unit and exactly one create audit', async () => {
    const before = await capture();
    const payload = newUnitPayload();
    const created = await json<EquipmentUnitResponseDto>(await request('/units', 'POST', payload), 201);
    const after = await capture();
    const persisted = after.units.find(({ id }) => id === created.id)!;
    assert.ok(persisted);
    assert.equal(persisted.createdByUserId, actor.id);
    assert.equal(created.serialNumber, payload.serialNumber);
    assert.equal(created.notes, payload.notes);
    assert.deepEqual(await json(await request(`/units/${created.id}`)), created);
    assert.equal(after.units.length, before.units.length + 1);
    assert.deepEqual(after.units.filter(({ id }) => id !== created.id), before.units);
    const events = after.audit.filter(({ id }) => !before.audit.some((row) => row.id === id));
    assert.equal(events.length, 1);
    assert.equal(events[0]!.entityId, created.id);
    assert.equal(events[0]!.actorUserId, actor.id);
    assert.equal(events[0]!.action, 'equipment.unit.created');
    for (const key of ['catalogs', 'movements', 'approvals', 'attachments'] as const) assert.deepEqual(after[key], before[key]);
  });

  await t.test('selected read of an existing ID cannot authorize the new ID; actual read regrant permits create', async (suite) => {
    suite.after(reset);
    const hrRole = await prisma.role.findUniqueOrThrow({ where: { code: 'hr' } });
    const scoped = await prisma.user.create({ data: {
      login: `${marker}-scoped`, fullName: `${marker}-scoped`, passwordHash: template.passwordHash,
      isActive: true, roles: { create: { roleId: hrRole.id } },
    } });
    const session = await loginAndGetCookieHeader({ baseUrl, login: scoped.login, password: 'manager123' });
    await rule('equipment.unit.create', 'allow', 'all', [], scoped.id);
    const withoutRead = await capture();
    const missingRead = await request('/units', 'POST', newUnitPayload(), session);
    assert.equal(missingRead.status, 403, await missingRead.text());
    assert.deepEqual(await capture(), withoutRead, 'A create grant alone cannot return an unreadable generated unit');
    await rule('equipment.read', 'allow', 'selected', [a.id], scoped.id);
    await json(await request(`/units/${a.id}`, 'GET', undefined, session));
    const before = await capture();
    const denied = await request('/units', 'POST', newUnitPayload(), session);
    assert.equal(denied.status, 403, await denied.text());
    assert.deepEqual(await capture(), before, 'Check the actual generated unit ID before create audit/commit');
    await rule('equipment.read', 'allow', 'all', [], scoped.id);
    const created = await json<EquipmentUnitResponseDto>(await request('/units', 'POST', newUnitPayload(), session), 201);
    assert.equal((await prisma.equipmentUnit.findUniqueOrThrow({ where: { id: created.id } })).createdByUserId, scoped.id);
    assert.deepEqual(await json(await request(`/units/${created.id}`, 'GET', undefined, session)), created);
    const after = await capture();
    assert.equal(after.units.length, before.units.length + 1);
    const events = after.audit.filter(({ id }) => !before.audit.some((row) => row.id === id));
    assert.equal(events.length, 1);
    assert.equal(events[0]!.entityId, created.id);
    assert.equal(events[0]!.actorUserId, scoped.id);
    assert.equal(events[0]!.action, 'equipment.unit.created');
    for (const key of ['catalogs', 'movements', 'approvals', 'attachments'] as const) assert.deepEqual(after[key], before[key]);
  });

  await t.test('raw own allows grant no unit authority, including for the actual creator', async (suite) => {
    suite.after(reset);
    const hrRole = await prisma.role.findUniqueOrThrow({ where: { code: 'hr' } });
    const scoped = await prisma.user.create({ data: {
      login: `${marker}-legacy-allow`, fullName: `${marker}-legacy-allow`, passwordHash: template.passwordHash,
      isActive: true, roles: { create: { roleId: hrRole.id } },
    } });
    const ownUnit = await makeUnit('legacy-allow-created', scoped.id);
    const session = await loginAndGetCookieHeader({ baseUrl, login: scoped.login, password: 'manager123' });
    // History has a readable-unit baseline, independently of legacy own rules.
    // Compare the actual HTTP response before installing any invalid allows.
    await rule('equipment.read', 'allow', 'all', [], scoped.id);
    const beforeHistory = await capture();
    const baselineHistory = await request(`/units/${ownUnit.id}/movements`, 'GET', undefined, session);
    const baselineHistoryBody = await json<unknown[]>(baselineHistory);
    assert.deepEqual(baselineHistoryBody, [], 'Empty fixture history must expose no movement data');
    assert.deepEqual(await capture(), beforeHistory);
    await reset();
    // Direct legacy fixture only: these scopes are not administratively valid.
    for (const code of ['equipment.access', 'equipment.read', 'equipment.broken', 'equipment.unit.delete', 'equipment.history', 'equipment.unit.create']) {
      assert.equal(ACCESS_ACTION_CATALOG.find(({ code: candidate }) => candidate === code)!.allowedScopes.includes('own'), false);
      await rule(code, 'allow', 'own', [], scoped.id);
    }
    const forbidden = async (path: string, method = 'GET', body?: unknown) => {
      const before = await capture();
      const response = await request(path, method, body, session);
      assert.equal(response.status, 403, await response.text());
      assert.deepEqual(await capture(), before, 'Unsupported own allow must not authorize business effects');
    };
    for (const unit of [ownUnit, b]) await forbidden(`/units/${unit.id}`);
    await forbidden('/units', 'POST', newUnitPayload());
    // A valid create grant still cannot bypass the unsupported read allow.
    await rule('equipment.unit.create', 'allow', 'all', [], scoped.id);
    await forbidden('/units', 'POST', newUnitPayload());
    // Isolate mutation/history leaves from the read gate: real read now works,
    // but creator metadata must not turn the remaining raw own allows into grants.
    await rule('equipment.read', 'allow', 'all', [], scoped.id);
    for (const unit of [ownUnit, b]) await json(await request(`/units/${unit.id}`, 'GET', undefined, session));
    const beforeLegacyHistory = await capture();
    const legacyHistory = await request(`/units/${ownUnit.id}/movements`, 'GET', undefined, session);
    assert.equal(legacyHistory.status, baselineHistory.status);
    assert.deepEqual(await json<unknown[]>(legacyHistory), baselineHistoryBody, 'Raw own allow must not expand baseline history visibility');
    assert.deepEqual(await capture(), beforeLegacyHistory, 'History reads must not persist unit/movement/audit effects');
    await forbidden(`/units/${ownUnit.id}/movements`, 'POST', { movementType: 'mark_broken' });
    await forbidden(`/units/${ownUnit.id}`, 'DELETE');
  });

  for (const actionCode of ['equipment.access', 'equipment.read']) await t.test(`${actionCode}: legacy own deny remains invalid/fail-closed, not a supported A-only ownership rule`, async (suite) => {
    suite.after(reset);
    assert.deepEqual(ACCESS_ACTION_CATALOG.find(({ code }) => code === actionCode)!.allowedScopes, ['selected', 'all']);
    // Deliberately invalid legacy rule on our own User only. Admin may not save
    // this scope. Do not weaken its fail-closed behavior or claim B is allowed.
    await rule(actionCode, 'deny', 'own');
    await rejected('/units', 'POST', newUnitPayload());
    for (const unit of [a, b]) {
      await rejected(`/units/${unit.id}`);
      await rejected(`/units/${unit.id}/movements`, 'POST', { movementType: 'mark_broken' });
      await rejected(`/units/${unit.id}`, 'DELETE');
    }
  });

  for (const actionCode of ['equipment.access', 'equipment.read']) await t.test(`${actionCode} selected A deny blocks creator-A mutations while foreign B remains a positive control`, async (suite) => {
    suite.after(reset);
    const control = await makeUnit(`foreign-control-${actionCode}`, founder.id);
    await rule('equipment.broken', 'allow');
    await rule('equipment.unit.delete', 'allow');
    await rule(actionCode, 'deny', 'selected', [a.id]);
    await rejected(`/units/${a.id}`);
    await rejected(`/units/${a.id}/movements`);
    await rejected(`/units/${a.id}/movements`, 'POST', { movementType: 'mark_broken' });
    await rejected(`/units/${a.id}`, 'DELETE');
    const rows = await json<EquipmentUnitResponseDto[]>(await request(`/units?search=${encodeURIComponent(marker)}`));
    assert.equal(rows.some(({ id }) => id === a.id), false);
    assert.equal(rows.some(({ id }) => id === control.id), true);
    const card = await json<EquipmentUnitResponseDto>(await request(`/units/${control.id}`));
    assert.equal(card.capabilities.canMarkBroken, true);
    const before = await capture();
    const movement = await json<{ id: string }>(await request(`/units/${control.id}/movements`, 'POST', { movementType: 'mark_broken' }), 201);
    const after = await capture();
    assert.equal(after.units.find(({ id }) => id === control.id)!.status, 'broken');
    assert.deepEqual(after.units.filter(({ id }) => id !== control.id), before.units.filter(({ id }) => id !== control.id));
    assert.equal(after.movements.length, before.movements.length + 1);
    assert.ok(after.movements.some(({ id }) => id === movement.id));
    const events = after.audit.filter(({ id }) => !before.audit.some((row) => row.id === id));
    assert.equal(events.length, 1);
    assert.equal(events[0]!.action, 'equipment.mark_broken');
    assert.equal(events[0]!.entityId, movement.id);
    assert.deepEqual(after.approvals, before.approvals);
    assert.deepEqual(after.catalogs, before.catalogs);
    assert.deepEqual(after.attachments, before.attachments);
  });

  await t.test('independent broken/delete/history leaf denies affect A DTO and mutation without suppressing writeoff or B', async (suite) => {
    suite.after(reset);
    for (const code of ['equipment.broken', 'equipment.unit.delete', 'equipment.history']) await rule(code, 'deny', 'selected', [a.id]);
    const card = await json<EquipmentUnitResponseDto>(await request(`/units/${a.id}`));
    assert.equal(card.capabilities.canMarkBroken, false);
    assert.equal(card.capabilities.canDelete, false);
    assert.equal(card.deletionState.canDelete, false);
    assert.equal(card.capabilities.canViewHistory, false);
    assert.equal(card.capabilities.canWriteoff, true, 'Independent writeoff must not inherit broken/delete/history denial');
    await rejected(`/units/${a.id}/movements`, 'POST', { movementType: 'mark_broken' });
    await rejected(`/units/${a.id}`, 'DELETE');
    await rejected(`/units/${a.id}/movements`);
    const foreign = await json<EquipmentUnitResponseDto>(await request(`/units/${b.id}`));
    assert.equal(foreign.capabilities.canMarkBroken, true);
    assert.equal(foreign.capabilities.canDelete, true);
    assert.equal(foreign.capabilities.canViewHistory, true);
    assert.deepEqual(await json(await request(`/units/${b.id}/movements`)), []);
  });
  // No execution claim. Unit scopes remain selected/all; creator metadata does
  // not enable own/assigned scopes or change parent object/order scope semantics.
});
