import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { Package, AlertTriangle, PackageX, ArrowDownToLine, ArrowUpFromLine, Boxes, ClipboardCheck, ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtNum, todayISO } from '@/lib/format';
import { Card, Loading, ErrorBox, PageHeader, StockBadge } from '@/components/ui';

interface Dash {
  mining: Record<string, number | string | null>;
  tasks: Record<string, number>;
  low_stock: { item_id: number; code: string; name: string; unit: string; closing: number; min_stock: number; status: string }[];
  trend: { day: string; qty_in: number; qty_out: number }[];
  top_departments: { department: string; qty: number; docs: number }[];
}

function range(kind: string): { from: string; to: string } {
  const t = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (kind === 'month') return { from: iso(new Date(t.getFullYear(), t.getMonth(), 1)), to: iso(t) };
  if (kind === 'quarter') return { from: iso(new Date(t.getFullYear(), Math.floor(t.getMonth() / 3) * 3, 1)), to: iso(t) };
  if (kind === 'year') return { from: iso(new Date(t.getFullYear(), 0, 1)), to: iso(t) };
  return { from: iso(t), to: iso(t) };
}

function Kpi({ icon, label, value, tone = 'navy', to }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone?: 'navy' | 'gold' | 'red' | 'amber' | 'green'; to?: string }) {
  const c = { navy: 'bg-navy-50 text-navy-700', gold: 'bg-gold-100 text-gold-700', red: 'bg-red-50 text-red-600', amber: 'bg-amber-50 text-amber-700', green: 'bg-emerald-50 text-emerald-700' }[tone];
  const body = (
    <div className="card flex items-center gap-3 p-4 transition hover:shadow-md">
      <div className={`rounded-lg p-2.5 ${c}`}>{icon}</div>
      <div><div className="text-xs text-slate-500">{label}</div><div className="text-xl font-semibold text-navy-900">{value}</div></div>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

function Task({ label, n, to }: { label: string; n: number; to: string }) {
  return (
    <Link to={to} className="flex items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-slate-50">
      <span>{label}</span>
      <span className={`min-w-8 rounded-full px-2 py-0.5 text-center text-xs font-semibold ${n ? 'bg-gold-500 text-navy-950' : 'bg-slate-100 text-slate-400'}`}>{n}</span>
    </Link>
  );
}

export default function Dashboard() {
  const { me, can } = useAuth();
  const [kind, setKind] = useState('today');
  const [custom, setCustom] = useState({ from: todayISO(), to: todayISO() });
  const r = kind === 'custom' ? custom : range(kind);
  const { data, isLoading, error } = useQuery({ queryKey: ['dashboard', r], queryFn: () => api.get<Dash>('/dashboard', r), refetchInterval: 120_000 });
  return (
    <div>
      <PageHeader title={`Xin chào, ${me?.full_name}`} subtitle="Tổng quan hoạt động kho SAMBO GOLD"
        actions={<div className="flex flex-wrap items-center gap-2">
          {[['today', 'Hôm nay'], ['month', 'Tháng này'], ['quarter', 'Quý này'], ['year', 'Năm nay'], ['custom', 'Tùy chọn']].map(([k, l]) => (
            <button key={k} className={kind === k ? 'btn-primary btn-sm' : 'btn-outline btn-sm'} onClick={() => setKind(k)}>{l}</button>
          ))}
          {kind === 'custom' && <><input type="date" className="input w-36" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /><input type="date" className="input w-36" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></>}
        </div>} />
      <ErrorBox error={error} />
      {isLoading || !data ? <Loading /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi icon={<Package size={20} />} label="Mã vật tư đang dùng" value={fmtNum(data.mining.item_count)} to="/items" />
            <Kpi icon={<Boxes size={20} />} label="Mã đang có tồn" value={fmtNum(data.mining.items_in_stock)} tone="gold" to="/stock" />
            <Kpi icon={<AlertTriangle size={20} />} label="Dưới mức tối thiểu" value={fmtNum(data.mining.below_min)} tone="amber" to="/stock?stock_status=BELOW_MIN" />
            <Kpi icon={<PackageX size={20} />} label="Hết hàng (có định mức)" value={fmtNum(data.mining.out_of_stock)} tone="red" to="/stock?stock_status=OUT" />
            <Kpi icon={<ArrowDownToLine size={20} />} label="Phiếu nhập trong kỳ" value={fmtNum(data.mining.receipts_in_period)} tone="green" to="/receipts" />
            <Kpi icon={<ArrowUpFromLine size={20} />} label="Phiếu xuất trong kỳ" value={fmtNum(data.mining.issues_in_period)} to="/issues" />
            <Kpi icon={<ClipboardCheck size={20} />} label="Thiết bị (mã)" value={fmtNum(data.mining.equipment_count)} to="/equipment" />
            <Kpi icon={<ShieldAlert size={20} />} label="Giá trị tồn kho" tone="gold"
              value={data.mining.costing_method === 'NOT_CONFIGURED' ? <span className="text-sm font-normal text-slate-500">Chưa cấu hình PP tính giá</span> : fmtNum(data.mining.inventory_value)} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Công việc cần xử lý" className="lg:col-span-1">
              <div className="-mx-3 -my-2">
                {can('receipts.approve') && <Task label="Phiếu nhập chờ duyệt" n={data.tasks.receipts_pending} to="/receipts?status=SUBMITTED" />}
                {can('issues.approve', 'issues.view_all', 'issues.view') && <Task label="Yêu cầu cấp vật tư chờ duyệt" n={data.tasks.issues_pending} to="/issues?status=SUBMITTED" />}
                {can('issues.issue') && <Task label="Phiếu đã duyệt – chờ xuất kho" n={data.tasks.issues_to_issue} to="/issues?status=APPROVED" />}
                {can('issues.confirm', 'issues.issue') && <Task label="Đã xuất – chờ xác nhận nhận hàng" n={data.tasks.issues_to_confirm} to="/issues?status=ISSUED" />}
                {can('receipts.inspect') && <Task label="Dòng hàng chờ kiểm tra chất lượng" n={data.tasks.qc_pending_lines} to="/receipts?pending_inspection=1" />}
                {can('stocktakes.view') && <Task label="Đợt kiểm kê chưa hoàn thành" n={data.tasks.stocktakes_open} to="/stocktakes" />}
                {can('adjustments.view') && <Task label="Phiếu điều chỉnh chờ duyệt" n={data.tasks.adjustments_pending} to="/adjustments?status=SUBMITTED" />}
                {can('transfers.view') && <Task label="Điều chuyển chờ duyệt" n={data.tasks.transfers_pending} to="/transfers?status=SUBMITTED" />}
                {can('returns.view') && <Task label="Hàng trả lại chờ xử lý" n={data.tasks.returns_pending} to="/returns" />}
                {can('stock.view') && <Task label="Cảnh báo tồn kho" n={data.tasks.stock_alerts} to="/stock?stock_status=BELOW_MIN" />}
              </div>
            </Card>
            <Card title="Nhập – xuất 30 ngày gần nhất (khả dụng)" className="lg:col-span-2">
              {data.trend.length === 0 ? <div className="py-16 text-center text-sm text-slate-400">Chưa có giao dịch</div> : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(8, 10) + '/' + d.slice(5, 7)} fontSize={11} />
                    <YAxis fontSize={11} />
                    <Tooltip formatter={(v: number) => fmtNum(v)} labelFormatter={(d: string) => d.split('-').reverse().join('/')} />
                    <Legend />
                    <Bar dataKey="qty_in" name="Nhập" fill="#1f447d" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="qty_out" name="Xuất" fill="#e0b23a" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Vật tư dưới mức tối thiểu / hết hàng" actions={<Link className="text-xs text-navy-600 hover:underline" to="/reports?key=below-min">Xem báo cáo</Link>}>
              {data.low_stock.length === 0 ? <div className="text-sm text-slate-400">Không có cảnh báo</div> : (
                <table className="table-base"><thead><tr><th>Mã</th><th>Tên</th><th className="text-right">Tồn</th><th className="text-right">Tối thiểu</th><th></th></tr></thead>
                  <tbody>{data.low_stock.map((x) => <tr key={x.item_id}><td><Link className="text-navy-700 hover:underline" to={`/items/${x.item_id}`}>{x.code}</Link></td><td>{x.name}</td><td className="text-right">{fmtNum(x.closing)} {x.unit}</td><td className="text-right">{fmtNum(x.min_stock)}</td><td><StockBadge status={x.status} /></td></tr>)}</tbody></table>
              )}
            </Card>
            <Card title="Bộ phận nhận vật tư nhiều nhất (30 ngày)">
              {data.top_departments.length === 0 ? <div className="text-sm text-slate-400">Chưa có dữ liệu</div> : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={data.top_departments} layout="vertical" margin={{ left: 40 }}>
                    <XAxis type="number" fontSize={11} /><YAxis type="category" dataKey="department" width={150} fontSize={11} />
                    <Tooltip /><Bar dataKey="docs" name="Số phiếu xuất" fill="#2f5a9a" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
