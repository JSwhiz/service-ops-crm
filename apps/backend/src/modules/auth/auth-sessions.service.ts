import { createHmac, randomBytes } from 'node:crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { AuthRequestMeta } from './types/auth-request-meta.type';

type SessionActor = { id: string; accessVersion: number };

interface StoredAuthSession {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBySessionId: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AuthSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async createSession(params: {
    actor: SessionActor;
    expiresAt: Date;
    meta: AuthRequestMeta;
  }): Promise<{
    sessionId: string;
    rawToken: string;
  }> {
    const rawToken = this.generateRawToken();
    const tokenHash = this.buildTokenHash(rawToken);

    const session = await this.prisma.$transaction(async (tx) => {
      if (!await this.lockSessionIssuer(tx, params.actor)) {
        throw new UnauthorizedException('Access changed. Sign in again.');
      }
      return this.getAuthSessionDelegate(tx).create({
        data: {
          userId: params.actor.id,
          tokenHash,
          expiresAt: params.expiresAt,
          userAgent: params.meta.userAgent ?? null,
          ipAddress: params.meta.ipAddress ?? null,
        },
      });
    });

    return {
      sessionId: session.id,
      rawToken,
    };
  }

  async findActiveSessionByRawToken(
    rawToken: string,
  ): Promise<StoredAuthSession | null> {
    const session = await this.getAuthSessionDelegate().findUnique({
      where: {
        tokenHash: this.buildTokenHash(rawToken),
      },
    });

    if (!session) {
      return null;
    }

    if (session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      return null;
    }

    return session;
  }

  async rotateSession(
    rawToken: string,
    params: {
      actor: SessionActor;
      expiresAt: Date;
      meta: AuthRequestMeta;
    },
  ): Promise<{
    sessionId: string;
    rawToken: string;
    userId: string;
  } | null> {
    const currentTokenHash = this.buildTokenHash(rawToken);
    const nextRawToken = this.generateRawToken();
    const nextTokenHash = this.buildTokenHash(nextRawToken);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const authSession = this.getAuthSessionDelegate(tx);
      if (!await this.lockSessionIssuer(tx, params.actor)) {
        // Commit invalidation of the presented token without issuing a successor.
        await authSession.updateMany({
          where: { tokenHash: currentTokenHash, userId: params.actor.id, revokedAt: null },
          data: { revokedAt: now },
        });
        return null;
      }
      const currentSession = await authSession.findUnique({
        where: {
          tokenHash: currentTokenHash,
        },
      });

      if (
        !currentSession ||
        currentSession.userId !== params.actor.id ||
        currentSession.revokedAt ||
        currentSession.expiresAt.getTime() <= now.getTime()
      ) {
        return null;
      }

      const revoked = await authSession.updateMany({
        where: {
          id: currentSession.id,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });

      if (revoked.count !== 1) {
        return null;
      }

      const nextSession = await authSession.create({
        data: {
          userId: currentSession.userId,
          tokenHash: nextTokenHash,
          expiresAt: params.expiresAt,
          userAgent: params.meta.userAgent ?? null,
          ipAddress: params.meta.ipAddress ?? null,
        },
      });

      await authSession.update({
        where: {
          id: currentSession.id,
        },
        data: {
          replacedBySessionId: nextSession.id,
        },
      });

      return {
        sessionId: nextSession.id,
        rawToken: nextRawToken,
        userId: currentSession.userId,
      };
    });
  }

  async revokeSessionByRawToken(rawToken: string): Promise<void> {
    await this.getAuthSessionDelegate().updateMany({
      where: {
        tokenHash: this.buildTokenHash(rawToken),
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  private async lockSessionIssuer(tx: Prisma.TransactionClient, actor: SessionActor): Promise<boolean> {
    // Create a row version without changing the permission revision. A
    // concurrent serializable deny must see this issue or fail, rather than
    // silently missing its refresh session in an older snapshot.
    const changed = await tx.$executeRaw`
      UPDATE "users" SET "accessVersion" = "accessVersion"
      WHERE "id" = ${actor.id} AND "accessVersion" = ${actor.accessVersion}
        AND "deletedAt" IS NULL AND "isActive" = true
    `;
    return changed === 1;
  }

  private generateRawToken(): string {
    return randomBytes(48).toString('base64url');
  }

  private buildTokenHash(rawToken: string): string {
    const refreshSecret = this.configService.get<string>('jwt.refreshSecret');

    if (!refreshSecret) {
      throw new Error('Missing jwt.refreshSecret configuration');
    }

    return createHmac('sha256', refreshSecret).update(rawToken).digest('hex');
  }

  private getAuthSessionDelegate(prisma: PrismaService | unknown = this.prisma): {
    create(args: unknown): Promise<StoredAuthSession>;
    findUnique(args: unknown): Promise<StoredAuthSession | null>;
    update(args: unknown): Promise<StoredAuthSession>;
    updateMany(args: unknown): Promise<{ count: number }>;
  } {
    return (prisma as { authSession: unknown }).authSession as {
      create(args: unknown): Promise<StoredAuthSession>;
      findUnique(args: unknown): Promise<StoredAuthSession | null>;
      update(args: unknown): Promise<StoredAuthSession>;
      updateMany(args: unknown): Promise<{ count: number }>;
    };
  }
}
