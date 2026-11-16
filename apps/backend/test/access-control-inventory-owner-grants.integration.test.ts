import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';

import type { InventoryItemResponseDto } from '../src/modules/inventory/dto/inventory-item-response.dto';
import { canAccessInventory, canManageInventoryCatalog } from '../src/modules/inventory/utils/inventory-access.util';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import type { AccessChange, AccessSubject } from '../src/modules/users-access/types/access-policy.type';
import { decideAccess, hasModuleDeny } from '../src/modules/users-access/utils/access-policy.util';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

// Historical filename only: inventory supports selected/all, NOT own/assigned.
// Main executes serially against its disposable schema. No role changes, source
// assignments, money operations, positive own rules or approval-lock changes.
test('inventory generated cards require positive read access before item and audit commit', { timeout: 180_000 }, async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const db = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(db.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(db.hostname));
  assert.equal(db.port, '55432');
  assert.match(db.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.MINIO_ENDPOINT ?? ''));
  assert.equal(process.env.MINIO_USE_SSL, 'false');
  for (const code of ['inventory.access', 'inventory.read']) {
    assert.deepEqual(ACCESS_ACTION_CATALOG.find(action => action.code === code)?.allowedScopes, ['selected', 'all']);
  }
  assert.deepEqual(ACCESS_ACTION_CATALOG.find(action => action.code === 'inventory.catalog.create')?.allowedScopes, ['all']);
  const prisma = new PrismaClient();
  const lifecycle: { close?: () => Promise<void> } = {};
  t.after(async () => { try { await lifecycle.close?.(); } finally { await prisma.$disconnect(); } });
  const { app, baseUrl } = await createTestApp(); lifecycle.close = () => app.close();
  const marker = `inventory-generated-read-${randomUUID()}`;
  const actor = await prisma.user.findUniqueOrThrow({ where: { login: 'hr1' } });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const identity = () => prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { id: true, login: true, isActive: true,
    roles: { orderBy: { roleId: 'asc' }, select: { roleId: true, role: { select: { code: true } } } },
    permissions: { orderBy: { permissionId: 'asc' }, select: { permissionId: true } } } });
  const initialIdentity = await identity();
  const roles = initialIdentity.roles.map(({ role }) => role.code);
  assert.deepEqual(roles, ['hr']);
  assert.equal(canAccessInventory(roles), false);
  assert.equal(canManageInventoryCatalog(roles), false);
  assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id } }), 0);
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'hr123' });
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: founder.login, password: 'founder123' });
  const request = (path: string, method = 'GET', body?: unknown, session = cookie) => fetch(`${baseUrl}/api/v1${path}`, {
    method, redirect: 'error', headers: { Cookie: session, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(25_000),
  });
  const json = async <T,>(response: Response, status = 200): Promise<T> => {
    const text = await response.text(); assert.equal(response.status, status, text); return JSON.parse(text) as T;
  };
  const capture = async () => ({
    items: await prisma.inventoryItem.findMany({ orderBy: { id: 'asc' } }),
    movements: await prisma.inventoryMovement.findMany({ orderBy: { id: 'asc' } }),
    approvals: await prisma.approvalRequest.findMany({ orderBy: { id: 'asc' } }),
    audit: await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
    notifications: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
    messages: await prisma.chatMessage.findMany({ orderBy: { id: 'asc' } }), identity: await identity(),
  });
  const access = async () => ({
    version: (await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { accessVersion: true } })).accessVersion,
    rules: await prisma.userAccessRule.findMany({ where: { userId: actor.id }, select: { actionCode: true, effect: true, scope: true, selectedIds: true }, orderBy: { actionCode: 'asc' } }),
    audit: await prisma.userAccessAudit.findMany({ where: { userId: actor.id }, orderBy: { id: 'asc' } }),
  });
  const change = (actionCode: string, effect: AccessChange['effect'], scope: 'all' | 'selected' = 'all', selectedIds: string[] = []): AccessChange => {
    const definition = ACCESS_ACTION_CATALOG.find(action => action.code === actionCode);
    assert.equal(definition?.manageable, true); assert.ok(definition?.allowedScopes.includes(scope));
    assert.equal(selectedIds.length > 0, scope === 'selected');
    return { actionCode, effect, scope, ...(scope === 'selected' ? { selectedIds: [...selectedIds].sort() } : {}) };
  };
  const admin = async (changes: AccessChange[]) => {
    const before = await capture(), state = await access();
    const endpoint = `/users-access/admin/users/${actor.id}`;
    const normalized = [...changes].sort((a, b) => a.actionCode.localeCompare(b.actionCode)).map(entry => ({ ...entry, selectedIds: entry.selectedIds ?? [] }));
    const payload = { expectedVersion: state.version, reason: marker, changes };
    const preview = await json<{ previewToken: string; previewHash: string; changes: AccessChange[] }>(await request(`${endpoint}/preview`, 'POST', payload, founderCookie), 201);
    assert.deepEqual(preview.changes, normalized);
    assert.deepEqual(await capture(), before);
    const saved = await json<{ accessVersion: number }>(await request(`${endpoint}/save`, 'POST', { ...payload, previewToken: preview.previewToken, previewHash: preview.previewHash }, founderCookie), 201);
    const after = await access();
    assert.equal(saved.accessVersion, state.version + 1); assert.equal(after.version, saved.accessVersion);
    const expected = new Map(state.rules.map(entry => [entry.actionCode, entry]));
    for (const entry of normalized) {
      if (entry.effect === 'default') expected.delete(entry.actionCode); else expected.set(entry.actionCode, { ...entry });
    }
    assert.deepEqual(after.rules, [...expected.values()].sort((a, b) => a.actionCode.localeCompare(b.actionCode)));
    const audits = after.audit.filter(entry => !state.audit.some(({ id }) => id === entry.id));
    assert.equal(audits.length, 1);
    assert.deepEqual(after.audit.filter(entry => state.audit.some(({ id }) => id === entry.id)), state.audit);
    assert.equal(audits[0].actorUserId, founder.id); assert.equal(audits[0].userId, actor.id);
    assert.equal(audits[0].versionBefore, state.version); assert.equal(audits[0].versionAfter, saved.accessVersion);
    assert.equal(audits[0].reason, marker); assert.equal(audits[0].previewHash, preview.previewHash);
    assert.deepEqual(audits[0].changes, normalized); assert.deepEqual(audits[0].before, state.rules); assert.deepEqual(audits[0].after, after.rules);
    const consumed = await prisma.userAccessPreview.findUniqueOrThrow({ where: { tokenHash: createHash('sha256').update(JSON.stringify(preview.previewToken)).digest('hex') } });
    assert.ok(consumed.usedAt); assert.equal(consumed.userId, actor.id); assert.equal(consumed.actorUserId, founder.id);
    assert.deepEqual(await capture(), before, 'Admin grant changes ACL only; business rows and identity are unchanged');
  };
  const reset = async () => {
    const state = await access();
    if (state.rules.length) await admin(state.rules.map(rule => change(rule.actionCode, 'default', rule.scope as 'all' | 'selected', rule.selectedIds)));
  };
  const input = (label: string) => ({ name: `${marker}-${label}`, category: marker, unit: 'шт' });
  const denied = async (path: string, method = 'GET', body?: unknown, status = 403) => {
    const before = await capture();
    const response = await request(path, method, body); const text = await response.text();
    assert.deepEqual(await capture(), before, 'Denied request has zero item/stock/approval/audit/notification/chat effects');
    assert.equal(response.status, status, text);
  };
  const createExactlyOne = async (label: string) => {
    const before = await capture();
    const created = await json<InventoryItemResponseDto>(await request('/inventory/items', 'POST', input(label)), 201);
    const after = await capture();
    const rows = after.items.filter(item => !before.items.some(({ id }) => id === item.id));
    assert.equal(rows.length, 1); assert.equal(rows[0].id, created.id); assert.equal(rows[0].createdByUserId, actor.id);
    assert.deepEqual(after.items.filter(item => before.items.some(({ id }) => id === item.id)), before.items);
    const audits = after.audit.filter(event => !before.audit.some(({ id }) => id === event.id));
    assert.equal(audits.length, 1); assert.equal(audits[0].action, 'inventory.item.created');
    assert.equal(audits[0].entityType, 'inventory_item'); assert.equal(audits[0].entityId, created.id); assert.equal(audits[0].actorUserId, actor.id);
    assert.deepEqual(after.audit.filter(event => before.audit.some(({ id }) => id === event.id)), before.audit);
    for (const key of ['movements', 'approvals', 'notifications', 'messages', 'identity'] as const) assert.deepEqual(after[key], before[key]);
    assert.equal(created.currentStock, 0);
    assert.equal((await json<InventoryItemResponseDto>(await request(`/inventory/items/${created.id}`))).id, created.id);
    return created;
  };
  const a = await json<InventoryItemResponseDto>(await request('/inventory/items', 'POST', input('founder-A'), founderCookie), 201);
  const b = await json<InventoryItemResponseDto>(await request('/inventory/items', 'POST', input('founder-B'), founderCookie), 201);

  await t.test('create-only HR cannot persist or receive an unreadable generated card', async () => {
    try {
      await denied('/inventory/items', 'POST', input('default'));
      await admin([change('inventory.catalog.create', 'allow')]);
      assert.equal((await access()).rules.some(rule => rule.actionCode === 'inventory.read'), false);
      await denied('/inventory/items', 'POST', input('create-only'));
    } finally { await reset(); }
  });
  await t.test('selected read grants A, not B or a newly generated ID', async () => {
    try {
      await admin([change('inventory.catalog.create', 'allow'), change('inventory.read', 'allow', 'selected', [a.id])]);
      assert.equal((await json<InventoryItemResponseDto>(await request(`/inventory/items/${a.id}`))).id, a.id);
      await denied(`/inventory/items/${b.id}`, 'GET', undefined, 404);
      await denied('/inventory/items', 'POST', input('selected-is-not-new-id'));
    } finally { await reset(); }
  });
  await t.test('all read permits exactly one create, revoke denies, and explicit retry succeeds without changing roles', async () => {
    try {
      await admin([change('inventory.catalog.create', 'allow'), change('inventory.read', 'allow')]);
      await createExactlyOne('read-all');
      await admin([change('inventory.read', 'default')]);
      const body = input('read-retry');
      await denied('/inventory/items', 'POST', body);
      assert.equal(await prisma.inventoryItem.count({ where: { name: body.name } }), 0);
      await admin([change('inventory.read', 'allow')]);
      await createExactlyOne('read-retry');
      await admin([change('inventory.catalog.create', 'default')]);
      await denied('/inventory/items', 'POST', input('create-revoked'));
      // A selected root deny must not become a global denial of unknown IDs.
      await admin([change('inventory.catalog.create', 'allow'), change('inventory.access', 'deny', 'selected', [a.id])]);
      await denied(`/inventory/items/${a.id}`, 'GET', undefined, 404);
      assert.equal((await json<InventoryItemResponseDto>(await request(`/inventory/items/${b.id}`))).id, b.id);
      await createExactlyOne('selected-root-control');
    } finally { await reset(); }
  });
  for (const parent of ['inventory.access', 'inventory.read']) await t.test(`${parent} all deny dominates create authority with atomic zero effects`, async () => {
    try {
      await admin([change('inventory.catalog.create', 'allow'), change('inventory.read', 'allow')]);
      await admin([change(parent, 'deny')]);
      await denied('/inventory/items', 'POST', input(`${parent}-denied`));
      await admin([change(parent, 'default')]);
      if (parent === 'inventory.read') await admin([change('inventory.read', 'allow')]);
      await createExactlyOne(`${parent}-retry`);
    } finally { await reset(); }
  });
  await t.test('unsupported own rules cannot be saved or grant access; malformed negative policy remains globally fail closed', async () => {
    const before = await capture(), state = await access();
    for (const effect of ['allow', 'deny'] as const) {
      const response = await request(`/users-access/admin/users/${actor.id}/preview`, 'POST', {
        expectedVersion: state.version, reason: marker, changes: [{ actionCode: 'inventory.read', effect, scope: 'own' }],
      }, founderCookie);
      assert.equal(response.status, 400, await response.text());
      const subject: AccessSubject = { id: actor.id, roleCodes: roles, isActive: true,
        accessRules: [{ actionCode: 'inventory.read', effect, scope: 'own', selectedIds: [] }] };
      for (const ownerUserId of [actor.id, founder.id]) {
        const context = { resourceType: 'inventory_item', resourceId: a.id, ownerUserId };
        assert.equal(decideAccess(subject, 'inventory.read', false, context), false);
        assert.equal(hasModuleDeny(subject, 'inventory.read', context), effect === 'deny');
        if (effect === 'deny') assert.equal(decideAccess(subject, 'inventory.read', true, context), false);
      }
    }
    assert.deepEqual(await access(), state); assert.deepEqual(await capture(), before);
    assert.deepEqual(await identity(), initialIdentity);
    // Malformed policy checks above are explicitly pure-policy coverage, not
    // claimed as persisted legacy-row or browser/realtime integration coverage.
  });
});
