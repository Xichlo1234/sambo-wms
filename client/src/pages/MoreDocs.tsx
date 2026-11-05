/* eslint-disable @typescript-eslint/no-explicit-any */
/** Điều chuyển, Hàng trả lại, Điều chỉnh tồn kho */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Send, CheckCircle2, XCircle, Ban, ArrowLeft, Microscope } from 'lucide-react';
import { api, newRequestId } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLookup } from '@/lib/hooks';
import { fmtDate, fmtDateTime, fmtNum, todayISO } from '@/lib/format';
import { BUCKET } from '@/lib/constants';
import { Alert, Badge, Card, Field, Loading, Modal, PageHeader, ReasonDialog, Spinner, useToast } from '@/components/ui';
import { AttachmentsPanel, HistoryTimeline, ItemPicker, LookupSelect, PrintButton, type PickedItem } from '@/components/shared';
import { DocList } from '@/components/DocList';

function useGeneralWarehouses() {
  const { data } = useLookup('/warehouses');
  return data?.filter((w) => w.type === 'GENERAL') ?? [];
}

function DocActions({ endpoint, d, perms, onDone, extra }: { endpoint: string; d: any; perms: { create: string; approve: string }; onDone?: () => void; extra?: ReactNode }) {
  const { me, can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [dlg, setDlg] = useState('');
  const act = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: unknown }) => api.post(`${endpoint}/${d.id}/${action}`, body ?? {}),
    onSuccess: (_r, v) => { toast.success({ submit: 'Đã gửi duyệt', approve: 'Đã phê duyệt & ghi sổ', reject: 'Đã từ chối', cancel: 'Đã hủy' }[v.action] ?? 'OK'); setDlg(''); qc.invalidateQueries({ queryKey: [endpoint] }); onDone?.(); },
    onError: (e) => { toast.error(e); qc.invalidateQueries({ queryKey: [endpoint] }); },
  });
  const mine = d.created_by === me?.id;
  const approvable = endpoint === '/returns' ? d.status === 'INSPECTED' : d.status === 'SUBMITTED';
  return (
    <>
      {extra}
      {['DRAFT', 'REJECTED'].includes(d.status) && can(perms.create) && <button className="btn-primary" onClick={() => act.mutate({ action: 'submit' })}><Send size={15} />Gửi duyệt</button>}
      {approvable && can(perms.approve) && !mine && <>
        <button className="btn-danger" onClick={() => setDlg('reject')}><XCircle size={15} />Từ chối</button>
        <button className="btn-success" onClick={() => setDlg('approve')}><CheckCircle2 size={15} />Phê duyệt & ghi sổ</button>
      </>}
      {['DRAFT', 'SUBMITTED', 'REJECTED'].includes(d.status) && can(perms.create) && !(endpoint === '/adjustments' && d.source === 'STOCKTAKE') && <button className="btn-ghost text-red-600" onClick={() => setDlg('cancel')}><Ban size={15} />Hủy</button>}
      <ReasonDialog open={dlg === 'approve'} title="Phê duyệt & ghi sổ" message="Sau khi duyệt, tồn kho được cập nhật và chứng từ không thể hủy." label="Ý kiến" required={false} confirmText="Phê duyệt" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(comment) => act.mutate({ action: 'approve', body: { comment } })} />
      <ReasonDialog open={dlg === 'reject'} title="Từ chối" danger confirmText="Từ chối" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(reason) => act.mutate({ action: 'reject', body: { reason } })} />
      <ReasonDialog open={dlg === 'cancel'} title="Hủy chứng từ" danger confirmText="Hủy" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(reason) => act.mutate({ action: 'cancel', body: { reason } })} />
    </>
  );
}

function StatusAlerts({ d }: { d: any }) {
  return <>
    {d.status === 'REJECTED' && <div className="mb-3"><Alert type="danger"><b>Lý do từ chối:</b> {d.reject_reason}</Alert></div>}
    {d.status === 'CANCELLED' && <div className="mb-3"><Alert type="warning"><b>Đã hủy:</b> {d.cancel_reason}</Alert></div>}
  </>;
}

