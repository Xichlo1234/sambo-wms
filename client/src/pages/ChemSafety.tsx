/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLookup } from '@/lib/hooks';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { INCIDENT_TYPE, SEVERITY, SDS_STATE } from '@/lib/constants';
import { Alert, Badge, Card, DataTable, Field, Modal, PageHeader, Pagination, Tabs, useToast, ReasonDialog } from '@/components/ui';
import { ChemicalPicker, ExportButtons, GhsIcons, type PickedChemical } from '@/components/shared';

function Kpi({ label, n, tone, to }: { label: string; n?: number; tone: string; to: string }) {
  return <Link to={to} className={`card block p-4 hover:shadow-md ${n ? tone : ''}`}><div className="text-xs text-slate-500">{label}</div><div className="text-2xl font-semibold">{n ?? '…'}</div></Link>;
}

function SdsTab() {
  const { data } = useQuery({ queryKey: ['report', 'chem-sds'], queryFn: () => api.get<any>('/reports/chem-sds') });
  const { data: chems } = useQuery({ queryKey: ['chemicals', 'sds-all'], queryFn: () => api.page<any>('/chemicals', { status: 'ACTIVE', pageSize: 200 }) });
  return (
    <Card title="Tình trạng hồ sơ SDS/MSDS theo hóa chất" actions={<ExportButtons reportKey="chem-sds" params={{}} />}>
      <Alert type="info">Thông tin an toàn phải lấy từ SDS/MSDS và được người có chuyên môn xác nhận. Hệ thống không tự suy diễn đặc tính nguy hiểm. Tải SDS & xác nhận tại hồ sơ từng hóa chất.</Alert>
      <div className="my-3 flex gap-4 text-sm">{data?.summary?.map((s: any) => <span key={s.label}>{s.label}: <b className="text-red-600">{s.value}</b></span>)}</div>
      <DataTable rows={chems?.data} columns={[
        { key: 'code', header: 'Mã', render: (r: any) => <Link className="font-semibold text-navy-700 hover:underline" to={`/chemicals/${r.id}`}>{r.code}</Link> },
        { key: 'name', header: 'Tên hóa chất', render: (r: any) => r.name },
        { key: 'cas', header: 'CAS', render: (r: any) => r.cas_number },
        { key: 'ghs', header: 'GHS', render: (r: any) => <GhsIcons codes={r.ghs_pictograms} /> },
        { key: 'sds', header: 'SDS/MSDS', render: (r: any) => <Badge status={r.sds_state} map={SDS_STATE} /> },
        { key: 'ver', header: 'Thông tin an toàn', render: (r: any) => r.safety_verified_at ? <span className="text-xs text-emerald-700">✔ Đã xác nhận {fmtDate(r.safety_verified_at)}</span> : <span className="text-xs text-amber-700">Chưa xác nhận</span> },
        { key: 'ctrl', header: 'Kiểm soát ĐB', render: (r: any) => r.is_controlled ? <span className="text-xs font-semibold text-red-700">Có</span> : '' },
      ]} />
    </Card>
  );
}

