import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { X, Loader2, ChevronLeft, ChevronRight, AlertTriangle, CheckCircle2, Info, Inbox } from 'lucide-react';
import { STATUS, STOCK_STATUS } from '@/lib/constants';
import { ApiError } from '@/lib/api';

// ---------------- Toast ----------------
type Toast = { id: number; type: 'success' | 'error' | 'info'; text: string };
const ToastCtx = createContext<{ push: (t: Omit<Toast, 'id'>) => void }>(null as never);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { ...t, id }]);
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), t.type === 'error' ? 9000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="no-print fixed right-4 top-4 z-[100] flex w-96 max-w-[90vw] flex-col gap-2">
        {list.map((t) => (
          <div key={t.id} className={clsx('flex items-start gap-2 rounded-lg border p-3 text-sm shadow-lg', t.type === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-900', t.type === 'error' && 'border-red-200 bg-red-50 text-red-900', t.type === 'info' && 'border-sky-200 bg-sky-50 text-sky-900')}>
            {t.type === 'success' ? <CheckCircle2 size={18} /> : t.type === 'error' ? <AlertTriangle size={18} /> : <Info size={18} />}
            <div className="flex-1 whitespace-pre-line">{t.text}</div>
            <button onClick={() => setList((l) => l.filter((x) => x.id !== t.id))}><X size={14} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export function useToast() {
  const { push } = useContext(ToastCtx);
  return {
    success: (text: string) => push({ type: 'success', text }),
    info: (text: string) => push({ type: 'info', text }),
    error: (e: unknown) => push({ type: 'error', text: e instanceof ApiError || e instanceof Error ? e.message : String(e) }),
  };
}

// ---------------- Layout pieces ----------------
export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        {back}
        <h1 className="text-xl font-semibold text-navy-900">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('card', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
          <div className="font-semibold text-navy-900">{title}</div>
          <div className="no-print flex gap-2">{actions}</div>
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function Badge({ status, map = STATUS, children }: { status?: string; map?: Record<string, { label: string; cls: string }>; children?: ReactNode }) {
  const s = status ? map[status] : undefined;
  return <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', s?.cls ?? 'bg-slate-100 text-slate-700')}>{children ?? s?.label ?? status}</span>;
}
export const StockBadge = ({ status }: { status: string }) => <Badge status={status} map={STOCK_STATUS} />;

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('animate-spin text-navy-600', className)} size={20} />;
}
export function Loading() {
  return <div className="flex items-center justify-center gap-2 py-12 text-slate-500"><Spinner /> Đang tải...</div>;
}
export function Empty({ text = 'Không có dữ liệu' }: { text?: string }) {
  return <div className="flex flex-col items-center gap-2 py-10 text-slate-400"><Inbox size={32} />{text}</div>;
}
export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle className="mr-1 inline" size={16} />{error instanceof Error ? error.message : String(error)}</div>;
}
export function Alert({ type = 'info', children }: { type?: 'info' | 'warning' | 'danger' | 'success'; children: ReactNode }) {
  const cls = { info: 'border-sky-200 bg-sky-50 text-sky-900', warning: 'border-amber-200 bg-amber-50 text-amber-900', danger: 'border-red-200 bg-red-50 text-red-900', success: 'border-emerald-200 bg-emerald-50 text-emerald-900' }[type];
  return <div className={clsx('rounded-md border p-3 text-sm', cls)}>{children}</div>;
}

// ---------------- Modal ----------------
export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (open) window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 pt-10" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={clsx('w-full rounded-lg bg-white shadow-xl', w)}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h3 className="text-base font-semibold text-navy-900">{title}</h3>
          <button className="btn-ghost btn-sm" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t bg-slate-50 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Hộp thoại xác nhận có (hoặc không) nhập lý do */
export function ReasonDialog({ open, title, message, label = 'Lý do', required = true, confirmText = 'Xác nhận', danger, onClose, onConfirm, loading }: {
  open: boolean; title: string; message?: ReactNode; label?: string; required?: boolean; confirmText?: string; danger?: boolean;
  onClose: () => void; onConfirm: (reason: string) => void; loading?: boolean;
}) {
  const [v, setV] = useState('');
  useEffect(() => { if (open) setV(''); }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={<>
        <button className="btn-outline" onClick={onClose}>Đóng</button>
        <button className={danger ? 'btn-danger' : 'btn-primary'} disabled={loading || (required && v.trim().length < 3)} onClick={() => onConfirm(v.trim())}>{loading && <Spinner className="h-4 w-4 text-white" />}{confirmText}</button>
      </>}>
      {message && <div className="mb-3 text-sm text-slate-600">{message}</div>}
      <label className="label">{label}{required && ' *'}</label>
      <textarea className="input" rows={3} value={v} onChange={(e) => setV(e.target.value)} autoFocus />
      {required && <div className="mt-1 text-xs text-slate-400">Tối thiểu 3 ký tự</div>}
    </Modal>
  );
}

// ---------------- Form field ----------------
export function Field({ label, error, required, children, hint, className }: { label: string; error?: string; required?: boolean; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="label">{label}{required && <span className="text-red-500"> *</span>}</label>
      {children}
      {hint && !error && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
      {error && <div className="mt-0.5 text-xs text-red-600">{error}</div>}
    </div>
  );
}

// ---------------- Pagination & table ----------------
export function Pagination({ meta, onPage }: { meta?: { page: number; totalPages: number; total: number; pageSize: number }; onPage: (p: number) => void }) {
  if (!meta) return null;
  return (
    <div className="no-print flex items-center justify-between border-t px-3 py-2 text-xs text-slate-500">
      <div>Tổng: <b>{meta.total.toLocaleString('vi-VN')}</b> bản ghi</div>
      <div className="flex items-center gap-1">
        <button className="btn-ghost btn-sm" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}><ChevronLeft size={14} /></button>
        <span>Trang {meta.page}/{meta.totalPages}</span>
        <button className="btn-ghost btn-sm" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}><ChevronRight size={14} /></button>
      </div>
    </div>
  );
}

export interface Column<T> { key: string; header: ReactNode; render?: (row: T) => ReactNode; className?: string; align?: 'right' | 'center' }
export function DataTable<T extends { id?: number | string }>({ columns, rows, loading, onRowClick, empty, rowKey }: { columns: Column<T>[]; rows?: T[]; loading?: boolean; onRowClick?: (r: T) => void; empty?: string; rowKey?: (r: T, i: number) => string | number }) {
  return (
    <div className="overflow-x-auto">
      <table className="table-base">
        <thead><tr>{columns.map((c) => <th key={c.key} className={clsx(c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.className)}>{c.header}</th>)}</tr></thead>
        <tbody>
          {loading && <tr><td colSpan={columns.length}><Loading /></td></tr>}
          {!loading && rows?.length === 0 && <tr><td colSpan={columns.length}><Empty text={empty} /></td></tr>}
          {!loading && rows?.map((r, i) => (
            <tr key={rowKey ? rowKey(r, i) : (r.id ?? i)} className={clsx(onRowClick && 'cursor-pointer')} onClick={() => onRowClick?.(r)}>
              {columns.map((c) => <td key={c.key} className={clsx(c.align === 'right' && 'text-right tabular-nums', c.align === 'center' && 'text-center', c.className)}>{c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Tìm kiếm...' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input className="input max-w-xs" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
}

export function Tabs({ tabs, value, onChange }: { tabs: { key: string; label: ReactNode }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div className="no-print mb-4 flex gap-1 overflow-x-auto border-b">
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)} className={clsx('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium', value === t.key ? 'border-gold-500 text-navy-900' : 'border-transparent text-slate-500 hover:text-navy-700')}>{t.label}</button>
      ))}
    </div>
  );
}
