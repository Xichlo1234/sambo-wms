import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import type { ErrorRequestHandler } from 'express';

export class AppError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', msg, details);
export const notFound = (msg = 'Không tìm thấy dữ liệu') => new AppError(404, 'NOT_FOUND', msg);
export const forbidden = (msg = 'Bạn không có quyền thực hiện thao tác này') => new AppError(403, 'FORBIDDEN', msg);
export const conflict = (msg: string, details?: unknown) => new AppError(409, 'CONFLICT', msg, details);
export const unauthorized = (msg = 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại') =>
  new AppError(401, 'UNAUTHORIZED', msg);
/** Vi phạm quy tắc nghiệp vụ (vd: xuất vượt tồn, tự phê duyệt) */
export const ruleViolation = (msg: string, details?: unknown) => new AppError(422, 'BUSINESS_RULE', msg, details);

const FIELD_LABELS: Record<string, string> = {
  code: 'Mã', username: 'Tên đăng nhập', barcode: 'Mã vạch', client_request_id: 'Yêu cầu (trùng lặp)',
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({ success: false, error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION', message: 'Dữ liệu nhập chưa hợp lệ: ' + details.map((d) => `${d.field ? d.field + ': ' : ''}${d.message}`).join('; '), details },
    });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = ([] as string[]).concat((err.meta?.target as string[]) || []);
      const label = target.map((t) => FIELD_LABELS[t] || t).join(', ');
      return res.status(409).json({ success: false, error: { code: 'DUPLICATE', message: `Dữ liệu bị trùng: ${label} đã tồn tại.` } });
    }
    if (err.code === 'P2025') return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy dữ liệu' } });
    if (err.code === 'P2003') return res.status(409).json({ success: false, error: { code: 'FK', message: 'Dữ liệu đang được tham chiếu hoặc tham chiếu không hợp lệ.' } });
    if (err.code === 'P2034') return res.status(409).json({ success: false, error: { code: 'CONCURRENCY', message: 'Có người khác đang thao tác cùng dữ liệu. Vui lòng thử lại.' } });
  }
  const msg = String(err?.message || '');
  if (/violates check constraint/.test(msg) || /chk_balance/.test(msg)) {
    return res.status(422).json({ success: false, error: { code: 'BUSINESS_RULE', message: 'Thao tác bị chặn vì sẽ làm tồn kho âm hoặc vi phạm ràng buộc dữ liệu.' } });
  }
  if (err?.type === 'entity.too.large') return res.status(413).json({ success: false, error: { code: 'TOO_LARGE', message: 'Dữ liệu gửi lên quá lớn' } });
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ success: false, error: { code: 'TOO_LARGE', message: 'File vượt quá dung lượng cho phép' } });
  console.error('[ERROR]', req.method, req.originalUrl, err);
  return res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Lỗi hệ thống. Vui lòng thử lại hoặc liên hệ quản trị viên.' } });
};
