/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Send, CheckCircle2, XCircle, Ban, ArrowLeft, PackageCheck, PenLine, ShieldCheck, Undo2, Save } from 'lucide-react';
import { api, newRequestId } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLookup } from '@/lib/hooks';
import { fmtDate, fmtDateTime, fmtNum, todayISO, toISODate } from '@/lib/format';
import { CHEM_RECEIPT_STATUS, LINE_RESULT, QC_STATUS, STATUS, SDS_STATE } from '@/lib/constants';
import { Alert, Badge, Card, Field, Loading, Modal, PageHeader, ReasonDialog, Spinner, useToast } from '@/components/ui';
import { AttachmentsPanel, ChemicalPicker, GhsIcons, HistoryTimeline, LookupSelect, PrintButton, type PickedChemical } from '@/components/shared';
import { DocList } from '@/components/DocList';

const back = (to: string, l: string) => <Link to={to} className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500"><ArrowLeft size={12} />{l}</Link>;
function useChemWarehouses() { const { data } = useLookup('/warehouses'); return data?.filter((w) => w.type === 'CHEMICAL') ?? []; }
const addDays = (iso: string, n: number) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// ============================ NHẬP HÓA CHẤT ============================
export function ChemReceiptList() {
  const { can } = useAuth();
  const nav = useNavigate();
  return <DocList<any> title="Nhập kho hóa chất" subtitle="Tiếp nhận → kiểm tra bao bì, nhãn, chứng từ, SDS, lô/NSX/HSD, vận chuyển → lập phiếu → phê duyệt → tạo lô & cập nhật tồn theo lô" endpoint="/chemical-receipts" basePath="/chem-receipts"
    statuses={['DRAFT', 'SUBMITTED', 'POSTED', 'REJECTED', 'CANCELLED']} statusMap={CHEM_RECEIPT_STATUS}
    actions={can('chemicals.receipt_create') && <button className="btn-primary" onClick={() => nav('/chem-receipts/new')}><Plus size={15} />Tiếp nhận hóa chất</button>}
    columns={[
      { key: 'code', header: 'Số phiếu', render: (r) => <b className="text-navy-800">{r.code}</b> },
      { key: 'date', header: 'Ngày nhận', render: (r) => fmtDate(r.received_date) },
      { key: 'sup', header: 'Nhà cung cấp', render: (r) => r.supplier?.name },
      { key: 'lines', header: 'Số dòng', align: 'right', render: (r) => r._count.lines },
      { key: 'creator', header: 'Người lập', render: (r) => r.creator.full_name },
      { key: 'st', header: 'Trạng thái', render: (r) => <Badge status={r.status} map={CHEM_RECEIPT_STATUS} /> },
    ]} />;
}

interface RLine { key: string; chem: PickedChemical | null; location_id: number | null; po_item_id: number | null; batch_no: string; mfg_date: string; expiry_date: string; qty_doc: string; qty_received: string; result: string; packaging_ok: boolean; label_ok: boolean; condition_note: string; note: string }
const emptyR = (): RLine => ({ key: newRequestId(), chem: null, location_id: null, po_item_id: null, batch_no: '', mfg_date: '', expiry_date: '', qty_doc: '', qty_received: '', result: 'PASSED', packaging_ok: true, label_ok: true, condition_note: '', note: '' });

