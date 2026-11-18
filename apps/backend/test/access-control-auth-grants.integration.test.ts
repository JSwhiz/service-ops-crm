import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '../src/modules/auth/constants/auth.constants';
import type { MeResponseDto } from '../src/modules/auth/dto/me-response.dto';
import { getCookieValue } from '../src/modules/auth/utils/auth-cookie.util';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type Scope = 'own' | 'all';
type AuthAction = 'auth.access' | 'auth.login' | 'auth.me' | 'auth.refresh';

test('auth grants enforce live own/all rules over actual HTTP cookies while logout remains an escape', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const definitions = ACCESS_ACTION_CATALOG.filter(({ module }) => module === 'auth');
  assert.deepEqual(definitions.map(({ code }) => code).sort(), ['auth.access', 'auth.login', 'auth.me', 'auth.refresh', 'auth.logout'].sort());
  for (const definition of definitions) {
    assert.deepEqual(definition.allowedScopes, ['own', 'all']);
    assert.equal(definition.manageable, definition.code !== 'auth.logout');
  }
  assert.equal(definitions.find(({ code }) => code === 'auth.logout')!.constraint, 'logout_always_available');

  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  t.after(async () => { try { await closeApp?.(); } finally { await prisma.$disconnect(); } });
  // Never mutate a seeded account, role, role membership or legacy permission.
  const seeded = await prisma.user.findMany({ orderBy: { id: 'asc' } });
  const seededIds = seeded.map(({ id }) => id);
  const sourceSnapshot = async () => ({
    users: await prisma.user.findMany({ where: { id: { in: seededIds } }, orderBy: { id: 'asc' } }),
    roles: await prisma.role.findMany({ orderBy: { id: 'asc' } }),
    memberships: await prisma.userRole.findMany({ where: { userId: { in: seededIds } }, orderBy: { id: 'asc' } }),
    permissions: await prisma.permission.findMany({ orderBy: { id: 'asc' } }),
    rolePermissions: await prisma.rolePermission.findMany({ orderBy: { id: 'asc' } }),
    directPermissions: await prisma.userPermission.findMany({ where: { userId: { in: seededIds } }, orderBy: { id: 'asc' } }),
  });
  const originalSources = await sourceSnapshot();
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  assert.ok(template.passwordHash);
  const managerRole = await prisma.role.findUniqueOrThrow({ where: { code: 'manager' } });
  const founderRole = await prisma.role.findUniqueOrThrow({ where: { code: 'founder' } });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const marker = `auth-grants-${randomUUID()}`;
  const ownedIds: string[] = [];
  let sequence = 0;
  const makeUser = async (label: string, founder = false) => {
    const saved = await prisma.user.create({ data: {
      login: `${marker}-${label}-${++sequence}`, fullName: `Auth acceptance ${label}`, passwordHash: template.passwordHash,
      isActive: true, roles: { create: { roleId: founder ? founderRole.id : managerRole.id } },
    } });
    ownedIds.push(saved.id);
    return saved;
  };
  type Actor = Awaited<ReturnType<typeof makeUser>>;
  const request = (path: string, method = 'GET', cookie = '', body?: unknown) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json', 'User-Agent': 'acl-auth-grants-fixture' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const expectStatus = async (response: Response, expected: number) => {
    assert.equal(response.status, expected, await response.clone().text());
  };
  const cookieHeaders = (response: Response): string[] => {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    assert.equal(typeof headers.getSetCookie, 'function', 'Require separate Set-Cookie headers; do not split Expires commas');
    return headers.getSetCookie!();
  };
  const authCookies = (response: Response) => cookieHeaders(response).filter((value) =>
    value.startsWith(`${ACCESS_TOKEN_COOKIE}=`) || value.startsWith(`${REFRESH_TOKEN_COOKIE}=`));
  const issuedCookies = (response: Response) => {
    const headers = authCookies(response);
    assert.equal(headers.length, 2);
    for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE]) {
      const header = headers.find((value) => value.startsWith(`${name}=`));
      assert.ok(header);
      assert.match(header, /; HttpOnly(?:;|$)/i);
      assert.match(header, name === ACCESS_TOKEN_COOKIE ? /; Path=\/(?:;|$)/i : /; Path=\/api\/v1\/auth(?:;|$)/i);
      const expires = /; Expires=([^;]+)/i.exec(header)?.[1];
      assert.ok(expires && Date.parse(expires) > Date.now());
    }
    const cookie = headers.map((value) => value.split(';', 1)[0]).join('; ');
    assert.ok(getCookieValue(cookie, ACCESS_TOKEN_COOKIE));
    assert.ok(getCookieValue(cookie, REFRESH_TOKEN_COOKIE));
    return cookie;
  };
  const noIssuedCookies = (response: Response) => {
    for (const header of authCookies(response)) assert.equal(header.split(';', 1)[0]!.split('=', 2)[1], '', 'Failure must not issue a usable token');
  };
  const clearedCookies = (response: Response) => {
    const headers = authCookies(response);
    assert.equal(headers.length, 2);
    for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE]) {
      const header = headers.find((value) => value.startsWith(`${name}=`));
      assert.ok(header);
      assert.equal(header.split(';', 1)[0], `${name}=`);
      const expires = /; Expires=([^;]+)/i.exec(header)?.[1];
      assert.ok(expires && Date.parse(expires) < Date.now());
      assert.match(header, name === ACCESS_TOKEN_COOKIE ? /; Path=\/(?:;|$)/i : /; Path=\/api\/v1\/auth(?:;|$)/i);
    }
  };
  const profile = (value: MeResponseDto, actor: Actor, role = 'manager') => {
    assert.equal(value.id, actor.id);
    assert.equal(value.login, actor.login);
    assert.equal(value.fullName, actor.fullName);
    assert.equal(value.isActive, true);
    assert.equal(value.roleCode, role);
    assert.deepEqual(value.roleCodes, [role]);
    assert.equal(typeof value.accessVersion, 'number');
    assert.ok(Array.isArray(value.accessRules));
    assert.ok(Object.keys(value.capabilities).length > 0);
    assert.ok(Object.values(value.capabilities).every((item) => typeof item === 'boolean'));
    for (const key of ['passwordHash', 'password', 'permissionCodes', 'accessToken', 'refreshToken']) assert.equal(key in value, false);
  };
  const loginResponse = (actor: Actor, password = 'manager123') => request('/auth/login', 'POST', '', { login: actor.login, password });
  const login = async (actor: Actor, role = 'manager') => {
    const response = await loginResponse(actor);
    await expectStatus(response, 201);
    const cookie = issuedCookies(response);
    const payload = await response.json() as { user: MeResponseDto };
    assert.deepEqual(Object.keys(payload), ['user']);
    profile(payload.user, actor, role);
    return { cookie, user: payload.user };
  };
  const me = async (actor: Actor, cookie: string, role = 'manager') => {
    const response = await request('/auth/me', 'GET', cookie);
    await expectStatus(response, 200);
    assert.deepEqual(authCookies(response), [], 'GET me must not silently issue/rotate cookies');
    const dto = await response.json() as MeResponseDto;
    profile(dto, actor, role);
    return dto;
  };
  const sessions = (actor: Actor) => prisma.authSession.findMany({ where: { userId: actor.id }, orderBy: { id: 'asc' } });
  const rule = (actor: Actor, actionCode: string, effect: 'allow' | 'deny', scope: Scope | 'selected' = 'own') => prisma.userAccessRule.upsert({
    where: { userId_actionCode: { userId: actor.id, actionCode } },
    create: { userId: actor.id, actionCode, effect, scope, selectedIds: scope === 'selected' ? [actor.id] : [] },
    update: { effect, scope, selectedIds: scope === 'selected' ? [actor.id] : [] },
  });
  const revoke = (actor: Actor, actionCode: string) => prisma.userAccessRule.delete({
    where: { userId_actionCode: { userId: actor.id, actionCode } },
  });
  const logout = async (cookie = '') => {
    const response = await request('/auth/logout', 'POST', cookie);
    await expectStatus(response, 201);
    assert.deepEqual(await response.json(), { success: true });
    clearedCookies(response);
  };
  const refresh = async (actor: Actor, cookie: string) => {
    const before = await sessions(actor);
    const response = await request('/auth/refresh', 'POST', cookie);
    await expectStatus(response, 201);
    const nextCookie = issuedCookies(response);
    assert.notEqual(getCookieValue(nextCookie, REFRESH_TOKEN_COOKIE), getCookieValue(cookie, REFRESH_TOKEN_COOKIE));
    // Access JWT may be identical if signed in the same second; actual acceptance
    // and refresh-session rotation, not token inequality, are the proof.
    const payload = await response.json() as { user: MeResponseDto };
    assert.deepEqual(Object.keys(payload), ['user']);
    profile(payload.user, actor);
    const after = await sessions(actor);
    assert.equal(after.length, before.length + 1);
    const added = after.filter((row) => !before.some(({ id }) => id === row.id));
    assert.equal(added.length, 1);
    assert.equal(added[0]!.revokedAt, null);
    assert.equal(added[0]!.userAgent, 'acl-auth-grants-fixture');
    assert.ok(added[0]!.ipAddress);
    const rotated = after.filter((row) => before.some((old) => old.id === row.id && old.revokedAt === null) && row.replacedBySessionId === added[0]!.id);
    assert.equal(rotated.length, 1);
    assert.ok(rotated[0]!.revokedAt);
    await me(actor, nextCookie);
    return { cookie: nextCookie, user: payload.user };
  };
  const blockedRefresh = async (actor: Actor, cookie: string, revokeActive: boolean) => {
    const before = await sessions(actor);
    const response = await request('/auth/refresh', 'POST', cookie);
    await expectStatus(response, 401);
    clearedCookies(response);
    noIssuedCookies(response);
    const after = await sessions(actor);
    assert.deepEqual(after.map(({ id }) => id), before.map(({ id }) => id), 'Denied refresh must not create a replacement identity/session');
    if (revokeActive) {
      const changed = after.filter((row) => before.find(({ id }) => id === row.id)!.revokedAt === null && row.revokedAt !== null);
      assert.equal(changed.length, 1);
      assert.equal(changed[0]!.replacedBySessionId, null);
    } else assert.deepEqual(after, before);
  };
  const control = await makeUser('unrelated-control');
  const controlSession = await login(control);

  await t.test('default login/me/refresh returns actual DTOs, rotates refresh only once, and exposes fresh metadata/API capabilities', async () => {
    const actor = await makeUser('default');
    const first = await login(actor);
    assert.deepEqual((await me(actor, first.cookie)).capabilities, first.user.capabilities);
    const deny = await rule(actor, 'search.query', 'deny', 'all');
    const fresh = await me(actor, first.cookie);
    assert.equal(fresh.capabilities.canAccessSearch, false);
    assert.ok(fresh.accessRules.some((row) => row.actionCode === deny.actionCode && row.effect === 'deny'));
    await expectStatus(await request('/search?q=auth-acceptance', 'GET', first.cookie), 403);
    const rotated = await refresh(actor, first.cookie);
    assert.equal(rotated.user.capabilities.canAccessSearch, false);
    await blockedRefresh(actor, first.cookie, false); // Replay cannot rotate the already consumed token.
    await revoke(actor, 'search.query');
    assert.equal((await me(actor, first.cookie)).capabilities.canAccessSearch, true);
    await expectStatus(await request('/search?q=auth-acceptance', 'GET', rotated.cookie), 200);
    await logout(rotated.cookie);
    await blockedRefresh(actor, rotated.cookie, false);
  });

  for (const scope of ['own', 'all'] as const) {
    for (const actionCode of ['auth.login', 'auth.me', 'auth.refresh', 'auth.access'] as const satisfies readonly AuthAction[]) {
      await t.test(`${actionCode} ${scope}: explicit allow/deny/live old cookie/default and unrelated control`, async () => {
        const actor = await makeUser(`${actionCode}-${scope}`);
        const first = await login(actor);
        await rule(actor, actionCode, 'allow', scope);
        await me(actor, first.cookie);
        let current = first;
        if (actionCode === 'auth.login') current = await login(actor);
        else if (actionCode === 'auth.refresh') current = await refresh(actor, first.cookie);
        await rule(actor, actionCode, 'deny', scope);
        if (actionCode === 'auth.login') {
          const before = await sessions(actor);
          const denied = await loginResponse(actor);
          await expectStatus(denied, 401);
          noIssuedCookies(denied);
          assert.deepEqual(await sessions(actor), before);
          await me(actor, current.cookie); // Login and profile are independent leaves.
        } else if (actionCode === 'auth.me') {
          await expectStatus(await request('/auth/me', 'GET', current.cookie), 401);
          await expectStatus(await request('/search?q=auth-acceptance', 'GET', current.cookie), 200);
        } else if (actionCode === 'auth.refresh') {
          await blockedRefresh(actor, current.cookie, true);
          await me(actor, current.cookie); // Refresh deny alone does not revoke an access JWT.
        } else {
          for (const path of ['/auth/me', '/search?q=auth-acceptance']) await expectStatus(await request(path, 'GET', current.cookie), 401);
          const before = await sessions(actor);
          const deniedLogin = await loginResponse(actor);
          await expectStatus(deniedLogin, 401);
          noIssuedCookies(deniedLogin);
          assert.deepEqual(await sessions(actor), before);
          await blockedRefresh(actor, current.cookie, true);
        }
        await me(control, controlSession.cookie); // all is per subject, not a rule on other Users.
        if (actionCode === 'auth.me' || actionCode === 'auth.access') {
          await logout(current.cookie); // Me/access denial must not lock the escape route.
          await blockedRefresh(actor, current.cookie, false);
        }
        await revoke(actor, actionCode);
        await me(actor, first.cookie); // Same old access cookie sees removal without another login.
        if (actionCode === 'auth.login') await login(actor);
        if (actionCode === 'auth.refresh' || actionCode === 'auth.access') {
          await blockedRefresh(actor, current.cookie, false); // Regrant cannot resurrect a revoked refresh token.
          const renewed = await login(actor);
          await refresh(actor, renewed.cookie);
        }
      });
    }
  }

  await t.test('logout metadata/API rejects administrative denies, but direct legacy/invalid rules cannot disable escape', async () => {
    const administrator = await makeUser('own-administrator', true);
    const adminSession = await login(administrator, 'founder');
    const target = await makeUser('logout-preview-target');
    const catalogResponse = await request('/users-access/admin/catalog', 'GET', adminSession.cookie);
    await expectStatus(catalogResponse, 200);
    const catalog = await catalogResponse.json() as { actions: typeof ACCESS_ACTION_CATALOG };
    assert.deepEqual(catalog.actions.filter(({ module }) => module === 'auth'), definitions);
    const before = {
      target: await prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
      rules: await prisma.userAccessRule.findMany({ where: { userId: target.id } }),
      previews: await prisma.userAccessPreview.findMany({ where: { userId: target.id } }),
      audits: await prisma.userAccessAudit.findMany({ where: { userId: target.id } }),
    };
    for (const scope of ['own', 'all'] as const) {
      const body = { expectedVersion: target.accessVersion, reason: 'Logout must remain available',
        changes: [{ actionCode: 'auth.logout', effect: 'deny', scope }] };
      for (const suffix of ['preview', 'save']) {
        const response = await request(`/users-access/admin/users/${target.id}/${suffix}`, 'POST', adminSession.cookie,
          suffix === 'save' ? { ...body, previewToken: 'a'.repeat(64), previewHash: 'b'.repeat(64) } : body);
        await expectStatus(response, 400);
      }
    }
    assert.deepEqual({
      target: await prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
      rules: await prisma.userAccessRule.findMany({ where: { userId: target.id } }),
      previews: await prisma.userAccessPreview.findMany({ where: { userId: target.id } }),
      audits: await prisma.userAccessAudit.findMany({ where: { userId: target.id } }),
    }, before);
    for (const scope of ['own', 'all', 'selected'] as const) {
      const actor = await makeUser(`legacy-logout-${scope}`);
      const session = await login(actor);
      await rule(actor, 'auth.logout', 'deny', scope); // selected is deliberately unsupported legacy data, only on our fixture.
      await rule(actor, 'auth.me', 'deny');
      await rule(actor, 'auth.access', 'deny');
      await expectStatus(await request('/auth/me', 'GET', session.cookie), 401);
      const beforeLogout = await sessions(actor);
      await logout(session.cookie);
      const afterLogout = await sessions(actor);
      assert.equal(afterLogout.length, beforeLogout.length);
      assert.ok(afterLogout.every(({ revokedAt, replacedBySessionId }) => revokedAt !== null && replacedBySessionId === null));
      await logout(session.cookie); // Idempotent and independent of JWT authorization.
      await blockedRefresh(actor, session.cookie, false);
    }
    await logout();
    await logout(`${REFRESH_TOKEN_COOKIE}=not-a-session`);
  });

  await t.test('inactive own fixture cannot login/read/refresh despite all positive auth leaves; reactivation cannot resurrect refresh', async () => {
    const actor = await makeUser('inactive');
    for (const definition of definitions.filter(({ manageable }) => manageable)) await rule(actor, definition.code, 'allow', 'all');
    const first = await login(actor);
    await prisma.user.update({ where: { id: actor.id }, data: { isActive: false } });
    try {
      const before = await sessions(actor);
      const denied = await loginResponse(actor);
      await expectStatus(denied, 401);
      noIssuedCookies(denied);
      assert.deepEqual(await sessions(actor), before);
      for (const path of ['/auth/me', '/search?q=auth-acceptance']) await expectStatus(await request(path, 'GET', first.cookie), 401);
      await blockedRefresh(actor, first.cookie, true);
      await logout(first.cookie);
    } finally { await prisma.user.update({ where: { id: actor.id }, data: { isActive: true } }); }
    await blockedRefresh(actor, first.cookie, false);
    await login(actor);
    await me(control, controlSession.cookie);
  });

  await t.test('credential/validation/missing-cookie failures never issue tokens or create sessions', async () => {
    const actor = await makeUser('credentials');
    for (const definition of definitions.filter(({ manageable }) => manageable)) await rule(actor, definition.code, 'allow', 'all');
    const before = await sessions(actor);
    for (const [body, expected] of [
      [{ login: actor.login, password: 'wrong-password' }, 401],
      [{ login: `${marker}-unknown`, password: 'manager123' }, 401],
      [{ login: actor.login, password: 'x' }, 400],
      [{ login: actor.login }, 400],
    ] as const) {
      const response = await request('/auth/login', 'POST', '', body);
      await expectStatus(response, expected);
      noIssuedCookies(response);
      assert.deepEqual(await sessions(actor), before);
    }
    await expectStatus(await request('/auth/me'), 401);
    await expectStatus(await request('/auth/me', 'GET', `${ACCESS_TOKEN_COOKIE}=not-a-valid-jwt`), 401);
    await blockedRefresh(actor, '', false);
    await blockedRefresh(actor, `${REFRESH_TOKEN_COOKIE}=not-a-valid-session`, false);
    await login(actor); // Positive credentials control after all failure paths.
  });
  assert.deepEqual(await sourceSnapshot(), originalSources, 'Existing users and all canonical roles/permission sources stay unchanged');
  for (const id of ownedIds) {
    const memberships = await prisma.userRole.findMany({ where: { userId: id }, include: { role: true } });
    assert.equal(memberships.length, 1);
    assert.ok(['manager', 'founder'].includes(memberships[0]!.role.code));
    assert.equal(await prisma.userPermission.count({ where: { userId: id } }), 0);
  }
  // Main owns execution/disposable-schema cleanup. Direct rule fixtures are not
  // successful admin-save or browser cookie-jar proof. No JWT/session-service mocks,
  // guard/rate-limit bypass, sleeps, token decoding or access-token revocation claims.
});