function Info({ items }: { items: [string, ReactNode][] }) {
  return <dl className="grid grid-cols-1 gap-2 text-sm md:grid-cols-3">{items.map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium">{v || '–'}</dd></div>)}</dl>;
}

const back = (to: string, label: string) => <Link to={to} className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500"><ArrowLeft size={12} />{label}</Link>;

// =================== ĐIỀU CHUYỂN ===================
export function TransferList() {
  const { can } = useAuth();
  const nav = useNavigate();
  return <DocList<any> title="Điều chuyển kho" subtitle="Giữa các vị trí lưu kho hoặc giữa các kho – ghi nhận người giao, người nhận, thời gian bàn giao" endpoint="/transfers" basePath="/transfers"
    statuses={['DRAFT', 'SUBMITTED', 'POSTED', 'REJECTED', 'CANCELLED']}
    actions={can('transfers.create') && <button className="btn-primary" onClick={() => nav('/transfers/new')}><Plus size={15} />Lập phiếu điều chuyển</button>}
    columns={[
      { key: 'code', header: 'Số phiếu', render: (r) => <b className="text-navy-800">{r.code}</b> },
      { key: 'date', header: 'Ngày', render: (r) => fmtDate(r.doc_date) },
      { key: 'route', header: 'Kho đi → đến', render: (r) => `${r.from_warehouse.code} → ${r.to_warehouse.code}` },
      { key: 'lines', header: 'Số dòng', align: 'right', render: (r) => r._count.lines },
      { key: 'creator', header: 'Người lập', render: (r) => r.creator.full_name },
      { key: 'status', header: 'Trạng thái', render: (r) => <Badge status={r.status} /> },
    ]} />;
}

export function TransferForm() {
  const nav = useNavigate();
  const toast = useToast();
  const whs = useGeneralWarehouses();
  const [reqId] = useState(newRequestId);
  const [h, setH] = useState({ from_warehouse_id: null as number | null, to_warehouse_id: null as number | null, doc_date: todayISO(), sender_name: '', receiver_name: '', reason: '', note: '' });
  const [lines, setLines] = useState<{ key: string; item: PickedItem | null; from_location_id: number | null; to_location_id: number | null; qty: string }[]>([{ key: newRequestId(), item: null, from_location_id: null, to_location_id: null, qty: '' }]);
  useEffect(() => { if (!h.from_warehouse_id && whs.length) setH((x) => ({ ...x, from_warehouse_id: whs[0].id, to_warehouse_id: whs[0].id })); }, [whs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const upd = (k: string, p: object) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l)));
  const m = useMutation({
    mutationFn: async () => {
      const r = await api.post<{ id: number }>('/transfers', { ...h, client_request_id: reqId, lines: lines.filter((l) => l.item).map((l) => ({ item_id: l.item!.id, from_location_id: l.from_location_id, to_location_id: l.to_location_id, qty: l.qty })) });
      await api.post(`/transfers/${r.id}/submit`);
      return r.id;
    },
    onSuccess: (id) => { toast.success('Đã lập và gửi duyệt phiếu điều chuyển'); nav(`/transfers/${id}`); }, onError: toast.error,
  });
  return (
    <div>
      <PageHeader back={back('/transfers', 'Điều chuyển')} title="Lập phiếu điều chuyển" />
      <div className="space-y-4">
        <Card title="Thông tin">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field label="Kho đi" required><select className="input" value={h.from_warehouse_id ?? ''} onChange={(e) => setH({ ...h, from_warehouse_id: Number(e.target.value) })}>{whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
            <Field label="Kho đến" required><select className="input" value={h.to_warehouse_id ?? ''} onChange={(e) => setH({ ...h, to_warehouse_id: Number(e.target.value) })}>{whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
            <Field label="Ngày chứng từ" required><input type="date" className="input" value={h.doc_date} onChange={(e) => setH({ ...h, doc_date: e.target.value })} /></Field>
            <Field label="Lý do" required><input className="input" value={h.reason} onChange={(e) => setH({ ...h, reason: e.target.value })} /></Field>
            <Field label="Người giao" required><input className="input" value={h.sender_name} onChange={(e) => setH({ ...h, sender_name: e.target.value })} /></Field>
            <Field label="Người nhận" required><input className="input" value={h.receiver_name} onChange={(e) => setH({ ...h, receiver_name: e.target.value })} /></Field>
            <Field label="Ghi chú" className="md:col-span-2"><input className="input" value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} /></Field>
          </div>
        </Card>
        <Card title="Vật tư điều chuyển" actions={<button className="btn-outline btn-sm" onClick={() => setLines([...lines, { key: newRequestId(), item: null, from_location_id: null, to_location_id: null, qty: '' }])}><Plus size={14} />Thêm dòng</button>}>
          <table className="table-base"><thead><tr><th>Vật tư</th><th className="w-40">Vị trí đi</th><th className="w-40">Vị trí đến</th><th className="w-32 text-right">Số lượng</th><th></th></tr></thead>
            <tbody>{lines.map((l) => (
              <tr key={l.key}>
                <td><ItemPicker value={l.item} warehouseId={h.from_warehouse_id} onPick={(it) => upd(l.key, { item: it })} /></td>
                <td><LookupSelect path="/locations" params={{ warehouse_id: h.from_warehouse_id }} value={l.from_location_id} onChange={(v) => upd(l.key, { from_location_id: v })} labelFn={(r) => r.code} /></td>
                <td><LookupSelect path="/locations" params={{ warehouse_id: h.to_warehouse_id }} value={l.to_location_id} onChange={(v) => upd(l.key, { to_location_id: v })} labelFn={(r) => r.code} /></td>
                <td><input type="number" step="any" min={0} className="input text-right" value={l.qty} onChange={(e) => upd(l.key, { qty: e.target.value })} /></td>
                <td><button className="btn-ghost btn-sm text-red-600" onClick={() => lines.length > 1 && setLines(lines.filter((x) => x.key !== l.key))}><Trash2 size={14} /></button></td>
              </tr>))}</tbody></table>
        </Card>
        <div className="flex justify-end gap-2"><button className="btn-outline" onClick={() => nav(-1)}>Hủy</button><button className="btn-primary" disabled={m.isPending} onClick={() => m.mutate()}>{m.isPending && <Spinner className="h-4 w-4 text-white" />}<Send size={15} />Lưu & gửi duyệt</button></div>
      </div>
    </div>
  );
}

export function TransferDetail() {
  const { id } = useParams();
  const { data: d, isLoading } = useQuery({ queryKey: ['/transfers', id], queryFn: () => api.get<any>(`/transfers/${id}`) });
  if (isLoading || !d) return <Loading />;
  return (
    <div>
      <PageHeader back={back('/transfers', 'Điều chuyển')} title={<span className="flex items-center gap-2">Điều chuyển {d.code} <Badge status={d.status} /></span>}
        actions={<DocActions endpoint="/transfers" d={d} perms={{ create: 'transfers.create', approve: 'transfers.approve' }} extra={<PrintButton type="transfer" id={d.id} />} />} />
      <StatusAlerts d={d} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Thông tin" className="lg:col-span-2"><Info items={[['Từ kho', d.from_warehouse.name], ['Đến kho', d.to_warehouse.name], ['Ngày CT', fmtDate(d.doc_date)], ['Người giao', d.sender_name], ['Người nhận', d.receiver_name], ['Thời gian bàn giao', fmtDateTime(d.handover_at)], ['Lý do', d.reason], ['Người lập', d.creator.full_name], ['Ghi chú', d.note]]} /></Card>
        <HistoryTimeline history={d.history} />
        <Card title="Chi tiết" className="lg:col-span-3">
          <table className="table-base"><thead><tr><th>#</th><th>Mã</th><th>Tên</th><th>ĐVT</th><th>Vị trí đi</th><th>Vị trí đến</th><th className="text-right">SL</th></tr></thead>
            <tbody>{d.lines.map((l: any) => <tr key={l.id}><td>{l.line_no}</td><td>{l.item.code}</td><td>{l.item.name}</td><td>{l.item.unit.code}</td><td>{l.from_location.code}</td><td>{l.to_location.code}</td><td className="text-right">{fmtNum(l.qty)}</td></tr>)}</tbody></table>
        </Card>
        <div className="lg:col-span-3"><AttachmentsPanel entityType="stock_transfer" entityId={d.id} locked={d.status === 'POSTED'} /></div>
      </div>
    </div>
  );
}

// =================== HÀNG TRẢ LẠI ===================
export function ReturnList() {
  const { can } = useAuth();
  const nav = useNavigate();
  return <DocList<any> title="Hàng trả lại" subtitle="Bộ phận trả vật tư → kho kiểm tra & phân loại → phê duyệt. Chỉ hàng dùng được mới tăng tồn khả dụng." endpoint="/returns" basePath="/returns"
    statuses={['DRAFT', 'SUBMITTED', 'INSPECTED', 'POSTED', 'REJECTED', 'CANCELLED']}
    actions={can('returns.create') && <button className="btn-primary" onClick={() => nav('/returns/new')}><Plus size={15} />Lập phiếu trả</button>}
    columns={[
      { key: 'code', header: 'Số phiếu', render: (r) => <b className="text-navy-800">{r.code}</b> },
      { key: 'date', header: 'Ngày', render: (r) => fmtDate(r.doc_date) },
      { key: 'dept', header: 'Bộ phận', render: (r) => r.department.name },
      { key: 'lines', header: 'Số dòng', align: 'right', render: (r) => r._count.lines },
      { key: 'creator', header: 'Người lập', render: (r) => r.creator.full_name },
      { key: 'status', header: 'Trạng thái', render: (r) => <Badge status={r.status} /> },
    ]} />;
}

export function ReturnForm() {
  const nav = useNavigate();
  const toast = useToast();
  const { me, can } = useAuth();
  const whs = useGeneralWarehouses();
  const [reqId] = useState(newRequestId);
  const [h, setH] = useState({ warehouse_id: null as number | null, department_id: me?.department?.id ?? null as number | null, doc_date: todayISO(), returned_by_name: me?.full_name ?? '', reason: '', note: '' });
  const [lines, setLines] = useState<{ key: string; item: PickedItem | null; location_id: number | null; qty_returned: string; reason: string }[]>([{ key: newRequestId(), item: null, location_id: null, qty_returned: '', reason: '' }]);
  useEffect(() => { if (!h.warehouse_id && whs.length) setH((x) => ({ ...x, warehouse_id: whs[0].id })); }, [whs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const upd = (k: string, p: object) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l)));
  const m = useMutation({
    mutationFn: async () => {
      const r = await api.post<{ id: number }>('/returns', { ...h, client_request_id: reqId, lines: lines.filter((l) => l.item).map((l) => ({ item_id: l.item!.id, location_id: l.location_id, qty_returned: l.qty_returned, reason: l.reason })) });
      await api.post(`/returns/${r.id}/submit`);
      return r.id;
    },
    onSuccess: (id) => { toast.success('Đã gửi phiếu trả – chờ kho kiểm tra'); nav(`/returns/${id}`); }, onError: toast.error,
  });
  return (
    <div>
      <PageHeader back={back('/returns', 'Hàng trả lại')} title="Lập phiếu trả vật tư" />
      <div className="space-y-4">
        <Card title="Thông tin"><div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Field label="Kho nhận về" required><select className="input" value={h.warehouse_id ?? ''} onChange={(e) => setH({ ...h, warehouse_id: Number(e.target.value) })}>{whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
          <Field label="Bộ phận trả" required><LookupSelect path="/departments" value={h.department_id} disabled={!can('issues.view_all', 'returns.inspect')} onChange={(v) => setH({ ...h, department_id: v })} /></Field>
          <Field label="Ngày" required><input type="date" className="input" value={h.doc_date} onChange={(e) => setH({ ...h, doc_date: e.target.value })} /></Field>
          <Field label="Người trả" required><input className="input" value={h.returned_by_name} onChange={(e) => setH({ ...h, returned_by_name: e.target.value })} /></Field>
          <Field label="Lý do trả" required className="md:col-span-2"><input className="input" value={h.reason} onChange={(e) => setH({ ...h, reason: e.target.value })} /></Field>
          <Field label="Ghi chú" className="md:col-span-2"><input className="input" value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} /></Field>
        </div></Card>
        <Card title="Vật tư trả" actions={<button className="btn-outline btn-sm" onClick={() => setLines([...lines, { key: newRequestId(), item: null, location_id: null, qty_returned: '', reason: '' }])}><Plus size={14} />Thêm dòng</button>}>
          <table className="table-base"><thead><tr><th>Vật tư</th><th className="w-40">Vị trí nhận về</th><th className="w-32 text-right">SL trả</th><th>Tình trạng / lý do</th><th></th></tr></thead>
            <tbody>{lines.map((l) => (
              <tr key={l.key}>
                <td><ItemPicker value={l.item} onPick={(it) => upd(l.key, { item: it, location_id: l.location_id ?? it?.default_location_id ?? null })} /></td>
                <td><LookupSelect path="/locations" params={{ warehouse_id: h.warehouse_id }} value={l.location_id} onChange={(v) => upd(l.key, { location_id: v })} labelFn={(r) => r.code} /></td>
                <td><input type="number" step="any" min={0} className="input text-right" value={l.qty_returned} onChange={(e) => upd(l.key, { qty_returned: e.target.value })} /></td>
                <td><input className="input" value={l.reason} onChange={(e) => upd(l.key, { reason: e.target.value })} /></td>
                <td><button className="btn-ghost btn-sm text-red-600" onClick={() => lines.length > 1 && setLines(lines.filter((x) => x.key !== l.key))}><Trash2 size={14} /></button></td>
              </tr>))}</tbody></table>
        </Card>
        <div className="flex justify-end gap-2"><button className="btn-outline" onClick={() => nav(-1)}>Hủy</button><button className="btn-primary" disabled={m.isPending} onClick={() => m.mutate()}><Send size={15} />Lưu & gửi</button></div>
      </div>
    </div>
  );
}

