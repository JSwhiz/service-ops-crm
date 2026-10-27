import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Retry only transactions PostgreSQL guarantees have rolled back. */
export async function inventoryTransaction<T>(
  prisma: PrismaService,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(work, { maxWait: 10000, timeout: 20000 });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' || (error.code === 'P2010' &&
          ['40P01', '40001'].includes(String(error.meta?.code))));
      if (!retryable || attempt >= 2) throw error;
    }
  }
}
