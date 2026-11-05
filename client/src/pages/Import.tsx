/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileSearch, Upload, FileWarning } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLookup } from '@/lib/hooks';
import { fmtDateTime, todayISO } from '@/lib/format';
import { Alert, Card, PageHeader, Spinner, Tabs, useToast } from '@/components/ui';

const TYPES = [
  { key: 'items', label: 'Danh mục vật tư / thiết bị', perm: ['items.import'] },
  { key: 'opening_stock', label: 'Tồn kho ban đầu', perm: ['adjustments.create'] },
  { key: 'chemicals', label: 'Danh mục hóa chất', perm: ['chemicals.manage'] },
  { key: 'suppliers', label: 'Nhà cung cấp', perm: ['suppliers.manage', 'import.run'] },
  { key: 'departments', label: 'Bộ phận sử dụng', perm: ['departments.manage', 'import.run'] },
];
const ST: Record<string, { label: string; cls: string }> = { NEW: { label: 'Mới – sẽ nhập', cls: 'text-emerald-700' }, DUPLICATE: { label: 'Trùng – bỏ qua', cls: 'text-slate-500' }, ERROR: { label: 'Lỗi', cls: 'text-red-600' } };

export default function ImportPage() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const types = TYPES.filter((t) => can(...t.perm));
  const type = sp.get('type') && types.some((t) => t.key === sp.get('type')) ? sp.get('type')! : types[0]?.key;
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [opts, setOpts] = useState({ warehouse_id: '', doc_date: todayISO(), auto_create_refs: false, skip_errors: false });
  const [show, setShow] = useState<'ALL' | 'ERROR' | 'NEW' | 'DUPLICATE'>('ALL');
  const { data: whs } = useLookup('/warehouses');
  const { data: hist } = useQuery({ queryKey: ['import-history'], queryFn: () => api.get<any[]>('/import/history') });
  const fd = () => {
    const f = new FormData();
    f.append('file', file!);
    if (opts.warehouse_id) f.append('warehouse_id', opts.warehouse_id);
    f.append('doc_date', opts.doc_date);
    f.append('auto_create_refs', String(opts.auto_create_refs));
    f.append('skip_errors', String(opts.skip_errors));
    return f;
  };
  const run = async (step: 'preview' | 'commit' | 'error-report') => {
    if (!file) return toast.error('Chọn file Excel');
    setBusy(step);
    try {
      if (step === 'preview') { setPreview(await api.post(`/import/${type}/preview`, fd())); setShow('ALL'); }
      else if (step === 'error-report') {
        const res = await fetch(`/api/import/${type}/error-report`, { method: 'POST', body: fd(), credentials: 'include', headers: { 'X-Requested-With': 'wms' } });
        if (!res.ok) throw new Error((await res.json()).error.message);
        const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = `Ket_qua_kiem_tra_${type}.xlsx`; a.click();
      } else {
        const r = await api.post<any>(`/import/${type}/commit`, fd());
        toast.success(`Đã nhập ${r.inserted} dòng, bỏ qua ${r.skipped} dòng.${r.ref_doc ? ` Đã tạo phiếu ${r.ref_doc} chờ duyệt.` : ''}`);
        setPreview(null); setFile(null);
        qc.invalidateQueries();
      }
    } catch (e) { toast.error(e); } finally { setBusy(''); }
  };
  if (!type) return <Alert type="warning">Bạn không có quyền import dữ liệu.</Alert>;
  const rows = preview?.rows.filter((r: any) => show === 'ALL' || r.status === show) ?? [];
  const cols = rows[0] ? Object.keys(rows[0].data) : [];
  return (
    <div>
      <PageHeader title="Nhập dữ liệu từ Excel" subtitle="Tải file mẫu → điền dữ liệu → Kiểm tra & xem trước (chưa ghi DB) → Xác nhận nhập. Hệ thống không ghi đè dữ liệu đã có." />
      <Tabs value={type} onChange={(k) => { setSp({ type: k }); setPreview(null); setFile(null); }} tabs={types.map((t) => ({ key: t.key, label: t.label }))} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="1. Chọn file" className="lg:col-span-1">
          <button className="btn-outline mb-3 w-full" onClick={() => api.download(`/import/templates/${type}`).catch(toast.error)}><Download size={15} />Tải file Excel mẫu</button>
          {type === 'opening_stock' && <>
            <label className="label">Kho nhập tồn đầu kỳ *</label>
            <select className="input mb-2" value={opts.warehouse_id} onChange={(e) => setOpts({ ...opts, warehouse_id: e.target.value })}><option value="">-- Chọn kho --</option>{whs?.filter((w) => w.type === 'GENERAL').map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
            <label className="label">Ngày chứng từ tồn đầu kỳ</label>
            <input type="date" className="input mb-2" value={opts.doc_date} onChange={(e) => setOpts({ ...opts, doc_date: e.target.value })} />
            <Alert type="info">Tồn đầu kỳ tạo thành <b>phiếu điều chỉnh chờ duyệt</b>, chỉ cập nhật tồn khi Quản lý kho (người khác) phê duyệt. Mặt hàng đã có giao dịch sẽ bị bỏ qua.</Alert>
          </>}
          {type === 'chemicals' && <div className="mt-2"><Alert type="warning">Chỉ import thông tin định danh. Thông tin nguy hiểm, GHS, bảo quản, bảo hộ phải nhập theo SDS và được HSE xác nhận trên hệ thống.</Alert></div>}
          {type === 'items' && <label className="mb-2 mt-2 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={opts.auto_create_refs} onChange={(e) => setOpts({ ...opts, auto_create_refs: e.target.checked })} />Tự tạo Nhóm vật tư / Đơn vị tính chưa có trong hệ thống (theo mã trong file)</label>}
          <input type="file" accept=".xlsx" className="mt-2 text-sm" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} />
          <button className="btn-primary mt-3 w-full" disabled={!file || !!busy || (type === 'opening_stock' && !opts.warehouse_id)} onClick={() => run('preview')}>{busy === 'preview' ? <Spinner className="h-4 w-4 text-white" /> : <FileSearch size={15} />}Kiểm tra & xem trước</button>
        </Card>
        <Card title="2. Kết quả kiểm tra" className="lg:col-span-2">
          {!preview ? <div className="py-10 text-center text-sm text-slate-400">Chưa kiểm tra file</div> : (
            <>
              <div className="mb-3 flex flex-wrap gap-2 text-sm">
                {[['ALL', `Tất cả: ${preview.summary.total}`], ['NEW', `Mới: ${preview.summary.new}`], ['DUPLICATE', `Trùng: ${preview.summary.duplicate}`], ['ERROR', `Lỗi: ${preview.summary.error}`]].map(([k, l]) => (
                  <button key={k} className={show === k ? 'btn-primary btn-sm' : 'btn-outline btn-sm'} onClick={() => setShow(k as never)}>{l}</button>
                ))}
                {(preview.summary.error > 0 || preview.summary.duplicate > 0) && <button className="btn-outline btn-sm ml-auto" onClick={() => run('error-report')}><FileWarning size={14} />Tải báo cáo dòng lỗi</button>}
              </div>
              <div className="max-h-[50vh] overflow-auto">
                <table className="table-base">
                  <thead><tr><th>Dòng</th><th>Trạng thái</th><th>Lỗi / cảnh báo</th>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>{rows.map((r: any) => (
                    <tr key={r.row}><td>{r.row}</td><td className={`whitespace-nowrap font-medium ${ST[r.status].cls}`}>{ST[r.status].label}</td>
                      <td className="text-xs"><span className="text-red-600">{r.errors.join('; ')}</span>{r.warnings.length > 0 && <span className="text-amber-700"> {r.warnings.join('; ')}</span>}</td>
                      {cols.map((c) => <td key={c} className="text-xs">{r.data[c]}</td>)}</tr>
                  ))}</tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-end gap-3 border-t pt-3">
                {preview.summary.error > 0 && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={opts.skip_errors} onChange={(e) => setOpts({ ...opts, skip_errors: e.target.checked })} />Bỏ qua {preview.summary.error} dòng lỗi, chỉ nhập dòng hợp lệ</label>}
                <button className="btn-success" disabled={!!busy || preview.summary.new === 0 || (preview.summary.error > 0 && !opts.skip_errors)} onClick={() => confirm(`Xác nhận nhập ${preview.summary.new} dòng mới?`) && run('commit')}>{busy === 'commit' ? <Spinner className="h-4 w-4 text-white" /> : <Upload size={15} />}3. Xác nhận nhập {preview.summary.new} dòng</button>
              </div>
            </>
          )}
        </Card>
        <Card title="Lịch sử import" className="lg:col-span-3">
          <table className="table-base"><thead><tr><th>Thời gian</th><th>Loại</th><th>File</th><th className="text-right">Tổng</th><th className="text-right">Đã nhập</th><th className="text-right">Bỏ qua</th><th className="text-right">Lỗi</th><th>Chứng từ</th><th>Người thực hiện</th></tr></thead>
            <tbody>{hist?.map((h) => <tr key={h.id}><td>{fmtDateTime(h.created_at)}</td><td>{TYPES.find((t) => t.key === h.import_type)?.label}</td><td>{h.file_name}</td><td className="text-right">{h.total_rows}</td><td className="text-right text-emerald-700">{h.success_rows}</td><td className="text-right">{h.skipped_rows}</td><td className="text-right text-red-600">{h.error_rows}</td><td>{h.ref_doc && <Link className="text-navy-700 underline" to={`/adjustments?q=${h.ref_doc}`}>{h.ref_doc}</Link>}</td><td>{h.user}</td></tr>)}</tbody></table>
        </Card>
      </div>
    </div>
  );
}
