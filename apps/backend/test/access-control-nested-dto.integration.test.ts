import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type LeafDto = { id: string; attachments: Array<{ id: string }> };
type CardDto = { capabilities: Record<string, boolean> };

test('bounded nested order DTO/files enforce leaf, file and positive parent read independently', async (t) => {
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
  const marker = `acl-nested-${randomUUID()}`;
  const [reader, outsider] = await Promise.all(['assigned', 'outsider'].map((suffix) => prisma.user.create({ data: {
    login: `${marker}-${suffix}`, fullName: `${marker}-${suffix}`, passwordHash: template.passwordHash,
    roles: { create: { roleId: role.id } }, isActive: true,
  } })));
  const [cookie, outsiderCookie] = await Promise.all([reader, outsider].map((user) => loginAndGetCookieHeader({
    baseUrl, login: user.login, password: 'manager123',
  })));
  const order = await prisma.oneTimeOrder.create({ data: {
    title: marker, executionAddress: 'Isolated nested DTO fixture', contactName: 'Fixture', status: 'in_progress',
    createdByUserId: founder.id,
    assignments: { create: { userId: reader.id, assignmentRoleCode: 'one_time_manager', isActive: true } },
  } });
  const request = (path: string, auth = cookie, method = 'GET', body?: unknown) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: auth, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const root = `/one-time-orders/${order.id}`;
  const [comment, photo, spec] = await Promise.all([
    prisma.oneTimeOrderComment.create({ data: { oneTimeOrderId: order.id, content: marker, createdByUserId: reader.id } }),
    prisma.oneTimeOrderPhoto.create({ data: { oneTimeOrderId: order.id, photoCategory: 'before', comment: marker, createdByUserId: reader.id } }),
    prisma.oneTimeOrderSpecificationItem.create({ data: { oneTimeOrderId: order.id, title: marker, sortOrder: 0, createdByUserId: founder.id } }),
  ]);
  const reportResponse = await request(`${root}/daily-report/today`, cookie, 'PUT', { content: marker });
  assert.equal(reportResponse.status, 200, await reportResponse.clone().text());
  const report = await reportResponse.json() as LeafDto;
  const leaves = [
    { id: report.id, type: 'one_time_order_daily_report', path: `${root}/daily-report/today`, action: 'one_time_orders.reports.read', capability: 'canReadReports' },
    { id: comment.id, type: 'one_time_order_comment', path: `${root}/comments`, action: 'one_time_orders.comments.read', capability: 'canReadComments' },
    { id: photo.id, type: 'one_time_order_photo', path: `${root}/photos`, action: 'one_time_orders.photos.read', capability: 'canReadPhotos' },
    { id: spec.id, type: 'one_time_order_specification_item', path: `${root}/specification-items`, action: 'one_time_orders.specification.read', capability: 'canReadSpecification' },
  ];
  const files = await Promise.all(leaves.map(async (leaf) => {
    const form = new FormData();
    form.set('entityType', leaf.type); form.set('entityId', leaf.id);
    form.set('file', new Blob([`${marker}-${leaf.type}`], { type: 'text/plain' }), `${leaf.type}.txt`);
    const uploaded = await fetch(`${baseUrl}/api/v1/files/upload`, { method: 'POST', headers: { Cookie: cookie }, body: form });
    assert.equal(uploaded.status, 201, await uploaded.clone().text());
    return await uploaded.json() as { id: string };
  }));
  const reset = () => prisma.userAccessRule.deleteMany({ where: { userId: reader.id } });
  const deny = (actionCode: string) => prisma.userAccessRule.create({ data: {
    userId: reader.id, actionCode, effect: 'deny', scope: 'all',
  } });
  const readLeaf = async (leaf: typeof leaves[number]) => {
    const response = await request(leaf.path);
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json() as LeafDto | LeafDto[];
    const item = Array.isArray(body) ? body.find((row) => row.id === leaf.id) : body;
    assert.ok(item, `${leaf.type}: ${JSON.stringify(body)}`);
    return item;
  };
  for (const [index, leaf] of leaves.entries()) {
    await t.test(`${leaf.type}: leaf deny, files.read redaction and unrelated leaf positive control`, async () => {
      await reset();
      assert.ok((await readLeaf(leaf)).attachments.some((file) => file.id === files[index].id));
      await deny(leaf.action);
      const denied = await request(leaf.path);
      assert.equal(denied.status, 403, await denied.clone().text());
      assert.equal((await request(`/files/${files[index].id}/content?download=1`)).status, 403);
      const card = await request(root);
      assert.equal(card.status, 200, await card.clone().text());
      assert.equal(((await card.json()) as CardDto).capabilities[leaf.capability], false);
      await readLeaf(leaves[(index + 1) % leaves.length]);
      await reset();
      await deny('files.read');
      assert.deepEqual((await readLeaf(leaf)).attachments, []);
      assert.equal((await request(`/files/${files[index].id}`)).status, 403);
      const entityFiles = await request(`/files/entity/${leaf.type}/${leaf.id}`);
      assert.equal(entityFiles.status, 200, await entityFiles.clone().text());
      assert.deepEqual(await entityFiles.json(), []);
      await reset();
      assert.ok((await readLeaf(leaf)).attachments.some((file) => file.id === files[index].id));
    });
  }
  await t.test('report update deny leaves report and attachment read intact without changing saved content', async () => {
    await reset();
    const before = await prisma.oneTimeOrderDailyReport.findUniqueOrThrow({ where: { id: report.id } });
    await deny('one_time_orders.reports.update');
    const card = await request(root);
    assert.equal(card.status, 200);
    const capabilities = ((await card.json()) as CardDto).capabilities;
    assert.equal(capabilities.canReadReports, true);
    assert.equal(capabilities.canUpdateReports, false);
    await readLeaf(leaves[0]);
    assert.equal((await request(`/files/${files[0].id}/content?download=1`)).status, 200);
    const write = await request(`${root}/daily-report/today`, cookie, 'PUT', { content: `${marker}-forbidden` });
    assert.equal(write.status, 403, await write.clone().text());
    assert.deepEqual(await prisma.oneTimeOrderDailyReport.findUniqueOrThrow({ where: { id: report.id } }), before);
    await reset();
  });
  await t.test('explicit module parent deny blocks every child/file despite child grants', async () => {
    await reset();
    await prisma.userAccessRule.createMany({ data: leaves.map((leaf) => ({ userId: reader.id,
      actionCode: leaf.action, effect: 'allow', scope: 'selected', selectedIds: [order.id],
    })) });
    await deny('one_time_orders.access');
    assert.ok([403, 404].includes((await request(root)).status));
    for (const [index, leaf] of leaves.entries()) {
      assert.ok([403, 404].includes((await request(leaf.path)).status), leaf.type);
      assert.equal((await request(`/files/${files[index].id}/content?download=1`)).status, 403, leaf.type);
    }
    await reset();
  });
  await t.test('selected specification grant alone cannot fetch attached original; positive root read enables it', async () => {
    await prisma.userAccessRule.create({ data: { userId: outsider.id, actionCode: 'one_time_orders.specification.read',
      effect: 'allow', scope: 'selected', selectedIds: [order.id],
    } });
    const contentPath = `/files/${files[3].id}/content?download=1`;
    assert.equal((await request(contentPath, outsiderCookie)).status, 403);
    await prisma.userAccessRule.create({ data: { userId: outsider.id, actionCode: 'one_time_orders.read',
      effect: 'allow', scope: 'selected', selectedIds: [order.id],
    } });
    const positive = await request(contentPath, outsiderCookie);
    assert.equal(positive.status, 200, await positive.clone().text());
    assert.equal(await positive.text(), `${marker}-${leaves[3].type}`);
    await prisma.userAccessRule.create({ data: { userId: outsider.id, actionCode: 'one_time_orders.access', effect: 'deny', scope: 'all' } });
    assert.equal((await request(contentPath, outsiderCookie)).status, 403);
  });
  await t.test('object materials deny blocks object originals only; HR extension deny preserves independent own/assigned report reads', async () => {
    const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' });
    const object = await prisma.object.create({ data: {
      name: `${marker}-object`, address: 'Bounded material/HR fixture', status: 'active', createdByUserId: founder.id,
      assignments: { create: { userId: reader.id, assignmentRoleCode: 'manager', isActive: true } },
    } });
    const [objectReport, objectComment, arrival] = await Promise.all([
      prisma.objectDailyReport.create({ data: { objectId: object.id, reportDate: new Date('2026-11-01T00:00:00Z'), content: marker, updatedByUserId: founder.id } }),
      prisma.objectComment.create({ data: { objectId: object.id, content: marker, createdByUserId: founder.id } }),
      prisma.objectArrivalPhoto.create({ data: { objectId: object.id, operationDate: new Date('2026-11-01T00:00:00Z'), createdByUserId: founder.id } }),
    ]);
    const targets = [
      { type: 'object', id: object.id }, { type: 'object_daily_report', id: objectReport.id },
      { type: 'object_comment', id: objectComment.id }, { type: 'object_arrival_photo', id: arrival.id },
    ];
    const objectFiles = await Promise.all(targets.map(async (target) => {
      // This tests attachment reads, not the report staging workflow. Create
      // real stored content, then bind this exact isolated fixture file to the
      // saved report; never retain an alternate readable root attachment.
      const stagedReport = target.type === 'object_daily_report';
      const form = new FormData();
      form.set('entityType', stagedReport ? 'object_comment' : target.type);
      form.set('entityId', stagedReport ? objectComment.id : target.id);
      form.set('file', new Blob([`${marker}-${target.type}`], { type: 'text/plain' }), `${target.type}.txt`);
      const response = await fetch(`${baseUrl}/api/v1/files/upload`, { method: 'POST', headers: { Cookie: founderCookie }, body: form });
      assert.equal(response.status, 201, await response.clone().text());
      const file = await response.json() as { id: string };
      if (stagedReport) {
        const rebound = await prisma.fileAttachment.updateMany({ where: { fileId: file.id, entityType: 'object_comment', entityId: objectComment.id },
          data: { entityType: 'object_daily_report', entityId: objectReport.id } });
        assert.equal(rebound.count, 1);
      }
      return file;
    }));
    const content = async (index: number, auth = cookie) => request(`/files/${objectFiles[index].id}/content?download=1`, auth);
    for (let index = 0; index < targets.length; index += 1) assert.equal((await content(index)).status, 200, targets[index].type);
    await deny('objects.materials.read');
    assert.equal((await content(0)).status, 403);
    for (let index = 1; index < targets.length; index += 1) assert.equal((await content(index)).status, 200, targets[index].type);
    await reset();
    const hrPermission = await prisma.permission.findUniqueOrThrow({ where: { code: 'objects.hr_reports_view' } });
    await prisma.userPermission.create({ data: { userId: outsider.id, permissionId: hrPermission.id } });
    assert.equal((await content(1, outsiderCookie)).status, 200, 'Positive report-only HR extension');
    await prisma.userAccessRule.create({ data: { userId: outsider.id, actionCode: 'objects.hr_reports_view', effect: 'deny', scope: 'all' } });
    assert.equal((await content(1, outsiderCookie)).status, 403);
    await prisma.object.update({ where: { id: object.id }, data: { createdByUserId: outsider.id } });
    assert.equal((await content(1, outsiderCookie)).status, 200, 'Independent ownership survives HR extension deny');
    await prisma.object.update({ where: { id: object.id }, data: { createdByUserId: founder.id } });
    await prisma.objectAssignment.create({ data: { objectId: object.id, userId: outsider.id, assignmentRoleCode: 'manager', isActive: true } });
    assert.equal((await content(1, outsiderCookie)).status, 200, 'Independent active assignment survives HR extension deny');
    await prisma.userAccessRule.create({ data: { userId: outsider.id, actionCode: 'objects.reports.read', effect: 'deny', scope: 'all' } });
    assert.equal((await content(1, outsiderCookie)).status, 403);
  });
});