export function ChemReceiptForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const whs = useChemWarehouses();
  const [reqId] = useState(newRequestId);
  const [h, setH] = useState<any>({ warehouse_id: null, doc_date: todayISO(), received_date: todayISO(), supplier_id: null, purchase_order_id: null, supplier_doc_no: '', deliverer_name: '', transport_note: '', note: '', chk_packaging: false, chk_label: false, chk_documents: false, chk_sds: false, chk_transport: false });
  const [lines, setLines] = useState<RLine[]>([emptyR()]);
  const ex = useQuery({ queryKey: ['/chemical-receipts', id], enabled: !!id, queryFn: () => api.get<any>(`/chemical-receipts/${id}`) });
  const pos = useQuery({ queryKey: ['po-receivable-chem', h.supplier_id], queryFn: () => api.page<any>('/purchase-orders', { receivable: 1, kind: 'chemical', supplier_id: h.supplier_id || undefined, pageSize: 100 }) });
  useEffect(() => { if (!h.warehouse_id && whs.length) setH((x: any) => ({ ...x, warehouse_id: whs[0].id })); }, [whs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const d = ex.data; if (!d) return;
    setH({ warehouse_id: d.warehouse_id, doc_date: toISODate(d.doc_date), received_date: toISODate(d.received_date), supplier_id: d.supplier_id, purchase_order_id: d.purchase_order_id, supplier_doc_no: d.supplier_doc_no ?? '', deliverer_name: d.deliverer_name ?? '', transport_note: d.transport_note ?? '', note: d.note ?? '', chk_packaging: d.chk_packaging, chk_label: d.chk_label, chk_documents: d.chk_documents, chk_sds: d.chk_sds, chk_transport: d.chk_transport });
    setLines(d.lines.map((l: any) => ({ key: String(l.id), chem: { ...l.chemical }, location_id: l.location_id, po_item_id: l.po_item_id, batch_no: l.batch_no ?? '', mfg_date: toISODate(l.mfg_date), expiry_date: toISODate(l.expiry_date), qty_doc: String(l.qty_doc), qty_received: String(l.qty_received), result: l.result, packaging_ok: l.packaging_ok, label_ok: l.label_ok, condition_note: l.condition_note ?? '', note: l.note ?? '' })));
  }, [ex.data]);
  const upd = (k: string, p: Partial<RLine>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l)));
  const loadPo = async (poId: number | null) => {
    setH((x: any) => ({ ...x, purchase_order_id: poId }));
    if (!poId) return;
    const po = await api.get<any>(`/purchase-orders/${poId}`);
    setH((x: any) => ({ ...x, purchase_order_id: poId, supplier_id: po.supplier_id }));
    setLines(po.lines.filter((l: any) => l.chemical && l.remaining > 0).map((l: any) => ({ ...emptyR(), chem: { ...l.chemical, is_controlled: false }, po_item_id: l.id, qty_doc: String(l.remaining), qty_received: String(l.remaining) })));
    toast.info(`Đã nạp ${po.lines.filter((l: any) => l.chemical && l.remaining > 0).length} dòng còn lại từ đơn ${po.code}. Kiểm tra & nhập mã lô, HSD, vị trí.`);
  };
  const [sp] = useSearchParams();
  useEffect(() => { const p = sp.get('po'); if (p && !id) loadPo(Number(p)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: async (andSubmit: boolean) => {
      const body = { ...h, client_request_id: id ? undefined : reqId, lines: lines.filter((l) => l.chem).map((l) => ({ chemical_id: l.chem!.id, location_id: l.location_id, po_item_id: l.po_item_id, batch_no: l.batch_no, mfg_date: l.mfg_date, expiry_date: l.expiry_date, qty_doc: l.qty_doc || 0, qty_received: l.qty_received || 0, result: l.result, packaging_ok: l.packaging_ok, label_ok: l.label_ok, condition_note: l.condition_note, note: l.note })) };
      const r = id ? await api.put<any>(`/chemical-receipts/${id}`, body) : await api.post<any>('/chemical-receipts', body);
      const docId = id ? Number(id) : r.id;
      if (andSubmit) { try { await api.post(`/chemical-receipts/${docId}/submit`); } catch (e) { nav(`/chem-receipts/${docId}`, { replace: true }); throw e; } }
      return docId;
    },
    onSuccess: (docId, s) => { toast.success(s ? 'Đã chuyển phê duyệt' : 'Đã lưu phiếu (chờ kiểm tra)'); qc.invalidateQueries({ queryKey: ['/chemical-receipts'] }); nav(`/chem-receipts/${docId}`); },
    onError: (e) => { toast.error(e); qc.invalidateQueries({ queryKey: ['/chemical-receipts'] }); },
  });
  if (id && ex.isLoading) return <Loading />;
  const allChk = h.chk_packaging && h.chk_label && h.chk_documents && h.chk_sds && h.chk_transport;
  return (
    <div>
      <PageHeader back={back('/chem-receipts', 'Nhập hóa chất')} title={id ? `Sửa phiếu ${ex.data?.code}` : 'Tiếp nhận & nhập kho hóa chất'} subtitle="Mỗi dòng đạt/cách ly sẽ tạo một LÔ riêng. Không nhập kho chính thức khi thiếu thông tin bắt buộc theo chính sách hóa chất." />
      <div className="space-y-4">
        <Card title="1. Thông tin tiếp nhận">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field label="Kho hóa chất" required><select className="input" value={h.warehouse_id ?? ''} onChange={(e) => setH({ ...h, warehouse_id: Number(e.target.value) })}>{whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
            <Field label="Ngày chứng từ" required><input type="date" className="input" value={h.doc_date} onChange={(e) => setH({ ...h, doc_date: e.target.value })} /></Field>
            <Field label="Ngày nhận thực tế" required><input type="date" className="input" value={h.received_date} onChange={(e) => setH({ ...h, received_date: e.target.value })} /></Field>
            <Field label="Nhà cung cấp"><LookupSelect path="/suppliers" value={h.supplier_id} onChange={(v) => setH({ ...h, supplier_id: v })} /></Field>
            <Field label="Đơn đặt hàng (PO) liên quan" hint="Chọn để nạp các dòng còn phải giao"><select className="input" value={h.purchase_order_id ?? ''} onChange={(e) => loadPo(e.target.value ? Number(e.target.value) : null)}><option value="">-- Không theo PO --</option>{pos.data?.data.map((p: any) => <option key={p.id} value={p.id}>{p.code} – {p.supplier.name}</option>)}</select></Field>
            <Field label="Số hóa đơn / phiếu giao"><input className="input" value={h.supplier_doc_no} onChange={(e) => setH({ ...h, supplier_doc_no: e.target.value })} /></Field>
            <Field label="Người giao hàng"><input className="input" value={h.deliverer_name} onChange={(e) => setH({ ...h, deliverer_name: e.target.value })} /></Field>
            <Field label="Điều kiện vận chuyển / tình trạng hàng"><input className="input" value={h.transport_note} onChange={(e) => setH({ ...h, transport_note: e.target.value })} placeholder="Xe chuyên dụng, niêm phong..." /></Field>
          </div>
        </Card>
        <Card title="2. Kiểm tra tiếp nhận (bắt buộc đủ 5 mục trước khi chuyển duyệt)">
          <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-5">
            {[['chk_packaging', 'Đã kiểm tra bao bì'], ['chk_label', 'Đã kiểm tra nhãn'], ['chk_documents', 'Đã kiểm tra chứng từ'], ['chk_sds', 'Đã đối chiếu SDS/MSDS'], ['chk_transport', 'Đã kiểm tra điều kiện vận chuyển & tình trạng hàng']].map(([k, l]) => (
              <label key={k} className={`flex items-center gap-2 rounded border p-2 ${h[k] ? 'border-emerald-300 bg-emerald-50' : ''}`}><input type="checkbox" checked={h[k]} onChange={(e) => setH({ ...h, [k]: e.target.checked })} />{l}</label>
            ))}
          </div>
        </Card>
        <Card title="3. Hóa chất nhận – theo từng lô" actions={<button className="btn-outline btn-sm" onClick={() => setLines([...lines, emptyR()])}><Plus size={14} />Thêm lô</button>}>
          <div className="space-y-3">
            {lines.map((l, i) => (
              <div key={l.key} className={`rounded-md border p-3 ${l.result === 'FAILED' ? 'border-red-200 bg-red-50/40' : l.result === 'QUARANTINE' ? 'border-orange-200 bg-orange-50/40' : ''}`}>
                <div className="mb-2 flex items-center justify-between"><b className="text-sm">Dòng {i + 1}{l.po_item_id ? ' (theo PO)' : ''}</b><button className="btn-ghost btn-sm text-red-600" onClick={() => setLines(lines.length > 1 ? lines.filter((x) => x.key !== l.key) : [emptyR()])}><Trash2 size={14} /></button></div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
                  <div className="col-span-2"><label className="label">Hóa chất *</label><ChemicalPicker value={l.chem} disabled={!!l.po_item_id} onPick={(c) => upd(l.key, { chem: c })} />{l.chem?.sds_state && l.chem.sds_state !== 'OK' && <div className="mt-0.5 text-xs text-amber-700">⚠ {SDS_STATE[l.chem.sds_state]?.label}</div>}</div>
                  <Field label="Mã lô NSX *"><input className="input" value={l.batch_no} onChange={(e) => upd(l.key, { batch_no: e.target.value })} /></Field>
                  <Field label="Ngày sản xuất"><input type="date" className="input" value={l.mfg_date} onChange={(e) => upd(l.key, { mfg_date: e.target.value, expiry_date: l.expiry_date || (l.chem?.default_shelf_life_days && e.target.value ? addDays(e.target.value, l.chem.default_shelf_life_days) : '') })} /></Field>
                  <Field label="Hạn sử dụng *"><input type="date" className={`input ${l.expiry_date && l.expiry_date < todayISO() ? 'border-red-400 bg-red-50' : ''}`} value={l.expiry_date} onChange={(e) => upd(l.key, { expiry_date: e.target.value })} />{l.expiry_date && l.expiry_date < todayISO() && <div className="text-[11px] text-red-600">Đã hết hạn</div>}</Field>
                  <Field label="Vị trí bảo quản *"><LookupSelect path="/locations" params={{ warehouse_id: h.warehouse_id }} value={l.location_id} onChange={(v) => upd(l.key, { location_id: v })} labelFn={(r) => `${r.code} – ${r.name}`} /></Field>
                  <Field label={`SL chứng từ (${l.chem?.unit.code ?? ''})`}><input type="number" step="any" className="input" value={l.qty_doc} onChange={(e) => upd(l.key, { qty_doc: e.target.value, qty_received: l.qty_received === '' ? e.target.value : l.qty_received })} /></Field>
                  <Field label="SL thực nhận"><input type="number" step="any" className={`input ${l.qty_doc !== '' && l.qty_received !== l.qty_doc ? 'border-amber-400 bg-amber-50' : ''}`} value={l.qty_received} onChange={(e) => upd(l.key, { qty_received: e.target.value })} /></Field>
                  <Field label="Kết quả kiểm tra"><select className="input" value={l.result} onChange={(e) => upd(l.key, { result: e.target.value })}>{Object.entries(LINE_RESULT).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
                  <div className="flex flex-col justify-end gap-1 text-sm"><label className="flex items-center gap-1"><input type="checkbox" checked={l.packaging_ok} onChange={(e) => upd(l.key, { packaging_ok: e.target.checked })} />Bao bì đạt</label><label className="flex items-center gap-1"><input type="checkbox" checked={l.label_ok} onChange={(e) => upd(l.key, { label_ok: e.target.checked })} />Nhãn đạt</label></div>
                  <Field label="Tình trạng / lý do cách ly, không đạt" className="col-span-2"><input className="input" value={l.condition_note} onChange={(e) => upd(l.key, { condition_note: e.target.value })} /></Field>
                  <Field label="Ghi chú (lý do thiếu/thừa)" className="col-span-2 md:col-span-6"><input className="input" value={l.note} onChange={(e) => upd(l.key, { note: e.target.value })} /></Field>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500"><b>Đạt</b>: tạo lô được phép xuất · <b>Cách ly</b>: tạo lô bị chặn xuất cho tới khi giải phóng · <b>Không đạt yêu cầu</b>: không nhập kho. Hai dòng cùng mã lô nhưng khác HSD luôn là hai lô riêng.</p>
        </Card>
        <div className="flex justify-end gap-2">
          <button className="btn-outline" onClick={() => nav(-1)}>Hủy</button>
          <button className="btn-outline" disabled={save.isPending} onClick={() => save.mutate(false)}>{save.isPending && <Spinner className="h-4 w-4" />}Lưu (chờ kiểm tra)</button>
          <button className="btn-primary" disabled={save.isPending || !allChk} title={!allChk ? 'Hoàn tất 5 mục kiểm tra tiếp nhận' : ''} onClick={() => save.mutate(true)}><Send size={15} />Lưu & chuyển phê duyệt</button>
        </div>
      </div>
    </div>
  );
}

export function ChemReceiptDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { me, can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [dlg, setDlg] = useState('');
  const { data: d, isLoading } = useQuery({ queryKey: ['/chemical-receipts', id], queryFn: () => api.get<any>(`/chemical-receipts/${id}`) });
  const act = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: unknown }) => api.post(`/chemical-receipts/${id}/${action}`, body ?? {}),
    onSuccess: (_r, v) => { toast.success({ submit: 'Đã chuyển phê duyệt', approve: 'Đã phê duyệt – các lô đã nhập kho', return: 'Đã trả về kiểm tra lại', refuse: 'Đã từ chối tiếp nhận', cancel: 'Đã hủy' }[v.action] ?? 'OK'); setDlg(''); qc.invalidateQueries({ queryKey: ['/chemical-receipts'] }); qc.invalidateQueries({ queryKey: ['chem-alerts'] }); },
    onError: (e) => { toast.error(e); qc.invalidateQueries({ queryKey: ['/chemical-receipts'] }); },
  });
  if (isLoading || !d) return <Loading />;
  const mine = d.created_by === me?.id;
  const policyIssues = d.lines.filter((l: any) => l.result !== 'FAILED' && l.policy_blocks.length);
  return (
    <div>
      <PageHeader back={back('/chem-receipts', 'Nhập hóa chất')} title={<span className="flex items-center gap-2">Phiếu nhập hóa chất {d.code} <Badge status={d.status} map={CHEM_RECEIPT_STATUS} /></span>}
        subtitle={`Người lập: ${d.creator.full_name} · ${fmtDateTime(d.created_at)}`}
        actions={<>
          <PrintButton type="chem-receipt" id={d.id} />
          {d.status === 'DRAFT' && mine && can('chemicals.receipt_create') && <><button className="btn-outline" onClick={() => nav(`/chem-receipts/${d.id}/edit`)}>Sửa</button><button className="btn-primary" onClick={() => act.mutate({ action: 'submit' })}><Send size={15} />Chuyển phê duyệt</button></>}
          {d.status === 'SUBMITTED' && can('chemicals.receipt_approve') && !mine && <><button className="btn-outline" onClick={() => setDlg('return')}><Undo2 size={15} />Trả về</button><button className="btn-success" onClick={() => setDlg('approve')}><CheckCircle2 size={15} />Phê duyệt nhập kho</button></>}
          {['DRAFT', 'SUBMITTED'].includes(d.status) && (can('chemicals.receipt_create') || can('chemicals.receipt_approve')) && <button className="btn-danger" onClick={() => setDlg('refuse')}><XCircle size={15} />Từ chối tiếp nhận</button>}
          {d.status === 'DRAFT' && mine && <button className="btn-ghost text-red-600" onClick={() => setDlg('cancel')}><Ban size={15} />Hủy</button>}
        </>} />
      {d.reject_reason && <div className="mb-3"><Alert type="danger"><b>{d.status === 'REJECTED' ? 'Từ chối tiếp nhận' : 'Trả về'}:</b> {d.reject_reason}</Alert></div>}
      {d.status !== 'POSTED' && policyIssues.length > 0 && <div className="mb-3"><Alert type="danger"><b>Chưa đủ điều kiện nhập kho:</b><ul className="ml-5 list-disc">{policyIssues.map((l: any) => <li key={l.id}>{l.chemical.code}: {l.policy_blocks.join(', ')}</li>)}</ul></Alert></div>}
      {d.storage_warnings?.length > 0 && <div className="mb-3"><Alert type="warning"><b>Cảnh báo lưu trữ (quy tắc đã được chuyên gia xác nhận):</b><ul className="ml-5 list-disc">{d.storage_warnings.map((w: string) => <li key={w}>{w}</li>)}</ul></Alert></div>}
      {d.status === 'SUBMITTED' && mine && <div className="mb-3"><Alert type="info">Chờ người có thẩm quyền khác phê duyệt.</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Thông tin tiếp nhận" className="lg:col-span-2">
          <dl className="grid grid-cols-1 gap-2 text-sm md:grid-cols-3">{[['Kho', d.warehouse.name], ['Ngày chứng từ', fmtDate(d.doc_date)], ['Ngày nhận', fmtDate(d.received_date)], ['Nhà cung cấp', d.supplier?.name], ['Đơn đặt hàng', d.purchase_order ? <Link className="text-navy-700 underline" to={`/purchase-orders/${d.purchase_order.id}`}>{d.purchase_order.code}</Link> : ''], ['Số HĐ/phiếu giao', d.supplier_doc_no], ['Người giao', d.deliverer_name], ['Vận chuyển', d.transport_note], ['Ngày ghi sổ', fmtDateTime(d.posted_at)]].map(([k, v]) => <div key={k as string}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium">{v || '–'}</dd></div>)}</dl>
          <div className="mt-3 flex flex-wrap gap-3 text-xs">{[['chk_packaging', 'Bao bì'], ['chk_label', 'Nhãn'], ['chk_documents', 'Chứng từ'], ['chk_sds', 'SDS/MSDS'], ['chk_transport', 'Vận chuyển']].map(([k, l]) => <span key={k} className={d[k] ? 'text-emerald-700' : 'text-red-600'}>{d[k] ? '✔' : '✘'} {l}</span>)}</div>
        </Card>
        <HistoryTimeline history={d.history} />
        <Card title="Chi tiết theo lô" className="lg:col-span-3">
          <div className="overflow-x-auto"><table className="table-base">
            <thead><tr><th>#</th><th>Hóa chất</th><th>Mã lô NSX</th><th>Lô nội bộ</th><th>NSX</th><th>HSD</th><th>Vị trí</th><th className="text-right">SL CT</th><th className="text-right">Thực nhận</th><th>Kết quả</th><th>Bao bì/nhãn</th><th>SDS</th><th>Tình trạng</th></tr></thead>
            <tbody>{d.lines.map((l: any) => {
              const b = d.batches.find((x: any) => x.receipt_line_id === l.id);
              return <tr key={l.id}><td>{l.line_no}</td><td><Link className="text-navy-700 hover:underline" to={`/chemicals/${l.chemical.id}`}>{l.chemical.code}</Link> – {l.chemical.name}</td><td>{l.batch_no}</td>
                <td>{b ? <Link className="text-navy-700 hover:underline" to={`/chem-batches/${b.id}`}>{b.internal_code}</Link> : ''}</td><td>{fmtDate(l.mfg_date)}</td><td>{fmtDate(l.expiry_date)}</td><td>{l.location.code}</td>
                <td className="text-right">{fmtNum(l.qty_doc)}</td><td className="text-right">{fmtNum(l.qty_received)} {l.chemical.unit.code}</td><td><Badge status={l.result} map={LINE_RESULT} /></td>
                <td className="text-xs">{l.packaging_ok ? '✔' : '✘'} / {l.label_ok ? '✔' : '✘'}</td><td><Badge status={l.sds_state} map={SDS_STATE} /></td><td className="text-xs">{[l.condition_note, l.note].filter(Boolean).join(' | ')}</td></tr>;
            })}</tbody></table></div>
        </Card>
        <div className="lg:col-span-3"><AttachmentsPanel entityType="chemical_receipt" entityId={d.id} locked={d.status === 'POSTED'} /></div>
      </div>
      <ReasonDialog open={dlg === 'approve'} title="Phê duyệt nhập kho hóa chất" message="Hệ thống kiểm tra lại chính sách (SDS, lô, HSD), tạo các lô và cập nhật tồn kho theo lô. Vị trí bảo quản trên phiếu được xác nhận." label="Ý kiến" required={false} confirmText="Phê duyệt" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(c) => act.mutate({ action: 'approve', body: { comment: c } })} />
      <ReasonDialog open={dlg === 'return'} title="Trả về kiểm tra lại" confirmText="Trả về" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(r) => act.mutate({ action: 'return', body: { reason: r } })} />
      <ReasonDialog open={dlg === 'refuse'} title="Từ chối tiếp nhận toàn bộ lô hàng" message="Hàng được trả lại nhà cung cấp, không nhập kho." danger confirmText="Từ chối tiếp nhận" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(r) => act.mutate({ action: 'refuse', body: { reason: r } })} />
      <ReasonDialog open={dlg === 'cancel'} title="Hủy phiếu" danger confirmText="Hủy" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(r) => act.mutate({ action: 'cancel', body: { reason: r } })} />
    </div>
  );
}

