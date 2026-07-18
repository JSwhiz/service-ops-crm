import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { createTestApp } from './helpers/create-test-app';

test('legacy completion correction preserves history and follows the current native cycle', async (t) => {
  const prisma = new PrismaClient();
  const { app } = await createTestApp();
  const founder = await prisma.user.findUniqueOrThrow({
    where: { login: 'founder' },
  });
  const marker = `legacy-current-${Date.now()}`;

  t.after(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const createOrder = (suffix: string, workCycle: number, status = 'completed') =>
    prisma.oneTimeOrder.create({
      data: {
        title: `${marker}-${suffix}`,
        executionAddress: 'Москва',
        contactName: 'Заказчик',
        status,
        workCycle,
        completedAt: new Date('2020-01-01T00:00:00.000Z'),
        completedByUserId: founder.id,
        createdByUserId: founder.id,
      },
    });
  const createLegacy = (oneTimeOrderId: string) =>
    prisma.oneTimeOrderCompletion.create({
      data: {
        oneTimeOrderId,
        workCycle: 1,
        completedAt: null,
        completedByUserId: null,
        completionSource: 'legacy_unknown',
        status: 'active',
      },
    });
  const createNative = (
    oneTimeOrderId: string,
    workCycle: number,
    status: string,
    completedAt: Date,
  ) =>
    prisma.oneTimeOrderCompletion.create({
      data: {
        oneTimeOrderId,
        workCycle,
        completedAt,
        completedByUserId: founder.id,
        completionSource: 'native',
        status,
      },
    });

  const legacyOnlyOrder = await createOrder('legacy-only', 1);
  const legacyOnly = await createLegacy(legacyOnlyOrder.id);
  const account = await prisma.accountabilityAccount.create({
    data: { userId: founder.id },
  });
  const legacyFunding = await prisma.accountabilityFunding.create({
    data: {
      accountabilityAccountId: account.id,
      amount: 10,
      comment: 'Legacy funding provenance',
      issuedByUserId: founder.id,
      recordedByUserId: founder.id,
      fundingType: 'one_time_order_receipt',
      entryDirection: 'credit',
      oneTimeOrderId: legacyOnlyOrder.id,
      oneTimeOrderCompletionId: legacyOnly.id,
    },
  });

  const cycleTwoOrder = await createOrder('cycle-two', 2);
  await createLegacy(cycleTwoOrder.id);
  const cycleTwoDate = new Date('2040-02-02T12:00:00.000Z');
  const cycleTwo = await createNative(
    cycleTwoOrder.id,
    2,
    'active',
    cycleTwoDate,
  );

  const cycleThreeOrder = await createOrder('cycle-three', 3);
  await createLegacy(cycleThreeOrder.id);
  await createNative(
    cycleThreeOrder.id,
    2,
    'superseded',
    new Date('2040-03-02T12:00:00.000Z'),
  );
  const cycleThreeDate = new Date('2040-03-03T12:00:00.000Z');
  const cycleThree = await createNative(
    cycleThreeOrder.id,
    3,
    'active',
    cycleThreeDate,
  );

  const openOrder = await createOrder('open', 1, 'in_progress');

  await prisma.$queryRaw`SELECT reconcile_one_time_order_completion_current_state()::text`;
  await prisma.$queryRaw`SELECT reconcile_one_time_order_completion_current_state()::text`;

  const [legacyState, cycleTwoState, cycleThreeState, openState] =
    await Promise.all([
      prisma.oneTimeOrder.findUniqueOrThrow({ where: { id: legacyOnlyOrder.id } }),
      prisma.oneTimeOrder.findUniqueOrThrow({ where: { id: cycleTwoOrder.id } }),
      prisma.oneTimeOrder.findUniqueOrThrow({ where: { id: cycleThreeOrder.id } }),
      prisma.oneTimeOrder.findUniqueOrThrow({ where: { id: openOrder.id } }),
    ]);
  assert.equal(legacyState.completedAt, null);
  assert.equal(legacyState.completedByUserId, null);
  assert.equal(cycleTwoState.completedAt?.toISOString(), cycleTwoDate.toISOString());
  assert.equal(cycleTwoState.completedByUserId, founder.id);
  assert.equal(cycleThreeState.completedAt?.toISOString(), cycleThreeDate.toISOString());
  assert.equal(cycleThreeState.completedByUserId, founder.id);
  assert.equal(openState.completedAt, null);
  assert.equal(openState.completedByUserId, null);
  assert.equal(
    await prisma.accountabilityFunding.count({ where: { id: legacyFunding.id } }),
    1,
  );
  assert.equal(
    (await prisma.oneTimeOrderCompletion.findUniqueOrThrow({
      where: { id: cycleTwo.id },
    })).completedAt?.toISOString(),
    cycleTwoDate.toISOString(),
  );
  assert.equal(
    (await prisma.oneTimeOrderCompletion.findUniqueOrThrow({
      where: { id: cycleThree.id },
    })).completedAt?.toISOString(),
    cycleThreeDate.toISOString(),
  );

  await assert.rejects(
    prisma.oneTimeOrderCompletion.create({
      data: {
        oneTimeOrderId: legacyOnlyOrder.id,
        workCycle: 9,
        completedAt: null,
        completedByUserId: null,
        completionSource: 'native',
        status: 'active',
      },
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('one_time_order_completions_facts_check'),
  );
  await assert.rejects(
    prisma.oneTimeOrderCompletion.create({
      data: {
        oneTimeOrderId: legacyOnlyOrder.id,
        workCycle: 10,
        completedAt: new Date(),
        completedByUserId: founder.id,
        completionSource: 'legacy_unknown',
        status: 'active',
      },
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('one_time_order_completions_facts_check'),
  );
});
