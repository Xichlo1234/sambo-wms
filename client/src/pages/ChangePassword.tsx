import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Card, PageHeader, useToast, Alert } from '@/components/ui';

export default function ChangePassword() {
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const toast = useToast();
  const { me, refresh } = useAuth();
  const nav = useNavigate();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) return toast.error('Mật khẩu nhập lại không khớp');
    try {
      await api.post('/auth/change-password', { current_password: cur, new_password: pw });
      toast.success('Đã đổi mật khẩu');
      refresh();
      nav('/');
    } catch (e) { toast.error(e); }
  };
  return (
    <div className="max-w-md">
      <PageHeader title="Đổi mật khẩu" />
      {me?.must_change_password && <div className="mb-3"><Alert type="warning">Bạn đang dùng mật khẩu ban đầu. Vui lòng đổi mật khẩu để tiếp tục sử dụng hệ thống.</Alert></div>}
      <Card>
        <form onSubmit={submit} className="space-y-3">
          <div><label className="label">Mật khẩu hiện tại</label><input type="password" className="input" value={cur} onChange={(e) => setCur(e.target.value)} /></div>
          <div><label className="label">Mật khẩu mới (≥ 8 ký tự, có chữ và số)</label><input type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
          <div><label className="label">Nhập lại mật khẩu mới</label><input type="password" className="input" value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
          <button className="btn-primary" disabled={!cur || pw.length < 8}>Lưu mật khẩu mới</button>
        </form>
      </Card>
    </div>
  );
}