// ============================ XUẤT HÓA CHẤT ============================
export function ChemIssueList() {
  const { can } = useAuth();
  const nav = useNavigate();
  return <DocList<any> title="Xuất kho hóa chất" subtitle="Yêu cầu sử dụng → phê duyệt → (HSE xác nhận nếu kiểm soát đặc biệt) → xuất theo lô FEFO → người nhận xác nhận" endpoint="/chemical-issues" basePath="/chem-issues"
    statuses={['DRAFT', 'SUBMITTED', 'APPROVED', 'ISSUED', 'RECEIVED', 'REJECTED', 'CANCELLED']}
    actions={can('chemicals.request') && <button className="btn-primary" onClick={() => nav('/chem-issues/new')}><Plus size={15} />Yêu cầu sử dụng hóa chất</button>}
    columns={[
      { key: 'code', header: 'Số phiếu', render: (r) => <b className="text-navy-800">{r.code}</b> },
      { key: 'date', header: 'Ngày', render: (r) => fmtDate(r.doc_date) },
      { key: 'dept', header: 'Bộ phận', render: (r) => r.department.name },
      { key: 'purpose', header: 'Mục đích / khu vực', render: (r) => <div className="text-xs">{r.purpose}<div className="text-slate-500">{r.work_area}</div></div> },
      { key: 'resp', header: 'Người chịu trách nhiệm', render: (r) => r.responsible_person },
      { key: 'st', header: 'Trạng thái', render: (r) => <div className="flex flex-col gap-0.5"><Badge status={r.status} />{r.requires_hse && <span className={`text-[11px] ${r.hse_confirmed_at ? 'text-emerald-700' : 'text-red-600'}`}>{r.hse_confirmed_at ? '✔ HSE đã xác nhận' : '⚠ Cần HSE xác nhận'}</span>}</div> },
    ]} />;
}

