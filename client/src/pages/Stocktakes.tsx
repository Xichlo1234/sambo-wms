/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Lock, Save, Send, CheckCircle2, XCircle, Ban, ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLookup } from '@/lib/hooks';
import { fmtDateTime, fmtNum } from '@/lib/format';
import { Alert, Badge, Card, Field, Loading, Modal, PageHeader, ReasonDialog, useToast } from '@/components/ui';
import { AttachmentsPanel, HistoryTimeline, ItemPicker, LookupSelect, PrintButton, type PickedItem } from '@/components/shared';
import { DocList } from '@/components/DocList';

const SCOPE: Record<string, string> = { ALL: 'Toàn bộ kho', CATEGORY: 'Theo nhóm vật tư', LOCATION: 'Theo vị trí lưu kho', ITEMS: 'Danh sách mặt hàng chọn' };

function CreateModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const { data: whs } = useLookup('/warehouses');
  const { data: cats } = useLookup('/categories');
  const [f, setF] = useState({ warehouse_id: null as number | null, name: '', scope_type: 'ALL', category_ids: [] as number[], location_ids: [] as number[], items: [] as PickedItem[], note: '' });
  const { data: locs } = useLookup('/locations', { warehouse_id: f.warehouse_id }, !!f.warehouse_id);
  useEffect(() => { if (!f.warehouse_id && whs) setF((x) => ({ ...x, warehouse_id: whs.find((w) => w.type === 'GENERAL')?.id ?? null })); }, [whs]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = useMutation({
    mutationFn: () => api.post<{ id: number }>('/stocktakes', { ...f, item_ids: f.items.map((i) => i.id) }),
    onSuccess: (r) => { toast.success('Đã tạo đợt kiểm kê'); nav(`/stocktakes/${r.id}`); }, onError: toast.error,
  });
  const toggle = (k: 'category_ids' | 'location_ids', id: number) => setF({ ...f, [k]: f[k].includes(id) ? f[k].filter((x) => x !== id) : [...f[k], id] });
  return (
    <Modal open onClose={onClose} title="Tạo đợt kiểm kê" size="md" footer={<><button className="btn-outline" onClick={onClose}>Hủy</button><button className="btn-primary" disabled={m.isPending || f.name.length < 3} onClick={() => m.mutate()}>Tạo</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kho" required><select className="input" value={f.warehouse_id ?? ''} onChange={(e) => setF({ ...f, warehouse_id: Number(e.target.value) })}>{whs?.filter((w) => w.type === 'GENERAL').map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
        <Field label="Phạm vi" required><select className="input" value={f.scope_type} onChange={(e) => setF({ ...f, scope_type: e.target.value })}>{Object.entries(SCOPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Tên đợt kiểm kê" required className="col-span-2"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="VD: Kiểm kê định kỳ tháng 11/2026" /></Field>
        {f.scope_type === 'CATEGORY' && <div className="col-span-2 grid max-h-48 grid-cols-2 gap-1 overflow-y-auto rounded border p-2 text-sm">{cats?.map((c) => <label key={c.id} className="flex gap-2"><input type="checkbox" checked={f.category_ids.includes(c.id)} onChange={() => toggle('category_ids', c.id)} />{c.code} – {c.name}</label>)}</div>}
        {f.scope_type === 'LOCATION' && <div className="col-span-2 grid max-h-48 grid-cols-3 gap-1 overflow-y-auto rounded border p-2 text-sm">{locs?.map((c) => <label key={c.id} className="flex gap-2"><input type="checkbox" checked={f.location_ids.includes(c.id)} onChange={() => toggle('location_ids', c.id)} />{c.code}</label>)}</div>}
        {f.scope_type === 'ITEMS' && <div className="col-span-2">
          <ItemPicker value={null} onPick={(it) => it && !f.items.some((x) => x.id === it.id) && setF({ ...f, items: [...f.items, it] })} />
          <div className="mt-2 flex flex-wrap gap-1">{f.items.map((i) => <span key={i.id} className="rounded bg-slate-100 px-2 py-0.5 text-xs">{i.code} <button onClick={() => setF({ ...f, items: f.items.filter((x) => x.id !== i.id) })}>×</button></span>)}</div>
        </div>}
        <Field label="Ghi chú" className="col-span-2"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export function StocktakeList() {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <>
      <DocList<any> title="Kiểm kê kho" subtitle="Chốt tồn sổ → kiểm đếm → chênh lệch = thực tế – sổ sách → giải trình → phê duyệt mới điều chỉnh tồn" endpoint="/stocktakes" basePath="/stocktakes"
        statuses={['DRAFT', 'COUNTING', 'SUBMITTED', 'POSTED', 'CANCELLED']}
        actions={can('stocktakes.create') && <button className="btn-primary" onClick={() => setOpen(true)}><Plus size={15} />Tạo đợt kiểm kê</button>}
        columns={[
          { key: 'code', header: 'Số', render: (r) => <b className="text-navy-800">{r.code}</b> },
          { key: 'name', header: 'Tên đợt', render: (r) => r.name },
          { key: 'scope', header: 'Phạm vi', render: (r) => SCOPE[r.scope_type] },
          { key: 'snap', header: 'Chốt sổ lúc', render: (r) => fmtDateTime(r.snapshot_at) },
          { key: 'lines', header: 'Số dòng', align: 'right', render: (r) => r._count.lines },
          { key: 'creator', header: 'Người tạo', render: (r) => r.creator.full_name },
          { key: 'status', header: 'Trạng thái', render: (r) => <Badge status={r.status} /> },
        ]} />
      {open && <CreateModal onClose={() => setOpen(false)} />}
    </>
  );
}

export function StocktakeDetail() {
  const { id } = useParams();
  const { me, can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [counts, setCounts] = useState<Record<number, { counted_qty: string; reason: string }>>({});
  const [filter, setFilter] = useState<'all' | 'diff' | 'todo'>('all');
  const [dlg, setDlg] = useState('');
  const [add, setAdd] = useState<{ item: PickedItem | null; location_id: number | null }>({ item: null, location_id: null });
  const { data: d, isLoading } = useQuery({ queryKey: ['/stocktakes', id], queryFn: () => api.get<any>(`/stocktakes/${id}`) });
  useEffect(() => { if (d) setCounts(Object.fromEntries(d.lines.map((l: any) => [l.id, { counted_qty: l.counted_qty == null ? '' : String(l.counted_qty), reason: l.reason ?? '' }]))); }, [d]);
  const inv = () => qc.invalidateQueries({ queryKey: ['/stocktakes'] });
  const act = useMutation({
    mutationFn: ({ action, body, method = 'post' }: { action: string; body?: unknown; method?: 'post' | 'put' }) => api[method](`/stocktakes/${id}/${action}`, body ?? {}),
    onSuccess: (r: any, v) => { toast.success({ freeze: 'Đã chốt tồn sổ – bắt đầu kiểm đếm', counts: 'Đã lưu số kiểm đếm', submit: `Đã gửi duyệt (${r?.variance_lines ?? 0} dòng chênh lệch)`, approve: 'Đã phê duyệt – điều chỉnh tồn kho đã ghi sổ', reject: 'Đã trả về kiểm đếm lại', cancel: 'Đã hủy', lines: 'Đã thêm dòng' }[v.action] ?? 'OK'); setDlg(''); inv(); },
    onError: (e) => { toast.error(e); inv(); },
  });
  const rows = useMemo(() => (d?.lines ?? []).filter((l: any) => {
    const c = counts[l.id];
    if (filter === 'todo') return !c || c.counted_qty === '';
    if (filter === 'diff') return c && c.counted_qty !== '' && Number(c.counted_qty) !== l.book_qty;
    return true;
  }), [d, counts, filter]);
  if (isLoading || !d) return <Loading />;
  const editable = d.status === 'COUNTING' && can('stocktakes.count');
  const done = d.lines.filter((l: any) => counts[l.id]?.counted_qty !== '' && counts[l.id]?.counted_qty !== undefined).length;
  const saveCounts = () => act.mutate({ action: 'counts', method: 'put', body: { lines: Object.entries(counts).map(([lid, c]) => ({ id: Number(lid), counted_qty: c.counted_qty === '' ? null : c.counted_qty, reason: c.reason })) } });
  return (
    <div>
      <PageHeader back={<Link to="/stocktakes" className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500"><ArrowLeft size={12} />Kiểm kê</Link>}
        title={<span className="flex items-center gap-2">{d.code} – {d.name} <Badge status={d.status} /></span>}
        subtitle={`${d.warehouse.name} · ${SCOPE[d.scope_type]} · Chốt sổ: ${fmtDateTime(d.snapshot_at) || 'chưa chốt'} · Đã đếm ${done}/${d.lines.length}`}
        actions={<>
          {d.status !== 'DRAFT' && <PrintButton type="stocktake" id={d.id} />}
          {d.status === 'DRAFT' && can('stocktakes.create') && <button className="btn-primary" onClick={() => confirm('Chốt tồn sổ tại thời điểm này để bắt đầu kiểm đếm?') && act.mutate({ action: 'freeze' })}><Lock size={15} />Chốt tồn sổ</button>}
          {editable && <button className="btn-outline" onClick={saveCounts}><Save size={15} />Lưu số kiểm</button>}
          {d.status === 'COUNTING' && can('stocktakes.count', 'stocktakes.create') && <button className="btn-primary" onClick={() => confirm('Lưu và gửi duyệt kết quả kiểm kê? Hệ thống sẽ lập phiếu điều chỉnh chênh lệch (chưa ghi sổ).') && api.put(`/stocktakes/${id}/counts`, { lines: Object.entries(counts).map(([lid, c]) => ({ id: Number(lid), counted_qty: c.counted_qty === '' ? null : c.counted_qty, reason: c.reason })) }).then(() => act.mutate({ action: 'submit' })).catch(toast.error)}><Send size={15} />Gửi duyệt</button>}
          {d.status === 'SUBMITTED' && can('stocktakes.approve') && <>
            <button className="btn-danger" onClick={() => setDlg('reject')}><XCircle size={15} />Trả về</button>
            <button className="btn-success" onClick={() => setDlg('approve')}><CheckCircle2 size={15} />Phê duyệt điều chỉnh</button>
          </>}
          {['DRAFT', 'COUNTING'].includes(d.status) && can('stocktakes.create') && <button className="btn-ghost text-red-600" onClick={() => setDlg('cancel')}><Ban size={15} />Hủy</button>}
        </>} />
      {d.reject_reason && d.status === 'COUNTING' && <div className="mb-3"><Alert type="danger"><b>Bị trả về:</b> {d.reject_reason}</Alert></div>}
      {d.moved_after_snapshot > 0 && <div className="mb-3"><Alert type="warning">Có <b>{d.moved_after_snapshot}</b> giao dịch phát sinh với các mặt hàng này sau thời điểm chốt sổ. Chênh lệch được tính so với tồn tại thời điểm chốt – hãy đảm bảo số kiểm đếm phản ánh đúng thời điểm chốt.</Alert></div>}
      {d.status === 'SUBMITTED' && d.created_by === me?.id && <div className="mb-3"><Alert type="info">Chờ người có thẩm quyền khác phê duyệt.</Alert></div>}
      {d.adjustment && <div className="mb-3 text-sm">Phiếu điều chỉnh: <Link className="text-navy-700 underline" to={`/adjustments/${d.adjustment.id}`}>{d.adjustment.code}</Link> <Badge status={d.adjustment.status} /></div>}
      {d.status === 'DRAFT' ? <Card><Alert type="info">Bấm <b>Chốt tồn sổ</b> để hệ thống ghi nhận số lượng trên sổ tại thời điểm kiểm kê và tạo danh sách kiểm đếm.</Alert></Card> : (
        <Card title="Bảng kiểm đếm" actions={<select className="input w-44" value={filter} onChange={(e) => setFilter(e.target.value as never)}><option value="all">Tất cả dòng</option><option value="todo">Chưa đếm</option><option value="diff">Có chênh lệch</option></select>}>
          {editable && (
            <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md bg-slate-50 p-2">
              <div className="w-80"><label className="label">Thêm mặt hàng phát hiện thực tế (sổ không có)</label><ItemPicker value={add.item} onPick={(it) => setAdd({ ...add, item: it })} /></div>
              <div className="w-40"><label className="label">Vị trí</label><LookupSelect path="/locations" params={{ warehouse_id: d.warehouse_id }} value={add.location_id} onChange={(v) => setAdd({ ...add, location_id: v })} labelFn={(r) => r.code} /></div>
              <button className="btn-outline" disabled={!add.item || !add.location_id} onClick={() => { act.mutate({ action: 'lines', body: { item_id: add.item!.id, location_id: add.location_id } }); setAdd({ item: null, location_id: null }); }}><Plus size={14} />Thêm</button>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Vị trí</th><th>Mã</th><th>Tên vật tư</th><th>ĐVT</th><th className="text-right">Tồn sổ</th><th className="w-32 text-right">Thực tế</th><th className="text-right">Chênh lệch</th><th>Giải trình nguyên nhân</th></tr></thead>
              <tbody>{rows.map((l: any) => {
                const c = counts[l.id] ?? { counted_qty: '', reason: '' };
                const v = c.counted_qty === '' ? null : Number(c.counted_qty) - l.book_qty;
                return (
                  <tr key={l.id} className={v ? 'bg-amber-50/60' : ''}>
                    <td>{l.location.code}</td><td>{l.item.code}</td><td>{l.item.name}</td><td>{l.item.unit.code}</td>
                    <td className="text-right">{fmtNum(l.book_qty)}</td>
                    <td>{editable ? <input type="number" step="any" min={0} className="input text-right" value={c.counted_qty} onChange={(e) => setCounts({ ...counts, [l.id]: { ...c, counted_qty: e.target.value } })} /> : <div className="text-right">{fmtNum(l.counted_qty)}</div>}</td>
                    <td className={`text-right font-semibold ${v ? (v > 0 ? 'text-emerald-700' : 'text-red-600') : ''}`}>{v == null ? '' : (v > 0 ? '+' : '') + fmtNum(v)}</td>
                    <td>{editable ? <input className={`input ${v && !c.reason ? 'border-red-300' : ''}`} value={c.reason} placeholder={v ? 'Bắt buộc giải trình' : ''} onChange={(e) => setCounts({ ...counts, [l.id]: { ...c, reason: e.target.value } })} /> : <span className="text-xs">{l.reason}</span>}</td>
                  </tr>);
              })}</tbody>
            </table>
          </div>
        </Card>
      )}
      <div className="mt-4 grid gap-4 lg:grid-cols-2"><HistoryTimeline history={d.history} /><AttachmentsPanel entityType="stocktake" entityId={d.id} locked={d.status === 'POSTED'} /></div>
      <ReasonDialog open={dlg === 'approve'} title="Phê duyệt kết quả kiểm kê" message="Chênh lệch sẽ được ghi sổ điều chỉnh tồn kho." label="Ý kiến" required={false} confirmText="Phê duyệt" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(comment) => act.mutate({ action: 'approve', body: { comment } })} />
      <ReasonDialog open={dlg === 'reject'} title="Trả về kiểm đếm lại" danger confirmText="Trả về" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(reason) => act.mutate({ action: 'reject', body: { reason } })} />
      <ReasonDialog open={dlg === 'cancel'} title="Hủy đợt kiểm kê" danger confirmText="Hủy" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(reason) => act.mutate({ action: 'cancel', body: { reason } })} />
    </div>
  );
}
