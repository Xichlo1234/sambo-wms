/**
 * Liên kết Đơn đặt hàng (PO) ↔ Phiếu nhập kho (kho mỏ & kho hóa chất).
 * - Chỉ nhận hàng cho PO đã duyệt / đã gửi NCC / đang giao một phần, đúng nhà cung cấp, đúng mặt hàng.
 * - Không nhận vượt số lượng còn lại của dòng PO (hàng thừa phải ghi "không đạt" hoặc lập PO bổ sung).
 * - Khi phiếu nhập được duyệt ghi sổ: cộng SL đã nhận vào dòng PO và cập nhật trạng thái PO (Giao một phần / Đã giao đủ).
 */
import { Prisma } from '@prisma/client';
import type { Db, Tx } from '../db';
import { badRequest, ruleViolation } from '../lib/errors';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
export const RECEIVABLE_PO = ['APPROVED', 'SENT', 'PARTIAL'] as const;

export interface PoLink { po_item_id: number | null | undefined; item_id?: number | null; chemical_id?: number | null; qty: Prisma.Decimal.Value; line_no?: number }

/** Kiểm tra khi lập / gửi duyệt phiếu nhập */
export async function validatePoLink(db: Db, poId: number | null | undefined, supplierId: number | null | undefined, kind: 'item' | 'chemical', lines: PoLink[]) {
  const linked = lines.filter((l) => l.po_item_id);
  if (!poId) {
    if (linked.length) throw badRequest('Dòng có liên kết PO nhưng phiếu chưa chọn đơn đặt hàng');
    return null;
  }
  const po = await db.purchaseOrder.findUnique({ where: { id: poId }, include: { lines: true } });
  if (!po) throw badRequest('Đơn đặt hàng không tồn tại');
  if (!RECEIVABLE_PO.includes(po.status as never)) throw ruleViolation(`Đơn đặt hàng ${po.code} đang ở trạng thái không nhận hàng được (phải Đã duyệt / Đã gửi NCC / Giao một phần).`);
  if (supplierId && po.supplier_id !== supplierId) throw badRequest(`Nhà cung cấp của phiếu nhập khác nhà cung cấp trên đơn đặt hàng ${po.code}`);
  const sum = new Map<number, Prisma.Decimal>();
  for (const l of linked) {
    const pl = po.lines.find((x) => x.id === l.po_item_id);
    if (!pl) throw badRequest(`Dòng ${l.line_no ?? ''}: dòng PO không thuộc đơn ${po.code}`);
    if (kind === 'item' ? pl.item_id !== l.item_id : pl.chemical_id !== l.chemical_id) throw badRequest(`Dòng ${l.line_no ?? ''}: mặt hàng không khớp với dòng PO ${pl.line_no}`);
    sum.set(pl.id, (sum.get(pl.id) ?? D(0)).plus(l.qty));
  }
  for (const [id, q] of sum) {
    const pl = po.lines.find((x) => x.id === id)!;
    const remaining = pl.qty_ordered.minus(pl.qty_received);
    if (q.gt(remaining)) throw ruleViolation(`Dòng PO ${pl.line_no}: SL nhận ${q.toString()} vượt SL còn lại ${remaining.toString()} của đơn ${po.code}. Phần thừa ghi "không đạt / trả lại" hoặc lập PO bổ sung.`);
  }
  return po;
}

/** Cập nhật PO khi phiếu nhập được ghi sổ – trong cùng transaction, khóa dòng PO */
export async function applyPoReceipt(tx: Tx, poId: number | null | undefined, lines: { po_item_id: number | null | undefined; qty: Prisma.Decimal.Value }[]) {
  if (!poId) return;
  await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${poId} FOR UPDATE`;
  const po = await tx.purchaseOrder.findUnique({ where: { id: poId }, include: { lines: true } });
  if (!po) return;
  if (!RECEIVABLE_PO.includes(po.status as never)) throw ruleViolation(`Đơn đặt hàng ${po.code} không còn ở trạng thái nhận hàng (hiện: ${po.status}).`);
  for (const l of lines) {
    if (!l.po_item_id || D(l.qty).lte(0)) continue;
    const r = await tx.$executeRaw`UPDATE purchase_order_items SET qty_received = qty_received + ${D(l.qty).toString()}::numeric, updated_at = now()
      WHERE id = ${l.po_item_id} AND order_id = ${poId} AND qty_received + ${D(l.qty).toString()}::numeric <= qty_ordered`;
    if (r !== 1) throw ruleViolation(`Dòng PO vượt số lượng đặt hàng còn lại (đơn ${po.code}). Có thể phiếu nhập khác vừa nhận hàng cho dòng này – kiểm tra lại.`);
  }
  const after = await tx.purchaseOrderItem.findMany({ where: { order_id: poId } });
  const full = after.every((x) => x.qty_received.gte(x.qty_ordered));
  const any = after.some((x) => x.qty_received.gt(0));
  await tx.purchaseOrder.update({ where: { id: poId }, data: { status: full ? 'RECEIVED' : any ? 'PARTIAL' : po.status, completed_at: full ? new Date() : null } });
}