export function ChemIssueForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { me, can } = useAuth();
  const whs = useChemWarehouses();
  const [reqId] = useState(newRequestId);
  const [h, setH] = useState<any>({ warehouse_id: null, doc_date: todayISO(), department_id: me?.department?.id ?? null, purpose: '', work_area: '', responsible_person: '', note: '' });
  const [lines, setLines] = useState<{ key: string; chem: PickedChemical | null; qty: string; note: string }[]>([{ key: newRequestId(), chem: null, qty: '', note: '' }]);
  const ex = useQuery({ queryKey: ['/chemical-issues', id], enabled: !!id, queryFn: () => api.get<any>(`/chemical-issues/${id}`) });
  useEffect(() => { if (!h.warehouse_id && whs.length) setH((x: any) => ({ ...x, warehouse_id: whs[0].id })); }, [whs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const d = ex.data; if (!d) return; setH({ warehouse_id: d.warehouse_id, doc_date: toISODate(d.doc_date), department_id: d.department_id, purpose: d.purpose, work_area: d.work_area, responsible_person: d.responsible_person, note: d.note ?? '' }); setLines(d.lines.map((l: any) => ({ key: String(l.id), chem: { ...l.chemical, available: l.available }, qty: String(l.qty_requested), note: l.note ?? '' }))); }, [ex.data]);
  const upd = (k: string, p: object) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l)));
  const save = useMutation({
    mutationFn: async (s: boolean) => {
      const body = { ...h, client_request_id: id ? undefined : reqId, lines: lines.filter((l) => l.chem).map((l) => ({ chemical_id: l.chem!.id, qty_requested: l.qty, note: l.note })) };
      const r = id ? await api.put<any>(`/chemical-issues/${id}`, body) : await api.post<any>('/chemical-issues', body);
      const docId = id ? Number(id) : r.id;
      if (s) await api.post(`/chemical-issues/${docId}/submit`);
      return docId;
    },
    onSuccess: (docId) => { toast.success('Đã lưu yêu cầu'); nav(`/chem-issues/${docId}`); }, onError: toast.error,
  });
  const controlled = lines.some((l) => l.chem?.is_controlled);
  return (
    <div>
      <PageHeader back={back('/chem-issues', 'Xuất hóa chất')} title={id ? `Sửa yêu cầu ${ex.data?.code}` : 'Yêu cầu sử dụng hóa chất'} />
      <div className="space-y-4">
        <Card title="Thông tin yêu cầu (bắt buộc)">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field label="Kho hóa chất" required><select className="input" value={h.warehouse_id ?? ''} onChange={(e) => setH({ ...h, warehouse_id: Number(e.target.value) })}>{whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
            <Field label="Ngày" required><input type="date" className="input" value={h.doc_date} onChange={(e) => setH({ ...h, doc_date: e.target.value })} /></Field>
            <Field label="Bộ phận sử dụng" required><LookupSelect path="/departments" value={h.department_id} disabled={!can('chemicals.issue', 'chemicals.issue_approve')} onChange={(v) => setH({ ...h, department_id: v })} /></Field>
            <Field label="Người chịu trách nhiệm" required><input className="input" value={h.responsible_person} onChange={(e) => setH({ ...h, responsible_person: e.target.value })} /></Field>
            <Field label="Mục đích sử dụng" required className="md:col-span-2"><input className="input" value={h.purpose} onChange={(e) => setH({ ...h, purpose: e.target.value })} /></Field>
            <Field label="Khu vực sử dụng" required className="md:col-span-2"><input className="input" value={h.work_area} onChange={(e) => setH({ ...h, work_area: e.target.value })} /></Field>
          </div>
        </Card>
        <Card title="Hóa chất cần cấp" actions={<button className="btn-outline btn-sm" onClick={() => setLines([...lines, { key: newRequestId(), chem: null, qty: '', note: '' }])}><Plus size={14} />Thêm dòng</button>}>
          {controlled && <div className="mb-3"><Alert type="warning">Có hóa chất <b>kiểm soát đặc biệt</b> – phiếu cần HSE xác nhận an toàn trước khi kho xuất.</Alert></div>}
          <table className="table-base"><thead><tr><th>Hóa chất</th><th className="w-36 text-right">Được phép xuất</th><th>Bảo hộ / GHS</th><th className="w-32 text-right">SL yêu cầu</th><th>Ghi chú</th><th></th></tr></thead>
            <tbody>{lines.map((l) => (
              <tr key={l.key}><td><ChemicalPicker value={l.chem} warehouseId={h.warehouse_id} onPick={(c) => upd(l.key, { chem: c })} /></td>
                <td className="pt-3 text-right">{l.chem && <span className={Number(l.chem.available) > 0 ? 'text-emerald-700' : 'text-red-600'}>{fmtNum(l.chem.available)} {l.chem.unit.code}</span>}</td>
                <td className="pt-2"><GhsIcons codes={l.chem?.ghs_pictograms} /></td>
                <td><input type="number" step="any" className="input text-right" value={l.qty} onChange={(e) => upd(l.key, { qty: e.target.value })} /></td>
                <td><input className="input" value={l.note} onChange={(e) => upd(l.key, { note: e.target.value })} /></td>
                <td><button className="btn-ghost btn-sm text-red-600" onClick={() => lines.length > 1 && setLines(lines.filter((x) => x.key !== l.key))}><Trash2 size={14} /></button></td></tr>
            ))}</tbody></table>
        </Card>
        <div className="flex justify-end gap-2"><button className="btn-outline" onClick={() => nav(-1)}>Hủy</button><button className="btn-outline" disabled={save.isPending} onClick={() => save.mutate(false)}>Lưu nháp</button><button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(true)}><Send size={15} />Lưu & gửi duyệt</button></div>
      </div>
    </div>
  );
}

