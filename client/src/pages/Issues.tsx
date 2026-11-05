/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Send, CheckCircle2, XCircle, Ban, Pencil, ArrowLeft, PackageCheck, PenLine } from 'lucide-react';
import { api, newRequestId } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLookup } from '@/lib/hooks';
import { fmtDate, fmtDateTime, fmtNum, todayISO, toISODate } from '@/lib/format';
import { Alert, Badge, Card, Field, Loading, Modal, PageHeader, ReasonDialog, Spinner, useToast } from '@/components/ui';
import { AttachmentsPanel, HistoryTimeline, ItemPicker, LookupSelect, PrintButton, type PickedItem } from '@/components/shared';
import { DocList } from '@/components/DocList';

interface Line { key: string; item: PickedItem | null; qty_requested: string; note: string }
const emptyLine = (): Line => ({ key: newRequestId(), item: null, qty_requested: '', note: '' });

export function IssueList() {
  const { can } = useAuth();
  const nav = useNavigate();
  return (
    <DocList<any> title="Xuất kho / Yêu cầu cấp vật tư" subtitle="Bộ phận lập yêu cầu → quản lý duyệt (giữ chỗ tồn) → kho xuất (ghi sổ) → người nhận xác nhận"
      endpoint="/issues" basePath="/issues" statuses={['DRAFT', 'SUBMITTED', 'APPROVED', 'ISSUED', 'RECEIVED', 'REJECTED', 'CANCELLED']}
      actions={can('issues.create') && <button className="btn-primary" onClick={() => nav('/issues/new')}><Plus size={15} />Lập yêu cầu cấp vật tư</button>}
      columns={[
        { key: 'code', header: 'Số phiếu', render: (r) => <b className="text-navy-800">{r.code}</b> },
        { key: 'doc_date', header: 'Ngày CT', render: (r) => fmtDate(r.doc_date) },
        { key: 'dept', header: 'Bộ phận', render: (r) => r.department.name },
        { key: 'purpose', header: 'Mục đích', render: (r) => <span className="line-clamp-2">{r.purpose}</span> },
        { key: 'req', header: 'Người yêu cầu', render: (r) => r.requester.full_name },
        { key: 'lines', header: 'Số dòng', align: 'right', render: (r) => r._count.lines },
        { key: 'status', header: 'Trạng thái', render: (r) => <span className="flex items-center gap-1"><Badge status={r.status} />{r.quota_warning && <span title="Vượt định mức" className="text-amber-600">⚠</span>}</span> },
      ]} />
  );
}

