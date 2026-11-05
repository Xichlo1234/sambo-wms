/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Lock, Unlock, ArrowLeft, ShieldCheck, Upload, Eye, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounce, useLookup } from '@/lib/hooks';
import { fmtDate, fmtDateTime, fmtNum } from '@/lib/format';
import { GHS, QC_STATUS, SDS_STATE, DOC_LINK } from '@/lib/constants';
import { Alert, Badge, Card, DataTable, Field, Loading, Modal, PageHeader, Pagination, SearchInput, Spinner, useToast, ReasonDialog } from '@/components/ui';
import { AttachmentsPanel, GhsIcons, LookupSelect, ExportButtons, HistoryTimeline } from '@/components/shared';

const STATE: Record<string, string> = { SOLID: 'Rắn', LIQUID: 'Lỏng', GAS: 'Khí', OTHER: 'Khác' };
const DOC_TYPE: Record<string, string> = { SDS: 'SDS/MSDS', TECH: 'Tài liệu kỹ thuật', COA: 'Giấy chứng nhận chất lượng (COA)', PACKAGING: 'Hình ảnh bao bì / nhãn', INCIDENT_GUIDE: 'Hướng dẫn xử lý sự cố' };

// ======================= FORM HÓA CHẤT =======================
const empty = { code: '', name: '', trade_name: '', name_en: '', scientific_name: '', cas_number: '', formula: '', concentration: '', chemical_group: '', manufacturer: '', supplier_id: null, unit_id: null, packaging: '', physical_state: 'OTHER', hazard_level: '', ghs_classification: '', ghs_pictograms: [] as string[], hazard_statements: '', precautionary_statements: '', storage_conditions: '', storage_temp_min: '', storage_temp_max: '', ventilation_req: '', fire_req: '', ppe_req: '', first_aid: '', spill_response: '', default_shelf_life_days: '', is_controlled: false, min_stock: 0, safety_notes: '', note: '' };

