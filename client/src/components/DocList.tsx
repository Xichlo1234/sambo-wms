import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useDebounce } from '@/lib/hooks';
import { STATUS } from '@/lib/constants';
import { DataTable, PageHeader, Pagination, SearchInput, type Column } from './ui';

/** Danh sách chứng từ dùng chung: tìm kiếm, lọc trạng thái, khoảng ngày, phân trang phía máy chủ */
export function DocList<T extends { id: number }>({ title, subtitle, endpoint, basePath, columns, statuses, actions, extraFilters, extraParams }: {
  title: string; subtitle?: string; endpoint: string; basePath: string; columns: Column<T>[]; statuses: string[];
  actions?: ReactNode; extraFilters?: ReactNode; extraParams?: Record<string, unknown>;
}) {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounce(q);
  useEffect(() => setPage(1), [dq, status, from, to]);
  useEffect(() => { if (status) sp.set('status', status); else sp.delete('status'); setSp(sp, { replace: true }); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  const params = { q: dq, status, from, to, page, pageSize: 20, pending_inspection: sp.get('pending_inspection') ?? undefined, ...extraParams };
  const { data, isLoading } = useQuery({ queryKey: [endpoint, 'list', params], queryFn: () => api.page<T>(endpoint, params), placeholderData: (p) => p });
  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <SearchInput value={q} onChange={setQ} placeholder="Tìm số phiếu, nội dung..." />
          <select className="input w-52" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tất cả trạng thái</option>
            {statuses.map((s) => <option key={s} value={s}>{STATUS[s]?.label ?? s}</option>)}
          </select>
          <span className="text-xs text-slate-500">Ngày CT từ</span>
          <input type="date" className="input w-36" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-xs text-slate-500">đến</span>
          <input type="date" className="input w-36" value={to} onChange={(e) => setTo(e.target.value)} />
          {extraFilters}
        </div>
        <DataTable loading={isLoading} rows={data?.data} columns={columns} onRowClick={(r) => nav(`${basePath}/${r.id}`)} />
        <Pagination meta={data?.meta} onPage={setPage} />
      </div>
    </div>
  );
}
