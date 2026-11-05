/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Send, CheckCircle2, XCircle, Ban, ArrowLeft, FileQuestion, ShoppingCart, Truck, Lightbulb, Lock } from 'lucide-react';
import { api, newRequestId } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSettings } from '@/lib/hooks';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, todayISO, toISODate } from '@/lib/format';
import { PURCHASE_STATUS, QUOTE_STATUS, PRIORITY } from '@/lib/constants';
import { Alert, Badge, Card, DataTable, Field, Loading, Modal, PageHeader, ReasonDialog, Spinner, useToast } from '@/components/ui';
import { AttachmentsPanel, HistoryTimeline, LookupSelect, PrintButton, TargetPicker, ExportButtons, type PickedItem, type PickedChemical } from '@/components/shared';
import { DocList } from '@/components/DocList';

const back = (to: string, l: string) => <Link to={to} className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500"><ArrowLeft size={12} />{l}</Link>;
const tName = (l: any) => (l.item ? `${l.item.code} – ${l.item.name}` : l.chemical ? `${l.chemical.code} – ${l.chemical.name}` : l.description);
const tUnit = (l: any) => l.item?.unit?.code ?? l.chemical?.unit?.code ?? l.unit_code ?? '';

function Actions({ endpoint, id, onDone }: { endpoint: string; id: number; onDone?: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, body }: { action: string; body?: unknown }) => api.post(`${endpoint}/${id}/${action}`, body ?? {}),
    onSuccess: () => { toast.success('Đã cập nhật'); qc.invalidateQueries({ queryKey: [endpoint] }); onDone?.(); },
    onError: (e) => { toast.error(e); qc.invalidateQueries({ queryKey: [endpoint] }); },
  });
}

// ============================ ĐỀ NGHỊ MUA ============================
export function PrList() {
  const { can } = useAuth();
  const nav = useNavigate();
  return <DocList<any> title="Đề nghị mua hàng" subtitle="Bộ phận lập đề nghị → người có thẩm quyền duyệt → mua hàng lập yêu cầu báo giá / đơn đặt hàng. Hệ thống không tự đặt hàng." endpoint="/purchase-requests" basePath="/purchase-requests"
    statuses={['DRAFT', 'SUBMITTED', 'APPROVED', 'ORDERED', 'REJECTED', 'CLOSED', 'CANCELLED']} statusMap={PURCHASE_STATUS}
    actions={can('purchase.request') && <button className="btn-primary" onClick={() => nav('/purchase-requests/new')}><Plus size={15} />Lập đề nghị mua</button>}
    columns={[
      { key: 'code', header: 'Số ĐN', render: (r) => <b className="text-navy-800">{r.code}</b> },
      { key: 'd', header: 'Ngày', render: (r) => fmtDate(r.request_date) },
      { key: 'dept', header: 'Bộ phận', render: (r) => r.department.name },
      { key: 'p', header: 'Mục đích', render: (r) => <span className="line-clamp-2 text-xs">{r.purpose}</span> },
      { key: 'prio', header: 'Ưu tiên', render: (r) => <Badge status={r.priority} map={PRIORITY} /> },
      { key: 'need', header: 'Ngày cần', render: (r) => fmtDate(r.needed_date) },
      { key: 'n', header: 'Dòng / BG', align: 'right', render: (r) => `${r._count.lines} / ${r._count.quotes}` },
      { key: 's', header: 'Trạng thái', render: (r) => <Badge status={r.status} map={PURCHASE_STATUS} /> },
    ]} />;
}

interface PLine { key: string; kind: 'item' | 'chemical'; item: PickedItem | null; chemical: PickedChemical | null; qty: string; needed_date: string; note: string }
const emptyP = (): PLine => ({ key: newRequestId(), kind: 'item', item: null, chemical: null, qty: '', needed_date: '', note: '' });