export function IssueForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { me, can } = useAuth();
  const [reqId] = useState(newRequestId);
  const { data: whs } = useLookup('/warehouses');
  const generalWhs = whs?.filter((w) => w.type === 'GENERAL');
  const [h, setH] = useState({ warehouse_id: null as number | null, doc_date: todayISO(), department_id: me?.department?.id ?? null as number | null, purpose: '', work_area: '', receiver_name: '', quota_note: '', note: '' });
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const existing = useQuery({ queryKey: ['/issues', id], enabled: !!id, queryFn: () => api.get<any>(`/issues/${id}`) });
  useEffect(() => { if (!h.warehouse_id && generalWhs?.length) setH((x) => ({ ...x, warehouse_id: generalWhs[0].id })); }, [generalWhs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const d = existing.data;
    if (!d) return;
    setH({ warehouse_id: d.warehouse_id, doc_date: toISODate(d.doc_date), department_id: d.department_id, purpose: d.purpose, work_area: d.work_area ?? '', receiver_name: d.receiver_name ?? '', quota_note: d.quota_note ?? '', note: d.note ?? '' });
    setLines(d.lines.map((l: any) => ({ key: String(l.id), item: { ...l.item, available: l.available }, qty_requested: String(l.qty_requested), note: l.note ?? '' })));
  }, [existing.data]);
  const upd = (k: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l)));
  const overQuota = lines.filter((l) => l.item?.max_issue_qty && Number(l.qty_requested) > Number(l.item.max_issue_qty));
  const save = useMutation({
    mutationFn: async (andSubmit: boolean) => {
      const body = { ...h, client_request_id: id ? undefined : reqId, lines: lines.filter((l) => l.item).map((l) => ({ item_id: l.item!.id, qty_requested: l.qty_requested, note: l.note })) };
      const r = id ? await api.put<{ id: number }>(`/issues/${id}`, body) : await api.post<{ id: number }>('/issues', body);
      const docId = id ? Number(id) : r.id;
      if (andSubmit) await api.post(`/issues/${docId}/submit`);
      return docId;
    },
    onSuccess: (docId, s) => { toast.success(s ? 'Đã gửi yêu cầu chờ duyệt' : 'Đã lưu nháp'); qc.invalidateQueries({ queryKey: ['/issues'] }); nav(`/issues/${docId}`); },
    onError: (e) => { toast.error(e); qc.invalidateQueries({ queryKey: ['/issues'] }); },
  });
  if (id && existing.isLoading) return <Loading />;
  return (
    <div>
      <PageHeader back={<Link to="/issues" className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500"><ArrowLeft size={12} />Xuất kho</Link>} title={id ? `Sửa yêu cầu ${existing.data?.code}` : 'Lập yêu cầu cấp vật tư'} subtitle="Ghi rõ mục đích sử dụng và khu vực/công trình. Số lượng khả dụng chỉ mang tính tham khảo tại thời điểm lập." />
      <div className="space-y-4">
        <Card title="Thông tin yêu cầu">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field label="Kho xuất" required><select className="input" value={h.warehouse_id ?? ''} onChange={(e) => setH({ ...h, warehouse_id: Number(e.target.value) })}>{generalWhs?.map((w) => <option key={w.id} value={w.id}>{w.code} – {w.name}</option>)}</select></Field>
            <Field label="Ngày chứng từ" required><input type="date" className="input" value={h.doc_date} onChange={(e) => setH({ ...h, doc_date: e.target.value })} /></Field>
            <Field label="Bộ phận nhận" required hint={!can('issues.view_all') ? 'Chỉ được lập cho bộ phận của bạn' : undefined}>
              <LookupSelect path="/departments" value={h.department_id} disabled={!can('issues.view_all')} onChange={(v) => setH({ ...h, department_id: v })} />
            </Field>
            <Field label="Người nhận dự kiến"><input className="input" value={h.receiver_name} onChange={(e) => setH({ ...h, receiver_name: e.target.value })} /></Field>
            <Field label="Mục đích sử dụng" required className="md:col-span-2"><input className="input" value={h.purpose} onChange={(e) => setH({ ...h, purpose: e.target.value })} placeholder="VD: Thay lọc dầu máy xúc CAT 336 số 02 theo kế hoạch bảo dưỡng" /></Field>
            <Field label="Công trình / khu vực sử dụng" className="md:col-span-2"><input className="input" value={h.work_area} onChange={(e) => setH({ ...h, work_area: e.target.value })} /></Field>
            <Field label="Ghi chú" className="md:col-span-4"><input className="input" value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} /></Field>
          </div>
        </Card>
        <Card title="Vật tư yêu cầu" actions={<button className="btn-outline btn-sm" onClick={() => setLines([...lines, emptyLine()])}><Plus size={14} />Thêm dòng</button>}>
          <table className="table-base">
            <thead><tr><th className="w-8">#</th><th>Vật tư</th><th className="w-28 text-right">Khả dụng</th><th className="w-28 text-right">Định mức/phiếu</th><th className="w-32 text-right">SL yêu cầu</th><th>Ghi chú</th><th></th></tr></thead>
            <tbody>{lines.map((l, i) => {
              const over = l.item?.max_issue_qty && Number(l.qty_requested) > Number(l.item.max_issue_qty);
              return (
                <tr key={l.key}>
                  <td>{i + 1}</td>
                  <td><ItemPicker value={l.item} warehouseId={h.warehouse_id} onPick={(it) => upd(l.key, { item: it })} /></td>
                  <td className="pt-3 text-right">{l.item ? <span className={Number(l.item.available) > 0 ? 'text-emerald-700' : 'text-red-600'}>{fmtNum(l.item.available)} {l.item.unit.code}</span> : ''}</td>
                  <td className="pt-3 text-right">{fmtNum(l.item?.max_issue_qty)}</td>
                  <td><input type="number" step="any" min={0} className={`input text-right ${over ? 'border-amber-400 bg-amber-50' : ''}`} value={l.qty_requested} onChange={(e) => upd(l.key, { qty_requested: e.target.value })} /></td>
                  <td><input className="input" value={l.note} onChange={(e) => upd(l.key, { note: e.target.value })} /></td>
                  <td><button className="btn-ghost btn-sm text-red-600" onClick={() => setLines(lines.length > 1 ? lines.filter((x) => x.key !== l.key) : [emptyLine()])}><Trash2 size={14} /></button></td>
                </tr>);
            })}</tbody>
          </table>
          {overQuota.length > 0 && (
            <div className="mt-3"><Alert type="warning">
              <b>Vượt định mức cấp phát:</b> {overQuota.map((l) => l.item!.code).join(', ')}. Bắt buộc ghi lý do.
              <input className="input mt-2" placeholder="Lý do vượt định mức" value={h.quota_note} onChange={(e) => setH({ ...h, quota_note: e.target.value })} />
            </Alert></div>
          )}
        </Card>
        <div className="flex justify-end gap-2">
          <button className="btn-outline" onClick={() => nav(-1)}>Hủy</button>
          <button className="btn-outline" disabled={save.isPending} onClick={() => save.mutate(false)}>{save.isPending && <Spinner className="h-4 w-4" />}Lưu nháp</button>
          <button className="btn-primary" disabled={save.isPending || !h.purpose} onClick={() => save.mutate(true)}><Send size={15} />Lưu & gửi duyệt</button>
        </div>
      </div>
    </div>
  );
}