function ChemIssueModal({ d, onClose }: { d: any; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [receiver, setReceiver] = useState(d.requester.full_name);
  const [receiverId, setReceiverId] = useState<number | null>(d.requester.id);
  const [alloc, setAlloc] = useState<Record<number, Record<number, string>>>({});
  const { data } = useQuery({ queryKey: ['chem-alloc', d.id], queryFn: () => api.get<any>(`/chemical-issues/${d.id}/allocation`) });
  const { data: users } = useQuery({ queryKey: ['users-lookup', d.department_id], queryFn: () => api.get<any[]>('/users/lookup', { department_id: d.department_id }) });
  useEffect(() => { if (data) setAlloc(Object.fromEntries(data.lines.map((l: any) => [l.id, Object.fromEntries(l.suggest.map((s: any) => [s.batch_id, String(s.qty)]))]))); }, [data]);
  const m = useMutation({
    mutationFn: () => api.post(`/chemical-issues/${d.id}/issue`, { receiver_name: receiver, receiver_user_id: receiverId, lines: d.lines.map((l: any) => ({ id: l.id, allocations: Object.entries(alloc[l.id] ?? {}).filter(([, q]) => Number(q) > 0).map(([b, q]) => ({ batch_id: Number(b), qty: Number(q) })) })) }),
    onSuccess: () => { toast.success('Đã xuất hóa chất theo lô'); qc.invalidateQueries({ queryKey: ['/chemical-issues'] }); onClose(); }, onError: toast.error,
  });
  return (
    <Modal open onClose={onClose} title={`Xuất hóa chất theo lô – ${d.code}`} size="xl" footer={<><button className="btn-outline" onClick={onClose}>Đóng</button><button className="btn-success" disabled={m.isPending || !data} onClick={() => m.mutate()}><PackageCheck size={15} />Xác nhận xuất</button></>}>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Field label="Tài khoản người nhận"><select className="input" value={receiverId ?? ''} onChange={(e) => { const u = users?.find((x) => x.id === Number(e.target.value)); setReceiverId(u?.id ?? null); if (u) setReceiver(u.full_name); }}><option value="">-- Không có tài khoản --</option>{users?.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></Field>
        <Field label="Họ tên người nhận" required><input className="input" value={receiver} onChange={(e) => setReceiver(e.target.value)} /></Field>
      </div>
      {data?.fefo && <div className="mb-3"><Alert type="info">Áp dụng <b>FEFO</b>: hệ thống đã gợi ý lô hạn gần nhất trước. Chọn lô hạn muộn hơn khi lô hạn sớm còn hàng sẽ bị chặn.</Alert></div>}
      {!data ? <Loading /> : data.lines.map((l: any) => {
        const line = d.lines.find((x: any) => x.id === l.id);
        const sum = Object.values(alloc[l.id] ?? {}).reduce((s, q) => s + Number(q || 0), 0);
        return (
          <div key={l.id} className="mb-3 rounded border p-3">
            <div className="mb-2 flex flex-wrap justify-between gap-2 text-sm"><span><b>{line.chemical.code}</b> – {line.chemical.name}</span><span>Duyệt: <b>{fmtNum(l.qty_approved)}</b> · Xuất: <b className={sum > l.qty_approved ? 'text-red-600' : ''}>{fmtNum(sum)}</b> {line.chemical.unit.code}{l.shortage > 0 && <span className="ml-2 text-red-600">Thiếu lô đủ điều kiện: {fmtNum(l.shortage)}</span>}</span></div>
            {line.chemical.ppe_req && <div className="mb-2 text-xs text-slate-600">Bảo hộ yêu cầu: {line.chemical.ppe_req}</div>}
            <table className="table-base"><thead><tr><th>Lô nội bộ / NSX</th><th>Vị trí</th><th>HSD</th><th className="text-right">Tồn lô</th><th>Trạng thái</th><th className="w-28 text-right">SL lấy</th></tr></thead>
              <tbody>{l.batches.map((b: any) => (
                <tr key={b.id} className={b.block_reasons.length ? 'bg-red-50/60 text-slate-400' : ''}><td><b>{b.internal_code}</b><div className="text-xs">{b.batch_no}</div></td><td>{b.location}</td><td>{fmtDate(b.expiry_date)}</td><td className="text-right">{fmtNum(b.qty_on_hand)}</td>
                  <td className="text-xs">{b.block_reasons.length ? <span className="text-red-600">✘ {b.block_reasons.join(', ')}</span> : <span className="text-emerald-700">✔ Được xuất{b.abnormal && ' (⚠ bao bì bất thường)'}</span>}</td>
                  <td>{!b.block_reasons.length && <input type="number" step="any" min={0} max={b.qty_on_hand} className="input text-right" value={alloc[l.id]?.[b.id] ?? ''} onChange={(e) => setAlloc({ ...alloc, [l.id]: { ...(alloc[l.id] ?? {}), [b.id]: e.target.value } })} />}</td></tr>
              ))}</tbody></table>
          </div>);
      })}
    </Modal>
  );
}

export function ChemIssueDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { me, can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [dlg, setDlg] = useState('');
  const [qty, setQty] = useState<Record<number, string>>({});
  const [sig, setSig] = useState('');
  const { data: d, isLoading } = useQuery({ queryKey: ['/chemical-issues', id], queryFn: () => api.get<any>(`/chemical-issues/${id}`) });
  useEffect(() => { if (d) setQty(Object.fromEntries(d.lines.map((l: any) => [l.id, String(Math.min(l.qty_requested, Math.max(0, l.available)))]))); }, [d]);
  const act = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: unknown }) => api.post(`/chemical-issues/${id}/${action}`, body ?? {}),
    onSuccess: (_r, v) => { toast.success({ submit: 'Đã gửi duyệt', approve: 'Đã phê duyệt (giữ chỗ tồn)', 'hse-confirm': 'HSE đã xác nhận an toàn', reject: 'Đã từ chối', cancel: 'Đã hủy', confirm: 'Đã xác nhận nhận hóa chất' }[v.action] ?? 'OK'); setDlg(''); qc.invalidateQueries({ queryKey: ['/chemical-issues'] }); },
    onError: (e) => { toast.error(e); qc.invalidateQueries({ queryKey: ['/chemical-issues'] }); },
  });
  if (isLoading || !d) return <Loading />;
  const mine = d.created_by === me?.id || d.requester_id === me?.id;
  const blocks = d.lines.filter((l: any) => l.policy_blocks.length);
  return (
    <div>
      <PageHeader back={back('/chem-issues', 'Xuất hóa chất')} title={<span className="flex items-center gap-2">Phiếu {d.code} <Badge status={d.status} /></span>}
        subtitle={`${d.department.name} · Người yêu cầu: ${d.requester.full_name}`}
        actions={<>
          <PrintButton type="chem-issue" id={d.id} />
          {['DRAFT', 'REJECTED'].includes(d.status) && d.created_by === me?.id && <><button className="btn-outline" onClick={() => nav(`/chem-issues/${d.id}/edit`)}>Sửa</button><button className="btn-primary" onClick={() => act.mutate({ action: 'submit' })}><Send size={15} />Gửi duyệt</button></>}
          {d.status === 'SUBMITTED' && can('chemicals.issue_approve') && !mine && <><button className="btn-danger" onClick={() => setDlg('reject')}><XCircle size={15} />Từ chối</button><button className="btn-success" onClick={() => setDlg('approve')}><CheckCircle2 size={15} />Phê duyệt</button></>}
          {d.requires_hse && !d.hse_confirmed_at && ['SUBMITTED', 'APPROVED'].includes(d.status) && can('chemicals.hse_confirm') && !mine && <button className="btn-gold" onClick={() => setDlg('hse')}><ShieldCheck size={15} />HSE xác nhận an toàn</button>}
          {d.status === 'APPROVED' && can('chemicals.issue') && <button className="btn-gold" disabled={d.requires_hse && !d.hse_confirmed_at} title={d.requires_hse && !d.hse_confirmed_at ? 'Chờ HSE xác nhận' : ''} onClick={() => setDlg('issue')}><PackageCheck size={15} />Xuất theo lô</button>}
          {d.status === 'ISSUED' && d.issued_by !== me?.id && (d.requester_id === me?.id || d.receiver_user_id === me?.id || me?.department?.id === d.department_id) && <button className="btn-success" onClick={() => { setSig(''); setDlg('confirm'); }}><PenLine size={15} />Xác nhận đã nhận</button>}
          {['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'].includes(d.status) && (can('chemicals.issue_approve') || (d.created_by === me?.id && d.status !== 'APPROVED')) && <button className="btn-ghost text-red-600" onClick={() => setDlg('cancel')}><Ban size={15} />Hủy</button>}
        </>} />
      {d.reject_reason && d.status === 'REJECTED' && <div className="mb-3"><Alert type="danger"><b>Lý do từ chối:</b> {d.reject_reason}</Alert></div>}
      {d.requires_hse && <div className="mb-3"><Alert type={d.hse_confirmed_at ? 'success' : 'warning'}>{d.hse_confirmed_at ? <>HSE ({d.hse_confirmer}) đã xác nhận lúc {fmtDateTime(d.hse_confirmed_at)}: {d.hse_note}</> : <>Phiếu có <b>hóa chất kiểm soát đặc biệt</b> – kho chỉ được xuất sau khi HSE xác nhận an toàn.</>}</Alert></div>}
      {blocks.length > 0 && ['SUBMITTED', 'APPROVED'].includes(d.status) && <div className="mb-3"><Alert type="danger"><b>Không đủ điều kiện an toàn:</b> {blocks.map((l: any) => `${l.chemical.code}: ${l.policy_blocks.join(', ')}`).join('; ')}</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Thông tin phiếu" className="lg:col-span-2">
          <dl className="grid grid-cols-1 gap-2 text-sm md:grid-cols-3">{[['Kho', d.warehouse.name], ['Ngày', fmtDate(d.doc_date)], ['Bộ phận', d.department.name], ['Mục đích', d.purpose], ['Khu vực sử dụng', d.work_area], ['Người chịu trách nhiệm', d.responsible_person], ['Người phê duyệt', d.approver ? `${d.approver} (${fmtDateTime(d.approved_at)})` : ''], ['Người xuất / thời gian', d.issuer ? `${d.issuer} (${fmtDateTime(d.issued_at)})` : ''], ['Người nhận', `${d.receiver_name ?? ''}${d.receive_signature ? ` – xác nhận “${d.receive_signature}” ${fmtDateTime(d.receive_confirmed_at)}` : ''}`]].map(([k, v]) => <div key={k as string}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium">{v || '–'}</dd></div>)}</dl>
        </Card>
        <HistoryTimeline history={d.history} />
        <Card title="Chi tiết" className="lg:col-span-3">
          <table className="table-base"><thead><tr><th>Hóa chất</th><th>GHS</th><th className="text-right">Yêu cầu</th><th className="text-right">Duyệt</th><th className="text-right">Đã xuất</th><th>Lô đã xuất (mã lô / HSD / SL)</th>{['SUBMITTED', 'APPROVED'].includes(d.status) && <th className="text-right">Được phép xuất</th>}</tr></thead>
            <tbody>{d.lines.map((l: any) => <tr key={l.id}><td><b>{l.chemical.code}</b> – {l.chemical.name}{l.chemical.is_controlled && <span className="ml-1 rounded bg-red-100 px-1 text-[10px] text-red-700">KSĐB</span>}</td><td><GhsIcons codes={l.chemical.ghs_pictograms} /></td><td className="text-right">{fmtNum(l.qty_requested)} {l.chemical.unit.code}</td><td className="text-right">{fmtNum(l.qty_approved)}</td><td className="text-right font-semibold">{fmtNum(l.qty_issued)}</td>
              <td className="text-xs">{(l.batch_detail ?? []).map((b: any) => <div key={b.batch_id}>{b.internal_code} / {b.batch_no} / {fmtDate(b.expiry_date)} / <b>{fmtNum(b.qty)}</b></div>)}</td>
              {['SUBMITTED', 'APPROVED'].includes(d.status) && <td className={`text-right ${l.available < (l.qty_approved ?? l.qty_requested) ? 'text-red-600' : 'text-emerald-700'}`}>{fmtNum(l.available)}{l.blocked_qty > 0 && <div className="text-[11px] text-slate-500">({fmtNum(l.blocked_qty)} bị chặn)</div>}</td>}</tr>)}</tbody></table>
        </Card>
        <div className="lg:col-span-3"><AttachmentsPanel entityType="chemical_issue" entityId={d.id} locked={['ISSUED', 'RECEIVED'].includes(d.status)} /></div>
      </div>
      <Modal open={dlg === 'approve'} onClose={() => setDlg('')} title="Phê duyệt yêu cầu hóa chất" size="md" footer={<><button className="btn-outline" onClick={() => setDlg('')}>Đóng</button><button className="btn-success" disabled={act.isPending} onClick={() => act.mutate({ action: 'approve', body: { lines: d.lines.map((l: any) => ({ id: l.id, qty_approved: qty[l.id] || 0 })) } })}>Phê duyệt</button></>}>
        <table className="table-base"><thead><tr><th>Hóa chất</th><th className="text-right">Yêu cầu</th><th className="text-right">Được phép xuất</th><th className="w-28">SL duyệt</th></tr></thead>
          <tbody>{d.lines.map((l: any) => <tr key={l.id}><td>{l.chemical.code}</td><td className="text-right">{fmtNum(l.qty_requested)}</td><td className="text-right">{fmtNum(l.available)}</td><td><input type="number" step="any" className="input" value={qty[l.id] ?? ''} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} /></td></tr>)}</tbody></table>
        <p className="mt-2 text-xs text-slate-500">Tồn được phép xuất đã loại trừ lô hết hạn, cách ly, không đạt và SL giữ chỗ cho phiếu khác.</p>
      </Modal>
      {dlg === 'issue' && <ChemIssueModal d={d} onClose={() => setDlg('')} />}
      <ReasonDialog open={dlg === 'hse'} title="HSE xác nhận yêu cầu an toàn" message="Xác nhận người sử dụng, khu vực, bảo hộ và phương án ứng cứu đáp ứng yêu cầu theo SDS." label="Nội dung xác nhận / điều kiện kèm theo" confirmText="Xác nhận" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(n) => act.mutate({ action: 'hse-confirm', body: { note: n } })} />
      <ReasonDialog open={dlg === 'reject'} title="Từ chối yêu cầu" danger confirmText="Từ chối" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(r) => act.mutate({ action: 'reject', body: { reason: r } })} />
      <ReasonDialog open={dlg === 'cancel'} title="Hủy phiếu" danger confirmText="Hủy" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(r) => act.mutate({ action: 'cancel', body: { reason: r } })} />
      <Modal open={dlg === 'confirm'} onClose={() => setDlg('')} title="Xác nhận đã nhận hóa chất" size="sm" footer={<><button className="btn-outline" onClick={() => setDlg('')}>Đóng</button><button className="btn-success" disabled={sig.length < 2 || act.isPending} onClick={() => act.mutate({ action: 'confirm', body: { signature: sig } })}>Xác nhận</button></>}>
        <p className="mb-2 text-sm">Gõ lại chính xác họ tên của bạn (<b>{me?.full_name}</b>) để ký nhận.</p><input className="input" placeholder="Họ và tên" value={sig} onChange={(e) => setSig(e.target.value)} autoFocus />
      </Modal>
    </div>
  );
}

