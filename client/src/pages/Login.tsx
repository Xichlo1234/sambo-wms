import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Spinner } from '@/components/ui';

export default function Login() {
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();
  const { me } = useAuth();
  if (me) return <Navigate to="/" replace />;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const r = await api.post<{ must_change_password: boolean }>('/auth/login', { username, password });
      await qc.invalidateQueries({ queryKey: ['me'] });
      nav(r.must_change_password ? '/change-password' : '/');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-navy-950 via-navy-900 to-navy-700 p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl bg-white p-8 shadow-2xl">
        <div className="mb-6 flex flex-col items-center gap-2">
          <img src="/logo.svg" className="h-14 w-14" alt="" />
          <div className="text-center">
            <div className="text-lg font-bold tracking-wide text-navy-900">SAMBO GOLD</div>
            <div className="text-xs uppercase tracking-wider text-gold-600">Warehouse Management System</div>
          </div>
        </div>
        <label className="label">Tên đăng nhập</label>
        <input className="input mb-3" value={username} onChange={(e) => setU(e.target.value)} autoFocus autoComplete="username" />
        <label className="label">Mật khẩu</label>
        <input className="input mb-4" type="password" value={password} onChange={(e) => setP(e.target.value)} autoComplete="current-password" />
        {err && <div className="mb-3 rounded-md bg-red-50 p-2 text-sm text-red-700">{err}</div>}
        <button className="btn-primary w-full py-2" disabled={busy || !username || !password}>{busy && <Spinner className="h-4 w-4 text-white" />}Đăng nhập</button>
        <p className="mt-4 text-center text-xs text-slate-400">Quên mật khẩu? Liên hệ quản trị hệ thống để đặt lại.</p>
      </form>
    </div>
  );
}
