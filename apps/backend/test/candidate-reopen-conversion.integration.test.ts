import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { CandidateCardResponseDto } from '../src/modules/candidates/dto/candidate-response.dto';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('closed regular candidates reopen only with a manager; conversion keeps every phone', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  t.after(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const cookie = await loginAndGetCookieHeader({ baseUrl, login: 'hr1', password: 'hr123' });
  const [founder, manager] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
  ]);
  const object = await prisma.object.create({
    data: { name: `Кандидаты ${randomUUID()}`, address: 'Тест', status: 'active', createdByUserId: founder.id },
  });
  const request = async (path: string, method = 'GET', body?: object): Promise<Response> => fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = async (response: Response, status: number): Promise<CandidateCardResponseDto> => {
    const text = await response.text();
    assert.equal(response.status, status, text);
    return JSON.parse(text) as CandidateCardResponseDto;
  };

  let candidate = await json(await request('/candidates', 'POST', {
    fullName: `Кандидат ${randomUUID().slice(0, 8)}`,
    candidateType: 'regular',
    objectId: object.id,
    phones: ['+7 900 111-22-33', '+7 900 444-55-66'],
    comment: 'Опыт уборки',
    assignments: [{ managerUserId: manager.id, objectId: object.id }],
  }), 201);

  candidate = await json(await request(`/candidates/${candidate.id}/status`, 'POST', {
    expectedVersion: candidate.version, status: 'rejected',
  }), 201);

  const withoutManager = await request(`/candidates/${candidate.id}/status`, 'POST', {
    expectedVersion: candidate.version, status: 'in_progress',
  });
  assert.equal(withoutManager.status, 400);
  assert.equal(((await withoutManager.json()) as { code?: string }).code, 'CANDIDATE_MANAGER_REQUIRED');

  candidate = await json(await request(`/candidates/${candidate.id}/status`, 'POST', {
    expectedVersion: candidate.version,
    status: 'in_progress',
    assignments: [{ managerUserId: manager.id, objectId: object.id }],
  }), 201);
  assert.equal(candidate.status, 'in_progress');
  assert.equal(await prisma.candidateManagerAssignment.count({ where: { candidateId: candidate.id, endedAt: null } }), 1);

  candidate = await json(await request(`/candidates/${candidate.id}/employee`, 'POST', {
    expectedVersion: candidate.version, employeeType: 'regular',
  }), 201);
  const employee = await prisma.employee.findUniqueOrThrow({ where: { id: candidate.employeeId! } });
  assert.equal(employee.phone, '+7 900 111-22-33');
  assert.match(employee.notes ?? '', /Опыт уборки/);
  assert.deepEqual(employee.phones, ['+7 900 111-22-33', '+7 900 444-55-66']);
});
