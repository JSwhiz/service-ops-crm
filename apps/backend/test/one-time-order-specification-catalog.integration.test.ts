import assert from "node:assert/strict";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import { loginAndGetCookieHeader } from "./helpers/auth";
import { createTestApp } from "./helpers/create-test-app";

test("specification catalog is leadership-only and order text remains a snapshot", async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = `spec-catalog-${Date.now()}`;
  const manager = await prisma.user.findUniqueOrThrow({
    where: { login: "manager1" },
  });
  const cookies = await Promise.all([
    loginAndGetCookieHeader({
      baseUrl,
      login: "founder",
      password: "founder123",
    }),
    loginAndGetCookieHeader({
      baseUrl,
      login: "manager1",
      password: "manager123",
    }),
    loginAndGetCookieHeader({
      baseUrl,
      login: "manager2",
      password: "manager123",
    }),
    loginAndGetCookieHeader({ baseUrl, login: "hr1", password: "hr123" }),
    loginAndGetCookieHeader({
      baseUrl,
      login: "deputy1",
      password: "deputy123",
    }),
  ]);
  const [
    founderCookie,
    managerCookie,
    outsiderCookie,
    hrCookie,
    deputyDirectorCookie,
  ] = cookies;
  const catalogUrl = `${baseUrl}/api/v1/one-time-orders/specification-catalog`;
  const templatesUrl = `${baseUrl}/api/v1/one-time-orders/specification-templates`;
  const createdOrderIds: string[] = [];

  t.after(async () => {
    await prisma.auditEvent.deleteMany({
      where: {
        entityType: "one_time_order",
        entityId: { in: createdOrderIds },
      },
    });
    await prisma.oneTimeOrderSpecificationItem.deleteMany({
      where: { oneTimeOrderId: { in: createdOrderIds } },
    });
    await prisma.oneTimeOrderAssignment.deleteMany({
      where: { oneTimeOrderId: { in: createdOrderIds } },
    });
    await prisma.oneTimeOrder.deleteMany({
      where: { id: { in: createdOrderIds } },
    });
    await prisma.oneTimeOrderSpecificationTemplateItem.deleteMany({
      where: { template: { name: { startsWith: `${marker} template` } } },
    });
    await prisma.oneTimeOrderSpecificationTemplate.deleteMany({
      where: { name: { startsWith: `${marker} template` } },
    });
    await prisma.auditEvent.deleteMany({
      where: { entityType: "one_time_order_specification_catalog" },
    });
    await prisma.oneTimeOrderSpecificationCatalogItem.deleteMany({
      where: { title: { startsWith: marker } },
    });
    await app.close();
    await prisma.$disconnect();
  });

  const initialCatalogRead = await fetch(catalogUrl, {
    headers: { Cookie: founderCookie },
  });
  assert.equal(initialCatalogRead.status, 200);
  const wetTemplate =
    await prisma.oneTimeOrderSpecificationTemplate.findUniqueOrThrow({
      where: { name: "Влажная уборка" },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
  assert.equal(wetTemplate.items.length, 23);
  const dustTemplate =
    await prisma.oneTimeOrderSpecificationTemplate.findUniqueOrThrow({
      where: { name: "Обеспыливание" },
      include: { items: true },
    });
  assert.equal(dustTemplate.items.length, 15);
  const seededWetCatalogItem = await prisma.oneTimeOrderSpecificationCatalogItem.findUniqueOrThrow({
    where: { id: wetTemplate.items[0]!.catalogItemId },
  });

  for (const cookie of [
    managerCookie,
    outsiderCookie,
    hrCookie,
    deputyDirectorCookie,
  ]) {
    assert.equal(
      (await fetch(catalogUrl, { headers: { Cookie: cookie } })).status,
      403,
    );
    assert.equal(
      (await fetch(templatesUrl, { headers: { Cookie: cookie } })).status,
      403,
    );
  }

  const itemCreate = await fetch(catalogUrl, {
    method: "POST",
    headers: { Cookie: founderCookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `${marker} custom`,
      description: "Описание",
      sortOrder: 100,
    }),
  });
  assert.equal(itemCreate.status, 201);
  const catalogItem = (await itemCreate.json()) as {
    id: string;
    title: string;
    isArchived: boolean;
    updatedAt: string;
  };

  const managerCatalogCreate = await fetch(catalogUrl, {
    method: "POST",
    headers: { Cookie: managerCookie, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Manager item" }),
  });
  assert.equal(managerCatalogCreate.status, 403);
  assert.equal(
    (
      await fetch(`${catalogUrl}/${catalogItem.id}`, {
        method: "PATCH",
        headers: { Cookie: managerCookie, "Content-Type": "application/json" },
        body: JSON.stringify({ title: "forged" }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${catalogUrl}/${catalogItem.id}`, {
        method: "DELETE",
        headers: { Cookie: managerCookie, "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived: true }),
      })
    ).status,
    403,
  );

  const templateCreate = await fetch(templatesUrl, {
    method: "POST",
    headers: { Cookie: founderCookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `${marker} template`,
      items: [{ catalogItemId: catalogItem.id, sortOrder: 0 }],
    }),
  });
  assert.equal(templateCreate.status, 201);
  const customTemplate = (await templateCreate.json()) as {
    id: string;
    version: number;
  };
  assert.equal(customTemplate.version, 1);
  const templateUpdatePayload = {
    expectedVersion: customTemplate.version,
    name: `${marker} template updated`,
  };
  const firstTemplateUpdate = await fetch(
    `${templatesUrl}/${customTemplate.id}`,
    {
      method: "PATCH",
      headers: { Cookie: founderCookie, "Content-Type": "application/json" },
      body: JSON.stringify(templateUpdatePayload),
    },
  );
  assert.equal(firstTemplateUpdate.status, 200);
  assert.equal(
    ((await firstTemplateUpdate.json()) as { version: number }).version,
    2,
  );
  const staleTemplateUpdate = await fetch(
    `${templatesUrl}/${customTemplate.id}`,
    {
      method: "PATCH",
      headers: { Cookie: founderCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...templateUpdatePayload,
        name: `${marker} stale overwrite`,
      }),
    },
  );
  assert.equal(staleTemplateUpdate.status, 409);
  assert.equal(
    (
      await prisma.oneTimeOrderSpecificationTemplate.findUniqueOrThrow({
        where: { id: customTemplate.id },
      })
    ).name,
    `${marker} template updated`,
  );
  assert.equal(
    (
      await fetch(templatesUrl, {
        method: "POST",
        headers: {
          Cookie: deputyDirectorCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "forged template", items: [] }),
      })
    ).status,
    403,
  );

  const managerCreateBase = {
    title: `${marker} manager-created`,
    executionAddress: "Москва",
    contactName: "Контакт",
    plannedPaymentMethod: "cash",
  };
  const managerOrder = await fetch(`${baseUrl}/api/v1/one-time-orders`, {
    method: "POST",
    headers: { Cookie: managerCookie, "Content-Type": "application/json" },
    body: JSON.stringify(managerCreateBase),
  });
  assert.equal(managerOrder.status, 201);
  const managerCreated = (await managerOrder.json()) as { id: string };
  createdOrderIds.push(managerCreated.id);

  for (const specificationPayload of [
    { specificationCatalogItemIds: [catalogItem.id] },
    { specificationTemplateIds: [customTemplate.id] },
    { specificationItems: [{ title: "forged order item" }] },
  ]) {
    const response = await fetch(`${baseUrl}/api/v1/one-time-orders`, {
      method: "POST",
      headers: { Cookie: managerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...managerCreateBase,
        title: `${marker} forbidden`,
        ...specificationPayload,
      }),
    });
    assert.equal(response.status, 403);
  }

  const managerCopyWithoutSpec = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${managerCreated.id}/copy`,
    {
      method: "POST",
      headers: { Cookie: managerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...managerCreateBase,
        title: `${marker} manager-copy`,
      }),
    },
  );
  assert.equal(managerCopyWithoutSpec.status, 201);
  const managerCopy = (await managerCopyWithoutSpec.json()) as { id: string };
  createdOrderIds.push(managerCopy.id);
  const managerCopyWithSpec = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${managerCreated.id}/copy`,
    {
      method: "POST",
      headers: { Cookie: managerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...managerCreateBase,
        title: `${marker} forbidden-copy`,
        specificationItems: [{ title: "forged copy item" }],
      }),
    },
  );
  assert.equal(managerCopyWithSpec.status, 403);

  const founderPayload = {
    creationRequestId: "a1111111-1111-4111-8111-111111111111",
    title: `${marker} leadership-created`,
    executionAddress: "Москва",
    contactName: "Контакт",
    plannedPaymentMethod: "cash",
    managerUserIds: [manager.id],
    specificationTemplateIds: [wetTemplate.id, dustTemplate.id],
    specificationCatalogItemIds: [catalogItem.id],
    specificationItems: [{ title: "Заказной пункт", requiresAttachment: true }],
  };
  const founderOrder = await fetch(`${baseUrl}/api/v1/one-time-orders`, {
    method: "POST",
    headers: { Cookie: founderCookie, "Content-Type": "application/json" },
    body: JSON.stringify(founderPayload),
  });
  assert.equal(founderOrder.status, 201);
  const founderCreated = (await founderOrder.json()) as { id: string };
  createdOrderIds.push(founderCreated.id);
  const timedOutRetries = await Promise.all([1, 2].map(() =>
    fetch(`${baseUrl}/api/v1/one-time-orders`, {
      method: "POST",
      headers: { Cookie: founderCookie, "Content-Type": "application/json" },
      body: JSON.stringify(founderPayload),
    }),
  ));
  assert.deepEqual(timedOutRetries.map(({ status }) => status), [201, 201]);
  const retriedOrderIds = await Promise.all(timedOutRetries.map(async (response) =>
    ((await response.json()) as { id: string }).id,
  ));
  assert.equal(
    retriedOrderIds.every((id) => id === founderCreated.id),
    true,
    "concurrent idempotent creation retries must return the same order",
  );
  const mismatchedRetry = await fetch(`${baseUrl}/api/v1/one-time-orders`, {
    method: "POST",
    headers: { Cookie: founderCookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...founderPayload,
      title: `${marker} changed payload`,
    }),
  });
  assert.equal(mismatchedRetry.status, 409);
  assert.equal(
    await prisma.oneTimeOrder.count({ where: { id: founderCreated.id } }),
    1,
  );
  const snapshot = await prisma.oneTimeOrderSpecificationItem.findMany({
    where: { oneTimeOrderId: founderCreated.id },
    orderBy: { sortOrder: "asc" },
  });
  assert.equal(snapshot.length, 40);
  assert.equal(
    snapshot[0]?.title,
    "Пылесос, мытье пола и плинтусов (без перемещения тяжелой мебели)",
  );
  assert.equal(snapshot[38]?.title, catalogItem.title);
  assert.equal(snapshot[39]?.title, "Заказной пункт");
  assert.equal(snapshot[39]?.requiresAttachment, false);

  const legacyOrder = await fetch(`${baseUrl}/api/v1/one-time-orders`, {
    method: "POST",
    headers: { Cookie: founderCookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      creationRequestId: "a2111111-1111-4111-8111-111111111111",
      title: `${marker} existing-order`,
      executionAddress: "Москва",
      contactName: "Контакт",
      plannedPaymentMethod: "cash",
      managerUserIds: [manager.id],
      specificationItems: [{ title: catalogItem.title }],
    }),
  });
  assert.equal(legacyOrder.status, 201);
  const legacyOrderBody = (await legacyOrder.json()) as { id: string };
  createdOrderIds.push(legacyOrderBody.id);
  const legacyItemsUrl = `${baseUrl}/api/v1/one-time-orders/${legacyOrderBody.id}/specification-items`;
  const legacyItem = (await (await fetch(legacyItemsUrl, {
    headers: { Cookie: founderCookie },
  })).json()) as Array<{ id: string; title: string }>;
  assert.equal(legacyItem.length, 1);
  const markedComplete = await fetch(
    `${legacyItemsUrl}/${legacyItem[0]!.id}/complete`,
    { method: "POST", headers: { Cookie: managerCookie } },
  );
  assert.equal(markedComplete.status, 201);
  assert.equal(
    (await fetch(`${legacyItemsUrl}/${legacyItem[0]!.id}/complete`, {
      method: "POST",
      headers: { Cookie: founderCookie },
    })).status,
    403,
    "leadership may edit specification structure but cannot execute an item without an active manager assignment",
  );
  await prisma.oneTimeOrder.update({
    where: { id: legacyOrderBody.id },
    data: { status: "in_progress" },
  });
  const applyUrl = `${baseUrl}/api/v1/one-time-orders/${legacyOrderBody.id}/specification-items/apply-catalog`;
  const applyPayload = {
    requestId: "a3111111-1111-4111-8111-111111111111",
    templateIds: [customTemplate.id, wetTemplate.id],
    catalogItemIds: [catalogItem.id, seededWetCatalogItem.id],
    expectedTemplateVersions: [
      { templateId: customTemplate.id, version: 2 },
      { templateId: wetTemplate.id, version: wetTemplate.version },
    ],
    expectedCatalogItems: [
      { catalogItemId: catalogItem.id, updatedAt: catalogItem.updatedAt },
      {
        catalogItemId: seededWetCatalogItem.id,
        updatedAt: seededWetCatalogItem.updatedAt,
      },
    ],
  };
  assert.equal(
    (await fetch(applyUrl, {
      method: "POST",
      headers: { Cookie: managerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ ...applyPayload, reason: "Менеджерская правка" }),
    })).status,
    403,
  );
  assert.equal(
    (await fetch(applyUrl, {
      method: "POST",
      headers: { Cookie: founderCookie, "Content-Type": "application/json" },
      body: JSON.stringify(applyPayload),
    })).status,
    400,
  );
  const staleSelection = await fetch(applyUrl, {
    method: "POST",
    headers: { Cookie: founderCookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...applyPayload,
      expectedTemplateVersions: [
        { templateId: customTemplate.id, version: 1 },
        { templateId: wetTemplate.id, version: wetTemplate.version },
      ],
      reason: "Добавлен объём работ",
    }),
  });
  assert.equal(staleSelection.status, 409);
  const appliedResponse = await fetch(applyUrl, {
    method: "POST",
    headers: { Cookie: founderCookie, "Content-Type": "application/json" },
    body: JSON.stringify({ ...applyPayload, reason: "Добавлен объём работ" }),
  });
  assert.equal(appliedResponse.status, 201);
  const appliedItems = (await appliedResponse.json()) as Array<{
    id: string;
    title: string;
    isCompleted: boolean;
  }>;
  assert.equal(appliedItems.length, wetTemplate.items.length + 1);
  assert.equal(appliedItems.some((item) => item.title === catalogItem.title), true);
  assert.equal(appliedItems.every((item) => item.isCompleted === false), true);
  const replayedApplies = await Promise.all([1, 2].map(() =>
    fetch(applyUrl, {
      method: "POST",
      headers: { Cookie: founderCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ ...applyPayload, reason: "Добавлен объём работ" }),
    }),
  ));
  assert.deepEqual(replayedApplies.map(({ status }) => status), [201, 201]);
  for (const replayedApply of replayedApplies) {
    assert.deepEqual(
      ((await replayedApply.json()) as Array<{ id: string }>).map(({ id }) => id),
      appliedItems.map(({ id }) => id),
    );
  }
  const duplicateTextItems = await prisma.oneTimeOrderSpecificationItem.findMany({
    where: { oneTimeOrderId: legacyOrderBody.id, title: catalogItem.title },
    orderBy: { sortOrder: "asc" },
  });
  assert.equal(duplicateTextItems.length, 2);
  assert.equal(duplicateTextItems[0]?.isCompleted, true);
  assert.equal(duplicateTextItems[1]?.isCompleted, false);
  assert.equal(
    await prisma.oneTimeOrderSpecificationApplyRequest.count({
      where: { oneTimeOrderId: legacyOrderBody.id },
    }),
    1,
  );
  const mismatchedApply = await fetch(applyUrl, {
    method: "POST",
    headers: { Cookie: founderCookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...applyPayload,
      catalogItemIds: [],
      reason: "Добавлен объём работ",
    }),
  });
  assert.equal(mismatchedApply.status, 409);

  const updateCatalogItem = await fetch(`${catalogUrl}/${catalogItem.id}`, {
    method: "PATCH",
    headers: { Cookie: founderCookie, "Content-Type": "application/json" },
    body: JSON.stringify({ title: `${marker} renamed` }),
  });
  assert.equal(updateCatalogItem.status, 200);
  await fetch(`${catalogUrl}/${catalogItem.id}`, {
    method: "DELETE",
    headers: { Cookie: founderCookie, "Content-Type": "application/json" },
    body: JSON.stringify({ isArchived: true }),
  });
  const unchangedSnapshot = await prisma.oneTimeOrderSpecificationItem.findMany(
    {
      where: { oneTimeOrderId: founderCreated.id },
      orderBy: { sortOrder: "asc" },
    },
  );
  assert.equal(unchangedSnapshot[38]?.title, catalogItem.title);
  assert.equal(
    (
      await prisma.oneTimeOrderSpecificationCatalogItem.findUniqueOrThrow({
        where: { id: catalogItem.id },
      })
    ).isArchived,
    true,
  );
  assert.equal(
    (await prisma.auditEvent.count({
      where: {
        entityType: "one_time_order_specification_catalog",
        entityId: catalogItem.id,
      },
    })) >= 3,
    true,
  );

  const snapshotCopy = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${founderCreated.id}/copy`,
    {
      method: "POST",
      headers: { Cookie: founderCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `${marker} leadership-copy`,
        executionAddress: "Москва",
        contactName: "Контакт",
        plannedPaymentMethod: "cash",
        specificationItems: snapshot.map((item) => ({
          title: item.title,
          description: item.description,
        })),
      }),
    },
  );
  assert.equal(snapshotCopy.status, 201);
  const snapshotCopyBody = (await snapshotCopy.json()) as { id: string };
  createdOrderIds.push(snapshotCopyBody.id);
  const copiedItems = await prisma.oneTimeOrderSpecificationItem.findMany({
    where: { oneTimeOrderId: snapshotCopyBody.id },
    orderBy: { sortOrder: "asc" },
  });
  assert.deepEqual(
    copiedItems.map((item) => item.title),
    snapshot.map((item) => item.title),
  );
  assert.ok(
    await prisma.auditEvent.count({
      where: {
        entityType: "one_time_order",
        entityId: snapshotCopyBody.id,
        action: "one_time_order.copied",
      },
    }),
  );
});
