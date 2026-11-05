import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { Prisma } from '@prisma/client';
import { config } from './config';
import { prisma } from './db';
import { authenticate } from './lib/auth';
import { errorHandler, AppError } from './lib/errors';
import authRouter from './modules/auth';
import { usersRouter, rolesRouter } from './modules/users';
import { unitsRouter, categoriesRouter, warehousesRouter, locationsRouter, departmentsRouter, suppliersRouter } from './modules/masterdata';
import itemsRouter from './modules/items';
import receiptsRouter from './modules/receipts';
import issuesRouter from './modules/issues';
import transfersRouter from './modules/transfers';
import returnsRouter from './modules/returns';
import adjustmentsRouter from './modules/adjustments';
import stocktakesRouter from './modules/stocktakes';
import stockRouter from './modules/stock';
import reportsRouter from './modules/reports';
import dashboardRouter from './modules/dashboard';
import searchRouter from './modules/search';
import attachmentsRouter from './modules/attachments';
import importRouter from './modules/import';
import backupRouter from './modules/backup';
import printRouter from './modules/print';
import { settingsRouter, auditRouter, notificationsRouter } from './modules/system';

// Decimal (số lượng/đơn giá) trả về JSON dạng số – Decimal(18,4) nằm trong độ chính xác của số thực 64-bit
(Prisma.Decimal.prototype as unknown as { toJSON: () => number }).toJSON = function (this: Prisma.Decimal) {
  return this.toNumber();
};

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // sau Nginx / Cloudflare Tunnel
  app.disable('x-powered-by');
  // Decimal → number, BigInt → string trong JSON trả về
  app.set('json replacer', (_k: string, v: unknown) => {
    if (typeof v === 'bigint') return v.toString();
    if (v && typeof v === 'object' && (v as { constructor?: { name?: string } }).constructor?.name === 'Decimal') return Number(v as Prisma.Decimal);
    return v;
  });
  app.use(helmet({ contentSecurityPolicy: { directives: { 'default-src': ["'self'"], 'img-src': ["'self'", 'data:', 'blob:'], 'style-src': ["'self'", "'unsafe-inline'"], 'frame-src': ["'self'", 'blob:'], 'object-src': ["'self'", 'blob:'] } } }));
  app.use(compression());
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());

  if (config.corsOrigin) {
    app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', config.corsOrigin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });
  }

  // Chống CSRF: mọi request ghi dữ liệu phải có header X-Requested-With (trình duyệt không tự gửi từ site khác)
  app.use('/api', (req: Request, _res: Response, next: NextFunction) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers['x-requested-with'] !== 'wms') {
      return next(new AppError(403, 'CSRF', 'Yêu cầu không hợp lệ (thiếu header bảo mật)'));
    }
    next();
  });

  app.get('/api/health', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ success: true, data: { status: 'ok', time: new Date().toISOString(), version: process.env.APP_VERSION || 'dev' } });
  });

  app.use('/api/auth', authRouter);
  const api = express.Router();
  api.use(authenticate);
  api.use('/users', usersRouter);
  api.use('/roles', rolesRouter);
  api.use('/units', unitsRouter);
  api.use('/categories', categoriesRouter);
  api.use('/warehouses', warehousesRouter);
  api.use('/locations', locationsRouter);
  api.use('/departments', departmentsRouter);
  api.use('/suppliers', suppliersRouter);
  api.use('/items', itemsRouter);
  api.use('/receipts', receiptsRouter);
  api.use('/issues', issuesRouter);
  api.use('/transfers', transfersRouter);
  api.use('/returns', returnsRouter);
  api.use('/adjustments', adjustmentsRouter);
  api.use('/stocktakes', stocktakesRouter);
  api.use('/stock', stockRouter);
  api.use('/reports', reportsRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/search', searchRouter);
  api.use('/attachments', attachmentsRouter);
  api.use('/import', importRouter);
  api.use('/backups', backupRouter);
  api.use('/print', printRouter);
  api.use('/settings', settingsRouter);
  api.use('/audit-logs', auditRouter);
  api.use('/notifications', notificationsRouter);
  app.use('/api', api);
  app.use('/api', (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'API không tồn tại')));

  if (config.serveClient && fs.existsSync(config.clientDist)) {
    app.use(express.static(config.clientDist, { index: false, maxAge: '7d', setHeaders: (res, p) => { if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.clientDist, 'index.html'));
    });
  }
  app.use(errorHandler);
  return app;
}
