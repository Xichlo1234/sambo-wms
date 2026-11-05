import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Lock, Unlock, FileSpreadsheet, Upload, ArrowLeft } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounce, useLookup } from '@/lib/hooks';
import { fmtNum } from '@/lib/format';
import { Badge, Card, DataTable, Field, Modal, PageHeader, Pagination, SearchInput, useToast, Alert, Loading, Spinner } from '@/components/ui';
import { LookupSelect, AttachmentsPanel } from '@/components/shared';

export interface Item {
  id: number; code: string; name: string; name_en?: string | null; kind: 'MATERIAL' | 'EQUIPMENT'; category_id: number; subcategory_id?: number | null;
  specification?: string | null; model?: string | null; manufacturer?: string | null; origin?: string | null; unit_id: number; barcode?: string | null;
  default_location_id?: number | null; min_stock: number; max_stock?: number | null; safety_stock: number; max_issue_qty?: number | null;
  preferred_supplier_id?: number | null; serial_no?: string | null; asset_code?: string | null; status: string; note?: string | null;
  category?: { code: string; name: string }; unit?: { code: string }; default_location?: { code: string } | null; preferred_supplier?: { name: string } | null;
}

const optNum = z.union([z.coerce.number().min(0, 'Không âm'), z.literal('')]).optional().nullable();
const schema = z.object({
  code: z.string().trim().min(1, 'Bắt buộc'), name: z.string().trim().min(1, 'Bắt buộc'), name_en: z.string().optional().nullable(),
  kind: z.enum(['MATERIAL', 'EQUIPMENT']), category_id: z.coerce.number({ invalid_type_error: 'Chọn nhóm' }).positive('Chọn nhóm'),
  subcategory_id: z.any().optional(), specification: z.string().optional().nullable(), model: z.string().optional().nullable(),
  manufacturer: z.string().optional().nullable(), origin: z.string().optional().nullable(), unit_id: z.coerce.number({ invalid_type_error: 'Chọn ĐVT' }).positive('Chọn ĐVT'),
  barcode: z.string().optional().nullable(), default_location_id: z.any().optional(), min_stock: z.coerce.number().min(0), max_stock: optNum,
  safety_stock: z.coerce.number().min(0), max_issue_qty: optNum, preferred_supplier_id: z.any().optional(), serial_no: z.string().optional().nullable(),
  asset_code: z.string().optional().nullable(), note: z.string().optional().nullable(),
}).refine((d) => d.max_stock === '' || d.max_stock == null || Number(d.max_stock) >= d.min_stock, { message: 'Tối đa ≥ tối thiểu', path: ['max_stock'] });
type FormData = z.infer<typeof schema>;

