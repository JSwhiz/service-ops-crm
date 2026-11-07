import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { ObjectResponseDto } from '../src/modules/objects/dto/object-response.dto';
import type { ObjectAuditLogResponseDto } from '../src/modules/objects/dto/object-audit-log-response.dto';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('root object DTO and nested history honor staffing, actual Employee and materials/contact read denies', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  assert.match(new URL(process.env.DATABASE_URL!).searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());
  const { app, baseUrl } = await createTestApp();
  t.after(() => app.close());
  const [template, role, founder] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }), prisma.role.findUniqueOrThrow({ where: { code: 'manager' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
  ]);
  const marker = `acl-object-dto-${randomUUID()}`;
  const reader = await prisma.user.create({ data: { login: marker, fullName: marker, passwordHash: template.passwordHash,
    isActive: true, roles: { create: { roleId: role.id } } } });
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: reader.login, password: 'manager123' });
  const instructions = [`Private instruction ${randomUUID()}`];
  const object = await prisma.object.create({ data: { name: marker, address: marker, status: 'active',
    createdByUserId: founder.id, instructionSteps: instructions,
    assignments: { create: { userId: reader.id, assignmentRoleCode: 'manager', isActive: true } } } });
  const employees = await Promise.all(['restricted', 'control'].map((suffix) => prisma.employee.create({ data: {
    fullName: `${marker}-${suffix}`, employmentStatus: 'active',
  } })));
  await prisma.objectEmployeeAssignment.createMany({ data: employees.map((employee) => ({ objectId: object.id, employeeId: employee.id, isActive: true })) });
  const contact = await prisma.objectContact.create({ data: { objectId: object.id, name: `Private contact ${randomUUID()}`, phones: ['+79990000001'] } });
  const logs = await Promise.all([
    prisma.objectAuditLog.create({ data: { objectId: object.id, actorUserId: founder.id, actionCode: 'object.contacts.updated',
      payload: { contactId: contact.id, before: { name: contact.name }, after: { phones: contact.phones } } } }),
    prisma.objectAuditLog.create({ data: { objectId: object.id, actorUserId: founder.id, actionCode: 'object.updated',
      payload: { changes: [{ before: { instructionSteps: instructions }, after: { instructionSteps: instructions } }], note: 'Public control note' } } }),
  ]);
  const get = (path: string) => fetch(`${baseUrl}/api/v1${path}`, { headers: { Cookie: cookie } });
  const card = async () => {
    const response = await get(`/objects/${object.id}`);
    assert.equal(response.status, 200, await response.clone().text());
    return await response.json() as ObjectResponseDto;
  };
  const history = async () => {
    const response = await get(`/objects/${object.id}/audit`);
    assert.equal(response.status, 200, await response.clone().text());
    return await response.json() as ObjectAuditLogResponseDto[];
  };
  const reset = () => prisma.userAccessRule.deleteMany({ where: { userId: reader.id } });
  const deny = (actionCode: string, id = object.id) => prisma.userAccessRule.create({ data: {
    userId: reader.id, actionCode, effect: 'deny', scope: 'selected', selectedIds: [id],
  } });
  await t.test('baseline proves actual linked employees, instructions and contact audit are present', async () => {
    const before = await card();
    assert.deepEqual(new Set(before.employees.map((employee) => employee.id)), new Set(employees.map((employee) => employee.id)));
    assert.deepEqual(before.instructionSteps, instructions);
    assert.ok(JSON.stringify(await history()).includes(contact.name));
    assert.ok(JSON.stringify(await history()).includes(instructions[0]));
  });
  await t.test('staffing read deny omits employees from root card, not just a dedicated staffing endpoint', async () => {
    await reset();
    await deny('objects.staffing.read');
    const result = await card();
    assert.equal(result.capabilities.canViewEmployees, false);
    assert.deepEqual(result.employees, []);
    assert.equal(JSON.stringify(result).includes(employees[0].fullName), false);
    assert.deepEqual(result.instructionSteps, instructions);
  });
  await t.test('actual Employee selected deny filters only that linked employee; control remains in root DTO', async () => {
    await reset();
    await deny('employees.view', employees[0].id);
    const result = await card();
    assert.deepEqual(result.employees.map((employee) => employee.id), [employees[1].id]);
    assert.equal(JSON.stringify(result).includes(employees[0].fullName), false);
    assert.deepEqual(result.instructionSteps, instructions);
  });
  await t.test('materials denial removes root instructions and deep audit snapshots, preserving contact/control fields', async () => {
    await reset();
    await deny('objects.materials.read');
    const result = await card();
    assert.equal(result.capabilities.canReadMaterials, false);
    assert.deepEqual(result.instructionSteps, []);
    assert.equal(result.employees.length, 2);
    const items = await history();
    const instructionLog = items.find((item) => item.id === logs[1].id);
    assert.ok(instructionLog);
    assert.equal(JSON.stringify(instructionLog.payload).includes(instructions[0]), false);
    assert.ok(JSON.stringify(instructionLog.payload).includes('Public control note'));
    assert.ok(JSON.stringify(items.find((item) => item.id === logs[0].id)?.payload).includes(contact.name));
  });
  await t.test('contacts denial hides whole named-contact audit payload while preserving instructions history', async () => {
    await reset();
    await deny('objects.contacts.read');
    const result = await card();
    assert.equal(result.capabilities.canReadContacts, false);
    assert.deepEqual(result.instructionSteps, instructions);
    const items = await history();
    assert.equal(items.find((item) => item.id === logs[0].id)?.payload, null);
    assert.ok(JSON.stringify(items.find((item) => item.id === logs[1].id)?.payload).includes(instructions[0]));
    await reset();
    assert.ok(JSON.stringify(await history()).includes(contact.name), 'Original cookie must see restored baseline');
  });
});
