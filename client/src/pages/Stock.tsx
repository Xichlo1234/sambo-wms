/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useDebounce, useLookup } from '@/lib/hooks';
import { fmtDate, fmtDateTime, fmtNum, firstOfMonthISO, todayISO } from '@/lib/format';
import { MOVEMENT, DOC_LINK, BUCKET } from '@/lib/constants';
import { Card, DataTable, PageHeader, Pagination, SearchInput, StockBadge, Tabs, Loading, Empty, Alert } from '@/components/ui';
import { ExportButtons, ItemPicker, LookupSelect, type PickedItem } from '@/components/shared';

export function StockPage() {
  const [sp] = useSearchParams();
  const [mode, setMode] = useState<'current' | 'period' | 'asof'>('current');
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [cat, setCat] = useState<number | null>(null);
  const [wh, setWh] = useState<number | null>(null);
  const [status, setStatus] = useState(sp.get('stock_status') ?? '');
  const [from, setFrom] = useState(firstOfMonthISO());
  const [to, setTo] = useState(todayISO());
  const [asOf, setAsOf] = useState(todayISO());
  const [page, setPage] = useState(1);
  const dq = useDebounce(q);
  useEffect(() => setPage(1), [dq, cat, wh, status, mode, from, to, asOf]);
  const params: Record<string, unknown> = { q: dq, category_id: cat, warehouse_id: wh, stock_status: status, page, pageSize: 50,
    ...(mode === 'period' ? { from, to } : mode === 'asof' ? { as_of: asOf } : { from: todayISO(), to: todayISO() }) };
  const { data, isLoading } = useQuery({ queryKey: ['stock', params], queryFn: () => api.page<any>('/stock/balances', params), placeholderData: (p) => p });
  const reportKey = mode === 'period' ? 'nxt' : mode === 'asof' ? 'stock-asof' : 'stock-current';
  const exportParams = mode === 'period' ? { from, to, q: dq, category_id: cat, warehouse_id: wh } : mode === 'asof' ? { to: asOf, q: dq, category_id: cat, warehouse_id: wh } : { q: dq, category_id: cat, warehouse_id: wh, status };
  return (
    <div>
      <PageHeader title="Tồn kho" subtitle="Tồn cuối kỳ = Tồn đầu kỳ + Nhập hợp lệ – Xuất hợp lệ ± Điều chỉnh hợp lệ (tính từ sổ cái, theo ngày ghi sổ)" actions={<ExportButtons reportKey={reportKey} params={exportParams} />} />
      <Tabs value={mode} onChange={(k) => setMode(k as never)} tabs={[{ key: 'current', label: 'Tồn hiện tại (thời gian thực)' }, { key: 'period', label: 'Nhập – xuất – tồn theo kỳ' }, { key: 'asof', label: 'Tồn tại thời điểm quá khứ' }]} />
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <SearchInput value={q} onChange={setQ} placeholder="Mã / tên vật tư..." />
          <LookupSelect path="/warehouses" value={wh} onChange={setWh} placeholder="Tất cả kho" className="input w-44" />
          <LookupSelect path="/categories" value={cat} onChange={setCat} placeholder="Tất cả nhóm" className="input w-52" />
          <select className="input w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tất cả trạng thái</option><option value="OK">Còn hàng</option><option value="LOW">Sắp hết hàng</option><option value="BELOW_MIN">Dưới mức tối thiểu</option>
            <option value="OUT">Hết hàng</option><option value="OVER_MAX">Vượt tồn tối đa</option><option value="PENDING_QC">Đang chờ kiểm tra</option>
          </select>
          {mode === 'period' && <><span className="text-xs">Từ</span><input type="date" className="input w-36" value={from} onChange={(e) => setFrom(e.target.value)} /><span className="text-xs">đến</span><input type="date" className="input w-36" value={to} onChange={(e) => setTo(e.target.value)} /></>}
          {mode === 'asof' && <><span className="text-xs">Tồn tại cuối ngày</span><input type="date" className="input w-36" value={asOf} max={todayISO()} onChange={(e) => setAsOf(e.target.value)} /></>}
        </div>
        <DataTable loading={isLoading} rows={data?.data} rowKey={(r) => r.item_id}
          columns={[
            { key: 'code', header: 'Mã', render: (r) => <Link className="font-semibold text-navy-700 hover:underline" to={`/stock-card?item_id=${r.item_id}`}>{r.code}</Link> },
            { key: 'name', header: 'Tên vật tư', render: (r) => <div>{r.name}<div className="text-xs text-slate-500">{r.category_name}</div></div> },
            { key: 'unit', header: 'ĐVT', render: (r) => r.unit },
            ...(mode === 'period' ? [
              { key: 'opening', header: 'Tồn đầu kỳ', align: 'right' as const, render: (r: any) => fmtNum(r.opening) },
              { key: 'in', header: 'Tổng nhập', align: 'right' as const, render: (r: any) => <span className="text-emerald-700">{fmtNum(r.qty_in)}</span> },
              { key: 'out', header: 'Tổng xuất', align: 'right' as const, render: (r: any) => <span className="text-red-600">{fmtNum(r.qty_out)}</span> },
            ] : []),
            { key: 'closing', header: mode === 'current' ? 'Tồn khả dụng' : 'Tồn cuối kỳ', align: 'right', render: (r) => <b>{fmtNum(r.closing)}</b> },
            ...(mode === 'current' ? [
              { key: 'reserved', header: 'Giữ chỗ', align: 'right' as const, render: (r: any) => fmtNum(r.reserved) },
              { key: 'available', header: 'Có thể xuất', align: 'right' as const, render: (r: any) => fmtNum(r.available) },
            ] : []),
            { key: 'q', header: 'Chờ KT', align: 'right', render: (r) => fmtNum(r.quarantine) },
            { key: 'd', header: 'Hư hỏng', align: 'right', render: (r) => fmtNum(r.damaged) },
            { key: 'loc', header: 'Vị trí', render: (r) => <span className="text-xs">{r.location_codes}</span> },
            { key: 'min', header: 'Min / Max', align: 'right', render: (r) => <span className="text-xs">{fmtNum(r.min_stock)} / {r.max_stock == null ? '–' : fmtNum(r.max_stock)}</span> },
            { key: 'st', header: 'Trạng thái', render: (r) => <div className="flex flex-col gap-0.5"><StockBadge status={r.stock_status} />{r.quarantine > 0 && <StockBadge status="PENDING_QC" />}</div> },
          ]} />
        <Pagination meta={data?.meta} onPage={setPage} />
      </div>
    </div>
  );
}

