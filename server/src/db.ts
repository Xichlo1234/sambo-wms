import { PrismaClient, Prisma } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.PRISMA_LOG === 'true' ? ['query', 'warn', 'error'] : ['warn', 'error'],
});

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;

/** Transaction dùng cho mọi thao tác ghi sổ – mức cô lập Read Committed + khóa advisory theo mặt hàng. */
export function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, { maxWait: 10_000, timeout: 30_000 });
}