function AlertsTab() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: a } = useQuery({ queryKey: ['chem-alerts'], queryFn: () => api.get<any>('/chemical-batches/summary/alerts') });
  const { data: rules } = useQuery({ queryKey: ['storage-rules'], queryFn: () => api.get<any[]>('/chemical-safety/storage-rules') });
  const { data: ctrl } = useQuery({ queryKey: ['chemicals', 'controlled'], queryFn: () => api.page<any>('/chemicals', { controlled: 1, status: 'ACTIVE', pageSize: 100 }) });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<{ a: PickedChemical | null; b: PickedChemical | null; description: string; source_ref: string }>({ a: null, b: null, description: '', source_ref: '' });
  const create = useMutation({ mutationFn: () => api.post('/chemical-safety/storage-rules', { chemical_a_id: f.a?.id, chemical_b_id: f.b?.id, description: f.description, source_ref: f.source_ref }), onSuccess: () => { toast.success('Đã thêm quy tắc – cần chuyên gia xác nhận để kích hoạt cảnh báo'); setOpen(false); qc.invalidateQueries({ queryKey: ['storage-rules'] }); }, onError: toast.error });
  const verify = useMutation({ mutationFn: (id: number) => api.post(`/chemical-safety/storage-rules/${id}/verify`), onSuccess: () => qc.invalidateQueries({ queryKey: ['storage-rules'] }), onError: toast.error });
  const days = a?.days ?? [30, 60, 90];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Lô đã hết hạn" n={a?.expired} tone="bg-red-50 text-red-700" to="/chem-batches?alert=expired" />
        <Kpi label={`Hết hạn trong ${days[0]} ngày`} n={a?.exp1} tone="bg-orange-50 text-orange-700" to="/chem-batches?alert=exp1" />
        <Kpi label={`Hết hạn trong ${days[1] ?? days[0]} ngày`} n={a?.exp2} tone="bg-amber-50 text-amber-700" to="/chem-batches?alert=exp2" />
        <Kpi label={`Hết hạn trong ${days[2] ?? days[1]} ngày`} n={a?.exp3} tone="bg-yellow-50 text-yellow-700" to="/chem-batches?alert=exp3" />
        <Kpi label="Tồn kho lâu ngày" n={a?.long_stored} tone="bg-purple-50 text-purple-700" to="/chem-batches?alert=long" />
        <Kpi label="Bao bì / bảo quản bất thường" n={a?.abnormal} tone="bg-pink-50 text-pink-700" to="/chem-batches?alert=abnormal" />
        <Kpi label="Lô cách ly / không đạt" n={a?.quarantine} tone="bg-orange-50 text-orange-700" to="/chem-batches?alert=quarantine" />
        <Kpi label="Lô chờ kiểm tra" n={a?.pending} tone="bg-sky-50 text-sky-700" to="/chem-batches?alert=pending" />
        <Kpi label="Thiếu / quá hạn SDS" n={a?.sds_missing} tone="bg-red-50 text-red-700" to="/chem-safety?tab=sds" />
        <Kpi label="SDS chưa xác nhận" n={a?.sds_unverified} tone="bg-amber-50 text-amber-700" to="/chem-safety?tab=sds" />
      </div>
      <p className="text-xs text-slate-500">Mốc cảnh báo hạn dùng và "tồn lâu ngày" cấu hình tại Cấu hình hệ thống → Chính sách hóa chất.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Yêu cầu lưu trữ không tương thích" actions={can('chemicals.manage', 'chemicals.safety_verify') && <button className="btn-outline btn-sm" onClick={() => setOpen(true)}><Plus size={14} />Thêm quy tắc</button>}>
          <p className="mb-2 text-xs text-slate-500">Chỉ nhập theo SDS / tài liệu chuyên môn. Hệ thống chỉ cảnh báo khi quy tắc đã được chuyên gia xác nhận; không tự đề xuất ghép nhóm.</p>
          <DataTable rows={rules} empty="Chưa có quy tắc" columns={[
            { key: 'p', header: 'Cặp hóa chất', render: (r: any) => <div className="text-sm">{r.a?.code} ⟷ {r.b?.code}<div className="text-xs text-slate-500">{r.a?.name} / {r.b?.name}</div></div> },
            { key: 'd', header: 'Yêu cầu', render: (r: any) => <div className="text-xs">{r.description}<div className="text-slate-500">Căn cứ: {r.source_ref}</div></div> },
            { key: 'v', header: 'Xác nhận', render: (r: any) => r.verified_at ? <span className="text-xs text-emerald-700">✔ {r.verifier}</span> : can('chemicals.safety_verify') ? <button className="btn-success btn-sm" onClick={() => verify.mutate(r.id)}><CheckCircle2 size={13} />Xác nhận</button> : <span className="text-xs text-amber-700">Chờ xác nhận</span> },
          ]} />
        </Card>
        <Card title="Danh sách hóa chất kiểm soát đặc biệt">
          <DataTable rows={ctrl?.data} empty="Không có" columns={[
            { key: 'c', header: 'Hóa chất', render: (r: any) => <Link className="text-navy-700 hover:underline" to={`/chemicals/${r.id}`}><b>{r.code}</b> – {r.name}</Link> },
            { key: 'g', header: 'GHS', render: (r: any) => <GhsIcons codes={r.ghs_pictograms} /> },
            { key: 's', header: 'SDS', render: (r: any) => <Badge status={r.sds_state} map={SDS_STATE} /> },
          ]} />
          <p className="mt-2 text-xs text-slate-500">Xuất hóa chất kiểm soát đặc biệt bắt buộc HSE xác nhận an toàn trên từng phiếu.</p>
        </Card>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Thêm yêu cầu lưu trữ không tương thích" size="md" footer={<><button className="btn-outline" onClick={() => setOpen(false)}>Hủy</button><button className="btn-primary" disabled={!f.a || !f.b || f.description.length < 5 || f.source_ref.length < 3} onClick={() => create.mutate()}>Lưu</button></>}>
        <div className="space-y-3">
          <Field label="Hóa chất A" required><ChemicalPicker value={f.a} onPick={(c) => setF({ ...f, a: c })} /></Field>
          <Field label="Hóa chất B" required><ChemicalPicker value={f.b} onPick={(c) => setF({ ...f, b: c })} /></Field>
          <Field label="Yêu cầu lưu trữ (theo SDS)" required><textarea className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Căn cứ (mục SDS / tài liệu)" required><input className="input" value={f.source_ref} onChange={(e) => setF({ ...f, source_ref: e.target.value })} placeholder="VD: SDS NaOH mục 7 & 10" /></Field>
        </div>
      </Modal>
    </div>
  );
}

