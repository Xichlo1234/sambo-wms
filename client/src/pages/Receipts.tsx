import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Send, CheckCircle2, XCircle, Ban, Pencil, ArrowLeft, Microscope } from 'lucide-react';
import { api, newRequestId } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLookup, useSettings } from '@/lib/hooks';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, todayISO, toISODate } from '@/lib/format';
import { Alert, Badge, Card, Field, Loading, Modal, PageHeader, ReasonDialog, Spinner, useToast } from '@/components/ui';
import { AttachmentsPanel, HistoryTimeline, ItemPicker, LookupSelect, PrintButton, type PickedItem } from '@/components/shared';
import { DocList } from '@/components/DocList';

interface Line { key: string; item: PickedItem | null; location_id: number | null; qty_doc: string; qty_received: string; qty_pending: string; qty_rejected: string; unit_price: string; condition_note: string; note: string }
const emptyLine = (): Line => ({ key: newRequestId(), item: null, location_id: null, qty_doc: '', qty_received: '', qty_pending: '0', qty_rejected: '0', unit_price: '', condition_note: '', note: '' });

export function ReceiptList() {
  const { can } = useAuth();
  const nav = useNavigate();
  return (
    <DocList<{ id: number; code: string; doc_date: string; status: string; supplier?: { name: string }; po_number?: string; creator: { full_name: string }; _count: { lines: number } }>
      title="Phiếu nhập kho" subtitle="Chỉ ghi nhận tăng tồn kho khi phiếu được Quản lý kho phê duyệt" endpoint="/receipts" basePath="/receipts"
      statuses={['DRAFT', 'SUBMITTED', 'POSTED', 'REJECTED', 'CANCELLED']}
      actions={can('receipts.create') && <button className="btn-primary" onClick={() => nav('/receipts/new')}><Plus size={15} />Lập phiếu nhập</button>}
      columns={[
        { key: 'code', header: 'Số phiếu', render: (r) => <b className="text-navy-800">{r.code}</b> },
        { key: 'doc_date', header: 'Ngày CT', render: (r) => fmtDate(r.doc_date) },
        { key: 'supplier', header: 'Nhà cung cấp', render: (r) => r.supplier?.name },
        { key: 'po', header: 'Số PO', render: (r) => r.po_number },
        { key: 'lines', header: 'Số dòng', align: 'right', render: (r) => r._count.lines },
        { key: 'creator', header: 'Người lập', render: (r) => r.creator.full_name },
        { key: 'status', header: 'Trạng thái', render: (r) => <Badge status={r.status} /> },
      ]} />
  );
}

