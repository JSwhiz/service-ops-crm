type EnvRecord = Record<string, string | undefined>;

function requireValue(env: EnvRecord, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

export function validateEnv(env: EnvRecord): EnvRecord {
  requireValue(env, 'NODE_ENV');
  requireValue(env, 'APP_ENV');
  requireValue(env, 'APP_NAME');
  requireValue(env, 'APP_BASE_URL');
  requireValue(env, 'BACKEND_PORT');

  requireValue(env, 'DATABASE_URL');
  requireValue(env, 'REDIS_URL');

  requireValue(env, 'JWT_ACCESS_SECRET');
  requireValue(env, 'JWT_REFRESH_SECRET');
  requireValue(env, 'JWT_ACCESS_EXPIRES_IN');
  requireValue(env, 'JWT_REFRESH_EXPIRES_IN');
  requireValue(env, 'AUTH_COOKIE_SECURE');
  requireValue(env, 'AUTH_COOKIE_SAME_SITE');

  requireValue(env, 'MINIO_ENDPOINT');
  requireValue(env, 'MINIO_PORT');
  requireValue(env, 'MINIO_USE_SSL');
  requireValue(env, 'MINIO_ACCESS_KEY');
  requireValue(env, 'MINIO_SECRET_KEY');
  requireValue(env, 'MINIO_BUCKET');

  return env;
}