export function PrForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { me, can } = useAuth();
  const [reqId] = useState(newRequestId);
  const [h, setH] = useState<any>({ request_date: todayISO(), department_id: me?.department?.id ?? null, purpose: '', priority: 'NORMAL', needed_date: '', note: '' });
  const [lines, setLines] = useState<PLine[]>([emptyP()]);
  const [showSug, setShowSug] = useState(false);
  const ex = useQuery({ queryKey: ['/purchase-requests', id], enabled: !!id, queryFn: () => api.get<any>(`/purchase-requests/${id}`) });
  const sug = useQuery({ queryKey: ['pr-suggestions'], enabled: showSug, queryFn: () => api.get<any[]>('/purchase-requests/suggestions') });
  useEffect(() => { const d = ex.data; if (!d) return; setH({ request_date: toISODate(d.request_date), department_id: d.department_id, purpose: d.purpose, priority: d.priority, needed_date: toISODate(d.needed_date), note: d.note ?? '' }); setLines(d.lines.map((l: any) => ({ key: String(l.id), kind: l.chemical_id ? 'chemical' : 'item', item: l.item ? { ...l.item } : null, chemical: l.chemical ? { ...l.chemical, is_controlled: false } : null, qty: String(l.qty), needed_date: toISODate(l.needed_date), note: l.note ?? '' }))); }, [ex.data]);
  const upd = (k: string, p: Partial<PLine>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l)));
  const addSug = (s: any) => setLines((ls) => [...ls.filter((l) => l.item || l.chemical), { ...emptyP(), kind: s.type, item: s.type === 'item' ? { id: s.id, code: s.code, name: s.name, unit: { code: s.unit } } : null, chemical: s.type === 'chemical' ? { id: s.id, code: s.code, name: s.name, unit: { code: s.unit }, is_controlled: false } : null, qty: String(Math.ceil(s.suggest_qty)) }]);
  const save = useMutation({
    mutationFn: async (s: boolean) => {
      const body = { ...h, needed_date: h.needed_date || null, client_request_id: id ? undefined : reqId, lines: lines.filter((l) => l.item || l.chemical).map((l) => ({ item_id: l.kind === 'item' ? l.item?.id : null, chemical_id: l.kind === 'chemical' ? l.chemical?.id : null, qty: l.qty, unit_code: l.kind === 'item' ? l.item?.unit.code : l.chemical?.unit.code, needed_date: l.needed_date || null, note: l.note })) };
      const r = id ? await api.put<any>(`/purchase-requests/${id}`, body) : await api.post<any>('/purchase-requests', body);
      const docId = id ? Number(id) : r.id;
      if (s) await api.post(`/purchase-requests/${docId}/submit`);
      return docId;
    },
    onSuccess: (docId) => { toast.success('Đã lưu đề nghị mua'); nav(`/purchase-requests/${docId}`); }, onError: toast.error,
  });
  return (
    <div>
      <PageHeader back={back('/purchase-requests', 'Đề nghị mua')} title={id ? `Sửa đề nghị ${ex.data?.code}` : 'Lập đề nghị mua hàng'}
        actions={can('purchase.request') && <button className="btn-outline" onClick={() => setShowSug(!showSug)}><Lightbulb size={15} />Gợi ý từ tồn kho thấp</button>} />
      <div className="space-y-4">
        {showSug && <Card title="Vật tư & hóa chất dưới mức tối thiểu (gợi ý – không tự đặt hàng)">
          {sug.isLoading ? <Loading /> : <DataTable rows={sug.data} empty="Không có mặt hàng dưới mức tối thiểu" rowKey={(r: any) => r.type + r.id} columns={[
            { key: 't', header: 'Loại', render: (r: any) => (r.type === 'item' ? 'Vật tư' : 'Hóa chất') }, { key: 'c', header: 'Mặt hàng', render: (r: any) => `${r.code} – ${r.name}` },
            { key: 'a', header: 'Khả dụng', align: 'right', render: (r: any) => fmtNum(r.available) }, { key: 'm', header: 'Tối thiểu', align: 'right', render: (r: any) => fmtNum(r.min_stock) },
            { key: 'o', header: 'Đang đặt', align: 'right', render: (r: any) => fmtNum(r.on_order) }, { key: 's', header: 'Đề xuất', align: 'right', render: (r: any) => <b>{fmtNum(r.suggest_qty)} {r.unit}</b> },
            { key: 'x', header: '', render: (r: any) => <div className="flex items-center gap-1">{r.in_open_request && <span className="text-[11px] text-amber-700">Đã có ĐN mở</span>}<button className="btn-outline btn-sm" onClick={() => addSug(r)}>Thêm</button></div> },
          ]} />}
        </Card>}
        <Card title="Thông tin đề nghị"><div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Field label="Ngày đề nghị" required><input type="date" className="input" value={h.request_date} onChange={(e) => setH({ ...h, request_date: e.target.value })} /></Field>
          <Field label="Bộ phận yêu cầu" required><LookupSelect path="/departments" value={h.department_id} disabled={!can('purchase.order', 'purchase.request_approve') && !!me?.department} onChange={(v) => setH({ ...h, department_id: v })} /></Field>
          <Field label="Mức độ ưu tiên"><select className="input" value={h.priority} onChange={(e) => setH({ ...h, priority: e.target.value })}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
          <Field label="Ngày cần hàng"><input type="date" className="input" value={h.needed_date} onChange={(e) => setH({ ...h, needed_date: e.target.value })} /></Field>
          <Field label="Mục đích mua" required className="md:col-span-4"><input className="input" value={h.purpose} onChange={(e) => setH({ ...h, purpose: e.target.value })} /></Field>
        </div></Card>
        <Card title="Danh sách hàng hóa" actions={<button className="btn-outline btn-sm" onClick={() => setLines([...lines, emptyP()])}><Plus size={14} />Thêm dòng</button>}>
          <table className="table-base"><thead><tr><th className="w-[30rem]">Hàng hóa</th><th className="w-20">ĐVT</th><th className="w-28 text-right">Số lượng</th><th className="w-36">Ngày cần</th><th>Ghi chú</th><th></th></tr></thead>
            <tbody>{lines.map((l) => (
              <tr key={l.key}><td><TargetPicker kind={l.kind} onKind={(k) => upd(l.key, { kind: k })} item={l.item} chemical={l.chemical} onItem={(i) => upd(l.key, { item: i })} onChemical={(c) => upd(l.key, { chemical: c })} /></td>
                <td className="pt-3">{l.kind === 'item' ? l.item?.unit.code : l.chemical?.unit.code}</td>
                <td><input type="number" step="any" className="input text-right" value={l.qty} onChange={(e) => upd(l.key, { qty: e.target.value })} /></td>
                <td><input type="date" className="input" value={l.needed_date} onChange={(e) => upd(l.key, { needed_date: e.target.value })} /></td>
                <td><input className="input" value={l.note} onChange={(e) => upd(l.key, { note: e.target.value })} /></td>
                <td><button className="btn-ghost btn-sm text-red-600" onClick={() => setLines(lines.length > 1 ? lines.filter((x) => x.key !== l.key) : [emptyP()])}><Trash2 size={14} /></button></td></tr>
            ))}</tbody></table>
          <p className="mt-2 text-xs text-slate-500">Đính kèm báo giá tham khảo (nếu có) tại màn hình chi tiết sau khi lưu.</p>
        </Card>
        <div className="flex justify-end gap-2"><button className="btn-outline" onClick={() => nav(-1)}>Hủy</button><button className="btn-outline" disabled={save.isPending} onClick={() => save.mutate(false)}>Lưu nháp</button><button className="btn-primary" disabled={save.isPending || h.purpose.length < 5} onClick={() => save.mutate(true)}><Send size={15} />Lưu & gửi duyệt</button></div>
      </div>
    </div>
  );
}