export function StockCardPage() {
  const [sp, setSp] = useSearchParams();
  const itemId = sp.get('item_id') ? Number(sp.get('item_id')) : null;
  const [item, setItem] = useState<PickedItem | null>(null);
  const [from, setFrom] = useState(firstOfMonthISO());
  const [to, setTo] = useState(todayISO());
  const [bucket, setBucket] = useState('USABLE');
  const { data: whs } = useLookup('/warehouses');
  const [wh, setWh] = useState<number | null>(null);
  useEffect(() => { if (!wh && whs?.length) setWh(whs.find((w) => w.type === 'GENERAL')?.id ?? null); }, [whs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (itemId && item?.id !== itemId) api.get<PickedItem[]>('/items/lookup', { ids: itemId }).then((r) => r[0] && setItem(r[0]));
  }, [itemId]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data, isLoading } = useQuery({
    queryKey: ['stock-card', itemId, wh, from, to, bucket], enabled: !!itemId && !!wh,
    queryFn: () => api.get<any>('/stock/card', { item_id: itemId, warehouse_id: wh, from, to, bucket }),
  });
  return (
    <div>
      <PageHeader title="Thẻ kho" subtitle="Mỗi mã vật tư một thẻ kho – lịch sử nhập/xuất và tồn sau từng giao dịch"
        actions={itemId && <ExportButtons reportKey="stock-card" params={{ item_id: itemId, warehouse_id: wh, from, to }} />} />
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-96"><label className="label">Vật tư</label><ItemPicker value={item} onPick={(it) => { setItem(it); if (it) setSp({ item_id: String(it.id) }); }} /></div>
          <div><label className="label">Kho</label><select className="input w-44" value={wh ?? ''} onChange={(e) => setWh(Number(e.target.value))}>{whs?.filter((w) => w.type === 'GENERAL').map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
          <div><label className="label">Từ ngày</label><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className="label">Đến ngày</label><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div><label className="label">Loại tồn</label><select className="input" value={bucket} onChange={(e) => setBucket(e.target.value)}><option value="USABLE">Khả dụng</option><option value="QUARANTINE">Chờ kiểm tra</option><option value="DAMAGED">Hư hỏng</option><option value="ALL">Tất cả</option></select></div>
        </div>
      </Card>
      <div className="mt-4">
        {!itemId ? <Card><Empty text="Chọn vật tư để xem thẻ kho" /></Card> : isLoading || !data ? <Loading /> : (
          <Card title={<>Thẻ kho: {data.item?.code} – {data.item?.name} ({data.item?.unit?.code})</>}>
            <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              {[['Tồn đầu kỳ', data.opening], ['Tổng nhập', data.total_in], ['Tổng xuất', data.total_out], ['Tồn cuối kỳ', data.closing]].map(([k, v]) => <div key={k} className="rounded-md bg-slate-50 p-3"><div className="text-xs text-slate-500">{k}</div><div className="text-lg font-semibold">{fmtNum(v)}</div></div>)}
            </div>
            {bucket === 'ALL' && <div className="mb-2"><Alert type="info">Đang xem tất cả loại tồn: cột "Tồn sau GD" là tổng khả dụng + chờ kiểm tra + hư hỏng.</Alert></div>}
            <DataTable rows={data.rows} empty="Không có giao dịch trong kỳ"
              columns={[
                { key: 'posted_at', header: 'Ngày ghi sổ', render: (r: any) => fmtDateTime(r.posted_at) },
                { key: 'doc_date', header: 'Ngày CT', render: (r: any) => fmtDate(r.doc_date) },
                { key: 'doc', header: 'Chứng từ', render: (r: any) => DOC_LINK[r.doc_type] ? <Link className="text-navy-700 hover:underline" to={`${DOC_LINK[r.doc_type]}/${r.doc_id}`}>{r.doc_code}</Link> : r.doc_code },
                { key: 'type', header: 'Loại GD', render: (r: any) => <>{MOVEMENT[r.movement_type]}{bucket === 'ALL' && <span className="ml-1 text-xs text-slate-500">({BUCKET[r.bucket]})</span>}</> },
                { key: 'loc', header: 'Vị trí', render: (r: any) => r.location_code },
                { key: 'in', header: 'Nhập', align: 'right', render: (r: any) => r.qty_in ? <span className="text-emerald-700">{fmtNum(r.qty_in)}</span> : '' },
                { key: 'out', header: 'Xuất', align: 'right', render: (r: any) => r.qty_out ? <span className="text-red-600">{fmtNum(r.qty_out)}</span> : '' },
                { key: 'bal', header: 'Tồn sau GD', align: 'right', render: (r: any) => <b>{fmtNum(r.balance)}</b> },
                { key: 'party', header: 'Bộ phận / NCC', render: (r: any) => r.department ?? r.supplier },
                { key: 'user', header: 'Người thực hiện', render: (r: any) => r.user_name },
                { key: 'note', header: 'Ghi chú', render: (r: any) => <span className="text-xs">{r.note}</span> },
              ]} />
          </Card>
        )}
      </div>
    </div>
  );
}
