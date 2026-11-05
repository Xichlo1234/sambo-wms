import type { DocStatus } from '@prisma/client';
import type { Tx } from '../db';
import { conflict } from './errors';

type Delegate = { updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }> };

/**
 * Chuyển trạng thái chứng từ có kiểm tra trạng thái hiện tại (optimistic lock).
 * Nếu 2 người cùng bấm "Duyệt", chỉ 1 người thành công – người còn lại nhận thông báo tải lại.
 */
export async function transition(tx: Tx, model: string, id: number, from: DocStatus[], data: Record<string, unknown>) {
  const delegate = (tx as unknown as Record<string, Delegate>)[model];
  const r = await delegate.updateMany({ where: { id, status: { in: from } }, data });
  if (r.count !== 1) {
    throw conflict('Trạng thái chứng từ đã thay đổi (có thể người khác vừa xử lý). Vui lòng tải lại trang và kiểm tra.');
  }
}

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Nháp', SUBMITTED: 'Chờ duyệt', APPROVED: 'Đã duyệt', COUNTING: 'Đang kiểm đếm', INSPECTED: 'Đã kiểm tra',
  POSTED: 'Đã ghi sổ', ISSUED: 'Đã xuất kho', RECEIVED: 'Đã nhận', REJECTED: 'Từ chối', CANCELLED: 'Đã hủy',
};