function QuoteEdit({ quoteId, onClose }: { quoteId: number; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const { data: q } = useQuery({ queryKey: ['quote', quoteId], queryFn: () => api.get<any>(`/quotes/${quoteId}`) });
  const [f, setF] = useState<any>(null);
  useEffect(() => { if (q) setF({ quote_no: q.quote_no ?? '', quote_date: toISODate(q.quote_date) || todayISO(), valid_until: toISODate(q.valid_until), currency: q.currency ?? 'VND', delivery_days: q.delivery_days ?? '', payment_terms: q.payment_terms ?? '', note: q.note ?? '', prices: Object.fromEntries(q.lines.map((l: any) => [l.id, l.unit_price ?? ''])) }); }, [q]);
  const m = useMutation({ mutationFn: () => api.put(`/quotes/${quoteId}`, { ...f, prices: undefined, lines: Object.entries(f.prices).map(([id, p]) => ({ id: Number(id), unit_price: p })) }), onSuccess: () => { toast.success('Đã lưu báo giá'); qc.invalidateQueries({ queryKey: ['/purchase-requests'] }); qc.invalidateQueries({ queryKey: ['/quotes'] }); onClose(); }, onError: toast.error });
  return (
    <Modal open onClose={onClose} title={`Nhập báo giá ${q?.code ?? ''} – ${q?.supplier?.name ?? ''}`} size="lg" footer={<><button className="btn-outline" onClick={onClose}>Đóng</button><button className="btn-primary" disabled={!f || m.isPending} onClick={() => m.mutate()}>Lưu báo giá</button></>}>
      {!f ? <Loading /> : <>
        <div className="mb-3 grid grid-cols-3 gap-3">
          <Field label="Số báo giá NCC"><input className="input" value={f.quote_no} onChange={(e) => setF({ ...f, quote_no: e.target.value })} /></Field>
          <Field label="Ngày báo giá" required><input type="date" className="input" value={f.quote_date} onChange={(e) => setF({ ...f, quote_date: e.target.value })} /></Field>
          <Field label="Hiệu lực đến"><input type="date" className="input" value={f.valid_until} onChange={(e) => setF({ ...f, valid_until: e.target.value })} /></Field>
          <Field label="Tiền tệ" required><select className="input" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>{((settings?.['currency.allowed'] as string[]) ?? ['VND']).map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Thời gian giao (ngày)"><input type="number" className="input" value={f.delivery_days} onChange={(e) => setF({ ...f, delivery_days: e.target.value })} /></Field>
          <Field label="Điều khoản thanh toán"><input className="input" value={f.payment_terms} onChange={(e) => setF({ ...f, payment_terms: e.target.value })} /></Field>
        </div>
        <table className="table-base"><thead><tr><th>Hàng hóa</th><th className="text-right">SL</th><th className="w-40">Đơn giá</th></tr></thead>
          <tbody>{q.lines.map((l: any) => { const pl = q.request?.lines.find((x: any) => x.id === l.pr_item_id); return <tr key={l.id}><td>{pl ? tName(pl) : ''}</td><td className="text-right">{fmtNum(l.qty)} {pl ? tUnit(pl) : ''}</td><td><input type="number" step="any" className="input text-right" value={f.prices[l.id]} onChange={(e) => setF({ ...f, prices: { ...f.prices, [l.id]: e.target.value } })} /></td></tr>; })}</tbody></table>
        <p className="mt-2 text-xs text-slate-500">Đính kèm file báo giá gốc của NCC tại màn hình đề nghị mua.</p>
      </>}
    </Modal>
  );
}

function PoFromQuote({ pr, quote, onClose }: { pr: any; quote: any; onClose: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState({ order_date: todayISO(), expected_date: quote.delivery_days ? new Date(Date.now() + quote.delivery_days * 86400_000).toISOString().slice(0, 10) : '', payment_terms: quote.payment_terms ?? '', delivery_terms: '' });
  const lines = quote.lines.filter((l: any) => l.unit_price != null);
  const m = useMutation({
    mutationFn: () => api.post<any>('/purchase-orders', { supplier_id: quote.supplier_id, request_id: pr.id, quote_id: quote.id, currency: quote.currency ?? 'VND', ...f, expected_date: f.expected_date || null, client_request_id: newRequestId(),
      lines: lines.map((l: any) => ({ pr_item_id: l.pr_item_id, item_id: l.item_id, chemical_id: l.chemical_id, qty_ordered: l.qty, unit_price: l.unit_price })) }),
    onSuccess: (r: any) => { toast.success('Đã lập đơn đặt hàng (nháp)'); nav(`/purchase-orders/${r.id}`); }, onError: toast.error,
  });
  return (
    <Modal open onClose={onClose} title={`Lập đơn đặt hàng từ báo giá ${quote.code} – ${quote.supplier.name}`} size="md" footer={<><button className="btn-outline" onClick={onClose}>Hủy</button><button className="btn-primary" disabled={m.isPending || !lines.length} onClick={() => m.mutate()}><ShoppingCart size={15} />Lập PO</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ngày đặt hàng"><input type="date" className="input" value={f.order_date} onChange={(e) => setF({ ...f, order_date: e.target.value })} /></Field>
        <Field label="Ngày giao dự kiến"><input type="date" className="input" value={f.expected_date} onChange={(e) => setF({ ...f, expected_date: e.target.value })} /></Field>
        <Field label="Điều khoản thanh toán"><input className="input" value={f.payment_terms} onChange={(e) => setF({ ...f, payment_terms: e.target.value })} /></Field>
        <Field label="Điều kiện giao hàng"><input className="input" value={f.delivery_terms} onChange={(e) => setF({ ...f, delivery_terms: e.target.value })} /></Field>
      </div>
      <p className="mt-2 text-sm">{lines.length} dòng có giá sẽ được đưa vào PO. Các báo giá khác của đề nghị này được đánh dấu "không chọn".</p>
    </Modal>
  );
}

export function PrDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { me, can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [dlg, setDlg] = useState('');
  const [rfq, setRfq] = useState(false);
  const [sups, setSups] = useState<number[]>([]);
  const [editQ, setEditQ] = useState<number | null>(null);
  const [poQ, setPoQ] = useState<any>(null);
  const { data: d, isLoading } = useQuery({ queryKey: ['/purchase-requests', id], queryFn: () => api.get<any>(`/purchase-requests/${id}`) });
  const { data: cmp } = useQuery({ queryKey: ['/purchase-requests', id, 'compare'], enabled: !!d?.quotes.length, queryFn: () => api.get<any>(`/purchase-requests/${id}/compare`) });
  const act = Actions({ endpoint: '/purchase-requests', id: Number(id), onDone: () => setDlg('') });
  const createRfq = useMutation({ mutationFn: () => api.post('/quotes', { request_id: Number(id), supplier_ids: sups }), onSuccess: () => { toast.success('Đã tạo yêu cầu báo giá'); setRfq(false); setSups([]); qc.invalidateQueries({ queryKey: ['/purchase-requests'] }); }, onError: toast.error });
  const { data: supList } = useQuery({ queryKey: ['lookup', '/suppliers'], queryFn: () => api.get<any[]>('/suppliers', { all: 1 }), enabled: rfq });
  if (isLoading || !d) return <Loading />;
  const mine = d.created_by === me?.id || d.requester_id === me?.id;
  return (
    <div>
      <PageHeader back={back('/purchase-requests', 'Đề nghị mua')} title={<span className="flex items-center gap-2">Đề nghị mua {d.code} <Badge status={d.status} map={PURCHASE_STATUS} /><Badge status={d.priority} map={PRIORITY} /></span>}
        subtitle={`${d.department.name} · ${d.requester.full_name} · ${fmtDate(d.request_date)}`}
        actions={<>
          {['DRAFT', 'REJECTED'].includes(d.status) && d.created_by === me?.id && <><button className="btn-outline" onClick={() => nav(`/purchase-requests/${d.id}/edit`)}>Sửa</button><button className="btn-primary" onClick={() => act.mutate({ action: 'submit' })}><Send size={15} />Gửi duyệt</button></>}
          {d.status === 'SUBMITTED' && can('purchase.request_approve') && !mine && <><button className="btn-danger" onClick={() => setDlg('reject')}><XCircle size={15} />Từ chối</button><button className="btn-success" onClick={() => setDlg('approve')}><CheckCircle2 size={15} />Phê duyệt</button></>}
          {['APPROVED', 'ORDERED'].includes(d.status) && can('purchase.order') && <><button className="btn-outline" onClick={() => setRfq(true)}><FileQuestion size={15} />Yêu cầu báo giá</button><button className="btn-primary" onClick={() => nav(`/purchase-orders/new?request_id=${d.id}`)}><ShoppingCart size={15} />Lập PO trực tiếp</button></>}
          {['APPROVED', 'ORDERED'].includes(d.status) && can('purchase.order') && <button className="btn-ghost" onClick={() => setDlg('close')}><Lock size={15} />Đóng</button>}
          {['DRAFT', 'SUBMITTED', 'REJECTED', 'APPROVED'].includes(d.status) && (mine || can('purchase.request_approve')) && <button className="btn-ghost text-red-600" onClick={() => setDlg('cancel')}><Ban size={15} />Hủy</button>}
        </>} />
      {d.reject_reason && d.status === 'REJECTED' && <div className="mb-3"><Alert type="danger">Lý do từ chối: {d.reject_reason}</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Thông tin" className="lg:col-span-2"><dl className="grid grid-cols-1 gap-2 text-sm md:grid-cols-3">{[['Mục đích', d.purpose], ['Ngày cần hàng', fmtDate(d.needed_date)], ['Ghi chú', d.note], ['Đơn đặt hàng', d.orders.map((o: any) => <Link key={o.id} className="mr-2 text-navy-700 underline" to={`/purchase-orders/${o.id}`}>{o.code}</Link>)]].map(([k, v]) => <div key={k as string}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium">{(Array.isArray(v) ? v.length : v) ? v : '–'}</dd></div>)}</dl></Card>
        <HistoryTimeline history={d.history} />
        <Card title="Hàng hóa đề nghị" className="lg:col-span-3"><table className="table-base"><thead><tr><th>#</th><th>Loại</th><th>Hàng hóa</th><th className="text-right">SL</th><th>ĐVT</th><th>Ngày cần</th><th>Ghi chú</th></tr></thead>
          <tbody>{d.lines.map((l: any) => <tr key={l.id}><td>{l.line_no}</td><td>{l.item ? 'Vật tư' : 'Hóa chất'}</td><td>{tName(l)}</td><td className="text-right">{fmtNum(l.qty)}</td><td>{tUnit(l)}</td><td>{fmtDate(l.needed_date)}</td><td className="text-xs">{l.note}</td></tr>)}</tbody></table></Card>
        {d.quotes.length > 0 && <Card title={`Báo giá & so sánh (${d.quotes.length} NCC)`} className="lg:col-span-3">
          <div className="overflow-x-auto"><table className="table-base">
            <thead><tr><th>Hàng hóa</th><th className="text-right">SL</th>{d.quotes.map((q: any) => <th key={q.id} className="text-right">{q.supplier.name}<div className="font-normal normal-case"><Badge status={q.status} map={QUOTE_STATUS} /></div></th>)}</tr></thead>
            <tbody>
              {cmp?.lines.map((l: any) => <tr key={l.id}><td>{l.label}</td><td className="text-right">{fmtNum(l.qty)}</td>{d.quotes.map((q: any) => { const p = l.prices.find((x: any) => x.quote_id === q.id)?.price; return <td key={q.id} className={`text-right ${p != null && p === l.best ? 'bg-emerald-50 font-semibold text-emerald-800' : ''}`}>{p == null ? '–' : fmtMoney(p)}</td>; })}</tr>)}
              <tr className="bg-slate-50 text-xs"><td colSpan={2}>Thời gian giao / thanh toán / hiệu lực</td>{d.quotes.map((q: any) => <td key={q.id} className="text-right">{q.delivery_days ?? '–'} ngày<br />{q.payment_terms}<br />{fmtDate(q.valid_until)}</td>)}</tr>
              <tr className="font-semibold"><td colSpan={2}>Tổng giá trị</td>{d.quotes.map((q: any) => { const c = cmp?.quotes.find((x: any) => x.id === q.id); return <td key={q.id} className="text-right">{c?.total != null ? `${fmtMoney(c.total)} ${q.currency ?? ''}` : '–'}</td>; })}</tr>
              {can('purchase.order') && <tr><td colSpan={2}></td>{d.quotes.map((q: any) => <td key={q.id} className="text-right"><div className="flex justify-end gap-1">{q.status !== 'SELECTED' && <button className="btn-outline btn-sm" onClick={() => setEditQ(q.id)}>Nhập giá</button>}{q.status === 'RECEIVED' && <button className="btn-primary btn-sm" onClick={() => setPoQ(q)}>Chọn → PO</button>}</div></td>)}</tr>}
            </tbody></table></div>
          <p className="mt-2 text-xs text-slate-500">Ô xanh: giá thấp nhất cho từng mặt hàng. Lựa chọn NCC cân nhắc cả chất lượng, thời gian giao (xem Đánh giá & so sánh NCC).</p>
        </Card>}
        <div className="lg:col-span-3"><AttachmentsPanel entityType="purchase_request" entityId={d.id} /></div>
      </div>
      <Modal open={rfq} onClose={() => setRfq(false)} title="Gửi yêu cầu báo giá" size="md" footer={<><button className="btn-outline" onClick={() => setRfq(false)}>Hủy</button><button className="btn-primary" disabled={!sups.length || createRfq.isPending} onClick={() => createRfq.mutate()}>Tạo {sups.length} yêu cầu báo giá</button></>}>
        <p className="mb-2 text-sm">Chọn nhà cung cấp nhận yêu cầu báo giá cho toàn bộ hàng hóa của đề nghị:</p>
        <div className="max-h-80 space-y-1 overflow-y-auto">{supList?.map((s) => <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sups.includes(s.id)} onChange={(e) => setSups(e.target.checked ? [...sups, s.id] : sups.filter((x) => x !== s.id))} />{s.code} – {s.name}</label>)}</div>
      </Modal>
      {editQ && <QuoteEdit quoteId={editQ} onClose={() => setEditQ(null)} />}
      {poQ && <PoFromQuote pr={d} quote={poQ} onClose={() => setPoQ(null)} />}
      <ReasonDialog open={dlg === 'approve'} title="Phê duyệt đề nghị mua" label="Ý kiến" required={false} confirmText="Phê duyệt" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(c) => act.mutate({ action: 'approve', body: { comment: c } })} />
      <ReasonDialog open={dlg === 'reject'} title="Từ chối đề nghị" danger confirmText="Từ chối" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(r) => act.mutate({ action: 'reject', body: { reason: r } })} />
      <ReasonDialog open={dlg === 'cancel'} title="Hủy đề nghị" danger confirmText="Hủy" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(r) => act.mutate({ action: 'cancel', body: { reason: r } })} />
      <ReasonDialog open={dlg === 'close'} title="Đóng đề nghị (không mua thêm)" confirmText="Đóng" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(r) => act.mutate({ action: 'close', body: { reason: r } })} />
    </div>
  );
}

