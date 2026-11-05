import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export function useDebounce<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export interface Lookup { id: number; code: string; name: string; [k: string]: unknown }
/** Danh mục dùng cho ô chọn – cache 5 phút (giảm lượt đọc) */
export function useLookup(path: string, params?: Record<string, unknown>, enabled = true) {
  return useQuery({ queryKey: ['lookup', path, params], queryFn: () => api.get<Lookup[]>(path, { all: 1, ...params }), staleTime: 5 * 60_000, enabled });
}

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api.get<Record<string, unknown>>('/settings'), staleTime: 5 * 60_000 });
}
