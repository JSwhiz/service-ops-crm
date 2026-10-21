import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type {
  CandidateCardResponseDto,
  CandidateAssignmentResponseDto,
} from '../src/modules/candidates/dto/candidate-response.dto';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test(
  'multi-manager candidates: API scope, independent SLA and atomic conversion',
  { timeout: 120_000 },
  async (t) => {
    // Refuse to run against the normal development schema, even when invoked directly.
    assert.equal(process.env.TEST_ISOLATED_DATABASE, 'true');
    assert.match(
      new URL(process.env.DATABASE_URL!).searchParams.get('schema') ?? '',
      /^integration_\d+_\d+$/,
    );
    const prisma = new PrismaClient();
    t.after(() => prisma.$disconnect());
    const { app, baseUrl } = await createTestApp();
    t.after(() => app.close());

    const accounts = [
      ['hr1', 'hr123'],
      ['founder', 'founder123'],
      ['manager1', 'manager123'],
      ['manager2', 'manager123'],
      ['berendyakov', 'berendyakov123'],
    ] as const;
    const cookies = new Map<string, string>();
    const ids = new Map<string, string>();
    for (const [login, password] of accounts) {
      cookies.set(
        login,
        await loginAndGetCookieHeader({ baseUrl, login, password }),
      );
      ids.set(
        login,
        (await prisma.user.findUniqueOrThrow({ where: { login } })).id,
      );
    }
    const objects = await Promise.all(
      [0, 1, 2].map((index) =>
        prisma.object.create({
          data: {
            name: `Multi-manager consideration ${index}`,
            address: 'Isolated integration fixture',
            status: 'active',
            createdByUserId: ids.get('founder')!,
          },
        }),
      ),
    );
    const selection = (login: string, index: number) => ({
      managerUserId: ids.get(login)!,
      objectId: objects[index].id,
    });
    const one = selection('manager1', 0);
    const two = selection('manager2', 1);
    const three = selection('berendyakov', 2);

    async function request(
      login: string,
      path: string,
      method = 'GET',
      body?: unknown,
    ) {
      return fetch(`${baseUrl}/api/v1${path}`, {
        method,
        headers: {
          Cookie: cookies.get(login)!,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    }
    async function json<T>(response: Response, status: number): Promise<T> {
      const body = await response.text();
      assert.equal(response.status, status, body);
      return JSON.parse(body) as T;
    }
    async function card(id: string) {
      return json<CandidateCardResponseDto>(
        await request('hr1', `/candidates/${id}`),
        200,
      );
    }
    let sequence = 0;
    async function create(assignments = [one, two]) {
      sequence += 1;
      return json<CandidateCardResponseDto>(
        await request('hr1', '/candidates', 'POST', {
          fullName: `Verifier Candidate ${sequence}`,
          candidateType: 'regular',
          objectId: objects[0].id,
          phones: [
            `+7 (995) 810-${String(sequence).padStart(2, '0')}-11`,
            `+7 (996) 820-${String(sequence).padStart(2, '0')}-22`,
          ],
          comment: 'Isolated candidate verification',
          assignments,
        }),
        201,
      );
    }
    function assignment(candidate: CandidateCardResponseDto, login: string) {
      const value = candidate.currentAssignments.find(
        (item) => item.manager.id === ids.get(login),
      );
      assert.ok(value, `Missing active assignment for ${login}`);
      return value;
    }
    function slaSnapshot(value: CandidateAssignmentResponseDto) {
      return {
        id: value.id,
        assignedAt: value.assignedAt,
        responseDueAt: value.responseDueAt,
        firstRespondedAt: value.firstRespondedAt,
        reminderSentAt: value.reminderSentAt,
      };
    }
    async function replace(
      candidate: CandidateCardResponseDto,
      assignments: (typeof one)[],
    ) {
      return json<CandidateCardResponseDto>(
        await request(
          'hr1',
          `/candidates/${candidate.id}/assignments`,
          'POST',
          {
            assignments,
            expectedVersion: candidate.version,
          },
        ),
        201,
      );
    }
    async function assertScope(
      login: string,
      candidate: CandidateCardResponseDto,
      visible: boolean,
    ) {
      const list = await json<{ items: Array<{ id: string }> }>(
        await request(
          login,
          `/candidates?q=${encodeURIComponent(candidate.fullName)}`,
        ),
        200,
      );
      assert.equal(
        list.items.some((item) => item.id === candidate.id),
        visible,
        `${login}: registry scope`,
      );
      const direct = await request(login, `/candidates/${candidate.id}`);
      assert.equal(
        direct.status,
        visible ? 200 : 404,
        `${login}: direct scope`,
      );
      await direct.text();
      const search = await json<{ items: Array<{ id: string; type: string }> }>(
        await request(
          login,
          `/search?q=${encodeURIComponent(candidate.fullName)}&limit=8`,
        ),
        200,
      );
      assert.equal(
        search.items.some(
          (item) => item.type === 'candidate' && item.id === candidate.id,
        ),
        visible,
        `${login}: global search scope`,
      );
      const recent = await json<Array<{ id: string; type: string }>>(
        await request(login, '/search/recent', 'POST', {
          refs: [{ type: 'candidate', id: candidate.id }],
        }),
        200,
      );
      assert.deepEqual(
        recent.map((item) => [item.type, item.id]),
        visible ? [['candidate', candidate.id]] : [],
        `${login}: recent scope`,
      );
    }

    await t.test(
      'create accepts phones and manager/object pairs; regular still requires legacy objectId',
      async () => {
        const denied = await request('hr1', '/candidates', 'POST', {
          fullName: 'Missing legacy object',
          candidateType: 'regular',
          phones: ['+79990000101'],
          assignments: [one, two],
        });
        assert.equal(denied.status, 400);
        assert.equal(
          await prisma.candidate.count({
            where: { fullName: 'Missing legacy object' },
          }),
          0,
        );
        const candidate = await create();
        assert.equal(candidate.phone, candidate.phones[0]);
        assert.equal(candidate.phones.length, 2);
        assert.equal(candidate.object?.id, objects[0].id);
        assert.equal(candidate.currentAssignments.length, 2);
        for (const [login, index] of [
          ['manager1', 0],
          ['manager2', 1],
        ] as const) {
          const active = assignment(candidate, login);
          assert.equal(active.object?.id, objects[index].id);
          assert.equal(active.firstRespondedAt, null);
          assert.equal(
            Date.parse(active.responseDueAt) - Date.parse(active.assignedAt),
            2 * 60 * 60 * 1000,
          );
          await assertScope(login, candidate, true);
        }
        await assertScope('berendyakov', candidate, false);
        await assertScope('hr1', candidate, true);
        await assertScope('founder', candidate, true);
        const removed = await replace(candidate, [two]);
        assert.equal(removed.currentAssignments.length, 1);
        assert.ok(
          removed.assignments.find(
            (item) => item.manager.id === one.managerUserId,
          )?.endedAt,
        );
        await assertScope('manager1', removed, false);
        await assertScope('manager2', removed, true);
        const feedback = await request(
          'manager1',
          `/candidates/${candidate.id}/responses`,
          'POST',
          { text: 'Removed manager' },
        );
        assert.equal(feedback.status, 403);
        assert.equal((await card(candidate.id)).responses.length, 0);
      },
    );

    await t.test(
      'assignment removal revokes all four read paths and feedback',
      async () => {
        const candidate = await create([one]);
        await assertScope('manager1', candidate, true);
        await assertScope('manager2', candidate, false);
        await assertScope('hr1', candidate, true);
        await assertScope('founder', candidate, true);
        const replaced = await replace(candidate, [two]);
        await assertScope('manager1', replaced, false);
        await assertScope('manager2', replaced, true);
        const denied = await request(
          'manager1',
          `/candidates/${candidate.id}/responses`,
          'POST',
          { text: 'Removed manager' },
        );
        assert.equal(denied.status, 403);
        assert.equal((await card(candidate.id)).responses.length, 0);
      },
    );

    await t.test(
      'HR and leadership feedback do not satisfy manager SLA',
      async () => {
        let candidate = await create([one]);
        const original = candidate.currentAssignments.map(slaSnapshot);
        for (const login of ['hr1', 'founder']) {
          candidate = await json<CandidateCardResponseDto>(
            await request(
              login,
              `/candidates/${candidate.id}/responses`,
              'POST',
              { text: `${login} feedback` },
            ),
            201,
          );
          assert.deepEqual(
            candidate.currentAssignments.map(slaSnapshot),
            original,
          );
          assert.equal(candidate.responses.at(-1)?.assignmentId, null);
          assert.equal(candidate.status, 'new');
          assert.equal(candidate.slaState, 'awaiting_response');
        }
      },
    );

    await t.test(
      'each assigned manager satisfies only their own SLA',
      async () => {
        let candidate = await create();
        candidate = await json<CandidateCardResponseDto>(
          await request(
            'manager1',
            `/candidates/${candidate.id}/responses`,
            'POST',
            { text: 'First manager response' },
          ),
          201,
        );
        assert.ok(assignment(candidate, 'manager1').firstRespondedAt);
        assert.equal(assignment(candidate, 'manager2').firstRespondedAt, null);
        assert.equal(
          candidate.responses.at(-1)?.assignmentId,
          assignment(candidate, 'manager1').id,
        );
        assert.equal(candidate.slaState, 'awaiting_response');
        const first = assignment(candidate, 'manager1').firstRespondedAt;
        candidate = await json<CandidateCardResponseDto>(
          await request(
            'manager1',
            `/candidates/${candidate.id}/responses`,
            'POST',
            { text: 'Follow-up' },
          ),
          201,
        );
        assert.equal(assignment(candidate, 'manager1').firstRespondedAt, first);
        candidate = await json<CandidateCardResponseDto>(
          await request(
            'manager2',
            `/candidates/${candidate.id}/responses`,
            'POST',
            { text: 'Second manager response' },
          ),
          201,
        );
        assert.ok(assignment(candidate, 'manager2').firstRespondedAt);
        assert.equal(candidate.slaState, 'responded');
      },
    );

    await t.test(
      'manager and SLA filters must match the same active assignment',
      async () => {
        const candidate = await create();
        await json<CandidateCardResponseDto>(
          await request(
            'manager1',
            `/candidates/${candidate.id}/responses`,
            'POST',
            { text: 'Only manager one has responded' },
          ),
          201,
        );
        const observations: Array<{
          login: string;
          state: string;
          actual: boolean;
          expected: boolean;
        }> = [];
        async function check(login: string, state: string, expected: boolean) {
          const query = new URLSearchParams({
            q: candidate.fullName,
            managerUserId: ids.get(login)!,
            slaState: state,
          });
          const result = await json<{ items: Array<{ id: string }> }>(
            await request('hr1', `/candidates?${query}`),
            200,
          );
          observations.push({
            login,
            state,
            actual: result.items.some((item) => item.id === candidate.id),
            expected,
          });
        }
        await check('manager1', 'responded', true);
        await check('manager1', 'awaiting_response', false);
        await check('manager2', 'responded', false);
        await check('manager2', 'awaiting_response', true);
        // Advance only the isolated fixture's deadline; do not wait for the two-hour SLA.
        await prisma.candidateManagerAssignment.update({
          where: { id: assignment(candidate, 'manager2').id },
          data: { responseDueAt: new Date(Date.now() - 60_000) },
        });
        await check('manager1', 'overdue', false);
        await check('manager2', 'overdue', true);
        await check('manager1', 'responded', true);
        await check('manager2', 'responded', false);
        await check('manager1', 'awaiting_response', false);
        await check('manager2', 'awaiting_response', false);
        await check('manager1', 'unassigned', false);
        await check('manager2', 'unassigned', false);
        for (const state of [
          'responded',
          'awaiting_response',
          'overdue',
          'unassigned',
        ]) {
          await check('berendyakov', state, false);
        }
        assert.deepEqual(
          observations.filter((item) => item.actual !== item.expected),
          [],
          'A different manager must not satisfy the selected manager SLA filter',
        );
      },
    );

    await t.test(
      'adding a second manager and removing a third preserves unchanged assignment SLA and history',
      async () => {
        let candidate = await create([one, three]);
        const pending = slaSnapshot(assignment(candidate, 'manager1'));
        candidate = await replace(candidate, [one, two, three]);
        assert.deepEqual(
          slaSnapshot(assignment(candidate, 'manager1')),
          pending,
        );
        candidate = await json<CandidateCardResponseDto>(
          await request(
            'manager1',
            `/candidates/${candidate.id}/responses`,
            'POST',
            { text: 'Preserve my response' },
          ),
          201,
        );
        const responded = slaSnapshot(assignment(candidate, 'manager1'));
        const second = slaSnapshot(assignment(candidate, 'manager2'));
        const thirdId = assignment(candidate, 'berendyakov').id;
        candidate = await replace(candidate, [one, two]);
        assert.deepEqual(
          slaSnapshot(assignment(candidate, 'manager1')),
          responded,
        );
        assert.deepEqual(
          slaSnapshot(assignment(candidate, 'manager2')),
          second,
        );
        assert.equal(candidate.assignments.length, 3);
        assert.ok(
          candidate.assignments.find((item) => item.id === thirdId)?.endedAt,
        );
        assert.equal(candidate.responses[0]?.assignmentId, responded.id);
        await assertScope('berendyakov', candidate, false);
        const version = candidate.version;
        candidate = await replace(candidate, [one, two]);
        assert.equal(
          candidate.version,
          version,
          'Identical replacement must not restart assignment lifecycle',
        );
        assert.deepEqual(
          slaSnapshot(assignment(candidate, 'manager1')),
          responded,
        );
      },
    );

    await t.test(
      'every phone is searchable as digits and with different punctuation in registry and global search',
      async () => {
        const candidate = await create([one]);
        for (const phone of candidate.phones) {
          const digits = phone.replace(/\D/g, '');
          const repunctuated = `${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4, 7)} ${digits.slice(7, 9)}-${digits.slice(9)}`;
          for (const query of [digits, phone, repunctuated, `8${digits.slice(1)}`, digits.slice(1)]) {
            for (const endpoint of ['/candidates', '/search']) {
              const result = await json<{ items: Array<{ id: string }> }>(
                await request(
                  'manager1',
                  `${endpoint}?q=${encodeURIComponent(query)}`,
                ),
                200,
              );
              assert.ok(
                result.items.some((item) => item.id === candidate.id),
                `${endpoint}: missing phone ${query}`,
              );
            }
          }
        }
      },
    );

    await t.test(
      'conversion rejects manager and stale version, then concurrent retries create exactly one unassigned employee',
      async () => {
        const candidate = await create();
        const employeeCount = await prisma.employee.count();
        for (const [login, version, status] of [
          ['manager1', candidate.version, 403],
          ['hr1', candidate.version + 1, 409],
        ] as const) {
          const denied = await request(
            login,
            `/candidates/${candidate.id}/employee`,
            'POST',
            { expectedVersion: version },
          );
          assert.equal(denied.status, status, await denied.text());
          assert.equal(await prisma.employee.count(), employeeCount);
          const unchanged = await card(candidate.id);
          assert.equal(unchanged.employeeId, null);
          assert.equal(unchanged.status, candidate.status);
          assert.equal(unchanged.version, candidate.version);
          assert.deepEqual(
            unchanged.currentAssignments,
            candidate.currentAssignments,
          );
        }
        const convert = (login = 'hr1') =>
          request(login, `/candidates/${candidate.id}/employee`, 'POST', {
            expectedVersion: candidate.version,
            employeeType: 'regular',
          });
        const results = await Promise.all(
          Array.from({ length: 8 }, (_, index) =>
            convert(index % 2 ? 'founder' : 'hr1'),
          ),
        );
        const converted = await Promise.all(
          results.map((result) => json<CandidateCardResponseDto>(result, 201)),
        );
        const employeeId = converted[0].employeeId;
        assert.ok(employeeId);
        assert.ok(converted.every((item) => item.employeeId === employeeId));
        const retry = await json<CandidateCardResponseDto>(
          await convert(),
          201,
        );
        assert.equal(retry.employeeId, employeeId);
        assert.equal(retry.status, 'accepted');
        assert.equal(retry.version, candidate.version + 1);
        assert.equal(retry.currentAssignments.length, 0);
        assert.ok(retry.assignments.every((item) => item.endedAt));
        assert.equal(await prisma.employee.count(), employeeCount + 1);
        const employee = await prisma.employee.findUniqueOrThrow({
          where: { id: employeeId },
          include: { objectAssignments: true, objectAssignmentHistory: true },
        });
        assert.equal(employee.fullName, candidate.fullName);
        assert.equal(employee.phone, candidate.phone);
        assert.equal(employee.notes, candidate.comment);
        assert.equal(employee.employeeType, 'regular');
        assert.deepEqual(employee.objectAssignments, []);
        assert.deepEqual(employee.objectAssignmentHistory, []);
        assert.equal(
          await prisma.auditEvent.count({
            where: {
              entityType: 'candidate',
              entityId: candidate.id,
              action: 'candidate.employee_created',
            },
          }),
          1,
        );
        assert.equal(
          await prisma.auditEvent.count({
            where: {
              entityType: 'employee',
              entityId: employeeId,
              action: 'employee.created',
            },
          }),
          1,
        );
      },
    );

    await t.test(
      'conversion rolls back employee, candidate and assignment writes when its final audit fails',
      async () => {
        const candidate = await create([one]);
        const employeeCount = await prisma.employee.count();
        const auditCount = await prisma.auditEvent.count();
        // Inject a real database failure at the end of conversion, in this isolated schema only.
        // NOT VALID leaves audit records from earlier subtests untouched.
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "audit_events" ADD CONSTRAINT "verifier_reject_conversion_audit" CHECK ("action" <> 'candidate.employee_created') NOT VALID`,
        );
        try {
          const failed = await request(
            'hr1',
            `/candidates/${candidate.id}/employee`,
            'POST',
            { expectedVersion: candidate.version },
          );
          assert.equal(failed.status, 500, await failed.text());
          assert.equal(
            await prisma.employee.count(),
            employeeCount,
            'Employee insert must roll back',
          );
          assert.equal(
            await prisma.auditEvent.count(),
            auditCount,
            'Employee audit must roll back',
          );
          const unchanged = await card(candidate.id);
          assert.equal(unchanged.employeeId, null);
          assert.equal(unchanged.status, candidate.status);
          assert.equal(unchanged.version, candidate.version);
          assert.deepEqual(
            unchanged.currentAssignments,
            candidate.currentAssignments,
            'Assignment closure must roll back',
          );
        } finally {
          await prisma.$executeRawUnsafe(
            'ALTER TABLE "audit_events" DROP CONSTRAINT "verifier_reject_conversion_audit"',
          );
        }
        const retried = await json<CandidateCardResponseDto>(
          await request('hr1', `/candidates/${candidate.id}/employee`, 'POST', {
            expectedVersion: candidate.version,
          }),
          201,
        );
        assert.ok(retried.employeeId);
        assert.equal(await prisma.employee.count(), employeeCount + 1);
      },
    );

    await t.test(
      'concurrent assignment replacements produce one winner and one explicit version conflict',
      async () => {
        const candidate = await create([one]);
        const results = await Promise.all(
          [
            [one, two],
            [one, three],
          ].map((assignments) =>
            request('hr1', `/candidates/${candidate.id}/assignments`, 'POST', {
              expectedVersion: candidate.version,
              assignments,
            }),
          ),
        );
        assert.deepEqual(
          results.map((result) => result.status).sort(),
          [201, 409],
        );
        const conflict = (await results
          .find((result) => result.status === 409)!
          .json()) as { code: string };
        assert.equal(conflict.code, 'CANDIDATE_VERSION_CONFLICT');
        const winner = await json<CandidateCardResponseDto>(
          results.find((result) => result.status === 201)!,
          201,
        );
        const final = await card(candidate.id);
        assert.equal(final.version, candidate.version + 1);
        assert.deepEqual(final.currentAssignments, winner.currentAssignments);
        assert.equal(final.currentAssignments.length, 2);
        assert.equal(
          final.assignments.length,
          2,
          'Losing replacement must not leave partial assignment history',
        );
        assert.deepEqual(
          slaSnapshot(assignment(final, 'manager1')),
          slaSnapshot(assignment(candidate, 'manager1')),
        );
        await assertScope(
          'manager2',
          final,
          final.currentAssignments.some(
            (item) => item.manager.id === two.managerUserId,
          ),
        );
        await assertScope(
          'berendyakov',
          final,
          final.currentAssignments.some(
            (item) => item.manager.id === three.managerUserId,
          ),
        );
      },
    );
  },
);
