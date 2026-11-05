/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Lock, Unlock, KeyRound, DatabaseBackup, ShieldCheck, Download, RotateCcw, Scale } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounce, useLookup } from '@/lib/hooks';
import { fmtDateTime } from '@/lib/format';
import { Alert, Badge, Card, DataTable, Field, Modal, PageHeader, Pagination, SearchInput, Spinner, Tabs, useToast } from '@/components/ui';
import { LookupSelect } from '@/components/shared';
import { WarehousesPanel, LocationsPanel, CategoriesPanel, UnitsPanel } from './MasterData';

// ================= NGƯỜI DÙNG =================
export function UsersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<any>(undefined);
  const [form, setForm] = useState<any>({});
  const [reset, setReset] = useState<any>(null);
  const [pw, setPw] = useState('');
  const dq = useDebounce(q);
  const { data, isLoading } = useQuery({ queryKey: ['users', dq, page], queryFn: () => api.page<any>('/users', { q: dq, page }) });
  const { data: roles } = useQuery({ queryKey: ['roles'], queryFn: () => api.get<any[]>('/roles') });
  useEffect(() => { if (edit !== undefined) setForm(edit ? { ...edit, role_ids: edit.roles.map((r: any) => r.role.id) } : { role_ids: [] }); }, [edit]);
  const save = useMutation({
    mutationFn: () => {
      const body = { username: form.username, full_name: form.full_name, email: form.email ?? '', phone: form.phone, position: form.position, department_id: form.department_id ?? null, role_ids: form.role_ids, ...(edit ? {} : { password: form.password }) };
      return edit ? api.put(`/users/${edit.id}`, body) : api.post('/users', body);
    },
    onSuccess: () => { toast.success('Đã lưu người dùng'); qc.invalidateQueries({ queryKey: ['users'] }); setEdit(undefined); }, onError: toast.error,
  });
  const lock = useMutation({ mutationFn: (u: any) => api.patch(`/users/${u.id}/status`, { status: u.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }), onError: toast.error });
  const doReset = useMutation({ mutationFn: () => api.post(`/users/${reset.id}/reset-password`, { password: pw }), onSuccess: () => { toast.success('Đã đặt lại mật khẩu – người dùng phải đổi khi đăng nhập'); setReset(null); setPw(''); }, onError: toast.error });
  return (
    <div>
      <PageHeader title="Quản lý người dùng" subtitle="Mỗi người dùng được gán vai trò; không mặc định cho mọi người quyền truy cập toàn bộ dữ liệu" actions={<button className="btn-primary" onClick={() => setEdit(null)}><Plus size={15} />Thêm người dùng</button>} />
      <div className="card">
        <div className="border-b p-3"><SearchInput value={q} onChange={setQ} placeholder="Tên đăng nhập, họ tên..." /></div>
        <DataTable loading={isLoading} rows={data?.data} columns={[
          { key: 'username', header: 'Tên đăng nhập', render: (r: any) => <b>{r.username}</b> }, { key: 'full_name', header: 'Họ tên' }, { key: 'position', header: 'Chức vụ' },
          { key: 'dept', header: 'Bộ phận', render: (r: any) => r.department?.name }, { key: 'roles', header: 'Vai trò', render: (r: any) => <div className="flex flex-wrap gap-1">{r.roles.map((x: any) => <span key={x.role.id} className="rounded bg-navy-50 px-1.5 py-0.5 text-xs text-navy-700">{x.role.name}</span>)}</div> },
          { key: 'last', header: 'Đăng nhập cuối', render: (r: any) => fmtDateTime(r.last_login_at) }, { key: 'status', header: 'Trạng thái', render: (r: any) => <Badge status={r.status} /> },
          { key: 'act', header: '', render: (r: any) => <div className="flex gap-1"><button className="btn-ghost btn-sm" onClick={() => setEdit(r)} title="Sửa"><Pencil size={14} /></button><button className="btn-ghost btn-sm" title="Đặt lại mật khẩu" onClick={() => setReset(r)}><KeyRound size={14} /></button><button className="btn-ghost btn-sm" title={r.status === 'ACTIVE' ? 'Khóa' : 'Mở'} onClick={() => confirm(`${r.status === 'ACTIVE' ? 'Khóa' : 'Mở khóa'} tài khoản ${r.username}?`) && lock.mutate(r)}>{r.status === 'ACTIVE' ? <Lock size={14} /> : <Unlock size={14} />}</button></div> },
        ]} />
        <Pagination meta={data?.meta} onPage={setPage} />
      </div>
      <Modal open={edit !== undefined} onClose={() => setEdit(undefined)} title={edit ? `Sửa ${edit.username}` : 'Thêm người dùng'} size="lg"
        footer={<><button className="btn-outline" onClick={() => setEdit(undefined)}>Hủy</button><button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>Lưu</button></>}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Tên đăng nhập" required><input className="input" disabled={!!edit} value={form.username ?? ''} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
          <Field label="Họ tên" required className="md:col-span-2"><input className="input" value={form.full_name ?? ''} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
          {!edit && <Field label="Mật khẩu ban đầu" required hint="≥ 8 ký tự, có chữ và số. Bắt buộc đổi khi đăng nhập lần đầu."><input className="input" type="password" value={form.password ?? ''} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>}
          <Field label="Email"><input className="input" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Điện thoại"><input className="input" value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="Chức vụ"><input className="input" value={form.position ?? ''} onChange={(e) => setForm({ ...form, position: e.target.value })} /></Field>
          <Field label="Bộ phận" hint="Người dùng bộ phận chỉ thấy phiếu của bộ phận mình"><LookupSelect path="/departments" value={form.department_id} onChange={(v) => setForm({ ...form, department_id: v })} /></Field>
        </div>
        <div className="mt-4"><div className="label">Vai trò *</div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">{roles?.map((r) => (
            <label key={r.id} className="flex items-start gap-2 rounded border p-2 text-sm"><input type="checkbox" className="mt-0.5" checked={form.role_ids?.includes(r.id) ?? false} onChange={(e) => setForm({ ...form, role_ids: e.target.checked ? [...form.role_ids, r.id] : form.role_ids.filter((x: number) => x !== r.id) })} /><span><b>{r.name}</b><span className="block text-xs text-slate-500">{r.description}</span></span></label>
          ))}</div>
        </div>
      </Modal>
      <Modal open={!!reset} onClose={() => setReset(null)} title={`Đặt lại mật khẩu: ${reset?.username}`} size="sm" footer={<><button className="btn-outline" onClick={() => setReset(null)}>Hủy</button><button className="btn-primary" disabled={pw.length < 8} onClick={() => doReset.mutate()}>Đặt lại</button></>}>
        <Field label="Mật khẩu tạm thời" hint="Người dùng sẽ phải đổi khi đăng nhập. Mọi phiên cũ bị thu hồi."><input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}

