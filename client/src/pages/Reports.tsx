/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, firstOfMonthISO, todayISO } from '@/lib/format';
import { Alert, Card, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { ExportButtons, ItemPicker, LookupSelect, type PickedItem } from '@/components/shared';

interface Def { key: string; group: string; title: string; params: string[] }

function cell(v: unknown, type?: string) {
  if (type === 'number') return fmtNum(v);
  if (type === 'money') return fmtMoney(v);
  if (type === 'date') return fmtDate(v);
  if (type === 'datetime') return fmtDateTime(v);
  return v == null ? '' : String(v);
}

export default function Reports() {
  const [sp, setSp] = useSearchParams();
  const { data: defs } = useQuery({ queryKey: ['report-defs'], queryFn: () => api.get<Def[]>('/reports'), staleTime: Infinity });
  const key = sp.get('key') ?? '';
  const def = defs?.find((d) => d.key === key);
  const [p, setP] = useState<Record<string, any>>({ from: firstOfMonthISO(), to: todayISO() });
  const [item, setItem] = useState<PickedItem | null>(null);
  const [applied, setApplied] = useState<Record<string, any> | null>(null);
  useEffect(() => { setApplied(null); }, [key]);
  const { data, isFetching, error } = useQuery({ queryKey: ['report', key, applied], enabled: !!def && !!applied, queryFn: () => api.get<any>(`/reports/${key}`, applied!) });
  const groups = [...new Set(defs?.map((d) => d.group))];
  const params = def ? Object.fromEntries(def.params.map((k) => [k, p[k]])) : {};
  return (
    <div>
      <PageHeader title="Báo cáo và thống kê" subtitle="Mọi báo cáo có bộ lọc, tổng hợp, chi tiết, xuất Excel/PDF và in. Báo cáo hóa chất & mua hàng sẽ bổ sung ở giai đoạn 4–5." />
      <div className="grid gap-4 lg:grid-cols-4">
        <Card title="Danh mục báo cáo" className="lg:col-span-1">
          {groups.map((g) => (
            <div key={g} className="mb-3">
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">{g}</div>
              {defs?.filter((d) => d.group === g).map((d, i) => (
                <button key={d.key} onClick={() => setSp({ key: d.key })} className={`block w-full rounded px-2 py-1.5 text-left text-sm ${key === d.key ? 'bg-gold-100 font-semibold text-navy-900' : 'hover:bg-slate-50'}`}>{i + 1}. {d.title}</button>
              ))}
            </div>
          ))}
        </Card>
        <div className="space-y-4 lg:col-span-3">
          {!def ? <Card><div className="flex flex-col items-center gap-2 py-16 text-slate-400"><BarChart3 size={40} />Chọn một báo cáo ở danh mục bên trái</div></Card> : (
            <>
              <Card title={def.title} actions={applied && <ExportButtons reportKey={key} params={applied} />}>
                <div className="flex flex-wrap items-end gap-3">
                  {def.params.includes('item_id') && <div className="w-80"><label className="label">Vật tư</label><ItemPicker value={item} onPick={(it) => { setItem(it); setP({ ...p, item_id: it?.id }); }} /></div>}
                  {def.params.includes('from') && <div><label className="label">Từ ngày</label><input type="date" className="input" value={p.from} onChange={(e) => setP({ ...p, from: e.target.value })} /></div>}
                  {def.params.includes('to') && <div><label className="label">{def.params.includes('from') ? 'Đến ngày' : 'Tại ngày'}</label><input type="date" className="input" value={p.to} onChange={(e) => setP({ ...p, to: e.target.value })} /></div>}
                  {def.params.includes('warehouse_id') && <div><label className="label">Kho</label><LookupSelect path="/warehouses" value={p.warehouse_id} onChange={(v) => setP({ ...p, warehouse_id: v })} placeholder="Tất cả" className="input w-40" /></div>}
                  {def.params.includes('category_id') && <div><label className="label">Nhóm</label><LookupSelect path="/categories" value={p.category_id} onChange={(v) => setP({ ...p, category_id: v })} placeholder="Tất cả" className="input w-48" /></div>}
                  {def.params.includes('department_id') && <div><label className="label">Bộ phận</label><LookupSelect path="/departments" value={p.department_id} onChange={(v) => setP({ ...p, department_id: v })} placeholder="Tất cả" className="input w-48" /></div>}
                  {def.params.includes('supplier_id') && <div><label className="label">Nhà cung cấp</label><LookupSelect path="/suppliers" value={p.supplier_id} onChange={(v) => setP({ ...p, supplier_id: v })} placeholder="Tất cả" className="input w-52" /></div>}
                  {def.params.includes('days') && <div><label className="label">Số ngày không giao dịch</label><input type="number" className="input w-28" value={p.days ?? 90} onChange={(e) => setP({ ...p, days: e.target.value })} /></div>}
                  {def.params.includes('status') && <div><label className="label">Trạng thái tồn</label><select className="input w-44" value={p.status ?? ''} onChange={(e) => setP({ ...p, status: e.target.value })}><option value="">Tất cả</option><option value="OK">Còn hàng</option><option value="LOW">Sắp hết</option><option value="BELOW_MIN">Dưới tối thiểu</option><option value="OUT">Hết hàng</option><option value="OVER_MAX">Vượt tối đa</option></select></div>}
                  {def.params.includes('kind') && <div><label className="label">Loại</label><select className="input w-36" value={p.kind ?? ''} onChange={(e) => setP({ ...p, kind: e.target.value })}><option value="">Tất cả</option><option value="MATERIAL">Vật tư</option><option value="EQUIPMENT">Thiết bị</option></select></div>}
                  {def.params.includes('q') && <div><label className="label">Từ khóa</label><input className="input w-48" value={p.q ?? ''} onChange={(e) => setP({ ...p, q: e.target.value })} placeholder="Mã / tên / số phiếu" /></div>}
                  <button className="btn-primary" disabled={def.params.includes('item_id') && !p.item_id} onClick={() => setApplied({ ...params })}>Xem báo cáo</button>
                </div>
              </Card>
              <ErrorBox error={error} />
              {isFetching ? <Loading /> : data && (
                <Card title={<>{data.title} <span className="text-xs font-normal text-slate-500">– {data.subtitle}</span></>}>
                  {data.summary && <div className="mb-3 flex flex-wrap gap-6 text-sm">{data.summary.map((s: any) => <div key={s.label}><span className="text-slate-500">{s.label}: </span><b>{s.value}</b></div>)}</div>}
                  {data.truncated && <div className="mb-2"><Alert type="info">Màn hình hiển thị {data.rows.length}/{data.row_count} dòng đầu. Xuất Excel/PDF để có đầy đủ dữ liệu.</Alert></div>}
                  <div className="max-h-[60vh] overflow-auto">
                    <table className="table-base">
                      <thead><tr>{data.columns.map((c: any) => <th key={c.key} className={c.type === 'number' || c.type === 'money' ? 'text-right' : ''}>{c.header}</th>)}</tr></thead>
                      <tbody>
                        {data.rows.length === 0 && <tr><td colSpan={data.columns.length} className="py-8 text-center text-slate-400">Không có dữ liệu</td></tr>}
                        {data.rows.map((r: any, i: number) => <tr key={i}>{data.columns.map((c: any) => <td key={c.key} className={c.type === 'number' || c.type === 'money' ? 'text-right tabular-nums' : ''}>{cell(r[c.key], c.type)}</td>)}</tr>)}
                        {Object.keys(data.totals ?? {}).length > 0 && <tr className="bg-gold-50 font-semibold">{data.columns.map((c: any, i: number) => <td key={c.key} className="text-right">{i === 0 ? 'TỔNG CỘNG' : c.key in data.totals ? fmtNum(data.totals[c.key]) : ''}</td>)}</tr>}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