export function ReceiptForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = useAuth();
  const { data: settings } = useSettings();
  const showPrice = can('stock.view_value');
  const [reqId] = useState(newRequestId);
  const { data: whs } = useLookup('/warehouses');
  const generalWhs = whs?.filter((w) => w.type === 'GENERAL');
  const [h, setH] = useState({ warehouse_id: null as number | null, doc_date: todayISO(), received_date: todayISO(), supplier_id: null as number | null, po_number: '', supplier_doc_no: '', deliverer_name: '', receiver_name: '', department_id: null as number | null, currency: '', exchange_rate: '', note: '', docs_checked: false, qty_checked: false, spec_checked: false });
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const existing = useQuery({ queryKey: ['/receipts', id], enabled: !!id, queryFn: () => api.get<Record<string, any>>(`/receipts/${id}`) }); // eslint-disable-line @typescript-eslint/no-explicit-any
  useEffect(() => {
    if (!h.warehouse_id && generalWhs?.length) setH((x) => ({ ...x, warehouse_id: generalWhs[0].id }));
  }, [generalWhs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const d = existing.data;
    if (!d) return;
    setH({ warehouse_id: d.warehouse_id, doc_date: toISODate(d.doc_date), received_date: toISODate(d.received_date), supplier_id: d.supplier_id, po_number: d.po_number ?? '', supplier_doc_no: d.supplier_doc_no ?? '', deliverer_name: d.deliverer_name ?? '', receiver_name: d.receiver_name ?? '', department_id: d.department_id, currency: d.currency ?? '', exchange_rate: d.exchange_rate ?? '', note: d.note ?? '', docs_checked: d.docs_checked, qty_checked: d.qty_checked, spec_checked: d.spec_checked });
    setLines(d.lines.map((l: any) => ({ key: String(l.id), item: { ...l.item }, location_id: l.location_id, qty_doc: String(l.qty_doc), qty_received: String(l.qty_received), qty_pending: String(l.qty_pending), qty_rejected: String(l.qty_rejected), unit_price: l.unit_price != null ? String(l.unit_price) : '', condition_note: l.condition_note ?? '', note: l.note ?? '' }))); // eslint-disable-line @typescript-eslint/no-explicit-any
  }, [existing.data]);
  const upd = (k: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  const save = useMutation({
    mutationFn: async (andSubmit: boolean) => {
      const body = {
        ...h, client_request_id: id ? undefined : reqId, received_date: h.received_date || null, exchange_rate: h.exchange_rate || null, currency: h.currency || null,
        lines: lines.filter((l) => l.item).map((l) => ({ item_id: l.item!.id, location_id: l.location_id, qty_doc: l.qty_doc || 0, qty_received: l.qty_received || 0, qty_pending: l.qty_pending || 0, qty_rejected: l.qty_rejected || 0, unit_price: l.unit_price === '' ? null : l.unit_price, condition_note: l.condition_note, note: l.note })),
      };
      const r = id ? await api.put<{ id: number }>(`/receipts/${id}`, body) : await api.post<{ id: number }>('/receipts', body);
      const docId = id ? Number(id) : r.id;
      if (andSubmit) await api.post(`/receipts/${docId}/submit`);
      return docId;
    },
    onSuccess: (docId, andSubmit) => { toast.success(andSubmit ? 'Đã lưu và gửi duyệt' : 'Đã lưu phiếu nháp'); qc.invalidateQueries({ queryKey: ['/receipts'] }); nav(`/receipts/${docId}`); },
    onError: (e) => { toast.error(e); qc.invalidateQueries({ queryKey: ['/receipts'] }); },
  });
  const currencies = (settings?.['currency.allowed'] as string[]) ?? [];
  if (id && existing.isLoading) return <Loading />;
  return (
    <div>
      <PageHeader back={<Link to="/receipts" className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500"><ArrowLeft size={12} />Phiếu nhập</Link>} title={id ? `Sửa phiếu nhập ${existing.data?.code}` : 'Lập phiếu nhập kho'}
        subtitle="Quy trình: nhận hàng → kiểm tra chứng từ → kiểm đếm → kiểm tra quy cách/tình trạng → lập phiếu nháp → đính kèm chứng từ → gửi Quản lý kho duyệt" />
      <div className="space-y-4">
        <Card title="Thông tin chung">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field label="Kho nhập" required><select className="input" value={h.warehouse_id ?? ''} onChange={(e) => setH({ ...h, warehouse_id: Number(e.target.value) })}>{generalWhs?.map((w) => <option key={w.id} value={w.id}>{w.code} – {w.name}</option>)}</select></Field>
            <Field label="Ngày chứng từ" required><input type="date" className="input" value={h.doc_date} onChange={(e) => setH({ ...h, doc_date: e.target.value })} /></Field>
            <Field label="Ngày nhận hàng thực tế"><input type="date" className="input" value={h.received_date} onChange={(e) => setH({ ...h, received_date: e.target.value })} /></Field>
            <Field label="Nhà cung cấp"><LookupSelect path="/suppliers" value={h.supplier_id} onChange={(v) => setH({ ...h, supplier_id: v })} /></Field>
            <Field label="Số đơn đặt hàng (PO)"><input className="input" value={h.po_number} onChange={(e) => setH({ ...h, po_number: e.target.value })} /></Field>
            <Field label="Số hóa đơn / phiếu giao hàng"><input className="input" value={h.supplier_doc_no} onChange={(e) => setH({ ...h, supplier_doc_no: e.target.value })} /></Field>
            <Field label="Người giao hàng"><input className="input" value={h.deliverer_name} onChange={(e) => setH({ ...h, deliverer_name: e.target.value })} /></Field>
            <Field label="Người nhận hàng"><input className="input" value={h.receiver_name} onChange={(e) => setH({ ...h, receiver_name: e.target.value })} placeholder="Mặc định: người lập" /></Field>
            <Field label="Bộ phận liên quan"><LookupSelect path="/departments" value={h.department_id} onChange={(v) => setH({ ...h, department_id: v })} /></Field>
            {showPrice && <>
              <Field label="Tiền tệ"><select className="input" value={h.currency} onChange={(e) => setH({ ...h, currency: e.target.value })}><option value="">--</option>{currencies.map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label="Tỷ giá"><input type="number" step="any" className="input" value={h.exchange_rate} onChange={(e) => setH({ ...h, exchange_rate: e.target.value })} /></Field>
            </>}
            <Field label="Ghi chú" className="md:col-span-2"><input className="input" value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} /></Field>
          </div>
        </Card>
        <Card title="Danh sách vật tư nhận" actions={<button className="btn-outline btn-sm" onClick={() => setLines([...lines, emptyLine()])}><Plus size={14} />Thêm dòng</button>}>
          <div className="overflow-x-auto">
            <table className="table-base min-w-[1100px]">
              <thead><tr><th className="w-8">#</th><th className="w-80">Vật tư</th><th className="w-36">Vị trí</th><th className="w-24 text-right">SL chứng từ</th><th className="w-24 text-right">SL thực nhận</th><th className="w-24 text-right">Chờ KT</th><th className="w-24 text-right">Không đạt</th><th className="w-24 text-right">Nhập kho</th>{showPrice && <th className="w-28 text-right">Đơn giá</th>}<th>Tình trạng / ghi chú</th><th></th></tr></thead>
              <tbody>
                {lines.map((l, i) => {
                  const rec = Number(l.qty_received || 0), docq = Number(l.qty_doc || 0);
                  const accepted = rec - Number(l.qty_pending || 0) - Number(l.qty_rejected || 0);
                  const diff = l.qty_received !== '' && l.qty_doc !== '' && rec !== docq;
                  return (
                    <tr key={l.key}>
                      <td>{i + 1}</td>
                      <td><ItemPicker value={l.item} onPick={(it) => upd(l.key, { item: it, location_id: l.location_id ?? it?.default_location_id ?? null })} />{l.item && <div className="mt-0.5 text-xs text-slate-500">ĐVT: {l.item.unit.code}</div>}</td>
                      <td><LookupSelect path="/locations" params={{ warehouse_id: h.warehouse_id }} value={l.location_id} onChange={(v) => upd(l.key, { location_id: v })} labelFn={(r) => r.code} /></td>
                      <td><input type="number" step="any" min={0} className="input text-right" value={l.qty_doc} onChange={(e) => upd(l.key, { qty_doc: e.target.value, qty_received: l.qty_received === '' ? e.target.value : l.qty_received })} /></td>
                      <td><input type="number" step="any" min={0} className={`input text-right ${diff ? 'border-amber-400 bg-amber-50' : ''}`} value={l.qty_received} onChange={(e) => upd(l.key, { qty_received: e.target.value })} />{diff && <div className="text-[11px] text-amber-700">{rec < docq ? `Thiếu ${fmtNum(docq - rec)}` : `Thừa ${fmtNum(rec - docq)}`}</div>}</td>
                      <td><input type="number" step="any" min={0} className="input text-right" value={l.qty_pending} onChange={(e) => upd(l.key, { qty_pending: e.target.value })} /></td>
                      <td><input type="number" step="any" min={0} className="input text-right" value={l.qty_rejected} onChange={(e) => upd(l.key, { qty_rejected: e.target.value })} /></td>
                      <td className={`pt-3 text-right font-semibold ${accepted < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{fmtNum(accepted)}</td>
                      {showPrice && <td><input type="number" step="any" min={0} className="input text-right" value={l.unit_price} onChange={(e) => upd(l.key, { unit_price: e.target.value })} /></td>}
                      <td><input className="input mb-1" placeholder={Number(l.qty_rejected) > 0 ? 'Tình trạng hàng không đạt (bắt buộc)' : 'Tình trạng hàng hóa'} value={l.condition_note} onChange={(e) => upd(l.key, { condition_note: e.target.value })} />
                        <input className="input" placeholder={diff ? 'Lý do thiếu/thừa (bắt buộc)' : 'Ghi chú'} value={l.note} onChange={(e) => upd(l.key, { note: e.target.value })} /></td>
                      <td><button className="btn-ghost btn-sm text-red-600" onClick={() => setLines(lines.length > 1 ? lines.filter((x) => x.key !== l.key) : [emptyLine()])}><Trash2 size={14} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-xs text-slate-500">SL nhập kho (tồn khả dụng) = SL thực nhận – Chờ kiểm tra – Không đạt. Hàng chờ kiểm tra được nhập vào tồn cách ly, chỉ chuyển sang khả dụng sau khi kiểm tra đạt.</div>
        </Card>
        <Card title="Kiểm tra trước khi gửi duyệt">
          <div className="flex flex-wrap gap-6 text-sm">
            {([['docs_checked', 'Đã kiểm tra chứng từ (hóa đơn, phiếu giao hàng, PO)'], ['qty_checked', 'Đã kiểm đếm số lượng thực tế'], ['spec_checked', 'Đã kiểm tra quy cách & tình trạng vật tư']] as const).map(([k, l]) => (
              <label key={k} className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={h[k]} onChange={(e) => setH({ ...h, [k]: e.target.checked })} />{l}</label>
            ))}
          </div>
          <div className="mt-2 text-xs text-slate-500">Sau khi lưu nháp, đính kèm hóa đơn/phiếu giao hàng/hình ảnh tại màn hình chi tiết phiếu.</div>
        </Card>
        <div className="flex justify-end gap-2">
          <button className="btn-outline" onClick={() => nav(-1)}>Hủy</button>
          <button className="btn-outline" disabled={save.isPending} onClick={() => save.mutate(false)}>{save.isPending && <Spinner className="h-4 w-4" />}Lưu nháp</button>
          <button className="btn-primary" disabled={save.isPending || !(h.docs_checked && h.qty_checked && h.spec_checked)} onClick={() => save.mutate(true)}><Send size={15} />Lưu & gửi duyệt</button>
        </div>
      </div>
    </div>
  );
}

function InspectModal({ docId, line, onClose }: { docId: number; line: any; onClose: () => void }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const [rel, setRel] = useState(String(line.qty_pending));
  const [rej, setRej] = useState('0');
  const [note, setNote] = useState('');
  const toast = useToast();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api.post(`/receipts/${docId}/lines/${line.id}/inspect`, { qty_release: rel, qty_reject: rej, note }),
    onSuccess: () => { toast.success('Đã ghi nhận kết quả kiểm tra'); qc.invalidateQueries({ queryKey: ['/receipts'] }); onClose(); }, onError: toast.error,
  });
  return (
    <Modal open onClose={onClose} title={`Kiểm tra chất lượng: ${line.item.code}`} size="sm"
      footer={<><button className="btn-outline" onClick={onClose}>Đóng</button><button className="btn-primary" disabled={m.isPending || note.length < 3} onClick={() => m.mutate()}>Ghi nhận</button></>}>
      <p className="mb-3 text-sm">SL chờ kiểm tra: <b>{fmtNum(line.qty_pending)} {line.item.unit.code}</b></p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="SL đạt (vào tồn khả dụng)"><input type="number" step="any" className="input" value={rel} onChange={(e) => setRel(e.target.value)} /></Field>
        <Field label="SL không đạt (vào tồn hư hỏng)"><input type="number" step="any" className="input" value={rej} onChange={(e) => setRej(e.target.value)} /></Field>
        <Field label="Kết quả kiểm tra" required className="col-span-2"><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export function ReceiptDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { me, can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [dlg, setDlg] = useState<'' | 'reject' | 'cancel' | 'approve'>('');
  const [inspect, setInspect] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data: d, isLoading } = useQuery({ queryKey: ['/receipts', id], queryFn: () => api.get<any>(`/receipts/${id}`) }); // eslint-disable-line @typescript-eslint/no-explicit-any
  const act = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: unknown }) => api.post(`/receipts/${id}/${action}`, body ?? {}),
    onSuccess: (_r, v) => { toast.success({ submit: 'Đã gửi duyệt', approve: 'Đã phê duyệt và ghi sổ – tồn kho đã cập nhật', reject: 'Đã từ chối phiếu', cancel: 'Đã hủy phiếu' }[v.action] ?? 'Thành công'); setDlg(''); qc.invalidateQueries({ queryKey: ['/receipts'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); },
    onError: (e) => { toast.error(e); qc.invalidateQueries({ queryKey: ['/receipts'] }); },
  });
  const totals = useMemo(() => d?.lines.reduce((s: Record<string, number>, l: Record<string, number>) => ({ doc: s.doc + l.qty_doc, rec: s.rec + l.qty_received, acc: s.acc + l.qty_accepted, amount: s.amount + (l.amount ?? 0) }), { doc: 0, rec: 0, acc: 0, amount: 0 }), [d]);
  if (isLoading || !d) return <Loading />;
  const mine = d.created_by === me?.id;
  const showPrice = can('stock.view_value');
  return (
    <div>
      <PageHeader back={<Link to="/receipts" className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500"><ArrowLeft size={12} />Phiếu nhập</Link>}
        title={<span className="flex items-center gap-2">Phiếu nhập {d.code} <Badge status={d.status} /></span>}
        subtitle={`Người lập: ${d.creator.full_name} · ${fmtDateTime(d.created_at)}${d.approver ? ` · Duyệt: ${d.approver.full_name} lúc ${fmtDateTime(d.approved_at)}` : ''}`}
        actions={<>
          <PrintButton type="receipt" id={d.id} />
          {['DRAFT', 'REJECTED'].includes(d.status) && mine && can('receipts.create') && <button className="btn-outline" onClick={() => nav(`/receipts/${d.id}/edit`)}><Pencil size={15} />Sửa</button>}
          {['DRAFT', 'REJECTED'].includes(d.status) && mine && can('receipts.create') && <button className="btn-primary" onClick={() => act.mutate({ action: 'submit' })}><Send size={15} />Gửi duyệt</button>}
          {d.status === 'SUBMITTED' && can('receipts.approve') && !mine && <>
            <button className="btn-danger" onClick={() => setDlg('reject')}><XCircle size={15} />Từ chối</button>
            <button className="btn-success" onClick={() => setDlg('approve')}><CheckCircle2 size={15} />Phê duyệt & ghi sổ</button>
          </>}
          {['DRAFT', 'SUBMITTED', 'REJECTED'].includes(d.status) && can('receipts.cancel') && <button className="btn-ghost text-red-600" onClick={() => setDlg('cancel')}><Ban size={15} />Hủy phiếu</button>}
        </>} />
      {d.status === 'SUBMITTED' && mine && <div className="mb-3"><Alert type="info">Phiếu đang chờ người có thẩm quyền khác phê duyệt (người lập không được tự duyệt).</Alert></div>}
      {d.status === 'REJECTED' && <div className="mb-3"><Alert type="danger"><b>Lý do từ chối:</b> {d.reject_reason}. Vui lòng sửa và gửi duyệt lại.</Alert></div>}
      {d.status === 'CANCELLED' && <div className="mb-3"><Alert type="warning"><b>Đã hủy:</b> {d.cancel_reason}</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Thông tin phiếu" className="lg:col-span-2">
          <dl className="grid grid-cols-1 gap-2 text-sm md:grid-cols-3">
            {[['Kho', d.warehouse.name], ['Ngày chứng từ', fmtDate(d.doc_date)], ['Ngày nhận thực tế', fmtDate(d.received_date)], ['Ngày ghi sổ', fmtDateTime(d.posted_at)], ['Nhà cung cấp', d.supplier?.name], ['Số PO', d.po_number], ['Số HĐ / phiếu giao', d.supplier_doc_no], ['Người giao', d.deliverer_name], ['Người nhận', d.receiver_name || d.creator.full_name], ['Bộ phận', d.department?.name], ['Tiền tệ', d.currency], ['Ghi chú', d.note]].map(([k, v]) => <div key={k as string}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium">{v || '–'}</dd></div>)}
          </dl>
          <div className="mt-3 flex flex-wrap gap-4 text-xs">{[['docs_checked', 'Chứng từ'], ['qty_checked', 'Số lượng'], ['spec_checked', 'Quy cách/tình trạng']].map(([k, l]) => <span key={k} className={d[k] ? 'text-emerald-700' : 'text-slate-400'}>{d[k] ? '✔' : '○'} Đã kiểm tra {l}</span>)}</div>
        </Card>
        <HistoryTimeline history={d.history} />
        <Card title="Chi tiết vật tư" className="lg:col-span-3">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>#</th><th>Mã</th><th>Tên vật tư</th><th>ĐVT</th><th>Vị trí</th><th className="text-right">SL CT</th><th className="text-right">Thực nhận</th><th className="text-right">Nhập kho</th><th className="text-right">Chờ KT</th><th className="text-right">Không đạt</th>{showPrice && <><th className="text-right">Đơn giá</th><th className="text-right">Thành tiền</th></>}<th>Tình trạng / ghi chú</th><th>Kiểm tra</th></tr></thead>
              <tbody>{d.lines.map((l: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                <tr key={l.id}>
                  <td>{l.line_no}</td><td><Link className="text-navy-700 hover:underline" to={`/items/${l.item.id}`}>{l.item.code}</Link></td><td>{l.item.name}</td><td>{l.item.unit.code}</td><td>{l.location.code}</td>
                  <td className="text-right">{fmtNum(l.qty_doc)}</td><td className={`text-right ${l.qty_doc !== l.qty_received ? 'font-semibold text-amber-700' : ''}`}>{fmtNum(l.qty_received)}</td>
                  <td className="text-right font-semibold text-emerald-700">{fmtNum(l.qty_accepted)}</td><td className="text-right">{fmtNum(l.qty_pending)}</td><td className="text-right text-red-600">{fmtNum(l.qty_rejected)}</td>
                  {showPrice && <><td className="text-right">{fmtMoney(l.unit_price)}</td><td className="text-right">{fmtMoney(l.amount)}</td></>}
                  <td className="text-xs">{[l.condition_note, l.note].filter(Boolean).join(' | ')}</td>
                  <td>{l.inspection_status === 'PENDING' ? (d.status === 'POSTED' && can('receipts.inspect') ? <button className="btn-gold btn-sm" onClick={() => setInspect(l)}><Microscope size={13} />Kiểm tra</button> : <Badge status="SUBMITTED">Chờ KT</Badge>) : l.inspection_status === 'RELEASED' ? <Badge status="POSTED">Đã KT</Badge> : l.inspection_status === 'REJECTED' ? <Badge status="REJECTED">Không đạt</Badge> : ''}</td>
                </tr>))}
                <tr className="bg-gold-50 font-semibold"><td colSpan={5}>Tổng cộng</td><td className="text-right">{fmtNum(totals?.doc)}</td><td className="text-right">{fmtNum(totals?.rec)}</td><td className="text-right">{fmtNum(totals?.acc)}</td><td colSpan={2}></td>{showPrice && <><td></td><td className="text-right">{fmtMoney(totals?.amount)}</td></>}<td colSpan={2}></td></tr>
              </tbody>
            </table>
          </div>
        </Card>
        <div className="lg:col-span-3"><AttachmentsPanel entityType="stock_receipt" entityId={d.id} locked={d.status === 'POSTED'} /></div>
      </div>
      <ReasonDialog open={dlg === 'reject'} title="Từ chối phiếu nhập" danger confirmText="Từ chối" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(reason) => act.mutate({ action: 'reject', body: { reason } })} />
      <ReasonDialog open={dlg === 'cancel'} title="Hủy phiếu nhập" message="Phiếu bị hủy sẽ không thể khôi phục. Phiếu đã ghi sổ không được hủy." danger confirmText="Hủy phiếu" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(reason) => act.mutate({ action: 'cancel', body: { reason } })} />
      <ReasonDialog open={dlg === 'approve'} title="Phê duyệt & ghi sổ phiếu nhập" message={<>Sau khi duyệt, hệ thống ghi tăng tồn kho chính thức và <b>không thể hủy</b> (chỉ điều chỉnh bằng phiếu điều chỉnh). Tổng nhập kho: <b>{fmtNum(totals?.acc)}</b>.</>} label="Ý kiến phê duyệt" required={false} confirmText="Phê duyệt & ghi sổ" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(comment) => act.mutate({ action: 'approve', body: { comment } })} />
      {inspect && <InspectModal docId={d.id} line={inspect} onClose={() => setInspect(null)} />}
    </div>
  );
}
