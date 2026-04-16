import assert from 'node:assert/strict';

export async function loginAndGetCookieHeader(params: {
  baseUrl: string;
  login: string;
  password: string;
}): Promise<string> {
  const response = await fetch(`${params.baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      login: params.login,
      password: params.password,
    }),
  });

  assert.equal(response.status, 201);

  const cookieHeaders = (
    response.headers as Headers & {
      getSetCookie?: () => string[];
    }
  ).getSetCookie?.() ?? [];

  return cookieHeaders
    .map((cookieHeader) => cookieHeader.split(';', 1)[0])
    .join('; ');
}