// ============================ KIỂM KÊ HÓA CHẤT ============================
export function ChemStocktakeList() {
  const { can } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const whs = useChemWarehouses();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<{ name: string; warehouse_id: number | null; chemicals: PickedChemical[] }>({ name: '', warehouse_id: null, chemicals: [] });
  const create = useMutation({ mutationFn: () => api.post<any>('/chemical-stocktakes', { name: f.name, warehouse_id: f.warehouse_id ?? whs[0]?.id, chemical_ids: f.chemicals.map((c) => c.id) }), onSuccess: (r: any) => nav(`/chem-stocktakes/${r.id}`), onError: toast.error });
  return (
    <>
      <DocList<any> title="Kiểm kê hóa chất theo lô" subtitle="Chốt tồn từng lô → đếm thực tế + tình trạng bao bì + HSD → chênh lệch theo lô → giải trình → phê duyệt điều chỉnh" endpoint="/chemical-stocktakes" basePath="/chem-stocktakes" hideDates
        statuses={['COUNTING', 'SUBMITTED', 'POSTED', 'CANCELLED']}
        actions={can('chemicals.stocktake') && <button className="btn-primary" onClick={() => setOpen(true)}><Plus size={15} />Tạo đợt kiểm kê</button>}
        columns={[{ key: 'code', header: 'Số', render: (r) => <b>{r.code}</b> }, { key: 'name', header: 'Tên đợt', render: (r) => r.name }, { key: 'snap', header: 'Chốt sổ', render: (r) => fmtDateTime(r.snapshot_at) }, { key: 'n', header: 'Số lô', align: 'right', render: (r) => r._count.lines }, { key: 'c', header: 'Người tạo', render: (r) => r.creator?.full_name }, { key: 's', header: 'Trạng thái', render: (r) => <Badge status={r.status} /> }]} />
      <Modal open={open} onClose={() => setOpen(false)} title="Tạo đợt kiểm kê hóa chất" size="md" footer={<><button className="btn-outline" onClick={() => setOpen(false)}>Hủy</button><button className="btn-primary" disabled={f.name.length < 3 || create.isPending} onClick={() => create.mutate()}>Tạo & chốt tồn sổ</button></>}>
        <div className="space-y-3">
          <Field label="Kho"><select className="input" value={f.warehouse_id ?? whs[0]?.id ?? ''} onChange={(e) => setF({ ...f, warehouse_id: Number(e.target.value) })}>{whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
          <Field label="Tên đợt" required><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="VD: Kiểm kê hóa chất tháng 11/2026" /></Field>
          <Field label="Giới hạn hóa chất (để trống = toàn bộ lô còn tồn)"><ChemicalPicker value={null} onPick={(c) => c && !f.chemicals.some((x) => x.id === c.id) && setF({ ...f, chemicals: [...f.chemicals, c] })} /></Field>
          <div className="flex flex-wrap gap-1">{f.chemicals.map((c) => <span key={c.id} className="rounded bg-slate-100 px-2 py-0.5 text-xs">{c.code} <button onClick={() => setF({ ...f, chemicals: f.chemicals.filter((x) => x.id !== c.id) })}>×</button></span>)}</div>
        </div>
      </Modal>
    </>
  );
}

export function ChemStocktakeDetail() {
  const { id } = useParams();
  const { me, can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [counts, setCounts] = useState<Record<number, any>>({});
  const [dlg, setDlg] = useState('');
  const { data: d, isLoading } = useQuery({ queryKey: ['/chemical-stocktakes', id], queryFn: () => api.get<any>(`/chemical-stocktakes/${id}`) });
  useEffect(() => { if (d) setCounts(Object.fromEntries(d.lines.map((l: any) => [l.id, { counted_qty: l.counted_qty ?? '', packaging_ok: l.packaging_ok, packaging_note: l.packaging_note ?? '', reason: l.reason ?? '' }]))); }, [d]);
  const body = () => ({ lines: Object.entries(counts).map(([lid, c]) => ({ id: Number(lid), counted_qty: c.counted_qty === '' ? null : c.counted_qty, packaging_ok: c.packaging_ok, packaging_note: c.packaging_note, reason: c.reason })) });
  const act = useMutation({
    mutationFn: async ({ action, b }: { action: string; b?: unknown }) => { if (action === 'counts') return api.put(`/chemical-stocktakes/${id}/counts`, body()); if (action === 'submit') await api.put(`/chemical-stocktakes/${id}/counts`, body()); return api.post(`/chemical-stocktakes/${id}/${action}`, b ?? {}); },
    onSuccess: (_r, v) => { toast.success({ counts: 'Đã lưu số kiểm', submit: 'Đã gửi duyệt', approve: 'Đã phê duyệt – điều chỉnh theo lô đã ghi sổ', reject: 'Đã trả về', cancel: 'Đã hủy' }[v.action] ?? 'OK'); setDlg(''); qc.invalidateQueries({ queryKey: ['/chemical-stocktakes'] }); },
    onError: (e) => { toast.error(e); qc.invalidateQueries({ queryKey: ['/chemical-stocktakes'] }); },
  });
  if (isLoading || !d) return <Loading />;
  const edit = d.status === 'COUNTING' && can('chemicals.stocktake');
  const setC = (lid: number, p: object) => setCounts({ ...counts, [lid]: { ...counts[lid], ...p } });
  return (
    <div>
      <PageHeader back={back('/chem-stocktakes', 'Kiểm kê hóa chất')} title={<span className="flex items-center gap-2">{d.code} – {d.name} <Badge status={d.status} /></span>} subtitle={`${d.warehouse?.name} · Chốt sổ ${fmtDateTime(d.snapshot_at)}`}
        actions={<>
          <PrintButton type="chem-stocktake" id={d.id} />
          {edit && <><button className="btn-outline" onClick={() => act.mutate({ action: 'counts' })}><Save size={15} />Lưu</button><button className="btn-primary" onClick={() => act.mutate({ action: 'submit' })}><Send size={15} />Gửi duyệt</button><button className="btn-ghost text-red-600" onClick={() => setDlg('cancel')}>Hủy</button></>}
          {d.status === 'SUBMITTED' && can('chemicals.approve_adjust') && d.created_by !== me?.id && <><button className="btn-danger" onClick={() => setDlg('reject')}>Trả về</button><button className="btn-success" onClick={() => setDlg('approve')}><CheckCircle2 size={15} />Phê duyệt</button></>}
        </>} />
      {d.reject_reason && d.status === 'COUNTING' && <div className="mb-3"><Alert type="danger">Bị trả về: {d.reject_reason}</Alert></div>}
      {d.adjustment && <div className="mb-3 text-sm">Phiếu điều chỉnh: <Link className="text-navy-700 underline" to={`/chem-adjustments/${d.adjustment.id}`}>{d.adjustment.code}</Link> <Badge status={d.adjustment.status} /></div>}
      <Card title="Bảng kiểm đếm theo lô">
        <div className="overflow-x-auto"><table className="table-base">
          <thead><tr><th>Vị trí</th><th>Hóa chất</th><th>Lô</th><th>HSD</th><th className="text-right">Tồn sổ</th><th className="w-28">Thực tế</th><th className="text-right">Chênh lệch</th><th className="w-36">Bao bì</th><th>Giải trình / mô tả</th></tr></thead>
          <tbody>{d.lines.map((l: any) => { const c = counts[l.id] ?? {}; const v = c.counted_qty === '' || c.counted_qty == null ? null : Number(c.counted_qty) - l.book_qty; return (
            <tr key={l.id} className={v ? 'bg-amber-50/60' : ''}><td>{l.batch.location.code}</td><td>{l.batch.chemical.code} – {l.batch.chemical.name}</td><td><b>{l.batch.internal_code}</b><div className="text-xs">{l.batch.batch_no}</div></td>
              <td className={l.expired ? 'font-semibold text-red-600' : ''}>{fmtDate(l.batch.expiry_date)}{l.expired && <div className="text-[11px]">Hết hạn</div>}</td><td className="text-right">{fmtNum(l.book_qty)}</td>
              <td>{edit ? <input type="number" step="any" className="input text-right" value={c.counted_qty ?? ''} onChange={(e) => setC(l.id, { counted_qty: e.target.value })} /> : <div className="text-right">{fmtNum(l.counted_qty)}</div>}</td>
              <td className={`text-right font-semibold ${v ? (v > 0 ? 'text-emerald-700' : 'text-red-600') : ''}`}>{v == null ? '' : (v > 0 ? '+' : '') + fmtNum(v)}</td>
              <td>{edit ? <select className="input" value={c.packaging_ok == null ? '' : String(c.packaging_ok)} onChange={(e) => setC(l.id, { packaging_ok: e.target.value === '' ? null : e.target.value === 'true' })}><option value="">-- Chọn --</option><option value="true">Tốt</option><option value="false">Bất thường</option></select> : l.packaging_ok == null ? '' : l.packaging_ok ? 'Tốt' : 'Bất thường'}</td>
              <td>{edit ? <div className="space-y-1">{c.packaging_ok === false && <input className="input" placeholder="Mô tả bao bì (bắt buộc)" value={c.packaging_note} onChange={(e) => setC(l.id, { packaging_note: e.target.value })} />}{!!v && <input className={`input ${!c.reason ? 'border-red-300' : ''}`} placeholder="Giải trình chênh lệch (bắt buộc)" value={c.reason} onChange={(e) => setC(l.id, { reason: e.target.value })} />}</div> : <span className="text-xs">{[l.packaging_note, l.reason].filter(Boolean).join(' | ')}</span>}</td></tr>); })}</tbody></table></div>
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-2"><HistoryTimeline history={d.history} /><AttachmentsPanel entityType="chemical_stocktake" entityId={d.id} locked={d.status === 'POSTED'} /></div>
      <ReasonDialog open={dlg === 'approve'} title="Phê duyệt kiểm kê hóa chất" label="Ý kiến" required={false} confirmText="Phê duyệt" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(c) => act.mutate({ action: 'approve', b: { comment: c } })} />
      <ReasonDialog open={dlg === 'reject'} title="Trả về kiểm đếm lại" danger confirmText="Trả về" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(r) => act.mutate({ action: 'reject', b: { reason: r } })} />
      <ReasonDialog open={dlg === 'cancel'} title="Hủy đợt kiểm kê" danger confirmText="Hủy" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(r) => act.mutate({ action: 'cancel', b: { reason: r } })} />
    </div>
  );
}

