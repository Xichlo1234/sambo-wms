import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import {
  LayoutDashboard, Package, Wrench, ArrowDownToLine, ArrowUpFromLine, Boxes, FileSpreadsheet, ClipboardCheck, ArrowLeftRight, Undo2,
  SlidersHorizontal, Truck, Building2, BarChart3, Upload, Users, ShieldCheck, Settings, History, DatabaseBackup, BookOpen, Bell, Search,
  LogOut, KeyRound, Menu, ChevronDown, FlaskConical, TestTubes, CalendarClock, ShieldAlert, FileText, ClipboardList, FileQuestion, ShoppingCart,
  PackageCheck, History as HistoryIcon, Star, Trash2,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useDebounce } from '@/lib/hooks';
import { fmtDateTime } from '@/lib/format';

interface NavItem { to: string; label: string; icon: ReactNode; perm?: string[] }
interface NavGroup { title?: string; items: NavItem[] }

const NAV: NavGroup[] = [
  { items: [{ to: '/', label: 'Tổng quan Dashboard', icon: <LayoutDashboard size={17} />, perm: ['dashboard.view'] }] },
  {
    title: 'Kho mỏ', items: [
      { to: '/items', label: 'Danh mục vật tư', icon: <Package size={17} />, perm: ['items.view'] },
      { to: '/equipment', label: 'Danh mục thiết bị', icon: <Wrench size={17} />, perm: ['items.view'] },
      { to: '/receipts', label: 'Nhập kho', icon: <ArrowDownToLine size={17} />, perm: ['receipts.view'] },
      { to: '/issues', label: 'Xuất kho', icon: <ArrowUpFromLine size={17} />, perm: ['issues.view', 'issues.view_all'] },
      { to: '/stock', label: 'Tồn kho', icon: <Boxes size={17} />, perm: ['stock.view'] },
      { to: '/stock-card', label: 'Thẻ kho', icon: <FileSpreadsheet size={17} />, perm: ['stock.view'] },
      { to: '/stocktakes', label: 'Kiểm kê', icon: <ClipboardCheck size={17} />, perm: ['stocktakes.view'] },
      { to: '/transfers', label: 'Điều chuyển', icon: <ArrowLeftRight size={17} />, perm: ['transfers.view'] },
      { to: '/returns', label: 'Hàng trả lại', icon: <Undo2 size={17} />, perm: ['returns.view'] },
      { to: '/adjustments', label: 'Điều chỉnh tồn kho', icon: <SlidersHorizontal size={17} />, perm: ['adjustments.view'] },
    ],
  },
  {
    title: 'Kho hóa chất', items: [
      { to: '/chemicals', label: 'Danh mục hóa chất', icon: <FlaskConical size={17} />, perm: ['chemicals.view'] },
      { to: '/chem-receipts', label: 'Nhập hóa chất', icon: <ArrowDownToLine size={17} />, perm: ['chemicals.view'] },
      { to: '/chem-issues', label: 'Xuất hóa chất', icon: <ArrowUpFromLine size={17} />, perm: ['chemicals.view', 'chemicals.request'] },
      { to: '/chem-batches', label: 'Quản lý lô & hạn sử dụng', icon: <CalendarClock size={17} />, perm: ['chemicals.view'] },
      { to: '/chem-stock', label: 'Tồn kho hóa chất', icon: <TestTubes size={17} />, perm: ['chemicals.view'] },
      { to: '/chem-safety?tab=sds', label: 'SDS/MSDS', icon: <FileText size={17} />, perm: ['chemicals.view'] },
      { to: '/chem-safety?tab=alerts', label: 'Cảnh báo an toàn', icon: <ShieldAlert size={17} />, perm: ['chemicals.view'] },
      { to: '/chem-stocktakes', label: 'Kiểm kê hóa chất', icon: <ClipboardCheck size={17} />, perm: ['chemicals.view'] },
      { to: '/chem-adjustments', label: 'Điều chỉnh / tiêu hủy', icon: <Trash2 size={17} />, perm: ['chemicals.view'] },
    ],
  },
  {
    title: 'Mua hàng', items: [
      { to: '/purchase-requests', label: 'Đề nghị mua hàng', icon: <ClipboardList size={17} />, perm: ['purchase.view', 'purchase.request'] },
      { to: '/quotes', label: 'Yêu cầu báo giá', icon: <FileQuestion size={17} />, perm: ['purchase.view'] },
      { to: '/purchase-orders', label: 'Đơn đặt hàng', icon: <ShoppingCart size={17} />, perm: ['purchase.view'] },
      { to: '/po-tracking', label: 'Theo dõi giao hàng', icon: <PackageCheck size={17} />, perm: ['purchase.view'] },
      { to: '/purchase-history', label: 'Lịch sử mua hàng', icon: <HistoryIcon size={17} />, perm: ['purchase.view'] },
    ],
  },
  {
    title: 'Nhà cung cấp', items: [
      { to: '/suppliers', label: 'Danh sách / hồ sơ NCC', icon: <Truck size={17} />, perm: ['suppliers.view'] },
      { to: '/supplier-evaluations', label: 'Đánh giá & so sánh NCC', icon: <Star size={17} />, perm: ['suppliers.view'] },
    ],
  },
  { items: [{ to: '/departments', label: 'Bộ phận sử dụng', icon: <Building2 size={17} />, perm: ['departments.view'] }] },
  {
    title: 'Báo cáo & dữ liệu', items: [
      { to: '/reports', label: 'Báo cáo và thống kê', icon: <BarChart3 size={17} />, perm: ['reports.view'] },
      { to: '/import', label: 'Nhập dữ liệu từ Excel', icon: <Upload size={17} />, perm: ['items.import', 'adjustments.create', 'suppliers.manage', 'departments.manage', 'import.run', 'chemicals.manage'] },
    ],
  },
  {
    title: 'Hệ thống', items: [
      { to: '/users', label: 'Người dùng', icon: <Users size={17} />, perm: ['users.manage'] },
      { to: '/roles', label: 'Phân quyền', icon: <ShieldCheck size={17} />, perm: ['roles.manage'] },
      { to: '/settings', label: 'Cấu hình hệ thống', icon: <Settings size={17} />, perm: ['settings.manage', 'masterdata.manage', 'period.lock'] },
      { to: '/audit-logs', label: 'Nhật ký hoạt động', icon: <History size={17} />, perm: ['audit.view'] },
      { to: '/backups', label: 'Sao lưu & khôi phục', icon: <DatabaseBackup size={17} />, perm: ['backup.manage'] },
    ],
  },
  { items: [{ to: '/guide', label: 'Hướng dẫn vận hành', icon: <BookOpen size={17} /> }] },
];

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const dq = useDebounce(q, 300);
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const { data, isFetching } = useQuery({
    queryKey: ['search', dq], enabled: dq.trim().length >= 2,
    queryFn: () => api.get<{ type: string; label: string; title: string; subtitle?: string; link: string }[]>('/search', { q: dq }),
  });
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); ref.current?.querySelector('input')?.focus(); } };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, []);
  return (
    <div ref={ref} className="relative w-full max-w-lg">
      <Search className="absolute left-2.5 top-2 text-slate-400" size={16} />
      <input className="input pl-8" placeholder="Tìm nhanh toàn hệ thống: mã vật tư, tên, số phiếu, NCC... (Ctrl+K)" value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      {open && dq.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-96 overflow-y-auto rounded-md border bg-white shadow-lg">
          {isFetching && <div className="p-3 text-sm text-slate-500">Đang tìm...</div>}
          {!isFetching && data?.length === 0 && <div className="p-3 text-sm text-slate-500">Không tìm thấy kết quả cho “{dq}”</div>}
          {data?.map((r, i) => (
            <button key={i} className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-navy-50" onClick={() => { setOpen(false); setQ(''); nav(r.link); }}>
              <span className="mt-0.5 w-24 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-center text-[11px] text-slate-600">{r.label}</span>
              <span><span className="font-medium">{r.title}</span>{r.subtitle && <span className="block text-xs text-slate-500">{r.subtitle}</span>}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data } = useQuery({
    queryKey: ['notifications'], refetchInterval: 60_000, // làm mới mỗi 60 giây – tránh đọc DB liên tục
    queryFn: () => api.get<{ rows: { id: number; title: string; message?: string; link?: string; read_at?: string; created_at: string; type: string }[]; unread: number }>('/notifications'),
  });
  const markAll = async () => { await api.post('/notifications/read', {}); qc.invalidateQueries({ queryKey: ['notifications'] }); };
  return (
    <div className="relative">
      <button className="btn-ghost relative" onClick={() => setOpen(!open)} title="Thông báo">
        <Bell size={18} />
        {!!data?.unread && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-96 rounded-md border bg-white shadow-lg" onMouseLeave={() => setOpen(false)}>
          <div className="flex items-center justify-between border-b px-3 py-2 text-sm font-semibold">Thông báo
            {!!data?.unread && <button className="text-xs font-normal text-navy-600 hover:underline" onClick={markAll}>Đánh dấu đã đọc tất cả</button>}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {data?.rows.length === 0 && <div className="p-4 text-center text-sm text-slate-400">Không có thông báo</div>}
            {data?.rows.map((n) => (
              <button key={n.id} className={clsx('block w-full border-b px-3 py-2 text-left text-sm hover:bg-slate-50', !n.read_at && 'bg-gold-50')}
                onClick={async () => { setOpen(false); if (!n.read_at) { await api.post('/notifications/read', { ids: [n.id] }); qc.invalidateQueries({ queryKey: ['notifications'] }); } if (n.link) nav(n.link); }}>
                <div className="font-medium">{n.title}</div>
                {n.message && <div className="text-xs text-slate-600">{n.message}</div>}
                <div className="text-[11px] text-slate-400">{fmtDateTime(n.created_at)}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { me, can, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => setMobileOpen(false), [loc.pathname]);
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.perm || can(...i.perm)) })).filter((g) => g.items.length);

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className={clsx('no-print fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-navy-900 text-navy-100 transition-transform lg:static lg:translate-x-0', mobileOpen ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex items-center gap-2.5 border-b border-navy-800 px-4 py-3.5">
          <img src="/logo.svg" className="h-9 w-9" alt="" />
          <div>
            <div className="text-sm font-bold tracking-wide text-gold-400">SAMBO GOLD</div>
            <div className="text-[10px] uppercase tracking-wider text-navy-300">Warehouse Management System</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {groups.map((g, gi) => (
            <div key={gi} className="mb-3">
              {g.title && <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-navy-400">{g.title}</div>}
              {g.items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => clsx('flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] transition', (i.to.includes('?') ? loc.pathname + loc.search === i.to : isActive) ? 'bg-gold-500 font-semibold text-navy-950' : 'text-navy-100 hover:bg-navy-800')}>
                  {i.icon}{i.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t border-navy-800 px-4 py-2 text-[10px] text-navy-400">Phiên bản 1.1 – Kho mỏ · Hóa chất · Mua hàng</div>
      </aside>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setMobileOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex items-center gap-3 border-b bg-white px-4 py-2">
          <button className="btn-ghost lg:hidden" onClick={() => setMobileOpen(true)}><Menu size={18} /></button>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-1">
            <Notifications />
            <div className="relative">
              <button className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-slate-100" onClick={() => setUserMenu(!userMenu)}>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-800 text-sm font-semibold text-gold-400">{me?.full_name.split(' ').pop()?.[0]}</div>
                <div className="hidden text-left sm:block">
                  <div className="text-sm font-medium leading-tight">{me?.full_name}</div>
                  <div className="text-[11px] text-slate-500">{me?.department?.name ?? me?.roles.join(', ')}</div>
                </div>
                <ChevronDown size={14} />
              </button>
              {userMenu && (
                <div className="absolute right-0 top-full z-40 mt-1 w-56 rounded-md border bg-white py-1 shadow-lg" onMouseLeave={() => setUserMenu(false)}>
                  <div className="border-b px-3 py-2 text-xs text-slate-500">Đăng nhập: <b>{me?.username}</b><br />Vai trò: {me?.roles.join(', ')}</div>
                  <button className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50" onClick={() => { setUserMenu(false); nav('/change-password'); }}><KeyRound size={15} />Đổi mật khẩu</button>
                  <button className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-slate-50" onClick={async () => { await logout(); nav('/login'); }}><LogOut size={15} />Đăng xuất</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6"><Outlet /></main>
      </div>
    </div>
  );
}