function ApproveModal({ d, onClose }: { d: any; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [qty, setQty] = useState<Record<number, string>>(() => Object.fromEntries(d.lines.map((l: any) => [l.id, String(Math.min(l.qty_requested, Math.max(0, l.available)))])));
  const [comment, setComment] = useState('');
  const m = useMutation({
    mutationFn: () => api.post(`/issues/${d.id}/approve`, { comment, lines: d.lines.map((l: any) => ({ id: l.id, qty_approved: qty[l.id] || 0 })) }),
    onSuccess: () => { toast.success('Đã phê duyệt – số lượng được giữ chỗ chờ xuất kho'); qc.invalidateQueries({ queryKey: ['/issues'] }); onClose(); }, onError: toast.error,
  });
  return (
    <Modal open onClose={onClose} title={`Phê duyệt yêu cầu ${d.code}`} size="lg"
      footer={<><button className="btn-outline" onClick={onClose}>Đóng</button><button className="btn-success" disabled={m.isPending} onClick={() => m.mutate()}><CheckCircle2 size={15} />Phê duyệt</button></>}>
      {d.quota_warning && <div className="mb-3"><Alert type="warning"><b>Vượt định mức:</b> {d.quota_note}</Alert></div>}
      <table className="table-base">
        <thead><tr><th>Vật tư</th><th className="text-right">Yêu cầu</th><th className="text-right">Khả dụng</th><th className="w-32 text-right">SL duyệt</th></tr></thead>
        <tbody>{d.lines.map((l: any) => (
          <tr key={l.id}><td><b>{l.item.code}</b> – {l.item.name}</td><td className="text-right">{fmtNum(l.qty_requested)} {l.item.unit.code}</td>
            <td className={`text-right ${l.available < l.qty_requested ? 'text-red-600' : 'text-emerald-700'}`}>{fmtNum(l.available)}</td>
            <td><input type="number" step="any" min={0} max={l.qty_requested} className="input text-right" value={qty[l.id]} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} /></td></tr>
        ))}</tbody>
      </table>
      <Field label="Ý kiến phê duyệt" className="mt-3"><input className="input" value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
      <p className="mt-2 text-xs text-slate-500">SL duyệt không vượt SL yêu cầu và tồn khả dụng (đã trừ giữ chỗ của các phiếu khác). Tồn kho chỉ giảm khi kho thực xuất.</p>
    </Modal>
  );
}