// ============================ YÊU CẦU BÁO GIÁ ============================
export function QuoteList() {
  const nav = useNavigate();
  const [edit, setEdit] = useState<number | null>(null);
  const { can } = useAuth();
  return (
    <>
      <DocList<any> title="Yêu cầu báo giá" subtitle="Tạo từ đề nghị mua đã duyệt (nút 'Yêu cầu báo giá'). Nhập giá NCC phản hồi và so sánh tại đề nghị mua." endpoint="/quotes" basePath="/quotes" hideDates
        statuses={['REQUESTED', 'RECEIVED', 'SELECTED', 'REJECTED']} statusMap={QUOTE_STATUS}
        columns={[
          { key: 'code', header: 'Số', render: (r) => <b>{r.code}</b> }, { key: 'sup', header: 'Nhà cung cấp', render: (r) => r.supplier.name },
          { key: 'pr', header: 'Đề nghị mua', render: (r) => r.request && <Link className="text-navy-700 underline" onClick={(e) => e.stopPropagation()} to={`/purchase-requests/${r.request.id}`}>{r.request.code}</Link> },
          { key: 'qn', header: 'Số BG NCC', render: (r) => r.quote_no }, { key: 'qd', header: 'Ngày BG', render: (r) => fmtDate(r.quote_date) }, { key: 'v', header: 'Hiệu lực', render: (r) => fmtDate(r.valid_until) },
          { key: 't', header: 'Tổng giá trị', align: 'right', render: (r) => r.total != null ? `${fmtMoney(r.total)} ${r.currency ?? ''}` : '' },
          { key: 's', header: 'Trạng thái', render: (r) => <div className="flex items-center gap-1"><Badge status={r.status} map={QUOTE_STATUS} />{can('purchase.order') && ['REQUESTED', 'RECEIVED'].includes(r.status) && <button className="btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); setEdit(r.id); }}>Nhập giá</button>}</div> },
        ]} />
      {edit && <QuoteEdit quoteId={edit} onClose={() => setEdit(null)} />}
      {false && nav}
    </>
  );
}
export function QuoteRedirect() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data } = useQuery({ queryKey: ['quote', id], queryFn: () => api.get<any>(`/quotes/${id}`) });
  useEffect(() => { if (data?.request_id) nav(`/purchase-requests/${data.request_id}`, { replace: true }); }, [data, nav]);
  return <Loading />;
}