// ================= PHÂN QUYỀN =================
export function RolesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: roles } = useQuery({ queryKey: ['roles'], queryFn: () => api.get<any[]>('/roles') });
  const { data: perms } = useQuery({ queryKey: ['permissions'], queryFn: () => api.get<{ code: string; module: string; name: string }[]>('/roles/permissions') });
  const [sel, setSel] = useState<any>(null);
  const [set, setSet] = useState<Set<string>>(new Set());
  const [newRole, setNewRole] = useState<{ code: string; name: string; description: string } | null>(null);
  useEffect(() => { if (!sel && roles?.length) setSel(roles[0]); }, [roles]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (sel) setSet(new Set(sel.permissions)); }, [sel]);
  const modules = useMemo(() => [...new Set(perms?.map((p) => p.module))], [perms]);
  const save = useMutation({
    mutationFn: () => api.put(`/roles/${sel.id}`, { code: sel.code, name: sel.name, description: sel.description, permissions: [...set] }),
    onSuccess: () => { toast.success('Đã cập nhật quyền – áp dụng ngay'); qc.invalidateQueries({ queryKey: ['roles'] }); }, onError: toast.error,
  });
  const create = useMutation({ mutationFn: () => api.post<any>('/roles', { ...newRole, permissions: [] }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['roles'] }); setNewRole(null); toast.success('Đã tạo vai trò'); }, onError: toast.error });
  return (
    <div>
      <PageHeader title="Phân quyền theo vai trò (RBAC)" subtitle="Tùy chỉnh quyền Xem / Tạo / Sửa / Hủy / Phê duyệt / Xuất báo cáo / Xem giá trị / Xem dữ liệu nhạy cảm cho từng vai trò" actions={<button className="btn-outline" onClick={() => setNewRole({ code: '', name: '', description: '' })}><Plus size={15} />Thêm vai trò</button>} />
      <div className="grid gap-4 lg:grid-cols-4">
        <Card title="Vai trò">
          {roles?.map((r) => <button key={r.id} onClick={() => setSel(r)} className={`mb-1 block w-full rounded px-2 py-1.5 text-left text-sm ${sel?.id === r.id ? 'bg-gold-100 font-semibold' : 'hover:bg-slate-50'}`}><ShieldCheck size={13} className="mr-1 inline" />{r.name} <span className="text-xs text-slate-400">({r._count.users} người)</span></button>)}
        </Card>
        {sel && <Card title={`Quyền của vai trò: ${sel.name}`} className="lg:col-span-3" actions={<button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>Lưu thay đổi</button>}>
          {sel.code === 'SUPER_ADMIN' && <div className="mb-3"><Alert type="info">Super Admin luôn giữ quyền quản lý người dùng & phân quyền.</Alert></div>}
          <div className="grid gap-4 md:grid-cols-2">
            {modules.map((m) => (
              <div key={m} className="rounded border p-3">
                <div className="mb-2 flex items-center justify-between text-sm font-semibold text-navy-900">{m}
                  <button className="text-xs font-normal text-navy-600 hover:underline" onClick={() => { const codes = perms!.filter((p) => p.module === m).map((p) => p.code); const all = codes.every((c) => set.has(c)); const n = new Set(set); codes.forEach((c) => (all ? n.delete(c) : n.add(c))); setSet(n); }}>Chọn/bỏ tất cả</button>
                </div>
                {perms!.filter((p) => p.module === m).map((p) => (
                  <label key={p.code} className="flex items-center gap-2 py-0.5 text-sm"><input type="checkbox" checked={set.has(p.code)} onChange={(e) => { const n = new Set(set); if (e.target.checked) n.add(p.code); else n.delete(p.code); setSet(n); }} />{p.name} <code className="text-[10px] text-slate-400">{p.code}</code></label>
                ))}
              </div>
            ))}
          </div>
        </Card>}
      </div>
      <Modal open={!!newRole} onClose={() => setNewRole(null)} title="Thêm vai trò" size="sm" footer={<><button className="btn-outline" onClick={() => setNewRole(null)}>Hủy</button><button className="btn-primary" onClick={() => create.mutate()}>Tạo</button></>}>
        {newRole && <div className="space-y-3">
          <Field label="Mã vai trò (chữ, số, _)" required><input className="input" value={newRole.code} onChange={(e) => setNewRole({ ...newRole, code: e.target.value })} /></Field>
          <Field label="Tên vai trò" required><input className="input" value={newRole.name} onChange={(e) => setNewRole({ ...newRole, name: e.target.value })} /></Field>
          <Field label="Mô tả"><input className="input" value={newRole.description} onChange={(e) => setNewRole({ ...newRole, description: e.target.value })} /></Field>
        </div>}
      </Modal>
    </div>
  );
}