function ItemForm({ item, kind, onClose }: { item?: Item | null; kind: 'MATERIAL' | 'EQUIPMENT'; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [similar, setSimilar] = useState<{ code: string; name: string; specification?: string; score: number }[] | null>(null);
  const { register, handleSubmit, formState: { errors }, watch, setValue, reset } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: item ? { ...item } as never : { kind, min_stock: 0, safety_stock: 0 } as never,
  });
  useEffect(() => { reset(item ? { ...item } as never : { kind, min_stock: 0, safety_stock: 0 } as never); setSimilar(null); }, [item, kind, reset]);
  const catId = watch('category_id');
  const { data: cats } = useLookup('/categories');
  const save = useMutation({
    mutationFn: (d: FormData & { confirm_similar?: boolean }) => {
      const body = { ...d, subcategory_id: d.subcategory_id || null, default_location_id: d.default_location_id || null, preferred_supplier_id: d.preferred_supplier_id || null };
      return item ? api.put(`/items/${item.id}`, body) : api.post('/items', body);
    },
    onSuccess: () => { toast.success(item ? 'Đã cập nhật vật tư' : 'Đã tạo vật tư mới'); qc.invalidateQueries({ queryKey: ['items'] }); onClose(); },
    onError: (e) => { if (e instanceof ApiError && e.code === 'SIMILAR_ITEMS') setSimilar(e.details as never); else toast.error(e); },
  });
  const submit = (confirm = false) => handleSubmit((d) => save.mutate({ ...d, confirm_similar: confirm }))();
  const parents = cats?.filter((c) => !c.parent_id);
  const subs = cats?.filter((c) => c.parent_id && Number(c.parent_id) === Number(catId));
  return (
    <Modal open onClose={onClose} title={item ? `Sửa ${item.code}` : kind === 'EQUIPMENT' ? 'Thêm thiết bị' : 'Thêm vật tư'} size="lg"
      footer={<><button className="btn-outline" onClick={onClose}>Hủy</button><button className="btn-primary" disabled={save.isPending} onClick={() => submit(false)}>{save.isPending && <Spinner className="h-4 w-4 text-white" />}Lưu</button></>}>
      {similar && (
        <div className="mb-3"><Alert type="warning">
          <b>Phát hiện mặt hàng có tên/quy cách tương tự – kiểm tra để tránh tạo trùng:</b>
          <ul className="my-1 ml-4 list-disc">{similar.map((s) => <li key={s.code}><b>{s.code}</b> – {s.name} {s.specification && `(${s.specification})`} – độ giống {Math.round(s.score * 100)}%</li>)}</ul>
          <button className="btn-gold btn-sm mt-1" onClick={() => submit(true)}>Đây là mặt hàng khác – vẫn lưu</button>
        </Alert></div>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Mã vật tư" required error={errors.code?.message} hint={item ? 'Không đổi được mã khi đã phát sinh giao dịch' : 'Duy nhất, tự viết hoa'}><input className="input uppercase" {...register('code')} /></Field>
        <Field label="Tên vật tư" required error={errors.name?.message} className="md:col-span-2"><input className="input" {...register('name')} /></Field>
        <Field label="Tên tiếng Anh"><input className="input" {...register('name_en')} /></Field>
        <Field label="Loại"><select className="input" {...register('kind')}><option value="MATERIAL">Vật tư / phụ tùng / CCDC / PPE</option><option value="EQUIPMENT">Thiết bị, máy móc</option></select></Field>
        <Field label="Nhóm vật tư" required error={errors.category_id?.message}>
          <select className="input" {...register('category_id')} onChange={(e) => { setValue('category_id', Number(e.target.value)); setValue('subcategory_id', null); }}>
            <option value="">-- Chọn --</option>{parents?.map((c) => <option key={c.id} value={c.id}>{c.code} – {c.name}</option>)}
          </select>
        </Field>
        <Field label="Phân nhóm"><select className="input" {...register('subcategory_id')}><option value="">-- Không --</option>{subs?.map((c) => <option key={c.id} value={c.id}>{c.code} – {c.name}</option>)}</select></Field>
        <Field label="Đơn vị tính" required error={errors.unit_id?.message}><LookupSelect path="/units" value={watch('unit_id')} onChange={(v) => setValue('unit_id', v as number, { shouldValidate: true })} /></Field>
        <Field label="Model"><input className="input" {...register('model')} /></Field>
        <Field label="Quy cách kỹ thuật" className="md:col-span-3"><textarea className="input" rows={2} {...register('specification')} /></Field>
        <Field label="Hãng sản xuất"><input className="input" {...register('manufacturer')} /></Field>
        <Field label="Xuất xứ"><input className="input" {...register('origin')} /></Field>
        <Field label="Mã vạch / QR"><input className="input" {...register('barcode')} /></Field>
        <Field label="Vị trí lưu kho mặc định"><LookupSelect path="/locations" value={watch('default_location_id')} onChange={(v) => setValue('default_location_id', v)} /></Field>
        <Field label="Nhà cung cấp ưu tiên" className="md:col-span-2"><LookupSelect path="/suppliers" value={watch('preferred_supplier_id')} onChange={(v) => setValue('preferred_supplier_id', v)} /></Field>
        <Field label="Tồn tối thiểu" error={errors.min_stock?.message}><input type="number" step="any" className="input" {...register('min_stock')} /></Field>
        <Field label="Tồn an toàn" error={errors.safety_stock?.message}><input type="number" step="any" className="input" {...register('safety_stock')} /></Field>
        <Field label="Tồn tối đa" error={errors.max_stock?.message}><input type="number" step="any" className="input" {...register('max_stock')} /></Field>
        <Field label="Định mức xuất / 1 phiếu" hint="Vượt định mức sẽ cảnh báo, bắt buộc ghi lý do"><input type="number" step="any" className="input" {...register('max_issue_qty')} /></Field>
        {watch('kind') === 'EQUIPMENT' && <>
          <Field label="Số serial"><input className="input" {...register('serial_no')} /></Field>
          <Field label="Mã tài sản"><input className="input" {...register('asset_code')} /></Field>
        </>}
        <Field label="Ghi chú" className="md:col-span-3"><textarea className="input" rows={2} {...register('note')} /></Field>
      </div>
    </Modal>
  );
}

export function ItemsPage({ kind }: { kind: 'MATERIAL' | 'EQUIPMENT' }) {
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<number | null>(null);
  const [status, setStatus] = useState('ACTIVE');
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<Item | null | undefined>(undefined);
  const dq = useDebounce(q);
  useEffect(() => setPage(1), [dq, cat, status, kind]);
  const params = { q: dq, category_id: cat, status, kind, page, pageSize: 20 };
  const { data, isLoading } = useQuery({ queryKey: ['items', params], queryFn: () => api.page<Item>('/items', params), placeholderData: (p) => p });
  const lock = useMutation({
    mutationFn: (it: Item) => api.patch(`/items/${it.id}/status`, { status: it.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['items'] }); toast.success('Đã cập nhật trạng thái'); }, onError: toast.error,
  });
  const title = kind === 'EQUIPMENT' ? 'Danh mục thiết bị' : 'Danh mục vật tư';
  return (
    <div>
      <PageHeader title={title} subtitle="Danh mục tập trung – không trùng mã, cảnh báo tên/quy cách tương tự"
        actions={<>
          {can('items.import') && <button className="btn-outline" onClick={() => nav('/import?type=items')}><Upload size={15} />Import Excel</button>}
          {can('reports.export') && <button className="btn-outline" onClick={() => api.download('/reports/stock-current/export', { format: 'xlsx', category_id: cat, q: dq })}><FileSpreadsheet size={15} />Xuất Excel</button>}
          {can('items.create') && <button className="btn-primary" onClick={() => setEdit(null)}><Plus size={15} />Thêm mới</button>}
        </>} />
      <div className="card">
        <div className="flex flex-wrap gap-2 border-b p-3">
          <SearchInput value={q} onChange={setQ} placeholder="Tìm mã, tên (không dấu), model, mã vạch..." />
          <LookupSelect path="/categories" value={cat} onChange={setCat} placeholder="Tất cả nhóm" className="input w-56" />
          <select className="input w-40" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Tất cả trạng thái</option><option value="ACTIVE">Đang dùng</option><option value="INACTIVE">Đã khóa</option></select>
        </div>
        <DataTable loading={isLoading} rows={data?.data} onRowClick={(r) => nav(`/items/${r.id}`)}
          columns={[
            { key: 'code', header: 'Mã', render: (r) => <b className="text-navy-800">{r.code}</b> },
            { key: 'name', header: 'Tên vật tư', render: (r) => <div>{r.name}{r.specification && <div className="text-xs text-slate-500">{r.specification}</div>}</div> },
            { key: 'cat', header: 'Nhóm', render: (r) => r.category?.name },
            { key: 'unit', header: 'ĐVT', render: (r) => r.unit?.code },
            { key: 'loc', header: 'Vị trí', render: (r) => r.default_location?.code },
            { key: 'min', header: 'Tối thiểu', align: 'right', render: (r) => fmtNum(r.min_stock) },
            { key: 'max', header: 'Tối đa', align: 'right', render: (r) => fmtNum(r.max_stock) },
            { key: 'status', header: 'Trạng thái', render: (r) => <Badge status={r.status} /> },
            { key: 'act', header: '', render: (r) => (
              <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                {can('items.update') && <button className="btn-ghost btn-sm" title="Sửa" onClick={() => setEdit(r)}><Pencil size={14} /></button>}
                {can('items.lock') && <button className="btn-ghost btn-sm" title={r.status === 'ACTIVE' ? 'Khóa' : 'Mở khóa'} onClick={() => confirm(`${r.status === 'ACTIVE' ? 'Khóa' : 'Mở khóa'} ${r.code}?`) && lock.mutate(r)}>{r.status === 'ACTIVE' ? <Lock size={14} /> : <Unlock size={14} />}</button>}
              </div>) },
          ]} />
        <Pagination meta={data?.meta} onPage={setPage} />
      </div>
      {edit !== undefined && <ItemForm item={edit} kind={kind} onClose={() => setEdit(undefined)} />}
    </div>
  );
}

