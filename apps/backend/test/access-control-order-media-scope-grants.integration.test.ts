import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { EquipmentScopeResponseDto } from '../src/modules/equipment/dto/equipment-response.dto';
import type { OrderInventoryResponseDto } from '../src/modules/inventory/dto/order-inventory-response.dto';
import type { OneTimeOrderPhotoResponseDto } from '../src/modules/one-time-orders/dto/one-time-order-photo-response.dto';
import type { OneTimeOrderResponseDto } from '../src/modules/one-time-orders/dto/one-time-order-response.dto';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type Photo = OneTimeOrderPhotoResponseDto;
type FileMetadata = { id: string; originalName: string };

test('order media/scoped read leaves retain parent scope, assigned specification writes and persistent attachment history', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  t.after(async () => { try { await closeApp?.(); } finally { await prisma.$disconnect(); } });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const [actor, peer, founder] = await Promise.all(['manager1', 'manager2', 'founder'].map((login) =>
    prisma.user.findUniqueOrThrow({ where: { login }, include: { roles: { include: { role: true } }, permissions: true } })));
  assert.deepEqual(actor.roles.map(({ role }) => role.code), ['manager']);
  assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id } }), 0);
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const marker = `acl-order-media-${randomUUID()}`;
  const catalog = await prisma.equipmentCatalogItem.create({ data: { name: marker, category: 'Isolated fixture', createdByUserId: founder.id } });
  const makeFixture = async (label: string, assigned: boolean) => {
    const order = await prisma.oneTimeOrder.create({ data: {
      title: `${marker}-${label}`, executionAddress: marker, contactName: 'Isolated fixture', status: 'in_progress', createdByUserId: founder.id,
      assignments: { create: { userId: assigned ? actor.id : peer.id, assignmentRoleCode: 'one_time_manager', isActive: true } },
    } });
    const photo = await prisma.oneTimeOrderPhoto.create({ data: {
      oneTimeOrderId: order.id, photoCategory: 'before', comment: `${marker}-photo-${label}`, createdByUserId: actor.id,
    } });
    const item = await prisma.oneTimeOrderSpecificationItem.create({ data: {
      oneTimeOrderId: order.id, title: `${marker}-specification-${label}`, sortOrder: 1, createdByUserId: founder.id,
    } });
    // Synthetic owned File/attachment metadata ONLY. These keys have no stored
    // bytes. No content/preview/thumbnail requests or first-upload I/O claims.
    const file = async (suffix: string, entityType: string, entityId: string) => prisma.file.create({ data: {
      bucket: 'isolated-metadata-only', objectKey: `${marker}/${label}/${suffix}.txt`, originalName: `${suffix}.txt`, mimeType: 'text/plain',
      sizeBytes: 1, uploadedByUserId: actor.id,
      attachments: { create: { entityType, entityId, uploadedByUserId: actor.id } },
    } });
    const photoFile = await file('photo', 'one_time_order_photo', photo.id);
    const specFile = await file('specification', 'one_time_order_specification_item', item.id);
    const inventoryItem = await prisma.inventoryItem.create({ data: {
      name: `${marker}-inventory-${label}`, category: 'Fixture', unit: 'шт', currentUnitPrice: 1, createdByUserId: founder.id,
    } });
    await prisma.inventoryMovement.create({ data: {
      inventoryItemId: inventoryItem.id, movementType: 'receipt', status: 'applied', quantity: 2, unitPriceSnapshot: 1, totalAmountSnapshot: 2, createdByUserId: founder.id,
    } });
    const movement = await prisma.inventoryMovement.create({ data: {
      inventoryItemId: inventoryItem.id, movementType: 'issue_to_one_time_order', status: 'applied', quantity: 1,
      unitPriceSnapshot: 1, totalAmountSnapshot: 1, relatedOneTimeOrderId: order.id, createdByUserId: founder.id,
    } });
    const unit = await prisma.equipmentUnit.create({ data: {
      catalogItemId: catalog.id, inventoryNumber: `${marker}-${label}`, status: 'assigned_to_one_time_order',
      currentOneTimeOrderId: order.id, createdByUserId: founder.id,
    } });
    return { order, photo, item, photoFile, specFile, movement, unit };
  };
  const a = await makeFixture('A', true), b = await makeFixture('B', true), hidden = await makeFixture('hidden', false);
  const capture = async () => ({
    orders: await prisma.oneTimeOrder.findMany({ orderBy: { id: 'asc' } }),
    assignments: await prisma.oneTimeOrderAssignment.findMany({ orderBy: { id: 'asc' } }),
    photos: await prisma.oneTimeOrderPhoto.findMany({ orderBy: { id: 'asc' } }),
    items: await prisma.oneTimeOrderSpecificationItem.findMany({ orderBy: { id: 'asc' } }),
    comments: await prisma.oneTimeOrderSpecificationComment.findMany({ orderBy: { id: 'asc' } }),
    files: await prisma.file.findMany({ orderBy: { id: 'asc' } }),
    attachments: await prisma.fileAttachment.findMany({ orderBy: { id: 'asc' } }),
    inventory: await prisma.inventoryMovement.findMany({ orderBy: { id: 'asc' } }),
    units: await prisma.equipmentUnit.findMany({ orderBy: { id: 'asc' } }),
    equipment: await prisma.equipmentMovement.findMany({ orderBy: { id: 'asc' } }),
    audit: await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
  });
  const request = (path: string, method = 'GET', body?: unknown): Promise<Response> => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15_000),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const ok = async <T>(path: string, method = 'GET', body?: unknown, expected = 200): Promise<T> => {
    const response = await request(path, method, body);
    assert.equal(response.status, expected, `${method} ${path}: ${await response.clone().text()}`);
    return response.json() as Promise<T>;
  };
  const rejected = async (path: string, method = 'GET', body?: unknown, expected = 403) => {
    const before = await capture();
    const response = await request(path, method, body);
    assert.equal(response.status, expected, `${method} ${path}: ${await response.clone().text()}`);
    assert.deepEqual(await capture(), before, 'Denied request changes no order, assignment, media, file/link, stock, equipment or history');
  };
  const rule = async (actionCode: string, effect: 'allow' | 'deny', selectedIds: string[] | undefined, run: () => Promise<void>, scope = selectedIds ? 'selected' : 'all') => {
    const previous = await prisma.userAccessRule.findUnique({ where: { userId_actionCode: { userId: actor.id, actionCode } } });
    const data = { effect, scope, selectedIds: selectedIds ?? [] };
    const saved = previous ? await prisma.userAccessRule.update({ where: { id: previous.id }, data })
      : await prisma.userAccessRule.create({ data: { userId: actor.id, actionCode, ...data } });
    try { await run(); } finally {
      if (previous) await prisma.userAccessRule.update({ where: { id: saved.id }, data: { effect: previous.effect, scope: previous.scope, selectedIds: previous.selectedIds } });
      else await prisma.userAccessRule.delete({ where: { id: saved.id } });
    }
  };
  const base = (f: typeof a) => `/one-time-orders/${f.order.id}`;
  const photoPath = (f: typeof a) => `${base(f)}/photos/${f.photo.id}`;
  const specPath = (f: typeof a) => `${base(f)}/specification-items/${f.item.id}/attachments/${f.specFile.id}`;
  const effects = async (before: Awaited<ReturnType<typeof capture>>, orderId: string, action: string) => {
    const after = await capture();
    const added = after.audit.filter((row) => !before.audit.some(({ id }) => id === row.id));
    assert.equal(added.length, 1);
    assert.equal(added[0].entityType, 'one_time_order');
    assert.equal(added[0].entityId, orderId);
    assert.equal(added[0].actorUserId, actor.id);
    assert.equal(added[0].action, action);
    assert.deepEqual(after.audit.filter(({ id }) => id !== added[0].id), before.audit, 'All earlier history remains immutable');
    return { after, event: added[0] };
  };
  const replay = (f: typeof a): Promise<Response> => {
    const form = new FormData();
    form.set('entityType', 'one_time_order_specification_item');
    form.set('entityId', f.item.id);
    form.set('uploadId', f.specFile.id);
    form.set('file', new Blob(['x'], { type: 'text/plain' }), 'specification.txt');
    return fetch(`${baseUrl}/api/v1/files/upload`, { method: 'POST', headers: { Cookie: cookie }, body: form, signal: AbortSignal.timeout(15_000) });
  };
  const assertReplay = async (f: typeof a, expected = 201) => {
    const before = await capture();
    const response = await replay(f);
    assert.equal(response.status, expected, await response.clone().text());
    if (expected === 201) assert.equal((await response.json() as FileMetadata).id, f.specFile.id);
    assert.deepEqual(await capture(), before, 'Metadata replay must not write files, links, business data or duplicate history');
  };

  await t.test('photo creation uses selected leaf/parent denies and default retains assigned baseline', async () => {
    await rule('one_time_orders.photos.create', 'allow', [a.order.id], async () => {
      for (const gate of ['one_time_orders.photos.create', 'one_time_orders.read', 'one_time_orders.access']) await rule(gate, 'deny', [a.order.id], async () => {
        await rejected(`${base(a)}/photos`, 'POST', { category: 'before', comment: 'Denied A' });
        assert.equal((await ok<{ capabilities: { canUploadPhotos: boolean } }>(base(b))).capabilities.canUploadPhotos, true);
        if (gate === 'one_time_orders.photos.create') {
          const beforeControl = await capture();
          const control = await ok<Photo>(`${base(b)}/photos`, 'POST', { category: 'before', comment: 'Control B' }, 201);
          const { after } = await effects(beforeControl, b.order.id, 'one_time_order.photo_created');
          assert.equal(control.oneTimeOrderId, b.order.id);
          assert.deepEqual({ ...after, photos: after.photos.filter(({ id }) => id !== control.id), audit: beforeControl.audit }, beforeControl);
        }
      });
    });
    const before = await capture();
    const created = await ok<Photo>(`${base(a)}/photos`, 'POST', { category: 'after', comment: '  Assigned baseline  ' }, 201);
    assert.equal(created.createdBy.id, actor.id);
    assert.equal(created.oneTimeOrderId, a.order.id);
    assert.equal(created.comment, 'Assigned baseline');
    const { after, event } = await effects(before, a.order.id, 'one_time_order.photo_created');
    assert.deepEqual(event.metadata, { photoId: created.id, category: 'after' });
    const saved = after.photos.find(({ id }) => id === created.id)!;
    assert.equal(saved.createdByUserId, actor.id);
    assert.equal(saved.deletedAt, null);
    assert.deepEqual({ ...after, photos: after.photos.filter(({ id }) => id !== created.id), audit: before.audit }, before);
    await rule('one_time_orders.photos.create', 'allow', [hidden.order.id], () => rejected(`${base(hidden)}/photos`, 'POST', { category: 'before' }, 404));
  });

  await t.test('photo delete/restore keeps File/link rows and previous history, including idempotent retries and old-cookie denies', async () => {
    for (const gate of ['one_time_orders.photos.delete', 'one_time_orders.read', 'one_time_orders.access']) await rule(gate, 'deny', [a.order.id], () => rejected(photoPath(a), 'DELETE', { reason: marker }));
    const before = await capture();
    const results: { deleted?: Photo; restored?: Photo } = {};
    await rule('one_time_orders.photos.delete', 'allow', [a.order.id], async () => {
      results.deleted = await ok<Photo>(photoPath(a), 'DELETE', { reason: `  ${marker}  ` });
    });
    const deleted = results.deleted;
    assert.ok(deleted);
    assert.ok(deleted.deletedAt);
    assert.equal(deleted.deletedBy!.id, actor.id);
    assert.equal(deleted.deleteReason, marker);
    assert.deepEqual(deleted.attachments, []);
    const removed = await effects(before, a.order.id, 'one_time_order.photo_deleted');
    assert.deepEqual(removed.event.metadata, { photoId: a.photo.id, deleteReason: marker });
    const deletedRow = removed.after.photos.find(({ id }) => id === a.photo.id)!;
    assert.deepEqual(deletedRow, { ...a.photo, deletedAt: deletedRow.deletedAt, deletedByUserId: actor.id,
      deleteReason: marker, restoredAt: null, restoredByUserId: null, updatedAt: deletedRow.updatedAt });
    assert.deepEqual({ ...removed.after, photos: before.photos, audit: before.audit }, before);
    await rejected(`/files/${a.photoFile.id}`);
    const unchanged = await capture();
    await ok(photoPath(a), 'DELETE', {});
    assert.deepEqual(await capture(), unchanged);
    for (const gate of ['one_time_orders.photos.restore', 'one_time_orders.read', 'one_time_orders.access']) await rule(gate, 'deny', [a.order.id], () => rejected(`${photoPath(a)}/restore`, 'POST'));
    await rule('one_time_orders.photos.restore', 'allow', [a.order.id], async () => {
      results.restored = await ok<Photo>(`${photoPath(a)}/restore`, 'POST', undefined, 201);
    });
    const restored = results.restored;
    assert.ok(restored);
    assert.equal(restored.deletedAt, null);
    assert.equal(restored.restoredBy!.id, actor.id);
    assert.deepEqual(restored.attachments.map(({ id }) => id), [a.photoFile.id]);
    const restoredState = await effects(unchanged, a.order.id, 'one_time_order.photo_restored');
    assert.deepEqual(restoredState.event.metadata, { photoId: a.photo.id, previousDeleteReason: marker });
    assert.deepEqual({ ...restoredState.after, photos: unchanged.photos, audit: unchanged.audit }, unchanged);
    const restoredRow = restoredState.after.photos.find(({ id }) => id === a.photo.id)!;
    assert.deepEqual(restoredRow, { ...deletedRow, deletedAt: null, deletedByUserId: null, deleteReason: null,
      restoredAt: restoredRow.restoredAt, restoredByUserId: actor.id, updatedAt: restoredRow.updatedAt });
    assert.equal((await ok<FileMetadata>(`/files/${a.photoFile.id}`)).id, a.photoFile.id);
    const repeat = await capture();
    await ok(`${photoPath(a)}/restore`, 'POST', undefined, 201);
    assert.deepEqual(await capture(), repeat);
    const history = await ok<Array<{ id: string }>>(`${base(a)}/history`);
    assert.ok(history.some(({ id }) => id === removed.event.id));
    assert.ok(history.some(({ id }) => id === restoredState.event.id));
    assert.ok((await ok<Photo[]>(`${base(b)}/photos`)).some(({ id }) => id === b.photo.id));
  });

  await t.test('specification comments/detach project independent leaves, selected denies and live default/regrant on the same cookie', async () => {
    const capabilities = async (f: typeof a) => (await ok<OneTimeOrderResponseDto>(base(f))).capabilities;
    const commentPath = (f: typeof a) => `${base(f)}/specification-items/${f.item.id}/comments`;
    const commentBody = () => ({ requestId: randomUUID(), content: `${marker}-independent-comment` });
    const addComment = async (f: typeof a) => {
      const before = await capture();
      const body = commentBody();
      const saved = await ok<{ id: string; itemId: string; content: string }>(commentPath(f), 'POST', body, 201);
      const { after } = await effects(before, f.order.id, 'one_time_order.specification_item_comment_created');
      assert.equal(saved.itemId, f.item.id);
      assert.equal(saved.content, body.content);
      const row = after.comments.find(({ id }) => id === saved.id)!;
      assert.equal(row.createdByUserId, actor.id);
      assert.equal(row.requestId, body.requestId);
      assert.deepEqual({ ...after, comments: after.comments.filter(({ id }) => id !== saved.id), audit: before.audit }, before);
    };
    // Extra owned metadata links keep earlier/later replay evidence untouched.
    const evidence = async (f: typeof a) => prisma.file.create({ data: {
      bucket: 'isolated-metadata-only', objectKey: `${marker}/independent/${randomUUID()}.txt`,
      originalName: 'independent.txt', mimeType: 'text/plain', sizeBytes: 1, uploadedByUserId: actor.id,
      attachments: { create: { entityType: 'one_time_order_specification_item', entityId: f.item.id, uploadedByUserId: actor.id } },
    } });
    const detachPath = (f: typeof a, id: string) => `${base(f)}/specification-items/${f.item.id}/attachments/${id}`;
    const detach = async (f: typeof a) => {
      const file = await evidence(f);
      const before = await capture();
      await ok(detachPath(f, file.id), 'DELETE');
      const { after, event } = await effects(before, f.order.id, 'one_time_order.specification_item_attachment_detached');
      const link = before.attachments.find((row) => row.fileId === file.id && row.entityId === f.item.id)!;
      assert.ok(link);
      assert.deepEqual(after.attachments, before.attachments.filter(({ id }) => id !== link.id));
      assert.deepEqual({ ...after, attachments: before.attachments, audit: before.audit }, before);
      assert.deepEqual(event.metadata, { specificationItemId: f.item.id });
      assert.ok(after.files.some(({ id }) => id === file.id), 'Detach preserves the File row; no binary I/O is exercised');
    };
    const assertFlags = async (f: typeof a, expected: [boolean, boolean, boolean]) => {
      const caps = await capabilities(f);
      assert.deepEqual([caps.canManageSpecification, caps.canCommentSpecification, caps.canDetachSpecificationFiles], expected);
      assert.equal(caps.canEditSpecification, false, 'Manager gets no structure authority from any execution leaf');
    };
    await assertFlags(a, [true, true, true]);
    await rule('one_time_orders.specification.comments', 'deny', [a.order.id], async () => {
      await assertFlags(a, [true, false, true]); await assertFlags(b, [true, true, true]);
      await rejected(commentPath(a), 'POST', commentBody());
      await addComment(b); await detach(a);
    });
    await rule('one_time_orders.specification.comments', 'allow', [a.order.id], async () => {
      await assertFlags(a, [true, true, true]); await addComment(a);
    });
    await assertFlags(a, [true, true, true]); // Revoked allow restores assigned baseline.
    await rule('one_time_orders.specification.detach', 'deny', [a.order.id], async () => {
      await assertFlags(a, [true, true, false]); await assertFlags(b, [true, true, true]);
      await rejected(specPath(a), 'DELETE'); await addComment(a); await detach(b);
    });
    await rule('one_time_orders.specification.detach', 'allow', [a.order.id], async () => {
      await assertFlags(a, [true, true, true]); await detach(a);
    });
    await assertFlags(a, [true, true, true]);
    await rule('one_time_orders.specification.execute', 'deny', [a.order.id], async () => {
      await assertFlags(a, [false, true, true]); await assertFlags(b, [true, true, true]);
      await rejected(`${base(a)}/specification-items/${a.item.id}/complete`, 'POST');
      await addComment(a); await detach(a);
    });
    for (const gate of ['one_time_orders.read', 'one_time_orders.access']) await rule(gate, 'deny', [a.order.id], async () => {
      await rejected(commentPath(a), 'POST', commentBody()); await rejected(specPath(a), 'DELETE');
      await assertFlags(b, [true, true, true]);
    });
    await rule('one_time_orders.read', 'allow', [hidden.order.id], async () => {
      await rule('one_time_orders.specification.comments', 'allow', [hidden.order.id], async () => {
        await rule('one_time_orders.specification.detach', 'allow', [hidden.order.id], async () => {
          await assertFlags(hidden, [false, false, false]);
          await rejected(commentPath(hidden), 'POST', commentBody()); await rejected(specPath(hidden), 'DELETE');
        });
      });
    });
    for (const status of ['completed', 'cancelled']) {
      await prisma.oneTimeOrder.update({ where: { id: a.order.id }, data: { status } });
      try {
        await assertFlags(a, [false, false, false]);
        await rejected(commentPath(a), 'POST', commentBody(), 409);
        await rejected(specPath(a), 'DELETE', undefined, 409);
      } finally { await prisma.oneTimeOrder.update({ where: { id: a.order.id }, data: { status: 'in_progress' } }); }
    }
    await assertFlags(a, [true, true, true]);
  });

  await t.test('specification attachment replay obeys leaf/parent/assigned scope without inventing membership or first-upload I/O', async () => {
    await assertReplay(a);
    await rule('one_time_orders.specification.attachments', 'allow', [a.order.id], async () => {
      for (const gate of ['one_time_orders.specification.attachments', 'one_time_orders.specification.read', 'one_time_orders.read', 'one_time_orders.access']) await rule(gate, 'deny', [a.order.id], async () => {
        await assertReplay(a, 403);
        await assertReplay(b);
      });
    });
    await assertReplay(a); // Removing allow restores assigned baseline, not a denial.
    await rule('one_time_orders.read', 'allow', [hidden.order.id], () => rule('one_time_orders.specification.attachments', 'allow', undefined, async () => {
      assert.equal((await ok<{ id: string }>(base(hidden))).id, hidden.order.id);
      await assertReplay(hidden, 403);
    }));
    const assignment = await prisma.oneTimeOrderAssignment.findFirstOrThrow({ where: { oneTimeOrderId: a.order.id, userId: actor.id } });
    await rule('one_time_orders.read', 'allow', [a.order.id], () => rule('one_time_orders.specification.attachments', 'allow', undefined, async () => {
      await prisma.oneTimeOrderAssignment.update({ where: { id: assignment.id }, data: { isActive: false } });
      try { await assertReplay(a, 403); await assertReplay(b); }
      finally { await prisma.oneTimeOrderAssignment.update({ where: { id: assignment.id }, data: { isActive: true } }); }
    }, 'assigned'));
    await assertReplay(a);
    await prisma.oneTimeOrder.update({ where: { id: a.order.id }, data: { status: 'completed' } });
    try { await assertReplay(a, 403); }
    finally { await prisma.oneTimeOrder.update({ where: { id: a.order.id }, data: { status: 'in_progress' } }); }
  });

  await t.test('actual specification detach removes only its exact link, keeps metadata/item/history and has an independent detach gate', async () => {
    for (const gate of ['one_time_orders.specification.detach', 'one_time_orders.read', 'one_time_orders.access']) await rule(gate, 'deny', [a.order.id], () => rejected(specPath(a), 'DELETE'));
    const before = await capture();
    const detached = await ok<{ attachments: FileMetadata[] }>(specPath(a), 'DELETE');
    assert.deepEqual(detached.attachments, []);
    const { after, event } = await effects(before, a.order.id, 'one_time_order.specification_item_attachment_detached');
    const link = before.attachments.find((row) => row.fileId === a.specFile.id && row.entityId === a.item.id)!;
    assert.deepEqual(after.attachments, before.attachments.filter(({ id }) => id !== link.id));
    assert.deepEqual({ ...after, attachments: before.attachments, audit: before.audit }, before);
    assert.deepEqual(event.oldValues, { specificationItemTitle: a.item.title, fileId: a.specFile.id, originalName: a.specFile.originalName });
    assert.equal(event.newValues, null);
    assert.deepEqual(event.metadata, { specificationItemId: a.item.id });
    assert.ok((await ok<Array<{ id: string }>>(`${base(a)}/history`)).some(({ id }) => id === event.id));
    await rejected(specPath(a), 'DELETE', undefined, 404);
    assert.ok(await prisma.file.findUnique({ where: { id: a.specFile.id } }));
  });

  await t.test('inventory/equipment scoped reads filter by order, never mutate stock, and respect source/leaf denial with B control', async () => {
    const read = async (f: typeof a) => {
      const before = await capture();
      const inventory = await ok<OrderInventoryResponseDto>(`${base(f)}/inventory`);
      assert.equal(inventory.total, 1);
      assert.deepEqual(inventory.items.map(({ id }) => id), [f.movement.id]);
      const equipment = await ok<EquipmentScopeResponseDto>(`${base(f)}/equipment`);
      assert.deepEqual(equipment.units.map(({ id }) => id), [f.unit.id]);
      assert.equal(equipment.units[0].capabilities.canCreateMovement, false);
      assert.deepEqual(await capture(), before, 'Scoped reads do not create ledger or equipment effects');
    };
    await read(a); await read(b);
    for (const [leaf, route] of [['one_time_orders.inventory.read', 'inventory'], ['one_time_orders.equipment.read', 'equipment']] as const) {
      await rule(leaf, 'allow', [a.order.id], async () => {
        for (const gate of [leaf, 'one_time_orders.read', 'one_time_orders.access']) await rule(gate, 'deny', [a.order.id], async () => {
          await rejected(`${base(a)}/${route}`);
          await read(b);
        });
      });
      await read(a);
      await rule(leaf, 'allow', [hidden.order.id], () => rejected(`${base(hidden)}/${route}`, 'GET', undefined, route === 'equipment' ? 404 : 403));
    }
    await rule('inventory.access', 'deny', undefined, () => rejected(`${base(a)}/inventory`));
    const before = await capture();
    await rule('equipment.read', 'deny', undefined, async () => {
      assert.deepEqual((await ok<EquipmentScopeResponseDto>(`${base(a)}/equipment`)).units, []);
    });
    assert.deepEqual(await capture(), before);
  });
});