// ============================ ĐIỀU CHỈNH / TIÊU HỦY ============================
export function ChemAdjustmentList() {
  const { can } = useAuth();
  const nav = useNavigate();
  return <DocList<any> title="Điều chỉnh / tiêu hủy hóa chất" subtitle="Theo từng lô – bắt buộc lý do; tiêu hủy ghi rõ phương thức / đơn vị xử lý; người khác phê duyệt" endpoint="/chemical-adjustments" basePath="/chem-adjustments" hideDates
    statuses={['DRAFT', 'SUBMITTED', 'POSTED', 'REJECTED', 'CANCELLED']}
    actions={can('chemicals.adjust') && <button className="btn-primary" onClick={() => nav('/chem-adjustments/new')}><Plus size={15} />Lập phiếu</button>}
    columns={[{ key: 'code', header: 'Số', render: (r) => <b>{r.code}</b> }, { key: 't', header: 'Loại', render: (r) => ({ ADJUSTMENT: 'Điều chỉnh', DISPOSAL: 'Tiêu hủy', STOCKTAKE: 'Theo kiểm kê' } as Record<string, string>)[r.adj_type] }, { key: 'd', header: 'Ngày', render: (r) => fmtDate(r.doc_date) }, { key: 'r', header: 'Lý do', render: (r) => <span className="line-clamp-2 text-xs">{r.reason}</span> }, { key: 'n', header: 'Số lô', align: 'right', render: (r) => r._count.lines }, { key: 'c', header: 'Người lập', render: (r) => r.creator?.full_name }, { key: 's', header: 'Trạng thái', render: (r) => <Badge status={r.status} /> }]} />;
}