function InspectReturn({ d, onClose }: { d: any; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [v, setV] = useState<Record<number, { qty_usable: string; qty_damaged: string; qty_pending: string; inspection_note: string }>>(() => Object.fromEntries(d.lines.map((l: any) => [l.id, { qty_usable: String(l.qty_returned), qty_damaged: '0', qty_pending: '0', inspection_note: '' }])));
  const m = useMutation({
    mutationFn: () => api.post(`/returns/${d.id}/inspect`, { lines: Object.entries(v).map(([id, x]) => ({ id: Number(id), ...x })) }),
    onSuccess: () => { toast.success('Đã ghi nhận kiểm tra – chờ phê duyệt'); qc.invalidateQueries({ queryKey: ['/returns'] }); onClose(); }, onError: toast.error,
  });
  return (
    <Modal open onClose={onClose} title="Kiểm tra chất lượng hàng trả lại" size="lg" footer={<><button className="btn-outline" onClick={onClose}>Đóng</button><button className="btn-primary" disabled={m.isPending} onClick={() => m.mutate()}>Ghi nhận</button></>}>
      <table className="table-base"><thead><tr><th>Vật tư</th><th className="text-right">SL trả</th><th className="w-24">Dùng được</th><th className="w-24">Hư hỏng</th><th className="w-24">Chờ xử lý</th><th>Nhận xét</th></tr></thead>
        <tbody>{d.lines.map((l: any) => { const x = v[l.id]; const set = (p: object) => setV({ ...v, [l.id]: { ...x, ...p } }); return (
          <tr key={l.id}><td>{l.item.code} – {l.item.name}</td><td className="text-right">{fmtNum(l.qty_returned)}</td>
            <td><input type="number" step="any" className="input" value={x.qty_usable} onChange={(e) => set({ qty_usable: e.target.value })} /></td>
            <td><input type="number" step="any" className="input" value={x.qty_damaged} onChange={(e) => set({ qty_damaged: e.target.value })} /></td>
            <td><input type="number" step="any" className="input" value={x.qty_pending} onChange={(e) => set({ qty_pending: e.target.value })} /></td>
            <td><input className="input" value={x.inspection_note} onChange={(e) => set({ inspection_note: e.target.value })} /></td></tr>); })}</tbody></table>
      <p className="mt-2 text-xs text-slate-500">Dùng được + Hư hỏng + Chờ xử lý phải bằng SL trả. Bắt buộc nhận xét khi có hàng hư hỏng/chờ xử lý.</p>
    </Modal>
  );
}

export function ReturnDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const [insp, setInsp] = useState(false);
  const { data: d, isLoading } = useQuery({ queryKey: ['/returns', id], queryFn: () => api.get<any>(`/returns/${id}`) });
  if (isLoading || !d) return <Loading />;
  return (
    <div>
      <PageHeader back={back('/returns', 'Hàng trả lại')} title={<span className="flex items-center gap-2">Phiếu trả {d.code} <Badge status={d.status} /></span>}
        actions={<DocActions endpoint="/returns" d={d} perms={{ create: 'returns.create', approve: 'returns.approve' }}
          extra={<><PrintButton type="return" id={d.id} />{d.status === 'SUBMITTED' && can('returns.inspect') && <button className="btn-gold" onClick={() => setInsp(true)}><Microscope size={15} />Kiểm tra chất lượng</button>}</>} />} />
      <StatusAlerts d={d} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Thông tin" className="lg:col-span-2"><Info items={[['Kho', d.warehouse.name], ['Bộ phận trả', d.department.name], ['Ngày', fmtDate(d.doc_date)], ['Người trả', d.returned_by_name], ['Lý do', d.reason], ['Ngày ghi sổ', fmtDateTime(d.posted_at)]]} /></Card>
        <HistoryTimeline history={d.history} />
        <Card title="Chi tiết" className="lg:col-span-3">
          <table className="table-base"><thead><tr><th>Mã</th><th>Tên</th><th>ĐVT</th><th>Vị trí</th><th className="text-right">SL trả</th><th className="text-right">Dùng được</th><th className="text-right">Hư hỏng</th><th className="text-right">Chờ xử lý</th><th>Nhận xét</th></tr></thead>
            <tbody>{d.lines.map((l: any) => <tr key={l.id}><td>{l.item.code}</td><td>{l.item.name}</td><td>{l.item.unit.code}</td><td>{l.location.code}</td><td className="text-right">{fmtNum(l.qty_returned)}</td><td className="text-right text-emerald-700">{fmtNum(l.qty_usable)}</td><td className="text-right text-red-600">{fmtNum(l.qty_damaged)}</td><td className="text-right">{fmtNum(l.qty_pending)}</td><td className="text-xs">{l.reason} {l.inspection_note && `| KT: ${l.inspection_note}`}</td></tr>)}</tbody></table>
        </Card>
        <div className="lg:col-span-3"><AttachmentsPanel entityType="stock_return" entityId={d.id} locked={d.status === 'POSTED'} /></div>
      </div>
      {insp && <InspectReturn d={d} onClose={() => setInsp(false)} />}
    </div>
  );
}