function ChemicalForm({ chem, onClose }: { chem?: any; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState<any>(chem ? Object.fromEntries(Object.keys(empty).map((k) => [k, chem[k] ?? (empty as any)[k]])) : { ...empty });
  const [dup, setDup] = useState<string | null>(null);
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });
  const save = useMutation({
    mutationFn: (confirm: boolean) => (chem ? api.put<any>(`/chemicals/${chem.id}`, f) : api.post<any>('/chemicals', { ...f, confirm_duplicate_cas: confirm })),
    onSuccess: (r: any) => { toast.success(r?.safety_reverify_required ? 'Đã lưu. Thông tin an toàn đã thay đổi – cần HSE xác nhận lại theo SDS.' : 'Đã lưu hóa chất'); qc.invalidateQueries({ queryKey: ['chemicals'] }); qc.invalidateQueries({ queryKey: ['chem-detail'] }); onClose(); },
    onError: (e) => { if (e instanceof ApiError && e.code === 'SIMILAR_ITEMS') setDup(e.message); else toast.error(e); },
  });
  const T = (k: string, label: string, opts: { req?: boolean; span?: string; area?: boolean; hint?: string } = {}) => (
    <Field label={label} required={opts.req} className={opts.span} hint={opts.hint}>
      {opts.area ? <textarea className="input" rows={2} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} /> : <input className="input" value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} />}
    </Field>
  );
  return (
    <Modal open onClose={onClose} title={chem ? `Sửa hóa chất ${chem.code}` : 'Thêm hóa chất'} size="xl"
      footer={<><button className="btn-outline" onClick={onClose}>Hủy</button><button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(false)}>{save.isPending && <Spinner className="h-4 w-4 text-white" />}Lưu</button></>}>
      {dup && <div className="mb-3"><Alert type="warning">{dup}<button className="btn-gold btn-sm ml-2" onClick={() => save.mutate(true)}>Là sản phẩm khác – vẫn lưu</button></Alert></div>}
      <div className="mb-2 text-sm font-semibold text-navy-800">1. Thông tin định danh</div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {T('code', 'Mã hóa chất', { req: true })}{T('name', 'Tên hóa chất', { req: true, span: 'md:col-span-2' })}{T('trade_name', 'Tên thương mại')}
        {T('name_en', 'Tên tiếng Anh')}{T('scientific_name', 'Tên khoa học')}{T('cas_number', 'CAS Number', { hint: 'Dạng 7647-01-0' })}{T('formula', 'Công thức hóa học')}
        {T('concentration', 'Nồng độ')}{T('chemical_group', 'Nhóm hóa chất')}{T('manufacturer', 'Nhà sản xuất')}
        <Field label="Nhà cung cấp"><LookupSelect path="/suppliers" value={f.supplier_id} onChange={(v) => set('supplier_id', v)} /></Field>
        <Field label="Đơn vị tính" required><LookupSelect path="/units" value={f.unit_id} onChange={(v) => set('unit_id', v)} /></Field>
        {T('packaging', 'Quy cách đóng gói')}
        <Field label="Trạng thái vật lý"><select className="input" value={f.physical_state} onChange={(e) => set('physical_state', e.target.value)}>{Object.entries(STATE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Hạn sử dụng mặc định (ngày)" hint="Gợi ý khi nhập lô"><input type="number" className="input" value={f.default_shelf_life_days ?? ''} onChange={(e) => set('default_shelf_life_days', e.target.value)} /></Field>
        <Field label="Tồn tối thiểu (cảnh báo / đề nghị mua)"><input type="number" step="any" className="input" value={f.min_stock} onChange={(e) => set('min_stock', e.target.value)} /></Field>
        <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={f.is_controlled} onChange={(e) => set('is_controlled', e.target.checked)} /><b className="text-red-700">Hóa chất kiểm soát đặc biệt</b> (xuất cần HSE xác nhận)</label>
      </div>
      <div className="mb-2 mt-4 text-sm font-semibold text-navy-800">2. Thông tin an toàn – nhập đúng theo SDS/MSDS (hệ thống không tự suy diễn)</div>
      <Alert type="info">Mọi thay đổi ở nhóm thông tin này sẽ hủy trạng thái "đã xác nhận" và cần người có chuyên môn (HSE) xác nhận lại.</Alert>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
        {T('hazard_level', 'Mức độ nguy hiểm (theo SDS)')}{T('ghs_classification', 'Phân loại GHS', { span: 'md:col-span-3' })}
        <Field label="Biểu tượng cảnh báo GHS" className="md:col-span-4">
          <div className="flex flex-wrap gap-3">{Object.entries(GHS).map(([k, v]) => <label key={k} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.ghs_pictograms.includes(k)} onChange={(e) => set('ghs_pictograms', e.target.checked ? [...f.ghs_pictograms, k] : f.ghs_pictograms.filter((x: string) => x !== k))} /><GhsIcons codes={[k]} /> {v}</label>)}</div>
        </Field>
        {T('hazard_statements', 'Câu cảnh báo (H)', { area: true, span: 'md:col-span-2' })}{T('precautionary_statements', 'Câu phòng ngừa (P)', { area: true, span: 'md:col-span-2' })}
        {T('storage_conditions', 'Điều kiện bảo quản', { area: true, span: 'md:col-span-2' })}
        <Field label="Nhiệt độ bảo quản tối thiểu (°C)"><input type="number" step="any" className="input" value={f.storage_temp_min ?? ''} onChange={(e) => set('storage_temp_min', e.target.value)} /></Field>
        <Field label="Nhiệt độ bảo quản tối đa (°C)"><input type="number" step="any" className="input" value={f.storage_temp_max ?? ''} onChange={(e) => set('storage_temp_max', e.target.value)} /></Field>
        {T('ventilation_req', 'Yêu cầu thông gió', { area: true })}{T('fire_req', 'Yêu cầu phòng cháy', { area: true })}{T('ppe_req', 'Yêu cầu bảo hộ cá nhân', { area: true })}{T('first_aid', 'Sơ cứu (theo SDS mục 4)', { area: true })}
        {T('spill_response', 'Xử lý tràn đổ / sự cố (theo SDS mục 6)', { area: true, span: 'md:col-span-2' })}{T('safety_notes', 'Ghi chú an toàn', { area: true, span: 'md:col-span-2' })}
      </div>
    </Modal>
  );
}

