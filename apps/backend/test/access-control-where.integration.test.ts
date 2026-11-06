import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Prisma, PrismaClient } from '@prisma/client';

import type { AccessRule, AccessSubject } from '../src/modules/users-access/types/access-policy.type';
import { buildAccessWhere } from '../src/modules/users-access/utils/access-policy.util';

import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

// Deliberately executes actual Prisma predicates: JS Boolean interpretations of
// OR:[], OR:[{}] and NOT:{} are not evidence of Prisma/SQL behavior.
test('ACL WHERE truth table against real Prisma findMany/count/aggregate', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  assert.match(new URL(process.env.DATABASE_URL!).searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const marker = `acl-where-${randomUUID()}`;
  const objects = await Promise.all([100, 200].map((dailyRate, index) => prisma.object.create({ data: {
    name: `${marker}-${index}`, address: 'Own isolated WHERE fixture', status: 'active', dailyRate,
    createdByUserId: founder.id,
  } })));
  const ids = objects.map((object) => object.id);
  const baseSubject: AccessSubject = { id: founder.id, isActive: true, roleCodes: ['founder'], accessRules: [] };
  const fixtureOnly: Prisma.ObjectWhereInput = { id: { in: ids } };
  const rule = (effect: 'allow' | 'deny', scope: AccessRule['scope'], actionCode = 'objects.read', selectedIds = [ids[0]]): AccessRule => ({
    actionCode, effect, scope, selectedIds: scope === 'selected' ? selectedIds : [],
  });
  const scopeWhere = (entry: AccessRule): Prisma.ObjectWhereInput | null => {
    if (entry.scope === 'all') return {};
    if (entry.scope === 'selected') return { id: { in: [...entry.selectedIds] } };
    if (entry.scope === 'own') return { createdByUserId: founder.id };
    if (entry.scope === 'assigned') return { assignments: { some: { userId: founder.id, isActive: true } } };
    return null;
  };
  const cases: Array<{
    name: string; legacy: Prisma.ObjectWhereInput; expected: string[]; rules?: AccessRule[];
    invariant?: Prisma.ObjectWhereInput; actionCode?: string; subject?: Partial<AccessSubject>;
    adapter?: (entry: AccessRule) => Prisma.ObjectWhereInput | null; parents?: string[];
  }> = [
    { name: 'legacy false OR:[] is zero', legacy: { OR: [] }, expected: [] },
    { name: 'nested legacy false remains zero', legacy: { OR: [{ OR: [] }] }, expected: [] },
    { name: 'concrete id-in-empty legacy remains zero', legacy: { id: { in: [] } }, expected: [] },
    { name: 'legacy true empty object preserves all fixture rows', legacy: {}, expected: ids },
    { name: 'legacy all plus selected grant stays all', legacy: {}, rules: [rule('allow', 'selected')], expected: ids },
    { name: 'false baseline plus selected grant exposes only selected', legacy: { OR: [] }, rules: [rule('allow', 'selected')], expected: [ids[0]] },
    { name: 'false baseline plus all grant exposes all', legacy: { OR: [] }, rules: [rule('allow', 'all')], expected: ids },
    { name: 'deny all is zero even over legacy all', legacy: {}, rules: [rule('deny', 'all')], expected: [] },
    { name: 'parent deny all overrides child all grant', legacy: {}, rules: [rule('allow', 'all'), rule('deny', 'all', 'objects.access')], expected: [] },
    { name: 'selected deny subtracts only selected', legacy: {}, rules: [rule('deny', 'selected')], expected: [ids[1]] },
    { name: 'all allow plus selected deny leaves only remainder', legacy: { OR: [] }, rules: [rule('allow', 'all'), rule('deny', 'selected')], expected: [ids[1]] },
    { name: 'unrepresentable deny fails closed without NOT-empty bypass', legacy: {}, rules: [rule('deny', 'selected')], adapter: () => null, expected: [] },
    { name: 'false invariant cannot be opened by all grant', legacy: {}, invariant: { OR: [] }, rules: [rule('allow', 'all')], expected: [] },
    { name: 'concrete false invariant stays zero', legacy: {}, invariant: { id: { in: [] } }, expected: [] },
    { name: 'inactive subject zero even with all baseline', legacy: {}, subject: { isActive: false }, expected: [] },
    { name: 'unknown action zero even with all baseline', legacy: {}, actionCode: 'objects.nonexistent', expected: [] },
    { name: 'legacy candidate negative source zero', legacy: {}, actionCode: 'candidates.view', subject: { permissionCodes: ['candidates.view', 'candidates.denied'] }, expected: [] },
    { name: 'legacy candidate negative parent zero', legacy: {}, actionCode: 'files.read', parents: ['candidates.view'], subject: { permissionCodes: ['candidates.denied'] }, expected: [] },
  ];
  for (const example of cases) {
    await t.test(example.name, async () => {
      const policyWhere = buildAccessWhere<Prisma.ObjectWhereInput>({
        subject: { ...baseSubject, ...example.subject, accessRules: example.rules ?? [] },
        actionCode: example.actionCode ?? 'objects.read', legacyWhere: example.legacy,
        invariantWhere: example.invariant ?? {}, scopeWhere: example.adapter ?? scopeWhere,
        parentActionCodes: example.parents,
      }) as Prisma.ObjectWhereInput;
      // The outer id filter only isolates this test's records. It does not repair
      // the helper predicate or permit a pass due to unrelated seeded rows.
      const where: Prisma.ObjectWhereInput = { AND: [fixtureOnly, policyWhere] };
      const actual = await prisma.object.findMany({ where, select: { id: true } });
      const count = await prisma.object.count({ where });
      const aggregate = await prisma.object.aggregate({ where, _sum: { dailyRate: true } });
      const expectedAmount = objects.filter((object) => example.expected.includes(object.id))
        .reduce((sum, object) => sum + object.dailyRate, 0);
      assert.deepEqual({
        ids: actual.map((row) => row.id).sort(), count, sum: aggregate._sum.dailyRate ?? 0,
      }, {
        ids: [...example.expected].sort(), count: example.expected.length, sum: expectedAmount,
      }, example.name);
    });
  }
});
