import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Download, Trash2, Eye, FileDown, Printer, FileSpreadsheet } from 'lucide-react';
import { api } from '@/lib/api';
import { useDebounce, useLookup } from '@/lib/hooks';
import { fmtDateTime, fmtNum } from '@/lib/format';
import { ATTACH_CATEGORIES } from '@/lib/constants';
import { useAuth } from '@/lib/auth';
import { Card, useToast, Spinner } from './ui';

export function LookupSelect({ path, value, onChange, placeholder = '-- Chọn --', params, disabled, className, labelFn }: {
  path: string; value: number | string | null | undefined; onChange: (v: number | null) => void; placeholder?: string;
  params?: Record<string, unknown>; disabled?: boolean; className?: string; labelFn?: (r: { code: string; name: string }) => string;
}) {
  const { data, isLoading } = useLookup(path, params);
  return (
    <select className={className ?? 'input'} value={value ?? ''} disabled={disabled || isLoading} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">{isLoading ? 'Đang tải...' : placeholder}</option>
      {data?.map((r) => <option key={r.id} value={r.id}>{labelFn ? labelFn(r) : `${r.code} – ${r.name}`}</option>)}
    </select>
  );
}

export interface PickedItem { id: number; code: string; name: string; specification?: string | null; unit: { code: string }; available?: number; usable?: number; max_issue_qty?: number | null; default_location_id?: number | null }

