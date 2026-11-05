import fs from 'fs';
import path from 'path';
import { config } from './config';
import { createApp } from './app';
import { prisma } from './db';
import { scheduleBackups } from './modules/backup';

async function main() {
  for (const d of ['uploads', 'backups']) fs.mkdirSync(path.join(config.storageDir, d), { recursive: true });
  await prisma.$connect();
  const app = createApp();
  app.listen(config.port, () => console.log(`[SAMBO WMS] API chạy tại cổng ${config.port} (${config.env})`));
  scheduleBackups();
}

main().catch((e) => {
  console.error('Khởi động thất bại:', e);
  process.exit(1);
});