function InspectionsTab() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const { data } = useQuery({ queryKey: ['chem-inspections', page], queryFn: () => api.page<any>('/chemical-inspections', { page }) });
  const { data: whs } = useLookup('/warehouses');
  const [open, setOpen] = useState(false);
  const init = { inspected_at: new Date().toISOString().slice(0, 16), temperature: '', humidity: '', ventilation_ok: true, fire_equipment_ok: true, spill_kit_ok: true, labeling_ok: true, segregation_ok: true, ppe_ok: true, findings: '', actions: '' };
  const [f, setF] = useState<any>(init);
  const m = useMutation({ mutationFn: () => api.post('/chemical-inspections', { ...f, inspected_at: new Date(f.inspected_at).toISOString(), warehouse_id: whs?.find((w) => w.type === 'CHEMICAL')?.id }), onSuccess: () => { toast.success('Đã ghi nhật ký kiểm tra'); setOpen(false); setF(init); qc.invalidateQueries({ queryKey: ['chem-inspections'] }); }, onError: toast.error });
  const items: [string, string][] = [['ventilation_ok', 'Thông gió'], ['fire_equipment_ok', 'Thiết bị PCCC'], ['spill_kit_ok', 'Bộ ứng phó tràn đổ'], ['labeling_ok', 'Nhãn mác'], ['segregation_ok', 'Phân khu / tách biệt'], ['ppe_ok', 'Trang bị bảo hộ']];
  return (
    <Card title="Nhật ký kiểm tra kho hóa chất" actions={can('chemicals.inspection') && <button className="btn-primary btn-sm" onClick={() => setOpen(true)}><Plus size={14} />Ghi kiểm tra</button>}>
      <DataTable rows={data?.data} columns={[
        { key: 'code', header: 'Số', render: (r: any) => r.code }, { key: 't', header: 'Thời gian', render: (r: any) => fmtDateTime(r.inspected_at) }, { key: 'i', header: 'Người kiểm tra', render: (r: any) => r.inspector },
        { key: 'env', header: 'Nhiệt độ / độ ẩm', render: (r: any) => `${r.temperature ?? '–'}°C / ${r.humidity ?? '–'}%` },
        { key: 'items', header: 'Hạng mục', render: (r: any) => <div className="flex flex-wrap gap-1 text-[11px]">{items.map(([k, l]) => <span key={k} className={r[k] ? 'text-emerald-700' : 'font-semibold text-red-600'}>{r[k] ? '✔' : '✘'} {l}</span>)}</div> },
        { key: 'res', header: 'Kết quả', render: (r: any) => r.result === 'PASS' ? <Badge status="POSTED">Đạt</Badge> : <Badge status="REJECTED">Có tồn tại</Badge> },
        { key: 'f', header: 'Phát hiện / biện pháp', render: (r: any) => <span className="text-xs">{[r.findings, r.actions].filter(Boolean).join(' → ')}</span> },
      ]} />
      <Pagination meta={data?.meta} onPage={setPage} />
      <Modal open={open} onClose={() => setOpen(false)} title="Ghi nhật ký kiểm tra kho hóa chất" size="md" footer={<><button className="btn-outline" onClick={() => setOpen(false)}>Hủy</button><button className="btn-primary" disabled={m.isPending} onClick={() => m.mutate()}>Lưu</button></>}>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Thời gian"><input type="datetime-local" className="input" value={f.inspected_at} onChange={(e) => setF({ ...f, inspected_at: e.target.value })} /></Field>
          <Field label="Nhiệt độ (°C)"><input type="number" className="input" value={f.temperature} onChange={(e) => setF({ ...f, temperature: e.target.value })} /></Field>
          <Field label="Độ ẩm (%)"><input type="number" className="input" value={f.humidity} onChange={(e) => setF({ ...f, humidity: e.target.value })} /></Field>
          {items.map(([k, l]) => <label key={k} className={`flex items-center gap-2 rounded border p-2 text-sm ${f[k] ? '' : 'border-red-300 bg-red-50'}`}><input type="checkbox" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />{l} đạt</label>)}
          <Field label="Phát hiện" className="col-span-3"><textarea className="input" rows={2} value={f.findings} onChange={(e) => setF({ ...f, findings: e.target.value })} /></Field>
          <Field label="Biện pháp khắc phục" className="col-span-3"><textarea className="input" rows={2} value={f.actions} onChange={(e) => setF({ ...f, actions: e.target.value })} /></Field>
        </div>
      </Modal>
    </Card>
  );
}

