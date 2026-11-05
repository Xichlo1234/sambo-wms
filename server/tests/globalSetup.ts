/**
 * Mỗi lần chạy kiểm thử tạo một database MỚI tên duy nhất (không đụng tới DB phát triển/production),
 * áp migration bằng `prisma migrate deploy`, seed dữ liệu demo; xóa đúng DB tạm đó khi kết thúc.
 */
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';
const dbName = `sambo_wms_test_${Date.now()}`;

export default async function setup() {
  const url = ADMIN_URL.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);
  const admin = new PrismaClient({ datasourceUrl: ADMIN_URL });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  await admin.$disconnect();
  process.env.TEST_DATABASE_URL = url;
  const env = { ...process.env, DATABASE_URL: url, SEED_DEMO: 'true' };
  execSync('npx prisma migrate deploy', { env, stdio: 'inherit' });
  execSync('npx tsx prisma/seed.ts', { env, stdio: 'inherit' });
  return async () => {
    if (process.env.KEEP_TEST_DB) return console.log('Giữ DB kiểm thử:', dbName);
    const a = new PrismaClient({ datasourceUrl: ADMIN_URL });
    await a.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await a.$disconnect();
  };
}