// ================= CẤU HÌNH =================
export function SettingsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const tabs = [
    ...(can('settings.manage', 'period.lock') ? [{ key: 'general', label: 'Cấu hình chung & khóa kỳ' }] : []),
    ...(can('masterdata.manage') ? [{ key: 'wh', label: 'Kho' }, { key: 'loc', label: 'Vị trí lưu kho' }, { key: 'cat', label: 'Nhóm vật tư' }, { key: 'unit', label: 'Đơn vị tính' }] : []),
  ];
  const [tab, setTab] = useState(tabs[0]?.key);
  const { data: s } = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Record<string, any>>('/settings') });
  const [f, setF] = useState<Record<string, any>>({});
  const [rc, setRc] = useState<any>(null);
  useEffect(() => { if (s) setF({ ...s, 'currency.allowed': (s['currency.allowed'] ?? []).join(', ') }); }, [s]);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put('/settings', body),
    onSuccess: () => { toast.success('Đã lưu cấu hình'); qc.invalidateQueries({ queryKey: ['settings'] }); }, onError: toast.error,
  });
  return (
    <div>
      <PageHeader title="Cấu hình hệ thống" />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'general' && s && (
        <div className="grid gap-4 lg:grid-cols-2">
          {can('period.lock') && <Card title="Khóa kỳ kho">
            <p className="mb-3 text-sm text-slate-600">Sau khi khóa, không chứng từ nào có <b>ngày chứng từ ≤ ngày khóa</b> được ghi sổ. Điều chỉnh phát sinh sau phải lập chứng từ điều chỉnh ở kỳ mở.</p>
            <div className="flex items-end gap-2">
              <Field label="Khóa đến hết ngày"><input type="date" className="input" value={f['inventory.lock_until'] ?? ''} onChange={(e) => setF({ ...f, 'inventory.lock_until': e.target.value })} /></Field>
              <button className="btn-primary" onClick={() => confirm('Xác nhận khóa kỳ kho?') && save.mutate({ 'inventory.lock_until': f['inventory.lock_until'] || null })}><Lock size={15} />Áp dụng</button>
              {s['inventory.lock_until'] && <button className="btn-outline" onClick={() => confirm('Mở khóa kỳ kho?') && save.mutate({ 'inventory.lock_until': null })}><Unlock size={15} />Mở khóa</button>}
            </div>
            <div className="mt-2 text-sm">Hiện tại: {s['inventory.lock_until'] ? <b className="text-red-600">Đã khóa đến {String(s['inventory.lock_until']).split('-').reverse().join('/')}</b> : <span className="text-emerald-700">Chưa khóa kỳ</span>}</div>
          </Card>}
          {can('settings.manage') && <Card title="Thông tin & tham số" actions={<button className="btn-primary" onClick={() => save.mutate({
            'company.name': f['company.name'], 'company.address': f['company.address'] ?? '', 'inventory.near_min_ratio': f['inventory.near_min_ratio'], 'inventory.no_movement_days': f['inventory.no_movement_days'],
            'inventory.costing_method': f['inventory.costing_method'], 'currency.base': f['currency.base'] || null,
            'currency.allowed': String(f['currency.allowed']).split(',').map((x) => x.trim().toUpperCase()).filter(Boolean), 'issue.require_quota_note': !!f['issue.require_quota_note'],
          })}>Lưu</button>}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tên công ty" className="col-span-2"><input className="input" value={f['company.name'] ?? ''} onChange={(e) => setF({ ...f, 'company.name': e.target.value })} /></Field>
              <Field label="Địa chỉ" className="col-span-2"><input className="input" value={f['company.address'] ?? ''} onChange={(e) => setF({ ...f, 'company.address': e.target.value })} /></Field>
              <Field label="Hệ số 'sắp hết hàng'" hint="Sắp hết khi tồn ≤ tối thiểu × hệ số"><input type="number" step="0.1" className="input" value={f['inventory.near_min_ratio'] ?? 1.2} onChange={(e) => setF({ ...f, 'inventory.near_min_ratio': e.target.value })} /></Field>
              <Field label="Số ngày 'không phát sinh giao dịch'"><input type="number" className="input" value={f['inventory.no_movement_days'] ?? 90} onChange={(e) => setF({ ...f, 'inventory.no_movement_days': e.target.value })} /></Field>
              <Field label="Phương pháp tính giá xuất kho" hint="Chỉ chọn khi công ty đã phê duyệt phương pháp"><select className="input" value={f['inventory.costing_method']} onChange={(e) => setF({ ...f, 'inventory.costing_method': e.target.value })}><option value="NOT_CONFIGURED">Chưa xác nhận</option><option value="WEIGHTED_AVERAGE">Bình quân gia quyền (chờ triển khai)</option><option value="FIFO">FIFO (chờ triển khai)</option></select></Field>
              <Field label="Đồng tiền hạch toán chính" hint="Chưa xác nhận thì để trống"><input className="input" maxLength={3} value={f['currency.base'] ?? ''} onChange={(e) => setF({ ...f, 'currency.base': e.target.value.toUpperCase() })} /></Field>
              <Field label="Các loại tiền tệ sử dụng" className="col-span-2"><input className="input" value={f['currency.allowed'] ?? ''} onChange={(e) => setF({ ...f, 'currency.allowed': e.target.value })} /></Field>
              <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f['issue.require_quota_note']} onChange={(e) => setF({ ...f, 'issue.require_quota_note': e.target.checked })} />Bắt buộc ghi lý do khi yêu cầu cấp vượt định mức</label>
            </div>
          </Card>}
          <Card title="Kiểm tra toàn vẹn dữ liệu kho">
            <p className="mb-3 text-sm text-slate-600">Đối chiếu số dư tồn kho hiện tại với toàn bộ sổ cái giao dịch.</p>
            <button className="btn-outline" onClick={() => api.get('/stock/reconcile').then(setRc).catch(toast.error)}><Scale size={15} />Chạy đối chiếu</button>
            {rc && <div className="mt-3">{rc.consistent ? <Alert type="success">Dữ liệu nhất quán: số dư khớp 100% với sổ cái.</Alert> : <Alert type="danger">Phát hiện {rc.differences.length} chênh lệch – liên hệ quản trị hệ thống. {JSON.stringify(rc.differences.slice(0, 5))}</Alert>}</div>}
          </Card>
        </div>
      )}
      {tab === 'wh' && <WarehousesPanel />}
      {tab === 'loc' && <LocationsPanel />}
      {tab === 'cat' && <CategoriesPanel />}
      {tab === 'unit' && <UnitsPanel />}
    </div>
  );
}

