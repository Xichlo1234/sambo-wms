import { Router } from 'express';
import { prisma } from '../db';
import { requirePerm, can } from '../lib/auth';
import { ok } from '../lib/http';
import { queryNxt, endOfDay } from '../services/stockQueries';

const r = Router();

/** Dashboard tổng hợp – mặc định ngày hiện tại; hỗ trợ from/to tùy chọn */
r.get('/', requirePerm('dashboard.view'), async (req, res) => {
  const today = new Date();
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const to = endOfDay(req.query.to ? new Date(String(req.query.to)) : today);
  const u = req.user!;
  const issueScope = can(req, 'issues.view_all') ? {} : { OR: [{ requester_id: u.id }, ...(u.department_id ? [{ department_id: u.department_id }] : [])] };

  const [stock, itemCount, equipmentCount, receiptsInPeriod, issuesInPeriod, pendingReceipts, pendingIssues, approvedIssues, toConfirm,
    openStocktakes, pendingAdjust, pendingTransfers, pendingReturns, pendingQc, trend, topConsumption] = await Promise.all([
    queryNxt({ from: today, to: today }),
    prisma.item.count({ where: { status: 'ACTIVE', kind: 'MATERIAL' } }),
    prisma.item.count({ where: { status: 'ACTIVE', kind: 'EQUIPMENT' } }),
    prisma.stockReceipt.count({ where: { status: 'POSTED', posted_at: { gte: from, lte: to } } }),
    prisma.stockIssue.count({ where: { status: { in: ['ISSUED', 'RECEIVED'] }, issued_at: { gte: from, lte: to }, ...issueScope } }),
    prisma.stockReceipt.count({ where: { status: 'SUBMITTED' } }),
    prisma.stockIssue.count({ where: { status: 'SUBMITTED', ...issueScope } }),
    prisma.stockIssue.count({ where: { status: 'APPROVED', ...issueScope } }),
    prisma.stockIssue.count({ where: { status: 'ISSUED', ...issueScope } }),
    prisma.stocktake.count({ where: { status: { in: ['DRAFT', 'COUNTING', 'SUBMITTED'] } } }),
    prisma.stockAdjustment.count({ where: { status: 'SUBMITTED' } }),
    prisma.stockTransfer.count({ where: { status: 'SUBMITTED' } }),
    prisma.stockReturn.count({ where: { status: { in: ['SUBMITTED', 'INSPECTED'] } } }),
    prisma.stockReceiptItem.count({ where: { inspection_status: 'PENDING', receipt: { status: 'POSTED' } } }),
    prisma.$queryRaw<{ day: string; qty_in: number; qty_out: number }[]>`
      SELECT to_char(date_trunc('day', posted_at + interval '7 hour'), 'YYYY-MM-DD') AS day,
        SUM(CASE WHEN movement_type IN ('RECEIPT','RETURN','TRANSFER_IN','OPENING') AND bucket = 'USABLE' THEN qty_in ELSE 0 END)::float AS qty_in,
        SUM(CASE WHEN movement_type = 'ISSUE' THEN qty_out ELSE 0 END)::float AS qty_out
      FROM stock_movements WHERE posted_at >= ${new Date(to.getTime() - 30 * 86400_000)} AND posted_at <= ${to}
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ department: string; qty: number; docs: number }[]>`
      SELECT d.name AS department, SUM(m.qty_out)::float AS qty, COUNT(DISTINCT m.doc_id)::int AS docs
      FROM stock_movements m JOIN departments d ON d.id = m.department_id
      WHERE m.movement_type = 'ISSUE' AND m.posted_at >= ${new Date(to.getTime() - 30 * 86400_000)} AND m.posted_at <= ${to}
      GROUP BY d.name ORDER BY docs DESC LIMIT 8`,
  ]);
  const rows = stock.rows;
  const statusCount = (s: string) => rows.filter((x) => x.stock_status === s).length;
  const lowList = rows.filter((x) => ['OUT', 'BELOW_MIN'].includes(x.stock_status) && x.min_stock > 0).slice(0, 10)
    .map((x) => ({ item_id: x.item_id, code: x.code, name: x.name, unit: x.unit, closing: x.closing, min_stock: x.min_stock, status: x.stock_status }));
  const costing = await prisma.systemSetting.findUnique({ where: { key: 'inventory.costing_method' } });
  ok(res, {
    period: { from, to },
    mining: {
      item_count: itemCount, equipment_count: equipmentCount,
      total_qty: Math.round(rows.reduce((s, x) => s + x.closing, 0) * 100) / 100,
      items_in_stock: rows.filter((x) => x.closing > 0).length,
      below_min: statusCount('BELOW_MIN'), out_of_stock: rows.filter((x) => x.stock_status === 'OUT' && x.min_stock > 0).length,
      low: statusCount('LOW'), over_max: statusCount('OVER_MAX'),
      receipts_in_period: receiptsInPeriod, issues_in_period: issuesInPeriod,
      inventory_value: null, costing_method: (costing?.value as string) ?? 'NOT_CONFIGURED',
    },
    tasks: {
      receipts_pending: pendingReceipts, issues_pending: pendingIssues, issues_to_issue: approvedIssues, issues_to_confirm: toConfirm,
      stocktakes_open: openStocktakes, adjustments_pending: pendingAdjust, transfers_pending: pendingTransfers, returns_pending: pendingReturns,
      qc_pending_lines: pendingQc, stock_alerts: statusCount('BELOW_MIN') + rows.filter((x) => x.stock_status === 'OUT' && x.min_stock > 0).length,
    },
    low_stock: lowList,
    trend,
    top_departments: topConsumption,
  });
});

export default r;