// ============================ ĐƠN ĐẶT HÀNG ============================
const poCols = [
  { key: 'code', header: 'Số PO', render: (r: any) => <b className="text-navy-800">{r.code}</b> },
  { key: 'd', header: 'Ngày đặt', render: (r: any) => fmtDate(r.order_date) },
  { key: 'e', header: 'Giao dự kiến', render: (r: any) => <span className={r.is_late ? 'font-semibold text-red-600' : ''}>{fmtDate(r.expected_date)}{r.is_late && ' (trễ)'}</span> },
  { key: 's', header: 'Nhà cung cấp', render: (r: any) => r.supplier.name },
  { key: 'n', header: 'Số dòng', align: 'right' as const, render: (r: any) => r._count.lines },
  { key: 't', header: 'Giá trị', align: 'right' as const, render: (r: any) => r.total_amount != null ? `${fmtMoney(r.total_amount)} ${r.currency ?? ''}` : '' },
  { key: 'st', header: 'Trạng thái', render: (r: any) => <Badge status={r.status} map={PURCHASE_STATUS} /> },
];
export function PoList() {
  const { can } = useAuth();
  const nav = useNavigate();
  return <DocList<any> title="Đơn đặt hàng" subtitle="Nháp → Chờ duyệt → Đã duyệt → Đã gửi NCC → Giao một phần / Đã giao đủ → Đã đóng. Liên kết trực tiếp với phiếu nhập kho." endpoint="/purchase-orders" basePath="/purchase-orders"
    statuses={['DRAFT', 'SUBMITTED', 'APPROVED', 'SENT', 'PARTIAL', 'RECEIVED', 'CLOSED', 'REJECTED', 'CANCELLED']} statusMap={PURCHASE_STATUS}
    actions={can('purchase.order') && <button className="btn-primary" onClick={() => nav('/purchase-orders/new')}><Plus size={15} />Lập đơn đặt hàng</button>} columns={poCols} />;
}

