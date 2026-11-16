import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { ObjectOperationsService } from '../src/modules/object-operations/object-operations.service';
import type { AccessRule } from '../src/modules/users-access/types/access-policy.type';

for (const parent of ['objects.read', 'objects.access']) {
  for (const scope of ['own', 'assigned', 'selected', 'all'] as const) {
    test(`staffing grant cannot override ${parent} deny in ${scope} scope`, async () => {
      let staffingReads = 0;
      const objects = {
        target: { id: 'target', createdByUserId: 'reader', assignments: [{ userId: 'reader', isActive: true }] },
        control: { id: 'control', createdByUserId: 'other', assignments: [] },
      };
      const db = {
        object: {
          findFirst: async ({ where }: { where: { id: keyof typeof objects } }) => objects[where.id],
          findUnique: async () => ({ paymentType: 'daily', dailyRate: 100 }),
        },
        objectEmployeeAssignment: { findMany: async () => { staffingReads += 1; return []; } },
      };
      const service = new ObjectOperationsService(db as never, {} as never, {} as never,
        {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
      const accessRules: AccessRule[] = [
        { actionCode: 'objects.staffing.read', effect: 'allow', scope: 'all', selectedIds: [] },
        { actionCode: parent, effect: 'deny', scope, selectedIds: scope === 'selected' ? ['target'] : [] },
      ];
      const reader = { id: 'reader', login: 'reader', fullName: 'Reader', isActive: true,
        roleCode: 'manager', roleCodes: ['manager'], permissionCodes: [], accessRules };
      await assert.rejects(service.listObjectEmployees(reader, 'target'),
        (error: unknown) => error instanceof ForbiddenException && error.message === 'Нет доступа к составу команды объекта');
      assert.equal(staffingReads, 0, 'No protected staffing query after parent denial');
      if (scope !== 'all') {
        assert.deepEqual(await service.listObjectEmployees(reader, 'control'), []);
        assert.equal(staffingReads, 1, 'Unrelated resource remains readable');
      }
    });
  }
}