export function ItemDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const [edit, setEdit] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['items', 'detail', id], queryFn: () => api.get<Item & { balances: { id: number; warehouse: { code: string }; location: { code: string; name: string }; qty_usable: number; qty_quarantine: number; qty_damaged: number }[] }>(`/items/${id}`) });
  if (isLoading || !data) return <Loading />;
  const total = data.balances.reduce((s, b) => s + b.qty_usable, 0);
  const rows: [string, React.ReactNode][] = [
    ['Mã', data.code], ['Tên', data.name], ['Tên tiếng Anh', data.name_en], ['Loại', data.kind === 'EQUIPMENT' ? 'Thiết bị' : 'Vật tư'], ['Nhóm', data.category?.name],
    ['Quy cách', data.specification], ['Model', data.model], ['Hãng SX', data.manufacturer], ['Xuất xứ', data.origin], ['ĐVT', data.unit?.code], ['Mã vạch', data.barcode],
    ['Vị trí mặc định', data.default_location?.code], ['Tồn tối thiểu / an toàn / tối đa', `${fmtNum(data.min_stock)} / ${fmtNum(data.safety_stock)} / ${fmtNum(data.max_stock) || '–'}`],
    ['Định mức xuất/phiếu', fmtNum(data.max_issue_qty) || '–'], ['NCC ưu tiên', data.preferred_supplier?.name], ['Serial / Mã tài sản', [data.serial_no, data.asset_code].filter(Boolean).join(' / ')], ['Ghi chú', data.note],
  ];
  return (
    <div>
      <PageHeader back={<Link to={data.kind === 'EQUIPMENT' ? '/equipment' : '/items'} className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-navy-700"><ArrowLeft size={12} />Danh mục</Link>}
        title={<>{data.code} – {data.name} <Badge status={data.status} /></>}
        actions={<>
          {can('stock.view') && <Link className="btn-outline" to={`/stock-card?item_id=${data.id}`}>Xem thẻ kho</Link>}
          {can('items.update') && <button className="btn-primary" onClick={() => setEdit(true)}><Pencil size={15} />Sửa</button>}
        </>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Thông tin vật tư" className="lg:col-span-2">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-2">
            {rows.map(([k, v]) => <div key={k} className="flex gap-2 border-b border-dashed border-slate-100 pb-1"><dt className="w-44 shrink-0 text-slate-500">{k}</dt><dd className="font-medium">{v || '–'}</dd></div>)}
          </dl>
        </Card>
        <Card title={`Tồn kho hiện tại: ${fmtNum(total)} ${data.unit?.code}`}>
          {data.balances.length === 0 ? <div className="text-sm text-slate-400">Chưa có tồn</div> : (
            <table className="table-base"><thead><tr><th>Vị trí</th><th className="text-right">Khả dụng</th><th className="text-right">Chờ KT</th><th className="text-right">Hỏng</th></tr></thead>
              <tbody>{data.balances.map((b) => <tr key={b.id}><td>{b.warehouse.code} / {b.location.code}</td><td className="text-right">{fmtNum(b.qty_usable)}</td><td className="text-right">{fmtNum(b.qty_quarantine)}</td><td className="text-right">{fmtNum(b.qty_damaged)}</td></tr>)}</tbody></table>
          )}
        </Card>
        <div className="lg:col-span-3"><AttachmentsPanel entityType="item" entityId={data.id} /></div>
      </div>
      {edit && <ItemForm item={data} kind={data.kind} onClose={() => setEdit(false)} />}
    </div>
  );
}