export function ChemAdjustmentForm() {
  const nav = useNavigate();
  const toast = useToast();
  const whs = useChemWarehouses();
  const [h, setH] = useState({ adj_type: 'DISPOSAL', doc_date: todayISO(), reason: '', disposal_method: '' });
  const [sel, setSel] = useState<Record<number, { qty: string; reason: string; b: any }>>({});
  const [alert, setAlert] = useState('expired');
  const { data } = useQuery({ queryKey: ['chem-batches', 'adj', alert], queryFn: () => api.page<any>('/chemical-batches', { alert, pageSize: 200 }) });
  const m = useMutation({
    mutationFn: async () => { const r = await api.post<any>('/chemical-adjustments', { ...h, warehouse_id: whs[0]?.id, lines: Object.entries(sel).map(([bid, x]) => ({ batch_id: Number(bid), qty_delta: Number(x.qty), reason: x.reason })) }); await api.post(`/chemical-adjustments/${r.id}/submit`); return r.id; },
    onSuccess: (rid) => { toast.success('Đã gửi duyệt'); nav(`/chem-adjustments/${rid}`); }, onError: toast.error,
  });
  return (
    <div>
      <PageHeader back={back('/chem-adjustments', 'Điều chỉnh / tiêu hủy')} title="Lập phiếu điều chỉnh / tiêu hủy hóa chất" />
      <div className="space-y-4">
        <Card title="Thông tin"><div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Field label="Loại phiếu"><select className="input" value={h.adj_type} onChange={(e) => setH({ ...h, adj_type: e.target.value })}><option value="DISPOSAL">Tiêu hủy</option><option value="ADJUSTMENT">Điều chỉnh (+/−)</option></select></Field>
          <Field label="Ngày"><input type="date" className="input" value={h.doc_date} onChange={(e) => setH({ ...h, doc_date: e.target.value })} /></Field>
          <Field label="Lý do" required className="md:col-span-2"><input className="input" value={h.reason} onChange={(e) => setH({ ...h, reason: e.target.value })} /></Field>
          {h.adj_type === 'DISPOSAL' && <Field label="Phương thức / đơn vị xử lý (theo SDS & quy định)" required className="md:col-span-4"><input className="input" value={h.disposal_method} onChange={(e) => setH({ ...h, disposal_method: e.target.value })} /></Field>}
        </div></Card>
        <Card title="Chọn lô" actions={<select className="input w-56" value={alert} onChange={(e) => setAlert(e.target.value)}><option value="expired">Lô đã hết hạn</option><option value="quarantine">Lô cách ly / không đạt</option><option value="abnormal">Lô bao bì bất thường</option><option value="">Tất cả lô còn tồn</option></select>}>
          <table className="table-base"><thead><tr><th></th><th>Hóa chất</th><th>Lô</th><th>HSD</th><th>KT</th><th className="text-right">Tồn</th><th className="w-28">SL {h.adj_type === 'DISPOSAL' ? 'hủy (âm)' : '(+/−)'}</th><th>Lý do dòng</th></tr></thead>
            <tbody>{data?.data.map((b: any) => { const s = sel[b.id]; return (
              <tr key={b.id}><td><input type="checkbox" checked={!!s} onChange={(e) => { const n = { ...sel }; if (e.target.checked) n[b.id] = { qty: String(-b.qty_on_hand), reason: '', b }; else delete n[b.id]; setSel(n); }} /></td>
                <td>{b.chemical.code} – {b.chemical.name}</td><td>{b.internal_code}<div className="text-xs">{b.batch_no}</div></td><td>{fmtDate(b.expiry_date)}</td><td><Badge status={b.qc_status} map={QC_STATUS} /></td><td className="text-right">{fmtNum(b.qty_on_hand)}</td>
                <td>{s && <input type="number" step="any" className="input" value={s.qty} onChange={(e) => setSel({ ...sel, [b.id]: { ...s, qty: e.target.value } })} />}</td><td>{s && <input className="input" value={s.reason} onChange={(e) => setSel({ ...sel, [b.id]: { ...s, reason: e.target.value } })} />}</td></tr>); })}</tbody></table>
        </Card>
        <div className="flex justify-end gap-2"><button className="btn-outline" onClick={() => nav(-1)}>Hủy</button><button className="btn-primary" disabled={m.isPending || !Object.keys(sel).length || h.reason.length < 5} onClick={() => m.mutate()}><Send size={15} />Lưu & gửi duyệt</button></div>
      </div>
    </div>
  );
}

export function ChemAdjustmentDetail() {
  const { id } = useParams();
  const { me, can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [dlg, setDlg] = useState('');
  const { data: a, isLoading } = useQuery({ queryKey: ['/chemical-adjustments', id], queryFn: () => api.get<any>(`/chemical-adjustments/${id}`) });
  const act = useMutation({ mutationFn: ({ action, b }: { action: string; b?: unknown }) => api.post(`/chemical-adjustments/${id}/${action}`, b ?? {}), onSuccess: () => { toast.success('Đã cập nhật'); setDlg(''); qc.invalidateQueries({ queryKey: ['/chemical-adjustments'] }); }, onError: toast.error });
  if (isLoading || !a) return <Loading />;
  return (
    <div>
      <PageHeader back={back('/chem-adjustments', 'Điều chỉnh / tiêu hủy')} title={<span className="flex items-center gap-2">{a.code} <Badge status={a.status} /></span>} subtitle={`${({ ADJUSTMENT: 'Điều chỉnh', DISPOSAL: 'Tiêu hủy', STOCKTAKE: 'Theo kiểm kê' } as Record<string, string>)[a.adj_type]} · ${a.creator?.full_name}`}
        actions={<>
          <PrintButton type="chem-adjustment" id={a.id} />
          {['DRAFT', 'REJECTED'].includes(a.status) && can('chemicals.adjust') && <button className="btn-primary" onClick={() => act.mutate({ action: 'submit' })}><Send size={15} />Gửi duyệt</button>}
          {a.status === 'SUBMITTED' && !a.stocktake_id && can('chemicals.approve_adjust') && a.created_by !== me?.id && <><button className="btn-danger" onClick={() => setDlg('reject')}>Từ chối</button><button className="btn-success" onClick={() => setDlg('approve')}><CheckCircle2 size={15} />Phê duyệt & ghi sổ</button></>}
          {['DRAFT', 'SUBMITTED', 'REJECTED'].includes(a.status) && !a.stocktake_id && can('chemicals.adjust') && <button className="btn-ghost text-red-600" onClick={() => setDlg('cancel')}>Hủy</button>}
        </>} />
      {a.stocktake_id && <div className="mb-3"><Alert type="info">Phiếu lập từ kiểm kê – phê duyệt tại màn hình <Link className="underline" to={`/chem-stocktakes/${a.stocktake_id}`}>Kiểm kê hóa chất</Link>.</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Thông tin" className="lg:col-span-2"><dl className="grid grid-cols-2 gap-2 text-sm">{[['Ngày', fmtDate(a.doc_date)], ['Lý do', a.reason], ['Phương thức xử lý', a.disposal_method], ['Người duyệt', a.approver?.full_name], ['Ghi sổ', fmtDateTime(a.posted_at)]].map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium">{v || '–'}</dd></div>)}</dl></Card>
        <HistoryTimeline history={a.history} />
        <Card title="Chi tiết theo lô" className="lg:col-span-3"><table className="table-base"><thead><tr><th>Hóa chất</th><th>Lô</th><th>Vị trí</th><th className="text-right">SL (+/−)</th><th>Lý do</th></tr></thead>
          <tbody>{a.lines.map((l: any) => <tr key={l.id}><td>{l.batch?.chemical.code} – {l.batch?.chemical.name}</td><td>{l.batch?.internal_code} / {l.batch?.batch_no}</td><td>{l.batch?.location.code}</td><td className={`text-right font-semibold ${l.qty_delta > 0 ? 'text-emerald-700' : 'text-red-600'}`}>{l.qty_delta > 0 ? '+' : ''}{fmtNum(l.qty_delta)} {l.batch?.chemical.unit.code}</td><td className="text-xs">{l.reason}</td></tr>)}</tbody></table></Card>
        <div className="lg:col-span-3"><AttachmentsPanel entityType="chemical_adjustment" entityId={a.id} locked={a.status === 'POSTED'} /></div>
      </div>
      <ReasonDialog open={dlg === 'approve'} title="Phê duyệt & ghi sổ" label="Ý kiến" required={false} confirmText="Phê duyệt" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(c) => act.mutate({ action: 'approve', b: { comment: c } })} />
      <ReasonDialog open={dlg === 'reject'} title="Từ chối" danger confirmText="Từ chối" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(r) => act.mutate({ action: 'reject', b: { reason: r } })} />
      <ReasonDialog open={dlg === 'cancel'} title="Hủy phiếu" danger confirmText="Hủy" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(r) => act.mutate({ action: 'cancel', b: { reason: r } })} />
    </div>
  );
}

export { STATUS };
