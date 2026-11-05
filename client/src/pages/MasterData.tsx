/* eslint-disable @typescript-eslint/no-explicit-any */
/** Trang danh mục dùng chung: Nhà cung cấp, Bộ phận, Kho, Vị trí, Nhóm vật tư, Đơn vị tính */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Lock, Unlock, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounce } from '@/lib/hooks';
import { COOP_STATUS } from '@/lib/constants';
import { Badge, DataTable, Field, Modal, PageHeader, Pagination, SearchInput, useToast, type Column } from '@/components/ui';
import { LookupSelect, AttachmentsPanel } from '@/components/shared';

export interface FieldDef { key: string; label: string; type?: 'text' | 'textarea' | 'select' | 'lookup' | 'email'; options?: Record<string, string>; lookup?: string; required?: boolean; span?: 2 | 3; hint?: string }

export function MasterPage({ title, subtitle, endpoint, managePerm, fields, columns, importType, attachEntity, embedded, extraFilter }: {
  title: string; subtitle?: string; endpoint: string; managePerm: string; fields: FieldDef[]; columns: Column<any>[];
  importType?: string; attachEntity?: string; embedded?: boolean; extraFilter?: (set: (k: string, v: unknown) => void, val: Record<string, unknown>) => ReactNode;
}) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [filters, setFilters] = useState<Record<string, unknown>>({});
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<any>(undefined);
  const [form, setForm] = useState<Record<string, any>>({});
  const dq = useDebounce(q);
  useEffect(() => setPage(1), [dq, status, filters]);
  const params = { q: dq, status, page, pageSize: 20, ...filters };
  const { data, isLoading } = useQuery({ queryKey: [endpoint, 'master', params], queryFn: () => api.page<any>(endpoint, params), placeholderData: (p) => p });
  useEffect(() => {
    const id = sp.get('id');
    if (id && !embedded) api.get<any>(`${endpoint}/${id}`).then((r) => setEdit(r)).catch(() => undefined);
  }, [sp]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (edit !== undefined) setForm(edit ? { ...edit } : {}); }, [edit]);
  const inv = () => { qc.invalidateQueries({ queryKey: [endpoint] }); qc.invalidateQueries({ queryKey: ['lookup'] }); };
  const save = useMutation({
    mutationFn: () => {
      const body = Object.fromEntries(fields.map((f) => [f.key, form[f.key] ?? null]));
      return edit ? api.put(`${endpoint}/${edit.id}`, body) : api.post(endpoint, body);
    },
    onSuccess: () => { toast.success('Đã lưu'); inv(); setEdit(undefined); }, onError: toast.error,
  });
  const lock = useMutation({ mutationFn: (r: any) => api.patch(`${endpoint}/${r.id}/status`, { status: r.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }), onSuccess: inv, onError: toast.error });
  const manage = can(managePerm);
  return (
    <div>
      {!embedded && <PageHeader title={title} subtitle={subtitle} actions={<>
        {importType && manage && <button className="btn-outline" onClick={() => nav(`/import?type=${importType}`)}><Upload size={15} />Import Excel</button>}
        {manage && <button className="btn-primary" onClick={() => setEdit(null)}><Plus size={15} />Thêm mới</button>}
      </>} />}
      <div className="card">
        <div className="flex flex-wrap gap-2 border-b p-3">
          <SearchInput value={q} onChange={setQ} />
          <select className="input w-40" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Tất cả</option><option value="ACTIVE">Đang dùng</option><option value="INACTIVE">Đã khóa</option></select>
          {extraFilter?.((k, v) => setFilters({ ...filters, [k]: v }), filters)}
          {embedded && manage && <button className="btn-primary ml-auto" onClick={() => setEdit(null)}><Plus size={15} />Thêm mới</button>}
        </div>
        <DataTable loading={isLoading} rows={data?.data} columns={[...columns, { key: 'status', header: 'Trạng thái', render: (r: any) => <Badge status={r.status} /> },
          { key: 'act', header: '', render: (r: any) => (
            <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
              <button className="btn-ghost btn-sm" title={manage ? 'Sửa' : 'Xem'} onClick={() => setEdit(r)}><Pencil size={14} /></button>
              {manage && <button className="btn-ghost btn-sm" title={r.status === 'ACTIVE' ? 'Khóa' : 'Mở khóa'} onClick={() => confirm(`${r.status === 'ACTIVE' ? 'Khóa' : 'Mở khóa'} ${r.code}?`) && lock.mutate(r)}>{r.status === 'ACTIVE' ? <Lock size={14} /> : <Unlock size={14} />}</button>}
            </div>) }]} />
        <Pagination meta={data?.meta} onPage={setPage} />
      </div>
      <Modal open={edit !== undefined} onClose={() => setEdit(undefined)} title={edit ? `${manage ? 'Sửa' : 'Xem'}: ${edit.code} – ${edit.name}` : `Thêm ${title.toLowerCase()}`} size="lg"
        footer={<><button className="btn-outline" onClick={() => setEdit(undefined)}>Đóng</button>{manage && <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>Lưu</button>}</>}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {fields.map((f) => (
            <Field key={f.key} label={f.label} required={f.required} hint={f.hint} className={f.span === 3 ? 'md:col-span-3' : f.span === 2 ? 'md:col-span-2' : ''}>
              {f.type === 'textarea' ? <textarea className="input" rows={2} disabled={!manage} value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                : f.type === 'select' ? <select className="input" disabled={!manage} value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}><option value="">--</option>{Object.entries(f.options!).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                  : f.type === 'lookup' ? <LookupSelect path={f.lookup!} disabled={!manage} value={form[f.key]} onChange={(v) => setForm({ ...form, [f.key]: v })} />
                    : <input className="input" type={f.type === 'email' ? 'email' : 'text'} disabled={!manage} value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />}
            </Field>
          ))}
        </div>
        {edit?.members && <div className="mt-4"><div className="label">Nhân viên thuộc bộ phận ({edit.members.length}) – gán tại màn hình Người dùng</div><div className="flex flex-wrap gap-1">{edit.members.map((m: any) => <span key={m.id} className="rounded bg-slate-100 px-2 py-0.5 text-xs">{m.full_name}{m.position ? ` – ${m.position}` : ''}</span>)}</div></div>}
        {edit && attachEntity && <div className="mt-4"><AttachmentsPanel entityType={attachEntity} entityId={edit.id} /></div>}
      </Modal>
    </div>
  );
}

