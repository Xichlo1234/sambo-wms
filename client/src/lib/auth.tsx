import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, setUnauthorizedHandler } from './api';

export interface Me {
  id: number; username: string; full_name: string; email?: string | null;
  department: { id: number; code: string; name: string } | null;
  roles: string[]; permissions: string[]; must_change_password: boolean;
}

interface Ctx { me: Me | null; loading: boolean; can: (...p: string[]) => boolean; refresh: () => void; logout: () => Promise<void> }
const AuthCtx = createContext<Ctx>(null as never);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [expired, setExpired] = useState(false);
  const { data, isLoading, refetch } = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/auth/me'), retry: false, staleTime: 5 * 60_000 });
  useEffect(() => {
    setUnauthorizedHandler(() => { if (!expired) { setExpired(true); qc.setQueryData(['me'], null); qc.clear(); } });
  }, [qc, expired]);
  useEffect(() => { if (data) setExpired(false); }, [data]);
  const perms = new Set(data?.permissions ?? []);
  const value: Ctx = {
    me: data ?? null,
    loading: isLoading,
    can: (...p) => p.some((x) => perms.has(x)),
    refresh: () => { refetch(); },
    logout: async () => { await api.post('/auth/logout').catch(() => undefined); qc.clear(); qc.setQueryData(['me'], null); },
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);
