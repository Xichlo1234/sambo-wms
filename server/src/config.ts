import 'dotenv/config';
import path from 'path';

const num = (v: string | undefined, d: number) => (v && !isNaN(Number(v)) ? Number(v) : d);

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 4000),
  sessionTtlHours: num(process.env.SESSION_TTL_HOURS, 12),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  corsOrigin: process.env.CORS_ORIGIN || '',
  storageDir: path.resolve(process.env.STORAGE_DIR || './storage'),
  uploadMaxMb: num(process.env.UPLOAD_MAX_MB, 20),
  pgBinDir: process.env.PG_BIN_DIR || '/usr/bin',
  databaseUrl: process.env.DATABASE_URL || '',
  backupCron: process.env.BACKUP_CRON || '',
  backupKeep: num(process.env.BACKUP_KEEP, 30),
  serveClient: process.env.SERVE_CLIENT === 'true',
  clientDist: path.resolve(process.env.CLIENT_DIST || '../client/dist'),
};

export const SESSION_COOKIE = 'wms_sid';