// =================== ĐIỀU CHỈNH ===================
const SOURCE: Record<string, string> = { MANUAL: 'Lập tay', STOCKTAKE: 'Theo kiểm kê', OPENING: 'Tồn đầu kỳ (import)' };
export function AdjustmentList() {
  const { can } = useAuth();
  const nav = useNavigate();
  return <DocList<any> title="Điều chỉnh tồn kho" subtitle="Mọi điều chỉnh bắt buộc có lý do và được người khác phê duyệt trước khi ghi sổ" endpoint="/adjustments" basePath="/adjustments"
    statuses={['DRAFT', 'SUBMITTED', 'POSTED', 'REJECTED', 'CANCELLED']}
    actions={can('adjustments.create') && <button className="btn-primary" onClick={() => nav('/adjustments/new')}><Plus size={15} />Lập phiếu điều chỉnh</button>}
    columns={[
      { key: 'code', header: 'Số phiếu', render: (r) => <b className="text-navy-800">{r.code}</b> },
      { key: 'date', header: 'Ngày', render: (r) => fmtDate(r.doc_date) },
      { key: 'src', header: 'Nguồn', render: (r) => SOURCE[r.source] },
      { key: 'reason', header: 'Lý do', render: (r) => <span className="line-clamp-2">{r.reason}</span> },
      { key: 'lines', header: 'Số dòng', align: 'right', render: (r) => r._count.lines },
      { key: 'creator', header: 'Người lập', render: (r) => r.creator.full_name },
      { key: 'status', header: 'Trạng thái', render: (r) => <Badge status={r.status} /> },
    ]} />;
}