function IncidentsTab() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const { data } = useQuery({ queryKey: ['chem-incidents', page], queryFn: () => api.page<any>('/chemical-incidents', { page }) });
  const { data: whs } = useLookup('/warehouses');
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState<any>(null);
  const init = { occurred_at: new Date().toISOString().slice(0, 16), chem: null as PickedChemical | null, location_text: '', incident_type: 'SPILL', severity: 'LOW', description: '', actions_taken: '', injuries: '' };
  const [f, setF] = useState<any>(init);
  const m = useMutation({ mutationFn: () => api.post('/chemical-incidents', { ...f, chem: undefined, chemical_id: f.chem?.id ?? null, occurred_at: new Date(f.occurred_at).toISOString(), warehouse_id: whs?.find((w) => w.type === 'CHEMICAL')?.id }), onSuccess: () => { toast.success('Đã ghi nhận sự cố – đã thông báo HSE'); setOpen(false); setF(init); qc.invalidateQueries({ queryKey: ['chem-incidents'] }); }, onError: toast.error });
  const close = useMutation({ mutationFn: (actions: string) => api.post(`/chemical-incidents/${closing.id}/close`, { actions_taken: actions }), onSuccess: () => { toast.success('Đã đóng sự cố'); setClosing(null); qc.invalidateQueries({ queryKey: ['chem-incidents'] }); }, onError: toast.error });
  return (
    <Card title="Nhật ký sự cố hóa chất & xử lý" actions={can('chemicals.incident') && <button className="btn-danger btn-sm" onClick={() => setOpen(true)}><Plus size={14} />Báo sự cố</button>}>
      <DataTable rows={data?.data} columns={[
        { key: 'code', header: 'Số', render: (r: any) => r.code }, { key: 't', header: 'Thời điểm', render: (r: any) => fmtDateTime(r.occurred_at) },
        { key: 'type', header: 'Loại', render: (r: any) => INCIDENT_TYPE[r.incident_type] }, { key: 'sev', header: 'Mức độ', render: (r: any) => <Badge status={r.severity} map={SEVERITY} /> },
        { key: 'chem', header: 'Hóa chất', render: (r: any) => r.chemical ? `${r.chemical.code} – ${r.chemical.name}` : '' },
        { key: 'desc', header: 'Mô tả / xử lý', render: (r: any) => <div className="text-xs">{r.description}{r.actions_taken && <div className="text-emerald-700">Xử lý: {r.actions_taken}</div>}</div> },
        { key: 'rep', header: 'Người báo', render: (r: any) => r.reporter },
        { key: 'st', header: 'Trạng thái', render: (r: any) => r.status === 'OPEN' ? (can('chemicals.incident') ? <button className="btn-outline btn-sm" onClick={() => setClosing(r)}>Đóng sự cố</button> : <Badge status="SUBMITTED">Đang xử lý</Badge>) : <Badge status="POSTED">Đã đóng</Badge> },
      ]} />
      <Pagination meta={data?.meta} onPage={setPage} />
      <Modal open={open} onClose={() => setOpen(false)} title="Báo cáo sự cố hóa chất" size="md" footer={<><button className="btn-outline" onClick={() => setOpen(false)}>Hủy</button><button className="btn-danger" disabled={m.isPending || f.description.length < 5} onClick={() => m.mutate()}>Ghi nhận</button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Thời điểm"><input type="datetime-local" className="input" value={f.occurred_at} onChange={(e) => setF({ ...f, occurred_at: e.target.value })} /></Field>
          <Field label="Vị trí"><input className="input" value={f.location_text} onChange={(e) => setF({ ...f, location_text: e.target.value })} /></Field>
          <Field label="Loại sự cố"><select className="input" value={f.incident_type} onChange={(e) => setF({ ...f, incident_type: e.target.value })}>{Object.entries(INCIDENT_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Mức độ"><select className="input" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>{Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
          <Field label="Hóa chất liên quan" className="col-span-2"><ChemicalPicker value={f.chem} onPick={(c) => setF({ ...f, chem: c })} /></Field>
          <Field label="Mô tả" required className="col-span-2"><textarea className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Biện pháp đã thực hiện (theo SDS / người phụ trách)" className="col-span-2"><textarea className="input" rows={2} value={f.actions_taken} onChange={(e) => setF({ ...f, actions_taken: e.target.value })} /></Field>
          <Field label="Thương tích (nếu có)" className="col-span-2"><input className="input" value={f.injuries} onChange={(e) => setF({ ...f, injuries: e.target.value })} /></Field>
        </div>
        <p className="mt-2 text-xs text-slate-500">Hệ thống không tự đề xuất quy trình xử lý – tham chiếu hướng dẫn trong SDS của hóa chất và chỉ đạo của người phụ trách chuyên môn.</p>
      </Modal>
      <ReasonDialog open={!!closing} title={`Đóng sự cố ${closing?.code ?? ''}`} label="Biện pháp xử lý đã thực hiện" confirmText="Đóng sự cố" loading={close.isPending} onClose={() => setClosing(null)} onConfirm={(a) => close.mutate(a)} />
    </Card>
  );
}

export default function ChemSafety() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'alerts';
  return (
    <div>
      <PageHeader title="An toàn hóa chất" subtitle="SDS/MSDS, cảnh báo hạn dùng & bảo quản, yêu cầu lưu trữ, hóa chất kiểm soát đặc biệt, nhật ký kiểm tra kho và sự cố" />
      <Tabs value={tab} onChange={(k) => setSp({ tab: k })} tabs={[{ key: 'alerts', label: 'Cảnh báo an toàn' }, { key: 'sds', label: 'SDS/MSDS' }, { key: 'inspections', label: 'Nhật ký kiểm tra kho' }, { key: 'incidents', label: 'Nhật ký sự cố' }]} />
      {tab === 'alerts' && <AlertsTab />}
      {tab === 'sds' && <SdsTab />}
      {tab === 'inspections' && <InspectionsTab />}
      {tab === 'incidents' && <IncidentsTab />}
    </div>
  );
}