// ======================= DANH SÁCH HÓA CHẤT =======================
export function ChemicalList() {
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [controlled, setControlled] = useState(false);
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<any>(undefined);
  const dq = useDebounce(q);
  useEffect(() => setPage(1), [dq, status, controlled]);
  const params = { q: dq, status, controlled: controlled ? 1 : undefined, page };
  const { data, isLoading } = useQuery({ queryKey: ['chemicals', params], queryFn: () => api.page<any>('/chemicals', params), placeholderData: (p) => p });
  const lock = useMutation({ mutationFn: (c: any) => api.patch(`/chemicals/${c.id}/status`, { status: c.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['chemicals'] }), onError: toast.error });
  return (
    <div>
      <PageHeader title="Danh mục hóa chất" subtitle="Hồ sơ riêng cho từng hóa chất: định danh, GHS, điều kiện bảo quản, bảo hộ, SDS/MSDS – quản lý tách biệt với kho vật tư"
        actions={<>{can('chemicals.manage') && <button className="btn-outline" onClick={() => nav('/import?type=chemicals')}><Upload size={15} />Import Excel</button>}{can('chemicals.manage') && <button className="btn-primary" onClick={() => setEdit(null)}><Plus size={15} />Thêm hóa chất</button>}</>} />
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <SearchInput value={q} onChange={setQ} placeholder="Mã, tên (không dấu), CAS..." />
          <select className="input w-40" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Tất cả</option><option value="ACTIVE">Đang dùng</option><option value="INACTIVE">Đã khóa</option></select>
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={controlled} onChange={(e) => setControlled(e.target.checked)} />Chỉ hóa chất kiểm soát đặc biệt</label>
        </div>
        <DataTable loading={isLoading} rows={data?.data} onRowClick={(r) => nav(`/chemicals/${r.id}`)} columns={[
          { key: 'code', header: 'Mã', render: (r: any) => <b className="text-navy-800">{r.code}</b> },
          { key: 'name', header: 'Tên hóa chất', render: (r: any) => <div>{r.name}{r.is_controlled && <span className="ml-1 rounded bg-red-100 px-1 text-[10px] text-red-700">Kiểm soát ĐB</span>}<div className="text-xs text-slate-500">{[r.trade_name, r.concentration].filter(Boolean).join(' · ')}</div></div> },
          { key: 'cas', header: 'CAS', render: (r: any) => r.cas_number },
          { key: 'ghs', header: 'GHS', render: (r: any) => <GhsIcons codes={r.ghs_pictograms} /> },
          { key: 'unit', header: 'ĐVT', render: (r: any) => r.unit.code },
          { key: 'sds', header: 'SDS/MSDS', render: (r: any) => <Badge status={r.sds_state} map={SDS_STATE} /> },
          { key: 'verified', header: 'TT an toàn', render: (r: any) => r.safety_verified_at ? <span className="text-xs text-emerald-700">✔ Đã xác nhận</span> : <span className="text-xs text-amber-700">Chưa xác nhận</span> },
          { key: 'status', header: 'Trạng thái', render: (r: any) => <Badge status={r.status} /> },
          { key: 'act', header: '', render: (r: any) => can('chemicals.manage') && <div className="flex gap-1" onClick={(e) => e.stopPropagation()}><button className="btn-ghost btn-sm" onClick={() => setEdit(r)}><Pencil size={14} /></button><button className="btn-ghost btn-sm" onClick={() => confirm(`${r.status === 'ACTIVE' ? 'Khóa' : 'Mở khóa'} ${r.code}?`) && lock.mutate(r)}>{r.status === 'ACTIVE' ? <Lock size={14} /> : <Unlock size={14} />}</button></div> },
        ]} />
        <Pagination meta={data?.meta} onPage={setPage} />
      </div>
      {edit !== undefined && <ChemicalForm chem={edit} onClose={() => setEdit(undefined)} />}
    </div>
  );
}

function DocUpload({ chemId, onClose }: { chemId: number; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ doc_type: 'SDS', title: '', version: '', language: 'vi', issue_date: '', review_date: '' });
  const m = useMutation({
    mutationFn: () => { const fd = new FormData(); Object.entries(f).forEach(([k, v]) => fd.append(k, v)); fd.append('file', file.current!.files![0]); return api.post(`/chemicals/${chemId}/documents`, fd); },
    onSuccess: () => { toast.success('Đã tải lên tài liệu. SDS cần được HSE xác nhận.'); qc.invalidateQueries({ queryKey: ['chem-detail'] }); onClose(); }, onError: toast.error,
  });
  return (
    <Modal open onClose={onClose} title="Tải lên hồ sơ an toàn / tài liệu" size="md" footer={<><button className="btn-outline" onClick={onClose}>Hủy</button><button className="btn-primary" disabled={m.isPending || f.title.length < 2} onClick={() => file.current?.files?.length ? m.mutate() : toast.error('Chọn file')}>Tải lên</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Loại tài liệu" required><select className="input" value={f.doc_type} onChange={(e) => setF({ ...f, doc_type: e.target.value })}>{Object.entries(DOC_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Tiêu đề" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="VD: SDS – Nhà sản xuất ABC" /></Field>
        <Field label="Phiên bản"><input className="input" value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} /></Field>
        <Field label="Ngôn ngữ"><input className="input" value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })} /></Field>
        <Field label="Ngày ban hành"><input type="date" className="input" value={f.issue_date} onChange={(e) => setF({ ...f, issue_date: e.target.value })} /></Field>
        <Field label="Hạn rà soát / hiệu lực" hint="Quá hạn → SDS hết hiệu lực, chặn nhập/xuất (theo chính sách)"><input type="date" className="input" value={f.review_date} onChange={(e) => setF({ ...f, review_date: e.target.value })} /></Field>
        <Field label="File (PDF, DOCX, JPG, PNG)" className="col-span-2"><input ref={file} type="file" accept=".pdf,.docx,.jpg,.jpeg,.png,.xlsx" className="text-sm" /></Field>
      </div>
      {f.doc_type === 'SDS' && <p className="mt-2 text-xs text-slate-500">SDS mới sẽ thay thế (đánh dấu "đã thay thế") phiên bản SDS hiện hành.</p>}
    </Modal>
  );
}