export function AdjustmentForm() {
  const nav = useNavigate();
  const toast = useToast();
  const whs = useGeneralWarehouses();
  const [reqId] = useState(newRequestId);
  const [h, setH] = useState({ warehouse_id: null as number | null, doc_date: todayISO(), reason: '', note: '' });
  const [lines, setLines] = useState<{ key: string; item: PickedItem | null; location_id: number | null; bucket: string; qty_delta: string; reason: string }[]>([{ key: newRequestId(), item: null, location_id: null, bucket: 'USABLE', qty_delta: '', reason: '' }]);
  useEffect(() => { if (!h.warehouse_id && whs.length) setH((x) => ({ ...x, warehouse_id: whs[0].id })); }, [whs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const upd = (k: string, p: object) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l)));
  const m = useMutation({
    mutationFn: async () => {
      const r = await api.post<{ id: number }>('/adjustments', { ...h, client_request_id: reqId, lines: lines.filter((l) => l.item).map((l) => ({ item_id: l.item!.id, location_id: l.location_id, bucket: l.bucket, qty_delta: l.qty_delta, reason: l.reason })) });
      await api.post(`/adjustments/${r.id}/submit`);
      return r.id;
    },
    onSuccess: (id) => { toast.success('Đã gửi duyệt phiếu điều chỉnh'); nav(`/adjustments/${id}`); }, onError: toast.error,
  });
  return (
    <div>
      <PageHeader back={back('/adjustments', 'Điều chỉnh')} title="Lập phiếu điều chỉnh tồn kho" subtitle="Số dương = tăng tồn, số âm = giảm tồn. Dùng khi phát hiện sai lệch, hủy hàng hư hỏng, xử lý hàng chờ kiểm tra..." />
      <div className="space-y-4">
        <Card title="Thông tin"><div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Field label="Kho" required><select className="input" value={h.warehouse_id ?? ''} onChange={(e) => setH({ ...h, warehouse_id: Number(e.target.value) })}>{whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
          <Field label="Ngày chứng từ" required><input type="date" className="input" value={h.doc_date} onChange={(e) => setH({ ...h, doc_date: e.target.value })} /></Field>
          <Field label="Lý do điều chỉnh" required className="md:col-span-2"><input className="input" value={h.reason} onChange={(e) => setH({ ...h, reason: e.target.value })} /></Field>
        </div></Card>
        <Card title="Dòng điều chỉnh" actions={<button className="btn-outline btn-sm" onClick={() => setLines([...lines, { key: newRequestId(), item: null, location_id: null, bucket: 'USABLE', qty_delta: '', reason: '' }])}><Plus size={14} />Thêm dòng</button>}>
          <table className="table-base"><thead><tr><th>Vật tư</th><th className="w-36">Vị trí</th><th className="w-36">Loại tồn</th><th className="w-32 text-right">SL (+/-)</th><th>Lý do dòng</th><th></th></tr></thead>
            <tbody>{lines.map((l) => (
              <tr key={l.key}>
                <td><ItemPicker value={l.item} warehouseId={h.warehouse_id} onPick={(it) => upd(l.key, { item: it, location_id: l.location_id ?? it?.default_location_id ?? null })} /></td>
                <td><LookupSelect path="/locations" params={{ warehouse_id: h.warehouse_id }} value={l.location_id} onChange={(v) => upd(l.key, { location_id: v })} labelFn={(r) => r.code} /></td>
                <td><select className="input" value={l.bucket} onChange={(e) => upd(l.key, { bucket: e.target.value })}>{Object.entries(BUCKET).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
                <td><input type="number" step="any" className="input text-right" value={l.qty_delta} onChange={(e) => upd(l.key, { qty_delta: e.target.value })} /></td>
                <td><input className="input" value={l.reason} onChange={(e) => upd(l.key, { reason: e.target.value })} /></td>
                <td><button className="btn-ghost btn-sm text-red-600" onClick={() => lines.length > 1 && setLines(lines.filter((x) => x.key !== l.key))}><Trash2 size={14} /></button></td>
              </tr>))}</tbody></table>
        </Card>
        <div className="flex justify-end gap-2"><button className="btn-outline" onClick={() => nav(-1)}>Hủy</button><button className="btn-primary" disabled={m.isPending || h.reason.length < 5} onClick={() => m.mutate()}><Send size={15} />Lưu & gửi duyệt</button></div>
      </div>
    </div>
  );
}

export function AdjustmentDetail() {
  const { id } = useParams();
  const { data: d, isLoading } = useQuery({ queryKey: ['/adjustments', id], queryFn: () => api.get<any>(`/adjustments/${id}`) });
  if (isLoading || !d) return <Loading />;
  return (
    <div>
      <PageHeader back={back('/adjustments', 'Điều chỉnh')} title={<span className="flex items-center gap-2">Điều chỉnh {d.code} <Badge status={d.status} /></span>}
        actions={<DocActions endpoint="/adjustments" d={d} perms={{ create: 'adjustments.create', approve: 'adjustments.approve' }} extra={<PrintButton type="adjustment" id={d.id} />} />} />
      <StatusAlerts d={d} />
      {d.source === 'STOCKTAKE' && d.stocktake && <div className="mb-3"><Alert type="info">Phiếu lập tự động từ kiểm kê <Link className="underline" to={`/stocktakes/${d.stocktake.id}`}>{d.stocktake.code}</Link>.</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Thông tin" className="lg:col-span-2"><Info items={[['Kho', d.warehouse.name], ['Nguồn', SOURCE[d.source]], ['Ngày CT', fmtDate(d.doc_date)], ['Lý do', d.reason], ['Người lập', d.creator.full_name], ['Ngày ghi sổ', fmtDateTime(d.posted_at)]]} /></Card>
        <HistoryTimeline history={d.history} />
        <Card title="Chi tiết" className="lg:col-span-3">
          <table className="table-base"><thead><tr><th>#</th><th>Mã</th><th>Tên</th><th>ĐVT</th><th>Vị trí</th><th>Loại tồn</th><th className="text-right">SL điều chỉnh</th><th>Lý do</th></tr></thead>
            <tbody>{d.lines.map((l: any) => <tr key={l.id}><td>{l.line_no}</td><td>{l.item.code}</td><td>{l.item.name}</td><td>{l.item.unit.code}</td><td>{l.location.code}</td><td>{BUCKET[l.bucket]}</td><td className={`text-right font-semibold ${l.qty_delta > 0 ? 'text-emerald-700' : 'text-red-600'}`}>{l.qty_delta > 0 ? '+' : ''}{fmtNum(l.qty_delta)}</td><td className="text-xs">{l.reason}</td></tr>)}</tbody></table>
        </Card>
        <div className="lg:col-span-3"><AttachmentsPanel entityType="stock_adjustment" entityId={d.id} locked={d.status === 'POSTED'} /></div>
      </div>
    </div>
  );
}
