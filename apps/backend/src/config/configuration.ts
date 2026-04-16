export default () => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    appEnv: process.env.APP_ENV ?? 'local',
    name: process.env.APP_NAME ?? 'Service Ops CRM',
    baseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
    backendPort: Number(process.env.BACKEND_PORT ?? '4000'),
  },
  database: {
    url: process.env.DATABASE_URL ?? '',
  },
  redis: {
    url: process.env.REDIS_URL ?? '',
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  },
  auth: {
    cookieDomain: process.env.AUTH_COOKIE_DOMAIN ?? '',
    cookieSecure: process.env.AUTH_COOKIE_SECURE === 'true',
    cookieSameSite: process.env.AUTH_COOKIE_SAME_SITE ?? 'lax',
  },
  storage: {
    endpoint: process.env.MINIO_ENDPOINT ?? 'localhost',
    port: Number(process.env.MINIO_PORT ?? '9000'),
    useSsl: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY ?? '',
    secretKey: process.env.MINIO_SECRET_KEY ?? '',
    bucket: process.env.MINIO_BUCKET ?? 'service-ops-files',
    publicBaseUrl:
      process.env.MINIO_PUBLIC_BASE_URL ?? 'http://localhost:9000',
  },
  bootstrap: {
    firstAdminLogin: process.env.FIRST_ADMIN_LOGIN ?? 'founder',
    firstAdminPassword: process.env.FIRST_ADMIN_PASSWORD ?? 'founder123',
    firstAdminFullName: process.env.FIRST_ADMIN_FULL_NAME ?? 'System Founder',
  },
});
