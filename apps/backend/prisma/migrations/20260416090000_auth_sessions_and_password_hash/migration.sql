ALTER TABLE "users"
ADD COLUMN "passwordHash" TEXT,
ALTER COLUMN "password" DROP NOT NULL;

CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedBySessionId" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_sessions_tokenHash_key" ON "auth_sessions"("tokenHash");
CREATE INDEX "auth_sessions_userId_idx" ON "auth_sessions"("userId");
CREATE INDEX "auth_sessions_expiresAt_idx" ON "auth_sessions"("expiresAt");
CREATE INDEX "auth_sessions_userId_revokedAt_idx" ON "auth_sessions"("userId", "revokedAt");

ALTER TABLE "auth_sessions"
ADD CONSTRAINT "auth_sessions_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "auth_sessions"
ADD CONSTRAINT "auth_sessions_replacedBySessionId_fkey"
FOREIGN KEY ("replacedBySessionId") REFERENCES "auth_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