interface OLine { key: string; kind: 'item' | 'chemical'; item: PickedItem | null; chemical: PickedChemical | null; pr_item_id: number | null; qty: string; price: string; note: string }
export function PoForm() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data: settings } = useSettings();
  const [reqId] = useState(newRequestId);
  const [h, setH] = useState<any>({ supplier_id: null, request_id: sp.get('request_id') ? Number(sp.get('request_id')) : null, order_date: todayISO(), expected_date: '', currency: 'VND', exchange_rate: '', payment_terms: '', delivery_terms: '', note: '' });
  const [lines, setLines] = useState<OLine[]>([{ key: newRequestId(), kind: 'item', item: null, chemical: null, pr_item_id: null, qty: '', price: '', note: '' }]);
  const ex = useQuery({ queryKey: ['/purchase-orders', id], enabled: !!id, queryFn: () => api.get<any>(`/purchase-orders/${id}`) });
  const pr = useQuery({ queryKey: ['/purchase-requests', h.request_id], enabled: !!h.request_id && !id, queryFn: () => api.get<any>(`/purchase-requests/${h.request_id}`) });
  useEffect(() => { if (pr.data) setLines(pr.data.lines.map((l: any) => ({ key: String(l.id), kind: l.chemical_id ? 'chemical' : 'item', item: l.item ? { ...l.item } : null, chemical: l.chemical ? { ...l.chemical, is_controlled: false } : null, pr_item_id: l.id, qty: String(l.qty), price: '', note: '' }))); }, [pr.data]);
  useEffect(() => { const d = ex.data; if (!d) return; setH({ supplier_id: d.supplier_id, request_id: d.request_id, quote_id: d.quote_id, order_date: toISODate(d.order_date), expected_date: toISODate(d.expected_date), currency: d.currency ?? 'VND', exchange_rate: d.exchange_rate ?? '', payment_terms: d.payment_terms ?? '', delivery_terms: d.delivery_terms ?? '', note: d.note ?? '' }); setLines(d.lines.map((l: any) => ({ key: String(l.id), kind: l.chemical_id ? 'chemical' : 'item', item: l.item ? { ...l.item } : null, chemical: l.chemical ? { ...l.chemical, is_controlled: false } : null, pr_item_id: l.pr_item_id, qty: String(l.qty_ordered), price: l.unit_price != null ? String(l.unit_price) : '', note: l.note ?? '' }))); }, [ex.data]);
  const upd = (k: string, p: Partial<OLine>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l)));
  const total = lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.price || 0), 0);
  const save = useMutation({
    mutationFn: async (s: boolean) => {
      const body = { ...h, expected_date: h.expected_date || null, exchange_rate: h.exchange_rate || null, client_request_id: id ? undefined : reqId, lines: lines.filter((l) => l.item || l.chemical).map((l) => ({ pr_item_id: l.pr_item_id, item_id: l.kind === 'item' ? l.item?.id : null, chemical_id: l.kind === 'chemical' ? l.chemical?.id : null, qty_ordered: l.qty, unit_price: l.price || 0, note: l.note })) };
      const r = id ? await api.put<any>(`/purchase-orders/${id}`, body) : await api.post<any>('/purchase-orders', body);
      const docId = id ? Number(id) : r.id;
      if (s) await api.post(`/purchase-orders/${docId}/submit`);
      return docId;
    },
    onSuccess: (docId) => { toast.success('Đã lưu đơn đặt hàng'); nav(`/purchase-orders/${docId}`); }, onError: toast.error,
  });
  return (
    <div>
      <PageHeader back={back('/purchase-orders', 'Đơn đặt hàng')} title={id ? `Sửa PO ${ex.data?.code}` : 'Lập đơn đặt hàng'} subtitle={pr.data ? `Theo đề nghị mua ${pr.data.code}` : undefined} />
      <div className="space-y-4">
        <Card title="Thông tin đơn hàng"><div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Field label="Nhà cung cấp" required className="md:col-span-2"><LookupSelect path="/suppliers" value={h.supplier_id} onChange={(v) => setH({ ...h, supplier_id: v })} /></Field>
          <Field label="Ngày đặt hàng" required><input type="date" className="input" value={h.order_date} onChange={(e) => setH({ ...h, order_date: e.target.value })} /></Field>
          <Field label="Ngày giao dự kiến"><input type="date" className="input" value={h.expected_date} onChange={(e) => setH({ ...h, expected_date: e.target.value })} /></Field>
          <Field label="Tiền tệ" required><select className="input" value={h.currency} onChange={(e) => setH({ ...h, currency: e.target.value })}>{((settings?.['currency.allowed'] as string[]) ?? ['VND']).map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Tỷ giá"><input type="number" step="any" className="input" value={h.exchange_rate} onChange={(e) => setH({ ...h, exchange_rate: e.target.value })} /></Field>
          <Field label="Điều khoản thanh toán"><input className="input" value={h.payment_terms} onChange={(e) => setH({ ...h, payment_terms: e.target.value })} /></Field>
          <Field label="Điều kiện giao hàng"><input className="input" value={h.delivery_terms} onChange={(e) => setH({ ...h, delivery_terms: e.target.value })} /></Field>
        </div></Card>
        <Card title="Danh mục hàng" actions={!h.request_id && <button className="btn-outline btn-sm" onClick={() => setLines([...lines, { key: newRequestId(), kind: 'item', item: null, chemical: null, pr_item_id: null, qty: '', price: '', note: '' }])}><Plus size={14} />Thêm dòng</button>}>
          <table className="table-base"><thead><tr><th className="w-[30rem]">Hàng hóa</th><th className="w-28 text-right">Số lượng</th><th className="w-36 text-right">Đơn giá</th><th className="w-36 text-right">Thành tiền</th><th>Ghi chú</th><th></th></tr></thead>
            <tbody>{lines.map((l) => (
              <tr key={l.key}><td><TargetPicker kind={l.kind} disabled={!!l.pr_item_id} onKind={(k) => upd(l.key, { kind: k })} item={l.item} chemical={l.chemical} onItem={(i) => upd(l.key, { item: i })} onChemical={(c) => upd(l.key, { chemical: c })} /></td>
                <td><input type="number" step="any" className="input text-right" value={l.qty} onChange={(e) => upd(l.key, { qty: e.target.value })} /></td>
                <td><input type="number" step="any" className="input text-right" value={l.price} onChange={(e) => upd(l.key, { price: e.target.value })} /></td>
                <td className="pt-3 text-right">{fmtMoney(Number(l.qty || 0) * Number(l.price || 0))}</td>
                <td><input className="input" value={l.note} onChange={(e) => upd(l.key, { note: e.target.value })} /></td>
                <td><button className="btn-ghost btn-sm text-red-600" onClick={() => lines.length > 1 && setLines(lines.filter((x) => x.key !== l.key))}><Trash2 size={14} /></button></td></tr>
            ))}<tr className="bg-gold-50 font-semibold"><td colSpan={3}>Tổng giá trị</td><td className="text-right">{fmtMoney(total)} {h.currency}</td><td colSpan={2}></td></tr></tbody></table>
        </Card>
        <div className="flex justify-end gap-2"><button className="btn-outline" onClick={() => nav(-1)}>Hủy</button><button className="btn-outline" disabled={save.isPending} onClick={() => save.mutate(false)}>{save.isPending && <Spinner className="h-4 w-4" />}Lưu nháp</button><button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(true)}><Send size={15} />Lưu & gửi duyệt</button></div>
      </div>
    </div>
  );
}