export const SuppliersPage = () => {
  const { can } = useAuth();
  return (
    <MasterPage title="Nhà cung cấp" subtitle="Hồ sơ dùng chung cho kho mỏ, kho hóa chất và mua hàng – bấm mã/tên để xem hồ sơ đầy đủ, lịch sử giao dịch, đánh giá" endpoint="/suppliers" managePerm="suppliers.manage" importType="suppliers" attachEntity="supplier"
      extraFilter={(set, v) => <select className="input w-44" value={(v.cooperation_status as string) ?? ''} onChange={(e) => set('cooperation_status', e.target.value)}><option value="">Mọi tình trạng hợp tác</option>{Object.entries(COOP_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
      fields={[
        { key: 'code', label: 'Mã NCC', required: true }, { key: 'name', label: 'Tên doanh nghiệp', required: true, span: 2 },
        { key: 'address', label: 'Địa chỉ', span: 2 }, { key: 'country', label: 'Quốc gia' },
        { key: 'contact_person', label: 'Người liên hệ' }, { key: 'phone', label: 'Điện thoại' }, { key: 'email', label: 'Email', type: 'email' },
        { key: 'tax_code', label: 'Mã số thuế' }, { key: 'supply_groups', label: 'Nhóm hàng cung cấp', span: 2 },
        ...(can('suppliers.view_sensitive') ? [{ key: 'bank_account', label: 'Số tài khoản ngân hàng' }, { key: 'bank_name', label: 'Ngân hàng', span: 2 as const }] : []),
        { key: 'payment_terms', label: 'Điều khoản thanh toán', span: 2 }, { key: 'cooperation_status', label: 'Trạng thái hợp tác', type: 'select', options: COOP_STATUS },
        { key: 'note', label: 'Ghi chú', type: 'textarea', span: 3 },
      ]}
      columns={[
        { key: 'code', header: 'Mã', render: (r) => <Link className="font-semibold text-navy-700 hover:underline" to={`/suppliers/${r.id}`}>{r.code}</Link> }, { key: 'name', header: 'Tên doanh nghiệp', render: (r) => <Link className="hover:underline" to={`/suppliers/${r.id}`}>{r.name}</Link> }, { key: 'country', header: 'Quốc gia' },
        { key: 'contact', header: 'Liên hệ', render: (r) => <div className="text-xs">{r.contact_person}<br />{r.phone} {r.email}</div> },
        { key: 'supply_groups', header: 'Nhóm hàng' }, { key: 'coop', header: 'Hợp tác', render: (r) => COOP_STATUS[r.cooperation_status] },
      ]} />
  );
};

export const DepartmentsPage = () => (
  <MasterPage title="Bộ phận sử dụng" subtitle="Danh mục bộ phận/khu vực tại mỏ – công ty tự cấu hình. Lịch sử cấp phát xem tại Báo cáo tiêu hao theo bộ phận." endpoint="/departments" managePerm="departments.manage" importType="departments"
    fields={[
      { key: 'code', label: 'Mã bộ phận', required: true }, { key: 'name', label: 'Tên bộ phận', required: true, span: 2 },
      { key: 'manager_name', label: 'Người phụ trách' }, { key: 'area', label: 'Khu vực hoạt động', span: 2 }, { key: 'description', label: 'Mô tả', type: 'textarea', span: 3 },
    ]}
    columns={[{ key: 'code', header: 'Mã', render: (r) => <b>{r.code}</b> }, { key: 'name', header: 'Tên bộ phận' }, { key: 'manager_name', header: 'Người phụ trách' }, { key: 'area', header: 'Khu vực' }, { key: 'members', header: 'Số nhân viên', align: 'right', render: (r) => r.members?.length ?? 0 }]} />
);

export const WarehousesPanel = () => (
  <MasterPage embedded title="Kho" endpoint="/warehouses" managePerm="masterdata.manage"
    fields={[{ key: 'code', label: 'Mã kho', required: true }, { key: 'name', label: 'Tên kho', required: true, span: 2 }, { key: 'type', label: 'Loại kho', type: 'select', options: { GENERAL: 'Kho mỏ (vật tư, thiết bị)', CHEMICAL: 'Kho hóa chất' }, required: true }, { key: 'manager', label: 'Thủ kho phụ trách' }, { key: 'address', label: 'Địa chỉ' }, { key: 'description', label: 'Mô tả', type: 'textarea', span: 3 }]}
    columns={[{ key: 'code', header: 'Mã', render: (r) => <b>{r.code}</b> }, { key: 'name', header: 'Tên kho' }, { key: 'type', header: 'Loại', render: (r) => (r.type === 'CHEMICAL' ? 'Kho hóa chất' : 'Kho mỏ') }, { key: 'manager', header: 'Phụ trách' }]} />
);
export const LocationsPanel = () => (
  <MasterPage embedded title="Vị trí lưu kho" endpoint="/locations" managePerm="masterdata.manage"
    extraFilter={(set, v) => <LookupSelect path="/warehouses" value={v.warehouse_id as number} onChange={(x) => set('warehouse_id', x)} placeholder="Tất cả kho" className="input w-48" />}
    fields={[{ key: 'warehouse_id', label: 'Kho', type: 'lookup', lookup: '/warehouses', required: true }, { key: 'code', label: 'Mã vị trí', required: true }, { key: 'name', label: 'Tên vị trí', required: true }, { key: 'zone', label: 'Khu / dãy' }, { key: 'description', label: 'Mô tả', span: 2 }]}
    columns={[{ key: 'wh', header: 'Kho', render: (r) => r.warehouse?.code }, { key: 'code', header: 'Mã', render: (r) => <b>{r.code}</b> }, { key: 'name', header: 'Tên vị trí' }, { key: 'zone', header: 'Khu' }]} />
);
export const CategoriesPanel = () => (
  <MasterPage embedded title="Nhóm vật tư" endpoint="/categories" managePerm="masterdata.manage"
    fields={[{ key: 'code', label: 'Mã nhóm', required: true }, { key: 'name', label: 'Tên nhóm', required: true }, { key: 'parent_id', label: 'Thuộc nhóm (nếu là phân nhóm)', type: 'lookup', lookup: '/categories' }, { key: 'description', label: 'Mô tả', type: 'textarea', span: 3 }]}
    columns={[{ key: 'code', header: 'Mã', render: (r) => <b>{r.code}</b> }, { key: 'name', header: 'Tên nhóm' }, { key: 'parent', header: 'Thuộc nhóm', render: (r) => r.parent?.name }]} />
);
export const UnitsPanel = () => (
  <MasterPage embedded title="Đơn vị tính" endpoint="/units" managePerm="masterdata.manage"
    fields={[{ key: 'code', label: 'Mã ĐVT', required: true }, { key: 'name', label: 'Tên ĐVT', required: true }]}
    columns={[{ key: 'code', header: 'Mã', render: (r) => <b>{r.code}</b> }, { key: 'name', header: 'Tên' }]} />
);