function IssueModal({ d, onClose }: { d: any; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [receiver, setReceiver] = useState(d.receiver_name ?? d.requester.full_name);
  const [receiverUser, setReceiverUser] = useState<number | null>(d.requester.id);
  const [alloc, setAlloc] = useState<Record<number, { location_id: number; qty: string }[]>>({});
  const { data: users } = useQuery({ queryKey: ['users-lookup', d.department_id], queryFn: () => api.get<any[]>('/users/lookup', { department_id: d.department_id }) });
  const locs = useQuery({
    queryKey: ['issue-locs', d.id],
    queryFn: async () => Object.fromEntries(await Promise.all(d.lines.map(async (l: any) => [l.id, (await api.get<any>('/stock/locations', { item_id: l.item_id, warehouse_id: d.warehouse_id })).locations]))),
  });
  useEffect(() => {
    if (!locs.data) return;
    // Gợi ý phân bổ: vị trí mặc định trước, rồi vị trí còn nhiều hàng
    const init: Record<number, { location_id: number; qty: string }[]> = {};
    for (const l of d.lines) {
      let need = Number(l.qty_approved ?? 0);
      const list = [...(locs.data[l.id] ?? [])].filter((x: any) => x.qty_usable > 0).sort((a: any, b: any) => (a.location_id === l.item.default_location_id ? -1 : b.location_id === l.item.default_location_id ? 1 : b.qty_usable - a.qty_usable));
      init[l.id] = [];
      for (const x of list) { if (need <= 0) break; const q = Math.min(need, x.qty_usable); init[l.id].push({ location_id: x.location_id, qty: String(q) }); need -= q; }
    }
    setAlloc(init);
  }, [locs.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = useMutation({
    mutationFn: () => api.post(`/issues/${d.id}/issue`, { receiver_name: receiver, receiver_user_id: receiverUser, lines: d.lines.map((l: any) => ({ id: l.id, allocations: (alloc[l.id] ?? []).filter((a) => Number(a.qty) > 0) })) }),
    onSuccess: () => { toast.success('Đã xuất kho và ghi sổ – chờ người nhận xác nhận'); qc.invalidateQueries({ queryKey: ['/issues'] }); onClose(); }, onError: toast.error,
  });
  return (
    <Modal open onClose={onClose} title={`Xuất kho phiếu ${d.code}`} size="lg"
      footer={<><button className="btn-outline" onClick={onClose}>Đóng</button><button className="btn-success" disabled={m.isPending || !receiver} onClick={() => m.mutate()}><PackageCheck size={15} />Xác nhận xuất kho</button></>}>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Field label="Tài khoản người nhận (để xác nhận điện tử)"><select className="input" value={receiverUser ?? ''} onChange={(e) => { const u = users?.find((x) => x.id === Number(e.target.value)); setReceiverUser(u?.id ?? null); if (u) setReceiver(u.full_name); }}><option value="">-- Không có tài khoản --</option>{users?.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></Field>
        <Field label="Họ tên người nhận" required><input className="input" value={receiver} onChange={(e) => setReceiver(e.target.value)} /></Field>
      </div>
      {locs.isLoading ? <Loading /> : d.lines.map((l: any) => {
        const sum = (alloc[l.id] ?? []).reduce((s, a) => s + Number(a.qty || 0), 0);
        return (
          <div key={l.id} className="mb-3 rounded-md border p-3">
            <div className="mb-2 flex justify-between text-sm"><span><b>{l.item.code}</b> – {l.item.name}</span><span>Được duyệt: <b>{fmtNum(l.qty_approved)}</b> {l.item.unit.code} · Thực xuất: <b className={sum > l.qty_approved ? 'text-red-600' : ''}>{fmtNum(sum)}</b></span></div>
            <table className="table-base"><thead><tr><th>Vị trí</th><th className="text-right">Tồn khả dụng tại vị trí</th><th className="w-32 text-right">SL lấy</th></tr></thead>
              <tbody>{(locs.data?.[l.id] ?? []).filter((x: any) => x.qty_usable > 0).map((x: any) => {
                const cur = alloc[l.id]?.find((a) => a.location_id === x.location_id);
                return <tr key={x.location_id}><td>{x.code} – {x.name}</td><td className="text-right">{fmtNum(x.qty_usable)}</td>
                  <td><input type="number" step="any" min={0} max={x.qty_usable} className="input text-right" value={cur?.qty ?? ''} onChange={(e) => setAlloc({ ...alloc, [l.id]: [...(alloc[l.id] ?? []).filter((a) => a.location_id !== x.location_id), { location_id: x.location_id, qty: e.target.value }] })} /></td></tr>;
              })}</tbody></table>
            {(locs.data?.[l.id] ?? []).every((x: any) => x.qty_usable <= 0) && <div className="text-sm text-red-600">Không còn tồn khả dụng tại vị trí nào.</div>}
          </div>);
      })}
      <p className="text-xs text-slate-500">Có thể xuất ít hơn SL duyệt; phần còn lại tự giải phóng giữ chỗ. Hệ thống chặn xuất vượt tồn tại vị trí.</p>
    </Modal>
  );
}

export function IssueDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { me, can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [dlg, setDlg] = useState<'' | 'reject' | 'cancel' | 'approve' | 'issue' | 'confirm'>('');
  const [sig, setSig] = useState('');
  const { data: d, isLoading } = useQuery({ queryKey: ['/issues', id], queryFn: () => api.get<any>(`/issues/${id}`) });
  const act = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: unknown }) => api.post(`/issues/${id}/${action}`, body ?? {}),
    onSuccess: (_r, v) => { toast.success({ submit: 'Đã gửi duyệt', reject: 'Đã từ chối', cancel: 'Đã hủy phiếu', confirm: 'Đã xác nhận nhận vật tư' }[v.action] ?? 'Thành công'); setDlg(''); qc.invalidateQueries({ queryKey: ['/issues'] }); },
    onError: (e) => { toast.error(e); qc.invalidateQueries({ queryKey: ['/issues'] }); },
  });
  if (isLoading || !d) return <Loading />;
  const mine = d.created_by === me?.id;
  const isRequester = d.requester_id === me?.id;
  const canConfirm = d.status === 'ISSUED' && can('issues.confirm', 'issues.issue') && d.issued_by !== me?.id && (isRequester || d.receiver_user_id === me?.id || me?.department?.id === d.department_id);
  return (
    <div>
      <PageHeader back={<Link to="/issues" className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500"><ArrowLeft size={12} />Xuất kho</Link>}
        title={<span className="flex items-center gap-2">Phiếu {d.code} <Badge status={d.status} /></span>}
        subtitle={`${d.department.name} · Người yêu cầu: ${d.requester.full_name} · ${fmtDateTime(d.created_at)}`}
        actions={<>
          <PrintButton type="issue" id={d.id} />
          {['DRAFT', 'REJECTED'].includes(d.status) && mine && <button className="btn-outline" onClick={() => nav(`/issues/${d.id}/edit`)}><Pencil size={15} />Sửa</button>}
          {['DRAFT', 'REJECTED'].includes(d.status) && mine && <button className="btn-primary" onClick={() => act.mutate({ action: 'submit' })}><Send size={15} />Gửi duyệt</button>}
          {d.status === 'SUBMITTED' && can('issues.approve') && !mine && !isRequester && <>
            <button className="btn-danger" onClick={() => setDlg('reject')}><XCircle size={15} />Từ chối</button>
            <button className="btn-success" onClick={() => setDlg('approve')}><CheckCircle2 size={15} />Phê duyệt</button>
          </>}
          {d.status === 'APPROVED' && can('issues.issue') && <button className="btn-gold" onClick={() => setDlg('issue')}><PackageCheck size={15} />Xuất kho</button>}
          {canConfirm && <button className="btn-success" onClick={() => { setSig(''); setDlg('confirm'); }}><PenLine size={15} />Xác nhận đã nhận</button>}
          {['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'].includes(d.status) && (can('issues.cancel') || (mine && d.status !== 'APPROVED')) && <button className="btn-ghost text-red-600" onClick={() => setDlg('cancel')}><Ban size={15} />Hủy</button>}
        </>} />
      {d.status === 'REJECTED' && <div className="mb-3"><Alert type="danger"><b>Lý do từ chối:</b> {d.reject_reason}</Alert></div>}
      {d.status === 'CANCELLED' && <div className="mb-3"><Alert type="warning"><b>Đã hủy:</b> {d.cancel_reason}</Alert></div>}
      {d.quota_warning && <div className="mb-3"><Alert type="warning"><b>Yêu cầu vượt định mức.</b> Lý do: {d.quota_note}</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Thông tin phiếu" className="lg:col-span-2">
          <dl className="grid grid-cols-1 gap-2 text-sm md:grid-cols-3">
            {[['Kho', d.warehouse.name], ['Ngày chứng từ', fmtDate(d.doc_date)], ['Ngày xuất thực tế', fmtDateTime(d.issued_at)], ['Bộ phận nhận', d.department.name], ['Mục đích', d.purpose], ['Khu vực / công trình', d.work_area], ['Người yêu cầu', d.requester.full_name], ['Người phê duyệt', d.approver ? `${d.approver.full_name} (${fmtDateTime(d.approved_at)})` : ''], ['Người xuất kho', d.issuer?.full_name], ['Người nhận', d.receiver_name], ['Xác nhận điện tử', d.receive_confirmed_at ? `“${d.receive_signature}” lúc ${fmtDateTime(d.receive_confirmed_at)}` : ''], ['Ghi chú', d.note]].map(([k, v]) => <div key={k as string}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium">{v || '–'}</dd></div>)}
          </dl>
        </Card>
        <HistoryTimeline history={d.history} />
        <Card title="Chi tiết vật tư" className="lg:col-span-3">
          <table className="table-base">
            <thead><tr><th>#</th><th>Mã</th><th>Tên vật tư</th><th>ĐVT</th><th className="text-right">SL yêu cầu</th><th className="text-right">SL duyệt</th><th className="text-right">SL thực xuất</th><th>Vị trí</th>{['SUBMITTED', 'APPROVED'].includes(d.status) && <th className="text-right">Khả dụng hiện tại</th>}<th>Ghi chú</th></tr></thead>
            <tbody>{d.lines.map((l: any) => (
              <tr key={l.id}><td>{l.line_no}</td><td><Link className="text-navy-700 hover:underline" to={`/items/${l.item.id}`}>{l.item.code}</Link></td><td>{l.item.name}</td><td>{l.item.unit.code}</td>
                <td className="text-right">{fmtNum(l.qty_requested)}</td><td className="text-right">{fmtNum(l.qty_approved)}</td><td className="text-right font-semibold">{fmtNum(l.qty_issued)}</td><td>{l.location?.code}</td>
                {['SUBMITTED', 'APPROVED'].includes(d.status) && <td className={`text-right ${l.available < (l.qty_approved ?? l.qty_requested) ? 'text-red-600' : 'text-emerald-700'}`}>{fmtNum(l.available)}</td>}<td className="text-xs">{l.note}</td></tr>
            ))}</tbody>
          </table>
        </Card>
        <div className="lg:col-span-3"><AttachmentsPanel entityType="stock_issue" entityId={d.id} locked={['ISSUED', 'RECEIVED'].includes(d.status)} /></div>
      </div>
      {dlg === 'approve' && <ApproveModal d={d} onClose={() => setDlg('')} />}
      {dlg === 'issue' && <IssueModal d={d} onClose={() => setDlg('')} />}
      <ReasonDialog open={dlg === 'reject'} title="Từ chối yêu cầu" danger confirmText="Từ chối" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(reason) => act.mutate({ action: 'reject', body: { reason } })} />
      <ReasonDialog open={dlg === 'cancel'} title="Hủy phiếu" message="Hủy phiếu đã duyệt sẽ giải phóng số lượng giữ chỗ." danger confirmText="Hủy phiếu" loading={act.isPending} onClose={() => setDlg('')} onConfirm={(reason) => act.mutate({ action: 'cancel', body: { reason } })} />
      <Modal open={dlg === 'confirm'} onClose={() => setDlg('')} title="Xác nhận điện tử đã nhận vật tư" size="sm"
        footer={<><button className="btn-outline" onClick={() => setDlg('')}>Đóng</button><button className="btn-success" disabled={act.isPending || sig.length < 2} onClick={() => act.mutate({ action: 'confirm', body: { signature: sig } })}>Xác nhận</button></>}>
        <p className="mb-3 text-sm">Tôi xác nhận đã nhận đủ vật tư theo số lượng thực xuất của phiếu <b>{d.code}</b>. Gõ lại chính xác họ tên của bạn (<b>{me?.full_name}</b>) để ký xác nhận.</p>
        <input className="input" value={sig} onChange={(e) => setSig(e.target.value)} placeholder="Họ và tên" autoFocus />
      </Modal>
    </div>
  );
}