export function ChemicalDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [upload, setUpload] = useState(false);
  const [verify, setVerify] = useState(false);
  const { data: c, isLoading } = useQuery({ queryKey: ['chem-detail', id], queryFn: () => api.get<any>(`/chemicals/${id}`) });
  const vDoc = useMutation({ mutationFn: (docId: number) => api.post(`/chemicals/documents/${docId}/verify`), onSuccess: () => { toast.success('Đã xác nhận tài liệu'); qc.invalidateQueries({ queryKey: ['chem-detail'] }); }, onError: toast.error });
  const vSafety = useMutation({ mutationFn: (note: string) => api.post(`/chemicals/${id}/verify-safety`, { note }), onSuccess: () => { toast.success('Đã xác nhận thông tin an toàn theo SDS'); setVerify(false); qc.invalidateQueries({ queryKey: ['chem-detail'] }); qc.invalidateQueries({ queryKey: ['chemicals'] }); }, onError: toast.error });
  if (isLoading || !c) return <Loading />;
  const safety: [string, any][] = [['Mức độ nguy hiểm', c.hazard_level], ['Phân loại GHS', c.ghs_classification], ['Câu cảnh báo (H)', c.hazard_statements], ['Câu phòng ngừa (P)', c.precautionary_statements], ['Điều kiện bảo quản', c.storage_conditions], ['Nhiệt độ bảo quản', c.storage_temp_min != null || c.storage_temp_max != null ? `${c.storage_temp_min ?? '…'} – ${c.storage_temp_max ?? '…'} °C` : ''], ['Thông gió', c.ventilation_req], ['Phòng cháy', c.fire_req], ['Bảo hộ cá nhân (PPE)', c.ppe_req], ['Sơ cứu', c.first_aid], ['Xử lý tràn đổ / sự cố', c.spill_response], ['Ghi chú an toàn', c.safety_notes]];
  return (
    <div>
      <PageHeader back={<Link to="/chemicals" className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500"><ArrowLeft size={12} />Danh mục hóa chất</Link>}
        title={<span className="flex flex-wrap items-center gap-2">{c.code} – {c.name} <Badge status={c.status} />{c.is_controlled && <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">Kiểm soát đặc biệt</span>}</span>}
        subtitle={[c.trade_name, c.cas_number && `CAS ${c.cas_number}`, c.formula, c.concentration].filter(Boolean).join(' · ')}
        actions={<>
          <Link className="btn-outline" to={`/chem-batches?chemical_id=${c.id}`}>Các lô & hạn dùng</Link>
          {can('chemicals.manage') && <button className="btn-outline" onClick={() => setUpload(true)}><Upload size={15} />Tải SDS / tài liệu</button>}
          {can('chemicals.safety_verify') && <button className="btn-success" onClick={() => setVerify(true)}><ShieldCheck size={15} />Xác nhận TT an toàn</button>}
          {can('chemicals.manage') && <button className="btn-primary" onClick={() => setEdit(true)}><Pencil size={15} />Sửa</button>}
        </>} />
      <div className="mb-3 flex flex-wrap gap-2">
        <Badge status={c.sds_state} map={SDS_STATE}>{c.sds_label}</Badge>
        {c.safety_verified_at ? <Badge status="POSTED">Thông tin an toàn đã xác nhận bởi {c.safety_verifier} ({fmtDateTime(c.safety_verified_at)})</Badge> : <Badge status="SUBMITTED">Thông tin an toàn CHƯA được chuyên gia xác nhận</Badge>}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Thông tin hóa chất">
          <dl className="space-y-1.5 text-sm">{[['Tên tiếng Anh', c.name_en], ['Tên khoa học', c.scientific_name], ['Nhóm', c.chemical_group], ['Nhà sản xuất', c.manufacturer], ['Nhà cung cấp', c.supplier?.name], ['ĐVT / quy cách', `${c.unit.code}${c.packaging ? ' · ' + c.packaging : ''}`], ['Trạng thái vật lý', STATE[c.physical_state]], ['HSD mặc định', c.default_shelf_life_days ? `${c.default_shelf_life_days} ngày` : ''], ['Tồn tối thiểu', fmtNum(c.min_stock)]].map(([k, v]) => <div key={k} className="flex gap-2"><dt className="w-32 shrink-0 text-slate-500">{k}</dt><dd className="font-medium">{v || '–'}</dd></div>)}</dl>
        </Card>
        <Card title={<span className="flex items-center gap-2">Thông tin an toàn (theo SDS) <GhsIcons codes={c.ghs_pictograms} /></span>} className="lg:col-span-2">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-2">{safety.map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="whitespace-pre-line">{v || <span className="text-slate-400">Chưa nhập</span>}</dd></div>)}</dl>
        </Card>
        <Card title="Hồ sơ an toàn & tài liệu" className="lg:col-span-3">
          {c.documents.length === 0 ? <Alert type="warning">Chưa có SDS/MSDS. Theo chính sách, hóa chất chưa có SDS hiệu lực sẽ bị chặn nhập kho và xuất kho.</Alert> : (
            <table className="table-base"><thead><tr><th>Loại</th><th>Tiêu đề</th><th>Phiên bản</th><th>Ban hành</th><th>Hạn rà soát</th><th>Xác nhận chuyên môn</th><th>Trạng thái</th><th></th></tr></thead>
              <tbody>{c.documents.map((d: any) => (
                <tr key={d.id} className={d.status !== 'ACTIVE' ? 'text-slate-400' : ''}><td>{DOC_TYPE[d.doc_type]}</td><td>{d.title}</td><td>{d.version}</td><td>{fmtDate(d.issue_date)}</td>
                  <td className={d.review_date && new Date(d.review_date) < new Date() ? 'font-semibold text-red-600' : ''}>{fmtDate(d.review_date)}</td>
                  <td>{d.verified_at ? <span className="text-emerald-700">✔ {d.verifier} ({fmtDate(d.verified_at)})</span> : d.status === 'ACTIVE' && can('chemicals.safety_verify') ? <button className="btn-success btn-sm" onClick={() => vDoc.mutate(d.id)}><CheckCircle2 size={13} />Xác nhận</button> : <span className="text-amber-700">Chưa xác nhận</span>}</td>
                  <td>{d.status === 'ACTIVE' ? 'Hiện hành' : 'Đã thay thế'}</td>
                  <td>{d.attachment_id && <button className="btn-ghost btn-sm" onClick={() => api.download(`/attachments/${d.attachment_id}/download`, { inline: 1 }, { open: true }).catch(toast.error)}><Eye size={14} /></button>}</td></tr>
              ))}</tbody></table>
          )}
        </Card>
        <Card title={`Lô đang tồn (${c.batches.length}) – theo FEFO`} className="lg:col-span-2">
          {c.batches.length === 0 ? <div className="text-sm text-slate-400">Không có lô tồn</div> : (
            <table className="table-base"><thead><tr><th>Lô nội bộ</th><th>Mã lô NSX</th><th>Vị trí</th><th>HSD</th><th className="text-right">Tồn</th><th>KT</th><th>Xuất được?</th></tr></thead>
              <tbody>{c.batches.map((b: any) => <tr key={b.id}><td><Link className="text-navy-700 hover:underline" to={`/chem-batches/${b.id}`}>{b.internal_code}</Link></td><td>{b.batch_no}</td><td>{b.location.code}</td><td>{fmtDate(b.expiry_date)}</td><td className="text-right">{fmtNum(b.qty_on_hand)}</td><td><Badge status={b.qc_status} map={QC_STATUS} /></td><td className="text-xs">{b.block_reasons.length ? <span className="text-red-600">✘ {b.block_reasons.join(', ')}</span> : <span className="text-emerald-700">✔</span>}</td></tr>)}</tbody></table>
          )}
        </Card>
        <Card title="Yêu cầu lưu trữ không tương thích">
          {c.storage_rules.length === 0 ? <div className="text-sm text-slate-400">Chưa có quy tắc. Quản lý tại "Cảnh báo an toàn".</div> : c.storage_rules.map((r: any) => <div key={r.id} className="mb-2 rounded border p-2 text-sm"><b>{r.other?.code} – {r.other?.name}</b><div className="text-xs">{r.description} · {r.source_ref}</div><div className="text-xs">{r.verified_at ? <span className="text-emerald-700">✔ Đã xác nhận</span> : <span className="text-amber-700">Chưa xác nhận (chưa cảnh báo)</span>}</div></div>)}
        </Card>
        <div className="lg:col-span-3"><AttachmentsPanel entityType="chemical" entityId={c.id} /></div>
      </div>
      {edit && <ChemicalForm chem={c} onClose={() => setEdit(false)} />}
      {upload && <DocUpload chemId={c.id} onClose={() => setUpload(false)} />}
      <ReasonDialog open={verify} title="Xác nhận thông tin an toàn" message="Tôi xác nhận đã đối chiếu toàn bộ thông tin an toàn của hóa chất với SDS/MSDS hiện hành và tài liệu chuyên môn." label="Ghi chú (mục SDS đã đối chiếu)" required={false} confirmText="Xác nhận" loading={vSafety.isPending} onClose={() => setVerify(false)} onConfirm={(n) => vSafety.mutate(n)} />
    </div>
  );
}

// ======================= LÔ & HẠN SỬ DỤNG =======================
export function BatchList() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Record<string, any>>('/settings'), staleTime: 300_000 });
  const days: number[] = settings?.['chemical.expiry_alert_days'] ?? [30, 60, 90];
  const [f, setF] = useState({ q: '', batch_no: '', alert: sp.get('alert') ?? '', chemical_id: sp.get('chemical_id') ?? '', supplier_id: null as number | null, location_id: null as number | null, expiry_from: '', expiry_to: '' });
  const [page, setPage] = useState(1);
  const df = useDebounce(f);
  useEffect(() => setPage(1), [df]);
  const params = { ...df, page, pageSize: 50 };
  const { data, isLoading } = useQuery({ queryKey: ['chem-batches', params], queryFn: () => api.page<any>('/chemical-batches', params), placeholderData: (p) => p });
  const { data: alerts } = useQuery({ queryKey: ['chem-alerts'], queryFn: () => api.get<any>('/chemical-batches/summary/alerts') });
  const chips: [string, string, number | undefined, string][] = [
    ['', 'Tất cả lô tồn', alerts?.batch_count, 'bg-slate-100'], ['expired', 'Đã hết hạn', alerts?.expired, 'bg-red-100 text-red-700'],
    ['exp1', `≤ ${days[0]} ngày`, alerts?.exp1, 'bg-orange-100 text-orange-800'], ['exp2', `${days[0] + 1}–${days[1] ?? days[0]} ngày`, alerts?.exp2, 'bg-amber-100 text-amber-800'],
    ['exp3', `${(days[1] ?? days[0]) + 1}–${days[2] ?? days[1] ?? days[0]} ngày`, alerts?.exp3, 'bg-yellow-100 text-yellow-800'], ['long', `Tồn lâu > ${alerts?.long_days ?? 365} ngày`, alerts?.long_stored, 'bg-purple-100 text-purple-800'],
    ['abnormal', 'Bao bì / bảo quản bất thường', alerts?.abnormal, 'bg-pink-100 text-pink-800'], ['quarantine', 'Cách ly / không đạt', alerts?.quarantine, 'bg-orange-100 text-orange-800'], ['pending', 'Chờ kiểm tra', alerts?.pending, 'bg-sky-100 text-sky-800'],
  ];
  return (
    <div>
      <PageHeader title="Quản lý lô & hạn sử dụng hóa chất" subtitle="Mỗi lần nhập tạo lô riêng – không gộp lô khác hạn. Lô hết hạn / cách ly / không đạt tự động bị chặn xuất."
        actions={<ExportButtons reportKey={f.alert === 'expired' ? 'chem-expired' : ['exp1', 'exp2', 'exp3'].includes(f.alert) ? 'chem-expiring' : f.alert === 'quarantine' ? 'chem-quarantine' : 'chem-batches'} params={{ q: f.q }} />} />
      <div className="mb-3 flex flex-wrap gap-2">{chips.map(([k, l, n, cls]) => <button key={k} onClick={() => setF({ ...f, alert: k })} className={`rounded-full px-3 py-1 text-xs font-medium ${cls} ${f.alert === k ? 'ring-2 ring-navy-700' : ''}`}>{l}: <b>{n ?? '…'}</b></button>)}</div>
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <SearchInput value={f.q} onChange={(q) => setF({ ...f, q })} placeholder="Tên / mã hóa chất" />
          <input className="input w-40" placeholder="Mã lô" value={f.batch_no} onChange={(e) => setF({ ...f, batch_no: e.target.value })} />
          <LookupSelect path="/suppliers" value={f.supplier_id} onChange={(v) => setF({ ...f, supplier_id: v })} placeholder="Mọi NCC" className="input w-48" />
          <LookupSelect path="/locations" value={f.location_id} onChange={(v) => setF({ ...f, location_id: v })} placeholder="Mọi vị trí" className="input w-40" labelFn={(r) => r.code} />
          <span className="text-xs">HSD từ</span><input type="date" className="input w-36" value={f.expiry_from} onChange={(e) => setF({ ...f, expiry_from: e.target.value })} />
          <span className="text-xs">đến</span><input type="date" className="input w-36" value={f.expiry_to} onChange={(e) => setF({ ...f, expiry_to: e.target.value })} />
          {f.chemical_id && <button className="btn-ghost btn-sm" onClick={() => setF({ ...f, chemical_id: '' })}>Bỏ lọc hóa chất ×</button>}
        </div>
        <DataTable loading={isLoading} rows={data?.data} onRowClick={(r) => nav(`/chem-batches/${r.id}`)} columns={[
          { key: 'chem', header: 'Hóa chất', render: (r: any) => <div><b>{r.chemical.code}</b> – {r.chemical.name}{r.chemical.is_controlled && <span className="ml-1 rounded bg-red-100 px-1 text-[10px] text-red-700">KSĐB</span>}</div> },
          { key: 'lot', header: 'Lô nội bộ / NSX', render: (r: any) => <div><b>{r.internal_code}</b><div className="text-xs text-slate-500">{r.batch_no}</div></div> },
          { key: 'mfg', header: 'NSX', render: (r: any) => fmtDate(r.mfg_date) },
          { key: 'rec', header: 'Ngày nhập', render: (r: any) => fmtDate(r.received_date) },
          { key: 'exp', header: 'Hạn sử dụng', render: (r: any) => <div className={r.days_to_expiry != null && r.days_to_expiry < 0 ? 'font-semibold text-red-600' : r.days_to_expiry != null && r.days_to_expiry <= days[0] ? 'font-semibold text-orange-600' : ''}>{fmtDate(r.expiry_date)}{r.days_to_expiry != null && <div className="text-xs">{r.days_to_expiry < 0 ? `Quá hạn ${-r.days_to_expiry} ngày` : `Còn ${r.days_to_expiry} ngày`}</div>}</div> },
          { key: 'qty', header: 'Tồn / Nhập', align: 'right', render: (r: any) => <div><b>{fmtNum(r.qty_on_hand)}</b> <span className="text-xs text-slate-500">/ {fmtNum(r.qty_received)} {r.chemical.unit.code}</span></div> },
          { key: 'loc', header: 'Vị trí', render: (r: any) => r.location.code },
          { key: 'sup', header: 'NCC', render: (r: any) => <span className="text-xs">{r.supplier?.name}</span> },
          { key: 'qc', header: 'Kiểm tra', render: (r: any) => <div className="flex flex-col gap-0.5"><Badge status={r.qc_status} map={QC_STATUS} />{r.abnormal && <span className="text-[11px] text-pink-700">⚠ Bao bì bất thường</span>}</div> },
          { key: 'ok', header: 'Xuất được?', render: (r: any) => r.block_reasons.length ? <span className="text-xs text-red-600">✘ {r.block_reasons.join(', ')}</span> : <span className="text-xs text-emerald-700">✔ Được xuất</span> },
        ]} />
        <Pagination meta={data?.meta} onPage={setPage} />
      </div>
    </div>
  );
}