export function PoDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { me, can } = useAuth();
  const [dlg, setDlg] = useState('');
  const { data: d, isLoading } = useQuery({ queryKey: ['/purchase-orders', id], queryFn: () => api.get<any>(`/purchase-orders/${id}`) });
  const act = Actions({ endpoint: '/purchase-orders', id: Number(id), onDone: () => setDlg('') });
  if (isLoading || !d) return <Loading />;
  const mine = d.created_by === me?.id;
  const receivable = ['APPROVED', 'SENT', 'PARTIAL'].includes(d.status);
  const hasItems = d.lines.some((l: any) => l.item_id && l.remaining > 0);
  const hasChems = d.lines.some((l: any) => l.chemical_id && l.remaining > 0);
  return (
    <div>
      <PageHeader back={back('/purchase-orders', 'Đơn đặt hàng')} title={<span className="flex items-center gap-2">PO {d.code} <Badge status={d.status} map={PURCHASE_STATUS} />{d.is_late && <Badge status="REJECTED">Giao chậm</Badge>}</span>}
        subtitle={`${d.supplier.name} · Lập bởi ${d.creator.full_name}`}
        actions={<>
          <PrintButton type="po" id={d.id} />
          {['DRAFT', 'REJECTED'].includes(d.status) && mine && <><button className="btn-outline" onClick={() => nav(`/purchase-orders/${d.id}/edit`)}>Sửa</button><button className="btn-primary" onClick={() => act.mutate({ action: 'submit' })}><Send size={15} />Gửi duyệt</button></>}
          {d.status === 'SUBMITTED' && can('purchase.order_approve') && !mine && <><button className="btn-danger" onClick={() => setDlg('reject')}><XCircle size={15} />Từ chối</button><button className="btn-success" onClick={() => setDlg('approve')}><CheckCircle2 size={15} />Phê duyệt</button></>}
          {d.status === 'APPROVED' && can('purchase.order') && <button className="btn-gold" onClick={() => act.mutate({ action: 'send' })}><Truck size={15} />Đánh dấu đã gửi NCC</button>}
          {receivable && hasItems && can('receipts.create') && <button className="btn-primary" onClick={() => nav(`/receipts/new?po=${d.id}`)}>Lập phiếu nhập kho mỏ</button>}
          {receivable && hasChems && can('chemicals.receipt_create') && <button className="btn-primary" onClick={() => nav(`/chem-receipts/new?po=${d.id}`)}>Lập phiếu nhập hóa chất</button>}
          {['PARTIAL', 'RECEIVED', 'SENT', 'APPROVED'].includes(d.status) && can('purchase.order') && <button className="btn-ghost" onClick={() => setDlg('close')}><Lock size={15} />Đóng đơn</button>}
          {['DRAFT', 'SUBMITTED', 'REJECTED', 'APPROVED', 'SENT'].includes(d.status) && can('purchase.order') && <button className="btn-ghost text-red-600" onClick={() => setDlg('cancel')}><Ban size={15} />Hủy</button>}
        </>} />
      {d.reject_reason && d.status === 'REJECTED' && <div className="mb-3"><Alert type="danger">Lý do từ chối: {d.reject_reason}</Alert></div>}
      {d.close_reason && <div className="mb-3"><Alert type="info">Đã đóng: {d.close_reason}</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Thông tin" className="lg:col-span-2"><dl className="grid grid-cols-1 gap-2 text-sm md:grid-cols-3">{[['Nhà cung cấp', <Link key="s" className="text-navy-700 underline" to={`/suppliers/${d.supplier.id}`}>{d.supplier.name}</Link>], ['Đề nghị mua', d.request ? <Link key="r" className="text-navy-700 underline" to={`/purchase-requests/${d.request.id}`}>{d.request.code}</Link> : ''], ['Ngày đặt', fmtDate(d.order_date)], ['Giao dự kiến', fmtDate(d.expected_date)], ['Tiền tệ / tỷ giá', `${d.currency ?? ''} ${d.exchange_rate ?? ''}`], ['Thanh toán', d.payment_terms], ['Giao hàng', d.delivery_terms], ['Tổng giá trị', d.total_amount != null ? `${fmtMoney(d.total_amount)} ${d.currency ?? ''}` : '(không có quyền xem)'], ['Hoàn tất', fmtDateTime(d.completed_at)]].map(([k, v]) => <div key={k as string}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium">{v || '–'}</dd></div>)}</dl></Card>
        <HistoryTimeline history={d.history} />
        <Card title="Tiến độ giao hàng theo dòng" className="lg:col-span-3"><table className="table-base"><thead><tr><th>#</th><th>Hàng hóa</th><th>ĐVT</th><th className="text-right">Đặt</th><th className="text-right">Đã nhận</th><th className="text-right">Còn lại</th><th className="w-40">Tiến độ</th><th className="text-right">Đơn giá</th><th className="text-right">Thành tiền</th></tr></thead>
          <tbody>{d.lines.map((l: any) => { const pct = Math.min(100, (l.qty_received / l.qty_ordered) * 100); return <tr key={l.id}><td>{l.line_no}</td><td>{tName(l)}</td><td>{tUnit(l)}</td><td className="text-right">{fmtNum(l.qty_ordered)}</td><td className="text-right">{fmtNum(l.qty_received)}</td><td className="text-right font-semibold">{fmtNum(l.remaining)}</td><td><div className="h-2 rounded bg-slate-200"><div className="h-2 rounded bg-emerald-500" style={{ width: `${pct}%` }} /></div><div className="text-[11px] text-slate-500">{pct.toFixed(0)}%</div></td><td className="text-right">{fmtMoney(l.unit_price)}</td><td className="text-right">{fmtMoney(l.amount)}</td></tr>; })}</tbody></table></Card>
        <Card title="Phiếu nhập kho liên kết" className="lg:col-span-3">
          {[...d.receipts.map((r: any) => ({ ...r, link: `/receipts/${r.id}`, k: 'Kho mỏ' })), ...d.chem_receipts.map((r: any) => ({ ...r, link: `/chem-receipts/${r.id}`, k: 'Kho hóa chất' }))].length === 0 ? <div className="text-sm text-slate-400">Chưa có phiếu nhập</div> :
            <table className="table-base"><thead><tr><th>Phiếu</th><th>Kho</th><th>Ngày CT</th><th>Ghi sổ</th><th>Trạng thái</th></tr></thead><tbody>{[...d.receipts.map((r: any) => ({ ...r, link: `/receipts/${r.id}`, k: 'Kho mỏ' })), ...d.chem_receipts.map((r: any) => ({ ...r, link: `/chem-receipts/${r.id}`, k: 'Kho hóa chất' }))].map((r: any) => <tr key={r.link}><td><Link className="text-navy-700 underline" to={r.link}>{r.code}</Link></td><td>{r.k}</td><td>{fmtDate(r.doc_date)}</td><td>{fmtDateTime(r.posted_at)}</td><td><Badge status={r.status} /></td></tr>)}</tbody></table>}
        </Card>
        <div className="lg:col-span-3"><AttachmentsPanel entityType="purchase_order" entityId={d.id} /></div>
      </div>
      <ReasonDialog open={dlg === 'approve'} title="Phê duyệt đơn đặt hàng" label="Ý kiến" required={false} confirmText="Phê duyệt" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(c) => act.mutate({ action: 'approve', body: { comment: c } })} />
      <ReasonDialog open={dlg === 'reject'} title="Từ chối đơn đặt hàng" danger confirmText="Từ chối" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(r) => act.mutate({ action: 'reject', body: { reason: r } })} />
      <ReasonDialog open={dlg === 'close'} title="Đóng đơn đặt hàng" message="Phần chưa giao sẽ không nhận nữa." confirmText="Đóng đơn" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(r) => act.mutate({ action: 'close', body: { reason: r } })} />
      <ReasonDialog open={dlg === 'cancel'} title="Hủy đơn đặt hàng" message="Chỉ hủy được khi chưa nhận hàng." danger confirmText="Hủy" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(r) => act.mutate({ action: 'cancel', body: { reason: r } })} />
    </div>
  );
}