// ================= NHẬT KÝ =================
const ACTIONS = ['LOGIN', 'LOGIN_FAILED', 'CREATE', 'UPDATE', 'SUBMIT', 'APPROVE', 'APPROVE_POST', 'ISSUE_POST', 'CONFIRM_RECEIVE', 'REJECT', 'CANCEL', 'LOCK', 'UNLOCK', 'IMPORT', 'EXPORT', 'PRINT', 'UPLOAD', 'PERIOD_LOCK', 'UPDATE_PERMISSIONS', 'BACKUP', 'RESTORE_START', 'RESTORE_DONE'];
export function AuditPage() {
  const [f, setF] = useState({ q: '', action: '', entity_type: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [view, setView] = useState<any>(null);
  const dq = useDebounce(f);
  useEffect(() => setPage(1), [dq]);
  const { data, isLoading } = useQuery({ queryKey: ['audit', dq, page], queryFn: () => api.page<any>('/audit-logs', { ...dq, page, pageSize: 50 }) });
  return (
    <div>
      <PageHeader title="Nhật ký hoạt động" subtitle="Ghi nhận người thực hiện, thời gian, địa chỉ IP, phiên đăng nhập và dữ liệu trước/sau thay đổi. Nhật ký không thể sửa/xóa." />
      <div className="card">
        <div className="flex flex-wrap gap-2 border-b p-3">
          <SearchInput value={f.q} onChange={(q) => setF({ ...f, q })} placeholder="Người dùng / mã đối tượng" />
          <select className="input w-48" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}><option value="">Mọi hành động</option>{ACTIONS.map((a) => <option key={a}>{a}</option>)}</select>
          <input className="input w-40" placeholder="Đối tượng (vd stock_issue)" value={f.entity_type} onChange={(e) => setF({ ...f, entity_type: e.target.value })} />
          <input type="date" className="input w-36" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /><input type="date" className="input w-36" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </div>
        <DataTable loading={isLoading} rows={data?.data} onRowClick={setView} columns={[
          { key: 't', header: 'Thời gian', render: (r: any) => fmtDateTime(r.created_at) }, { key: 'u', header: 'Người dùng', render: (r: any) => r.username ?? '—' },
          { key: 'a', header: 'Hành động', render: (r: any) => <code className="text-xs">{r.action}</code> }, { key: 'e', header: 'Đối tượng', render: (r: any) => `${r.entity_type}${r.entity_id ? ' #' + r.entity_id : ''}` },
          { key: 'c', header: 'Mã', render: (r: any) => r.entity_code }, { key: 'ip', header: 'IP', render: (r: any) => r.ip },
        ]} />
        <Pagination meta={data?.meta} onPage={setPage} />
      </div>
      <Modal open={!!view} onClose={() => setView(null)} title={`Chi tiết nhật ký #${view?.id}`} size="lg">
        {view && <div className="space-y-2 text-sm">
          <div><b>{view.action}</b> – {view.entity_type} {view.entity_code} – {view.username} – {fmtDateTime(view.created_at)}</div>
          <div className="text-xs text-slate-500">IP: {view.ip} · Phiên: {view.session_id} · {view.user_agent}</div>
          <div className="grid gap-2 md:grid-cols-2">
            <div><div className="label">Trước</div><pre className="max-h-80 overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(view.before_data, null, 2)}</pre></div>
            <div><div className="label">Sau</div><pre className="max-h-80 overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(view.after_data, null, 2)}</pre></div>
          </div>
        </div>}
      </Modal>
    </div>
  );
}

// ================= SAO LƯU =================
export function BackupPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [restore, setRestore] = useState<any>(null);
  const [confirmText, setConfirmText] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['backups'], queryFn: () => api.get<any[]>('/backups') });
  const inv = () => qc.invalidateQueries({ queryKey: ['backups'] });
  const create = useMutation({ mutationFn: () => api.post('/backups', { note: 'Sao lưu thủ công' }), onSuccess: () => { toast.success('Đã tạo bản sao lưu'); inv(); }, onError: toast.error });
  const verify = useMutation({ mutationFn: (id: number) => api.post<any>(`/backups/${id}/verify`), onSuccess: (r: any) => { r.ok ? toast.success('Toàn vẹn: ' + r.message) : toast.error(r.message); inv(); }, onError: toast.error });
  const doRestore = useMutation({ mutationFn: () => api.post<any>(`/backups/${restore.id}/restore`, { confirm: confirmText }), onSuccess: (r: any) => { toast.success(r.message); setRestore(null); qc.invalidateQueries(); }, onError: toast.error });
  return (
    <div>
      <PageHeader title="Sao lưu & khôi phục dữ liệu" subtitle="Sao lưu tự động theo lịch (cấu hình BACKUP_CRON trên máy chủ) + sao lưu thủ công. Mỗi bản gồm CSDL (pg_dump) và tài liệu đính kèm."
        actions={<button className="btn-primary" disabled={create.isPending} onClick={() => create.mutate()}>{create.isPending ? <Spinner className="h-4 w-4 text-white" /> : <DatabaseBackup size={15} />}Sao lưu ngay</button>} />
      <div className="mb-3"><Alert type="warning"><b>Quy trình khôi phục khi sự cố:</b> (1) Kiểm tra toàn vẹn bản sao lưu; (2) Thông báo người dùng ngừng thao tác; (3) Bấm Khôi phục – hệ thống tự tạo bản sao lưu an toàn trước khi khôi phục và chạy trong 1 transaction (lỗi sẽ hoàn tác); (4) Chạy "Đối chiếu dữ liệu kho" tại Cấu hình. Khi ứng dụng không chạy được, dùng script <code>deploy/restore.sh</code> trên máy chủ. Nên sao chép bản sao lưu ra ổ ngoài / lưu trữ đám mây định kỳ.</Alert></div>
      <div className="card">
        <DataTable loading={isLoading} rows={data} columns={[
          { key: 't', header: 'Thời gian', render: (r: any) => fmtDateTime(r.started_at) }, { key: 'f', header: 'File', render: (r: any) => <span className="text-xs">{r.file_name}</span> },
          { key: 'type', header: 'Loại', render: (r: any) => (r.type === 'AUTO' ? 'Tự động' : 'Thủ công') },
          { key: 'size', header: 'Dung lượng', align: 'right', render: (r: any) => (r.size_bytes ? `${(r.size_bytes / 1024 / 1024).toFixed(2)} MB` : '') },
          { key: 'st', header: 'Trạng thái', render: (r: any) => <Badge status={r.status === 'SUCCESS' ? 'POSTED' : r.status === 'FAILED' ? 'REJECTED' : 'DRAFT'}>{r.status}</Badge> },
          { key: 'v', header: 'Kiểm tra toàn vẹn', render: (r: any) => r.verified_at ? <span className={r.verify_ok ? 'text-emerald-700' : 'text-red-600'} title={r.message}>{r.verify_ok ? '✔ Đạt' : '✘ Lỗi'} ({fmtDateTime(r.verified_at)})</span> : '' },
          { key: 'm', header: 'Ghi chú', render: (r: any) => <span className="text-xs">{r.message}</span> },
          { key: 'a', header: '', render: (r: any) => r.status === 'SUCCESS' && <div className="flex gap-1">
            <button className="btn-ghost btn-sm" title="Kiểm tra toàn vẹn" onClick={() => verify.mutate(r.id)}><ShieldCheck size={14} /></button>
            <button className="btn-ghost btn-sm" title="Tải về" onClick={() => api.download(`/backups/${r.id}/download`).catch(toast.error)}><Download size={14} /></button>
            <button className="btn-ghost btn-sm text-red-600" title="Khôi phục" onClick={() => { setConfirmText(''); setRestore(r); }}><RotateCcw size={14} /></button>
          </div> },
        ]} />
      </div>
      <Modal open={!!restore} onClose={() => setRestore(null)} title="Khôi phục dữ liệu" size="sm"
        footer={<><button className="btn-outline" onClick={() => setRestore(null)}>Hủy</button><button className="btn-danger" disabled={confirmText !== 'KHOI PHUC' || doRestore.isPending} onClick={() => doRestore.mutate()}>{doRestore.isPending && <Spinner className="h-4 w-4 text-white" />}Khôi phục</button></>}>
        <Alert type="danger">Toàn bộ dữ liệu hiện tại sẽ được thay bằng bản sao lưu <b>{restore?.file_name}</b> ({fmtDateTime(restore?.started_at)}). Dữ liệu phát sinh sau thời điểm này sẽ mất (đã có bản sao lưu an toàn tự động).</Alert>
        <Field label='Gõ "KHOI PHUC" để xác nhận' className="mt-3"><input className="input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}

export { useLookup };