export function BatchDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [dlg, setDlg] = useState<'' | 'PASSED' | 'QUARANTINE' | 'FAILED' | 'abnormal' | 'normal'>('');
  const { data: b, isLoading } = useQuery({ queryKey: ['chem-batch', id], queryFn: () => api.get<any>(`/chemical-batches/${id}`) });
  const m = useMutation({
    mutationFn: (note: string) => (dlg === 'abnormal' || dlg === 'normal' ? api.patch(`/chemical-batches/${id}/abnormal`, { abnormal: dlg === 'abnormal', note }) : api.patch(`/chemical-batches/${id}/status`, { qc_status: dlg, note })),
    onSuccess: () => { toast.success('Đã cập nhật lô'); setDlg(''); qc.invalidateQueries({ queryKey: ['chem-batch'] }); qc.invalidateQueries({ queryKey: ['chem-batches'] }); qc.invalidateQueries({ queryKey: ['chem-alerts'] }); }, onError: toast.error,
  });
  if (isLoading || !b) return <Loading />;
  const title = { PASSED: 'Giải phóng lô (Đạt – cho phép sử dụng)', QUARANTINE: 'Cách ly lô (chặn xuất)', FAILED: 'Đánh dấu lô không đạt (chặn xuất)', abnormal: 'Ghi nhận bao bì / bảo quản bất thường', normal: 'Xác nhận bao bì đã bình thường', '': '' }[dlg];
  return (
    <div>
      <PageHeader back={<Link to="/chem-batches" className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500"><ArrowLeft size={12} />Lô & hạn sử dụng</Link>}
        title={<span className="flex flex-wrap items-center gap-2">Lô {b.internal_code} <Badge status={b.qc_status} map={QC_STATUS} />{b.abnormal && <Badge status="REJECTED">Bao bì bất thường</Badge>}</span>}
        subtitle={`${b.chemical.code} – ${b.chemical.name} · Mã lô NSX ${b.batch_no}`}
        actions={can('chemicals.batch_status') && <>
          {b.qc_status !== 'QUARANTINE' && <button className="btn-outline" onClick={() => setDlg('QUARANTINE')}><AlertTriangle size={15} />Cách ly</button>}
          {b.qc_status !== 'FAILED' && <button className="btn-outline text-red-600" onClick={() => setDlg('FAILED')}>Không đạt</button>}
          {b.qc_status !== 'PASSED' && <button className="btn-success" onClick={() => setDlg('PASSED')}><CheckCircle2 size={15} />Giải phóng</button>}
          <button className="btn-ghost" onClick={() => setDlg(b.abnormal ? 'normal' : 'abnormal')}>{b.abnormal ? 'Bao bì đã bình thường' : 'Báo bao bì bất thường'}</button>
        </>} />
      {b.block_reasons.length > 0 && <div className="mb-3"><Alert type="danger"><b>Lô đang bị chặn xuất:</b> {b.block_reasons.join(', ')}</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Thông tin lô">
          <dl className="space-y-1.5 text-sm">{[['Hóa chất', `${b.chemical.code} – ${b.chemical.name}`], ['Mã lô NSX', b.batch_no], ['Ngày sản xuất', fmtDate(b.mfg_date)], ['Ngày nhập kho', fmtDate(b.received_date)], ['Hạn sử dụng', fmtDate(b.expiry_date)], ['SL nhập / còn lại', `${fmtNum(b.qty_received)} / ${fmtNum(b.qty_on_hand)} ${b.chemical.unit.code}`], ['Kho / vị trí', `${b.warehouse.code} / ${b.location.code}`], ['Nhà cung cấp', b.supplier?.name], ['Điều kiện bảo quản', b.chemical.storage_conditions], ['Chứng từ nhập', b.receipt ? <Link className="text-navy-700 underline" to={`/chem-receipts/${b.receipt.id}`}>{b.receipt.code}</Link> : ''], ['Ghi chú kiểm tra', b.qc_note], ['Tình trạng bao bì', b.abnormal_note]].map(([k, v]) => <div key={k as string} className="flex gap-2"><dt className="w-32 shrink-0 text-slate-500">{k}</dt><dd className="font-medium">{v || '–'}</dd></div>)}</dl>
        </Card>
        <Card title="Thẻ kho theo lô" className="lg:col-span-2">
          <DataTable rows={b.movements} empty="Chưa có giao dịch" columns={[
            { key: 'posted', header: 'Ngày ghi sổ', render: (r: any) => fmtDateTime(r.posted_at) },
            { key: 'doc', header: 'Chứng từ', render: (r: any) => DOC_LINK[r.doc_type] ? <Link className="text-navy-700 hover:underline" to={`${DOC_LINK[r.doc_type]}/${r.doc_id}`}>{r.doc_code}</Link> : r.doc_code },
            { key: 'type', header: 'Loại', render: (r: any) => ({ RECEIPT: 'Nhập', ISSUE: 'Xuất', ADJUSTMENT: 'Điều chỉnh', STOCKTAKE: 'Kiểm kê', DISPOSAL: 'Tiêu hủy' } as Record<string, string>)[r.movement_type] },
            { key: 'in', header: 'Nhập', align: 'right', render: (r: any) => r.qty_in ? fmtNum(r.qty_in) : '' },
            { key: 'out', header: 'Xuất', align: 'right', render: (r: any) => r.qty_out ? fmtNum(r.qty_out) : '' },
            { key: 'bal', header: 'Tồn lô', align: 'right', render: (r: any) => <b>{fmtNum(r.balance_after)}</b> },
            { key: 'user', header: 'Người thực hiện', render: (r: any) => r.user_name },
            { key: 'note', header: 'Ghi chú', render: (r: any) => <span className="text-xs">{r.note}</span> },
          ]} />
        </Card>
        <HistoryTimeline history={b.history} />
        <div className="lg:col-span-2"><AttachmentsPanel entityType="chemical_batch" entityId={b.id} /></div>
      </div>
      <ReasonDialog open={!!dlg} title={title} label="Lý do / kết quả kiểm tra" confirmText="Xác nhận" danger={dlg === 'FAILED'} loading={m.isPending} onClose={() => setDlg('')} onConfirm={(n) => m.mutate(n)} />
    </div>
  );
}

// ======================= TỒN KHO HÓA CHẤT =======================
export function ChemStock() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounce(q);
  const { data: whs } = useLookup('/warehouses');
  const [wh, setWh] = useState<number | null>(null);
  useEffect(() => setPage(1), [dq, wh]);
  const params = { q: dq, page, warehouse_id: wh };
  const { data, isLoading } = useQuery({ queryKey: ['chem-stock', params], queryFn: () => api.page<any>('/chemical-batches/summary/by-chemical', params), placeholderData: (p) => p });
  return (
    <div>
      <PageHeader title="Tồn kho hóa chất" subtitle="Tổng hợp từ từng lô: tổng tồn, được phép xuất (loại trừ lô hết hạn/cách ly/chưa kiểm tra), giữ chỗ, HSD gần nhất" actions={<ExportButtons reportKey="chem-stock" params={{ q: dq }} />} />
      <div className="card">
        <div className="flex flex-wrap gap-2 border-b p-3">
          <SearchInput value={q} onChange={setQ} placeholder="Mã, tên, CAS..." />
          <select className="input w-48" value={wh ?? ''} onChange={(e) => setWh(e.target.value ? Number(e.target.value) : null)}><option value="">Tất cả kho hóa chất</option>{whs?.filter((w) => w.type === 'CHEMICAL').map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        </div>
        <DataTable loading={isLoading} rows={data?.data} onRowClick={(r) => nav(`/chemicals/${r.id}`)} columns={[
          { key: 'code', header: 'Mã', render: (r: any) => <b>{r.code}</b> },
          { key: 'name', header: 'Tên hóa chất', render: (r: any) => <>{r.name}{r.is_controlled && <span className="ml-1 rounded bg-red-100 px-1 text-[10px] text-red-700">KSĐB</span>}</> },
          { key: 'unit', header: 'ĐVT', render: (r: any) => r.unit },
          { key: 'batches', header: 'Số lô', align: 'right', render: (r: any) => r.batch_count },
          { key: 'on', header: 'Tổng tồn', align: 'right', render: (r: any) => fmtNum(r.on_hand) },
          { key: 'iss', header: 'Được phép xuất', align: 'right', render: (r: any) => <b className="text-emerald-700">{fmtNum(r.issuable)}</b> },
          { key: 'res', header: 'Giữ chỗ', align: 'right', render: (r: any) => fmtNum(r.reserved) },
          { key: 'exp', header: 'Hết hạn', align: 'right', render: (r: any) => r.expired ? <span className="font-semibold text-red-600">{fmtNum(r.expired)}</span> : '' },
          { key: 'q', header: 'Cách ly / chờ KT', align: 'right', render: (r: any) => (r.quarantine + r.pending) ? <span className="text-orange-600">{fmtNum(r.quarantine + r.pending)}</span> : '' },
          { key: 'near', header: 'HSD gần nhất', render: (r: any) => fmtDate(r.nearest_expiry) },
          { key: 'min', header: 'Tối thiểu', align: 'right', render: (r: any) => <span className={r.below_min ? 'font-semibold text-red-600' : ''}>{fmtNum(r.min_stock)}{r.below_min && ' ⚠'}</span> },
          { key: 'sds', header: 'SDS', render: (r: any) => <Badge status={r.sds_state} map={SDS_STATE} /> },
        ]} />
        <Pagination meta={data?.meta} onPage={setPage} />
      </div>
    </div>
  );
}