export function PoTracking() {
  const nav = useNavigate();
  const [late, setLate] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['/purchase-orders', 'tracking', late], queryFn: () => api.page<any>('/purchase-orders', { receivable: 1, late: late ? 1 : undefined, pageSize: 200 }) });
  return (
    <div>
      <PageHeader title="Theo dõi giao hàng" subtitle="Đơn đặt hàng đang thực hiện (đã duyệt / đã gửi / giao một phần)" actions={<ExportButtons reportKey="po-delivery" params={{}} />} />
      <div className="card">
        <div className="border-b p-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={late} onChange={(e) => setLate(e.target.checked)} />Chỉ đơn giao chậm</label></div>
        <DataTable loading={isLoading} rows={data?.data} onRowClick={(r) => nav(`/purchase-orders/${r.id}`)} columns={poCols} />
      </div>
    </div>
  );
}

export function PurchaseHistory() {
  const nav = useNavigate();
  return <DocList<any> title="Lịch sử mua hàng" subtitle="Toàn bộ đơn đặt hàng – lọc theo trạng thái, thời gian; xuất báo cáo tại Báo cáo → Mua hàng" endpoint="/purchase-orders" basePath="/purchase-orders"
    statuses={['RECEIVED', 'CLOSED', 'PARTIAL', 'SENT', 'APPROVED', 'CANCELLED']} statusMap={PURCHASE_STATUS}
    actions={<button className="btn-outline" onClick={() => nav('/reports?key=po-report')}>Mở báo cáo đơn đặt hàng</button>} columns={poCols} />;
}
