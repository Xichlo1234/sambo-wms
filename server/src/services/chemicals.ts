/**
 * BỘ MÁY GHI SỔ KHO HÓA CHẤT – theo từng LÔ (batch)
 * - Tồn kho hóa chất luôn theo lô (chemical_batches.qty_on_hand) + sổ cái lô bất biến (chemical_movements).
 * - Không gộp lô: mỗi dòng nhập kho tạo một lô riêng (mã lô nội bộ duy nhất).
 * - Điều kiện xuất của lô: QC = Đạt, chưa hết hạn, SDS còn hiệu lực (theo chính sách), thông tin an toàn đã xác nhận (theo chính sách).
 *   Không có cơ chế "bỏ qua cảnh báo an toàn".
 * - Khóa advisory theo (kho, hóa chất) để thao tác đồng thời không làm sai tồn lô.
 */
import { Prisma, type ChemicalBatch } from '@prisma/client';
import { prisma, type Db, type Tx } from '../db';
import { ruleViolation } from '../lib/errors';
import { getSettings } from '../lib/settings';
import { assertPeriodOpen } from './inventory';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const LOCK_NS = 100000; // tách không gian khóa với kho vật tư

export function todayUTC() {
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
}

export async function lockChemicals(tx: Tx, keys: { warehouse_id: number; chemical_id: number }[]) {
  const uniq = [...new Map(keys.map((k) => [`${k.warehouse_id}:${k.chemical_id}`, k])).values()].sort((a, b) => a.warehouse_id - b.warehouse_id || a.chemical_id - b.chemical_id);
  for (const k of uniq) await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NS + k.warehouse_id}::int, ${k.chemical_id}::int)`;
}

export interface ChemMove {
  batch_id: number;
  direction: 'IN' | 'OUT';
  qty: Prisma.Decimal.Value;
  movement_type: 'RECEIPT' | 'ISSUE' | 'ADJUSTMENT' | 'STOCKTAKE' | 'DISPOSAL';
  doc_type: string;
  doc_id: number;
  doc_code: string;
  doc_date: Date;
  department_id?: number | null;
  note?: string | null;
}

/** Ghi sổ biến động theo lô – PHẢI gọi trong transaction */
export async function postChemMovements(tx: Tx, userId: number, moves: ChemMove[]) {
  if (!moves.length) return;
  for (const t of new Set(moves.map((m) => m.doc_date.getTime()))) await assertPeriodOpen(tx, new Date(t));
  const batches = await tx.chemicalBatch.findMany({ where: { id: { in: [...new Set(moves.map((m) => m.batch_id))] } }, include: { chemical: { select: { code: true, name: true } } } });
  await lockChemicals(tx, batches.map((b) => ({ warehouse_id: b.warehouse_id, chemical_id: b.chemical_id })));
  const rows: Prisma.ChemicalMovementCreateManyInput[] = [];
  const now = new Date();
  for (const m of moves) {
    const b = batches.find((x) => x.id === m.batch_id);
    if (!b) throw ruleViolation(`Lô ID ${m.batch_id} không tồn tại`);
    const qty = D(m.qty);
    if (qty.lte(0)) throw ruleViolation('Số lượng ghi sổ phải lớn hơn 0');
    let r: { v: Prisma.Decimal }[];
    if (m.direction === 'IN') {
      r = await tx.$queryRaw`UPDATE chemical_batches SET qty_on_hand = qty_on_hand + ${qty.toString()}::numeric, updated_at = now() WHERE id = ${b.id} RETURNING qty_on_hand AS v`;
    } else {
      r = await tx.$queryRaw`UPDATE chemical_batches SET qty_on_hand = qty_on_hand - ${qty.toString()}::numeric, updated_at = now() WHERE id = ${b.id} AND qty_on_hand >= ${qty.toString()}::numeric RETURNING qty_on_hand AS v`;
      if (!r.length) {
        const cur = await tx.chemicalBatch.findUnique({ where: { id: b.id } });
        throw ruleViolation(`Lô ${b.internal_code} (${b.chemical.code} – mã lô NSX ${b.batch_no}) chỉ còn ${cur?.qty_on_hand.toString()}, không đủ ${qty.toString()}. Không được xuất âm.`);
      }
    }
    rows.push({
      batch_id: b.id, chemical_id: b.chemical_id, warehouse_id: b.warehouse_id, location_id: b.location_id, movement_type: m.movement_type,
      qty_in: m.direction === 'IN' ? qty : D(0), qty_out: m.direction === 'OUT' ? qty : D(0), balance_after: D(r[0].v),
      doc_type: m.doc_type, doc_id: m.doc_id, doc_code: m.doc_code, doc_date: m.doc_date, posted_at: now, department_id: m.department_id ?? null, user_id: userId, note: m.note ?? null,
    });
  }
  await tx.chemicalMovement.createMany({ data: rows });
}

export type SdsState = { state: 'OK' | 'MISSING' | 'EXPIRED' | 'UNVERIFIED'; doc_id?: number; review_date?: Date | null; title?: string };

/** Tình trạng SDS/MSDS theo hóa chất */
export async function sdsStatus(db: Db, chemicalIds: number[]): Promise<Map<number, SdsState>> {
  const res = new Map<number, SdsState>();
  if (!chemicalIds.length) return res;
  const docs = await db.chemicalSafetyDocument.findMany({ where: { chemical_id: { in: chemicalIds }, doc_type: 'SDS', status: 'ACTIVE' }, orderBy: { id: 'desc' } });
  const today = todayUTC();
  for (const id of chemicalIds) {
    const d = docs.find((x) => x.chemical_id === id);
    if (!d) res.set(id, { state: 'MISSING' });
    else if (d.review_date && d.review_date < today) res.set(id, { state: 'EXPIRED', doc_id: d.id, review_date: d.review_date, title: d.title });
    else if (!d.verified_at) res.set(id, { state: 'UNVERIFIED', doc_id: d.id, review_date: d.review_date, title: d.title });
    else res.set(id, { state: 'OK', doc_id: d.id, review_date: d.review_date, title: d.title });
  }
  return res;
}

export const SDS_LABEL: Record<string, string> = { OK: 'Còn hiệu lực, đã xác nhận', MISSING: 'Chưa có SDS', EXPIRED: 'SDS quá hạn rà soát', UNVERIFIED: 'SDS chưa được xác nhận chuyên môn' };

/** Kiểm tra hóa chất có đủ điều kiện an toàn theo chính sách (dùng cho nhập kho & xuất kho) */
export async function chemicalPolicyBlocks(db: Db, chemicalIds: number[]) {
  const s = await getSettings(db);
  const chems = await db.chemical.findMany({ where: { id: { in: chemicalIds } }, select: { id: true, code: true, name: true, safety_verified_at: true, status: true } });
  const sds = await sdsStatus(db, chemicalIds);
  const blocks = new Map<number, string[]>();
  for (const c of chems) {
    const r: string[] = [];
    if (c.status !== 'ACTIVE') r.push('Hóa chất đã bị khóa');
    const st = sds.get(c.id)!;
    if (s['chemical.require_sds'] && (st.state === 'MISSING' || st.state === 'EXPIRED')) r.push(SDS_LABEL[st.state]);
    if (s['chemical.require_safety_verified'] && !c.safety_verified_at) r.push('Thông tin an toàn chưa được người có chuyên môn xác nhận');
    blocks.set(c.id, r);
  }
  return { blocks, sds, chems };
}

/** Lý do chặn xuất của một lô (rỗng = được xuất) */
export function batchBlockReasons(b: Pick<ChemicalBatch, 'qc_status' | 'expiry_date' | 'qty_on_hand'>, today = todayUTC()) {
  const r: string[] = [];
  if (b.expiry_date && b.expiry_date < today) r.push('Đã hết hạn sử dụng');
  if (b.qc_status === 'QUARANTINE') r.push('Đang bị cách ly');
  if (b.qc_status === 'FAILED') r.push('Không đạt kiểm tra');
  if (b.qc_status === 'PENDING') r.push('Chưa kiểm tra chất lượng');
  if (D(b.qty_on_hand).lte(0)) r.push('Hết tồn');
  return r;
}

/** SL đã duyệt cấp nhưng chưa xuất (giữ chỗ) theo hóa chất */
export async function chemReserved(db: Db, warehouseId: number, chemicalIds: number[], excludeIssueId?: number) {
  const map = new Map<number, Prisma.Decimal>();
  if (!chemicalIds.length) return map;
  const rows = await db.$queryRaw<{ chemical_id: number; qty: Prisma.Decimal }[]>`
    SELECT l.chemical_id, COALESCE(SUM(l.qty_approved), 0) AS qty FROM chemical_issue_items l JOIN chemical_issues i ON i.id = l.issue_id
    WHERE i.status = 'APPROVED' AND i.warehouse_id = ${warehouseId} AND l.chemical_id IN (${Prisma.join(chemicalIds)})
      AND (${excludeIssueId ?? 0}::int = 0 OR i.id <> ${excludeIssueId ?? 0}::int)
    GROUP BY l.chemical_id`;
  for (const r of rows) map.set(r.chemical_id, D(r.qty));
  return map;
}

/** Tồn được phép xuất = tổng tồn các lô đủ điều kiện – giữ chỗ */
export async function chemAvailability(db: Db, warehouseId: number, chemicalIds: number[], excludeIssueId?: number) {
  const today = todayUTC();
  const batches = await db.chemicalBatch.findMany({ where: { warehouse_id: warehouseId, chemical_id: { in: chemicalIds }, qty_on_hand: { gt: 0 } } });
  const reserved = await chemReserved(db, warehouseId, chemicalIds, excludeIssueId);
  const out = new Map<number, { on_hand: Prisma.Decimal; issuable: Prisma.Decimal; blocked: Prisma.Decimal; reserved: Prisma.Decimal; available: Prisma.Decimal }>();
  for (const id of chemicalIds) {
    const bs = batches.filter((b) => b.chemical_id === id);
    const on = bs.reduce((s, b) => s.plus(b.qty_on_hand), D(0));
    const ok = bs.filter((b) => batchBlockReasons(b, today).length === 0).reduce((s, b) => s.plus(b.qty_on_hand), D(0));
    const res = reserved.get(id) ?? D(0);
    out.set(id, { on_hand: on, issuable: ok, blocked: on.minus(ok), reserved: res, available: ok.minus(res) });
  }
  return out;
}

/** Thứ tự FEFO: hạn sử dụng gần nhất trước (lô không có hạn xếp cuối), cùng hạn thì nhập trước xuất trước */
export function fefoSort<T extends { expiry_date: Date | null; received_date: Date; id: number }>(list: T[]) {
  return [...list].sort((a, b) => {
    const ea = a.expiry_date ? a.expiry_date.getTime() : Number.MAX_SAFE_INTEGER;
    const eb = b.expiry_date ? b.expiry_date.getTime() : Number.MAX_SAFE_INTEGER;
    return ea - eb || a.received_date.getTime() - b.received_date.getTime() || a.id - b.id;
  });
}

/** Cảnh báo lưu trữ không tương thích tại vị trí – chỉ dựa trên quy tắc ĐÃ ĐƯỢC CHUYÊN GIA XÁC NHẬN */
export async function incompatibilityWarnings(db: Db, placements: { chemical_id: number; location_id: number }[]) {
  const warnings: string[] = [];
  if (!placements.length) return warnings;
  const rules = await db.chemicalStorageRequirement.findMany({ where: { status: 'ACTIVE', verified_at: { not: null } } });
  if (!rules.length) return warnings;
  const locIds = [...new Set(placements.map((p) => p.location_id))];
  const present = await db.chemicalBatch.findMany({ where: { location_id: { in: locIds }, qty_on_hand: { gt: 0 } }, select: { chemical_id: true, location_id: true } });
  const chemIds = [...new Set([...placements.map((p) => p.chemical_id), ...present.map((p) => p.chemical_id)])];
  const chems = await db.chemical.findMany({ where: { id: { in: chemIds } }, select: { id: true, code: true, name: true } });
  const locs = await db.warehouseLocation.findMany({ where: { id: { in: locIds } }, select: { id: true, code: true } });
  const name = (id: number) => { const c = chems.find((x) => x.id === id); return c ? `${c.code} – ${c.name}` : String(id); };
  for (const p of placements) {
    const others = [...present.filter((x) => x.location_id === p.location_id).map((x) => x.chemical_id), ...placements.filter((x) => x !== p && x.location_id === p.location_id).map((x) => x.chemical_id)];
    for (const o of new Set(others)) {
      if (o === p.chemical_id) continue;
      const [a, b] = p.chemical_id < o ? [p.chemical_id, o] : [o, p.chemical_id];
      const rule = rules.find((r) => r.chemical_a_id === a && r.chemical_b_id === b);
      if (rule) warnings.push(`Vị trí ${locs.find((l) => l.id === p.location_id)?.code}: ${name(p.chemical_id)} KHÔNG tương thích lưu trữ với ${name(o)} – ${rule.description}${rule.source_ref ? ` (căn cứ: ${rule.source_ref})` : ''}`);
    }
  }
  return [...new Set(warnings)];
}

export async function chemicalWarehouse(db: Db, id: number) {
  const wh = await db.warehouse.findUnique({ where: { id } });
  if (!wh || wh.status !== 'ACTIVE') throw ruleViolation('Kho không tồn tại hoặc đã khóa');
  if (wh.type !== 'CHEMICAL') throw ruleViolation('Phân hệ hóa chất chỉ thao tác trên kho loại "Kho hóa chất" – không dùng chung kho vật tư.');
  return wh;
}

export { prisma };