/** Ô tìm & chọn vật tư (tìm theo mã / tên không dấu / mã vạch), hiển thị tồn khả dụng */
export function ItemPicker({ value, onPick, warehouseId, kind, placeholder = 'Gõ mã, tên hoặc quét mã vạch...', disabled }: {
  value?: PickedItem | null; onPick: (it: PickedItem | null) => void; warehouseId?: number | null; kind?: string; placeholder?: string; disabled?: boolean;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const dq = useDebounce(q, 250);
  const ref = useRef<HTMLDivElement>(null);
  const { data, isFetching } = useQuery({
    queryKey: ['item-lookup', dq, warehouseId, kind], enabled: open,
    queryFn: () => api.get<PickedItem[]>('/items/lookup', { q: dq, warehouse_id: warehouseId, kind }),
  });
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  if (value && !open) {
    return (
      <div className="flex items-center gap-1">
        <div className="input flex-1 truncate bg-slate-50" title={value.name}><b>{value.code}</b> – {value.name}</div>
        {!disabled && <button type="button" className="btn-ghost btn-sm" onClick={() => { onPick(null); setOpen(true); }}>Đổi</button>}
      </div>
    );
  }
  return (
    <div ref={ref} className="relative">
      <input className="input" placeholder={placeholder} value={q} disabled={disabled} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      {open && (
        <div className="absolute left-0 z-30 mt-1 max-h-72 w-[36rem] max-w-[90vw] overflow-y-auto rounded-md border bg-white shadow-lg">
          {isFetching && <div className="p-2 text-xs text-slate-500">Đang tìm...</div>}
          {!isFetching && data?.length === 0 && <div className="p-2 text-xs text-slate-500">Không tìm thấy vật tư đang hoạt động</div>}
          {data?.map((it) => (
            <button type="button" key={it.id} className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-navy-50" onClick={() => { onPick(it); setOpen(false); setQ(''); }}>
              <span><b>{it.code}</b> – {it.name}{it.specification && <span className="text-xs text-slate-500"> ({it.specification})</span>}</span>
              <span className="shrink-0 text-xs text-slate-500">{it.available !== undefined && <>Khả dụng: <b className={it.available > 0 ? 'text-emerald-700' : 'text-red-600'}>{fmtNum(it.available)}</b> </>}{it.unit.code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AttachmentsPanel({ entityType, entityId, locked }: { entityType: string; entityId: number; locked?: boolean }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [category, setCategory] = useState('OTHER');
  const fileRef = useRef<HTMLInputElement>(null);
  const key = ['attachments', entityType, entityId];
  const { data } = useQuery({ queryKey: key, queryFn: () => api.get<{ id: number; file_name: string; category: string; size_bytes: number; created_at: string; uploader?: string; mime_type: string }[]>('/attachments', { entity_type: entityType, entity_id: entityId }) });
  const up = useMutation({
    mutationFn: (files: FileList) => {
      const fd = new FormData();
      fd.append('entity_type', entityType); fd.append('entity_id', String(entityId)); fd.append('category', category);
      Array.from(files).forEach((f) => fd.append('files', f));
      return api.post('/attachments', fd);
    },
    onSuccess: () => { toast.success('Đã tải lên tài liệu'); qc.invalidateQueries({ queryKey: key }); if (fileRef.current) fileRef.current.value = ''; },
    onError: toast.error,
  });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/attachments/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: key }), onError: toast.error });
  return (
    <Card title={<span className="flex items-center gap-1.5"><Paperclip size={16} />Tài liệu đính kèm ({data?.length ?? 0})</span>}>
      {can('attachments.upload') && (
        <div className="no-print mb-3 flex flex-wrap items-center gap-2">
          <select className="input w-44" value={category} onChange={(e) => setCategory(e.target.value)}>
            {Object.entries(ATTACH_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input ref={fileRef} type="file" multiple accept=".pdf,.xlsx,.docx,.jpg,.jpeg,.png" className="text-sm" onChange={(e) => e.target.files?.length && up.mutate(e.target.files)} />
          {up.isPending && <Spinner />}
          <span className="text-xs text-slate-400">PDF, XLSX, DOCX, JPG, PNG</span>
        </div>
      )}
      {!data?.length ? <div className="text-sm text-slate-400">Chưa có tài liệu</div> : (
        <ul className="divide-y text-sm">
          {data.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 py-1.5">
              <div className="min-w-0"><span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px]">{ATTACH_CATEGORIES[a.category] ?? a.category}</span><span className="truncate">{a.file_name}</span>
                <span className="ml-2 text-xs text-slate-400">{(a.size_bytes / 1024).toFixed(0)} KB · {a.uploader} · {fmtDateTime(a.created_at)}</span></div>
              <div className="no-print flex shrink-0 gap-1">
                {(a.mime_type.startsWith('image/') || a.mime_type === 'application/pdf') && <button className="btn-ghost btn-sm" title="Xem" onClick={() => api.download(`/attachments/${a.id}/download`, { inline: 1 }, { open: true }).catch(toast.error)}><Eye size={14} /></button>}
                <button className="btn-ghost btn-sm" title="Tải về" onClick={() => api.download(`/attachments/${a.id}/download`).catch(toast.error)}><Download size={14} /></button>
                {can('attachments.delete') && !locked && <button className="btn-ghost btn-sm text-red-600" title="Gỡ" onClick={() => confirm(`Gỡ tài liệu "${a.file_name}"?`) && del.mutate(a.id)}><Trash2 size={14} /></button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const ACTION_LABEL: Record<string, string> = { CREATE: 'Tạo phiếu', SUBMIT: 'Gửi duyệt', APPROVE: 'Phê duyệt', REJECT: 'Từ chối', CANCEL: 'Hủy', ISSUE: 'Xuất kho', CONFIRM: 'Xác nhận nhận hàng', INSPECT: 'Kiểm tra chất lượng', FREEZE: 'Chốt tồn sổ' };
export function HistoryTimeline({ history }: { history?: { id: string | number; action: string; comment?: string | null; created_at: string; user: { full_name: string } }[] }) {
  if (!history?.length) return null;
  return (
    <Card title="Lịch sử xử lý">
      <ol className="relative ml-2 border-l border-slate-200">
        {history.map((h) => (
          <li key={String(h.id)} className="mb-3 ml-4">
            <div className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full border-2 border-white bg-gold-500" />
            <div className="text-sm"><b>{ACTION_LABEL[h.action] ?? h.action}</b> – {h.user.full_name}</div>
            <div className="text-xs text-slate-500">{fmtDateTime(h.created_at)}</div>
            {h.comment && <div className="mt-0.5 text-xs italic text-slate-600">“{h.comment}”</div>}
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function PrintButton({ type, id }: { type: string; id: number }) {
  const toast = useToast();
  return <button className="btn-outline" onClick={() => api.download(`/print/${type}/${id}`, {}, { open: true }).catch(toast.error)}><Printer size={15} />In phiếu (PDF)</button>;
}

export function ExportButtons({ reportKey, params }: { reportKey: string; params: Record<string, unknown> }) {
  const { can } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState('');
  if (!can('reports.export')) return null;
  const go = async (format: string, open = false) => {
    setBusy(format + open);
    try { await api.download(`/reports/${reportKey}/export`, { ...params, format, ...(open ? { inline: 1 } : {}) }, { open }); } catch (e) { toast.error(e); } finally { setBusy(''); }
  };
  return (
    <>
      <button className="btn-outline" disabled={!!busy} onClick={() => go('xlsx')}><FileSpreadsheet size={15} />Excel</button>
      <button className="btn-outline" disabled={!!busy} onClick={() => go('pdf')}><FileDown size={15} />PDF</button>
      <button className="btn-outline" disabled={!!busy} onClick={() => go('pdf', true)}><Printer size={15} />In</button>
    </>
  );
}

export interface PickedChemical { id: number; code: string; name: string; cas_number?: string | null; concentration?: string | null; is_controlled: boolean; unit: { code: string }; available?: number; on_hand?: number; sds_state?: string; ghs_pictograms?: string[]; default_shelf_life_days?: number | null }

/** Ô tìm & chọn hóa chất (mã, tên không dấu, CAS) – kèm tồn được phép xuất & tình trạng SDS */
export function ChemicalPicker({ value, onPick, warehouseId, disabled }: { value?: PickedChemical | null; onPick: (c: PickedChemical | null) => void; warehouseId?: number | null; disabled?: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const dq = useDebounce(q, 250);
  const ref = useRef<HTMLDivElement>(null);
  const { data, isFetching } = useQuery({ queryKey: ['chem-lookup', dq, warehouseId], enabled: open, queryFn: () => api.get<PickedChemical[]>('/chemicals/lookup', { q: dq, warehouse_id: warehouseId }) });
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  if (value && !open) {
    return (
      <div className="flex items-center gap-1">
        <div className="input flex-1 truncate bg-slate-50" title={value.name}><b>{value.code}</b> – {value.name}{value.is_controlled && <span className="ml-1 rounded bg-red-100 px-1 text-[10px] text-red-700">KSĐB</span>}</div>
        {!disabled && <button type="button" className="btn-ghost btn-sm" onClick={() => { onPick(null); setOpen(true); }}>Đổi</button>}
      </div>
    );
  }
  return (
    <div ref={ref} className="relative">
      <input className="input" placeholder="Gõ mã, tên hóa chất hoặc số CAS..." value={q} disabled={disabled} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      {open && (
        <div className="absolute left-0 z-30 mt-1 max-h-72 w-[36rem] max-w-[90vw] overflow-y-auto rounded-md border bg-white shadow-lg">
          {isFetching && <div className="p-2 text-xs text-slate-500">Đang tìm...</div>}
          {!isFetching && data?.length === 0 && <div className="p-2 text-xs text-slate-500">Không tìm thấy hóa chất đang sử dụng</div>}
          {data?.map((c) => (
            <button type="button" key={c.id} className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-navy-50" onClick={() => { onPick(c); setOpen(false); setQ(''); }}>
              <span><b>{c.code}</b> – {c.name}{c.cas_number && <span className="text-xs text-slate-500"> (CAS {c.cas_number})</span>}{c.is_controlled && <span className="ml-1 rounded bg-red-100 px-1 text-[10px] text-red-700">Kiểm soát ĐB</span>}</span>
              <span className="shrink-0 text-xs text-slate-500">{c.available !== undefined && <>Được xuất: <b className={c.available > 0 ? 'text-emerald-700' : 'text-red-600'}>{fmtNum(c.available)}</b> </>}{c.unit.code}{c.sds_state && c.sds_state !== 'OK' && <span className="ml-1 text-amber-700">· {c.sds_state === 'MISSING' ? 'thiếu SDS' : c.sds_state === 'EXPIRED' ? 'SDS quá hạn' : 'SDS chưa XN'}</span>}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Chọn vật tư (kho mỏ) HOẶC hóa chất – dùng cho đề nghị mua / đơn đặt hàng */
export function TargetPicker({ kind, onKind, item, chemical, onItem, onChemical, disabled }: { kind: 'item' | 'chemical'; onKind: (k: 'item' | 'chemical') => void; item: PickedItem | null; chemical: PickedChemical | null; onItem: (i: PickedItem | null) => void; onChemical: (c: PickedChemical | null) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start gap-1">
      <select className="input w-28 shrink-0" value={kind} disabled={disabled} onChange={(e) => { onKind(e.target.value as 'item'); onItem(null); onChemical(null); }}>
        <option value="item">Vật tư</option><option value="chemical">Hóa chất</option>
      </select>
      <div className="flex-1">{kind === 'item' ? <ItemPicker value={item} onPick={onItem} disabled={disabled} /> : <ChemicalPicker value={chemical} onPick={onChemical} disabled={disabled} />}</div>
    </div>
  );
}

export function GhsIcons({ codes }: { codes?: string[] }) {
  if (!codes?.length) return null;
  return <span className="inline-flex flex-wrap gap-1">{codes.map((c) => <span key={c} title={c} className="inline-flex h-6 w-6 rotate-45 items-center justify-center border-2 border-red-600 bg-white text-[8px] font-bold text-red-700"><span className="-rotate-45">{c.slice(3)}</span></span>)}</span>;
}
