import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { Loading, Alert } from '@/components/ui';
import Layout from '@/components/Layout';
import Login from '@/pages/Login';
import ChangePassword from '@/pages/ChangePassword';
import Dashboard from '@/pages/Dashboard';
import { ItemsPage, ItemDetail } from '@/pages/Items';
import { ReceiptList, ReceiptForm, ReceiptDetail } from '@/pages/Receipts';
import { IssueList, IssueForm, IssueDetail } from '@/pages/Issues';
import { StockPage, StockCardPage } from '@/pages/Stock';
import { StocktakeList, StocktakeDetail } from '@/pages/Stocktakes';
import { TransferList, TransferForm, TransferDetail, ReturnList, ReturnForm, ReturnDetail, AdjustmentList, AdjustmentForm, AdjustmentDetail } from '@/pages/MoreDocs';
import { SuppliersPage, DepartmentsPage } from '@/pages/MasterData';
import Reports from '@/pages/Reports';
import ImportPage from '@/pages/Import';
import { UsersPage, RolesPage, SettingsPage, AuditPage, BackupPage } from '@/pages/System';
import Guide from '@/pages/Guide';

function Guard({ perm, children }: { perm?: string[]; children: ReactNode }) {
  const { can } = useAuth();
  if (perm && !can(...perm)) return <Alert type="warning">Bạn không có quyền truy cập chức năng này. Liên hệ quản trị nếu cần cấp quyền.</Alert>;
  return <>{children}</>;
}

function Protected() {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" replace />;
  if (me.must_change_password && loc.pathname !== '/change-password') return <Navigate to="/change-password" replace />;
  return <Layout />;
}

const P = (perm: string[], el: ReactNode) => <Guard perm={perm}>{el}</Guard>;

export default function App() {
  const { can } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Protected />}>
        <Route index element={can('dashboard.view') ? <Dashboard /> : <Guide />} />
        <Route path="change-password" element={<ChangePassword />} />
        <Route path="items" element={P(['items.view'], <ItemsPage kind="MATERIAL" />)} />
        <Route path="equipment" element={P(['items.view'], <ItemsPage kind="EQUIPMENT" />)} />
        <Route path="items/:id" element={P(['items.view'], <ItemDetail />)} />
        <Route path="receipts" element={P(['receipts.view'], <ReceiptList />)} />
        <Route path="receipts/new" element={P(['receipts.create'], <ReceiptForm />)} />
        <Route path="receipts/:id/edit" element={P(['receipts.create'], <ReceiptForm />)} />
        <Route path="receipts/:id" element={P(['receipts.view'], <ReceiptDetail />)} />
        <Route path="issues" element={P(['issues.view', 'issues.view_all'], <IssueList />)} />
        <Route path="issues/new" element={P(['issues.create'], <IssueForm />)} />
        <Route path="issues/:id/edit" element={P(['issues.create'], <IssueForm />)} />
        <Route path="issues/:id" element={P(['issues.view', 'issues.view_all'], <IssueDetail />)} />
        <Route path="stock" element={P(['stock.view'], <StockPage />)} />
        <Route path="stock-card" element={P(['stock.view'], <StockCardPage />)} />
        <Route path="stocktakes" element={P(['stocktakes.view'], <StocktakeList />)} />
        <Route path="stocktakes/:id" element={P(['stocktakes.view'], <StocktakeDetail />)} />
        <Route path="transfers" element={P(['transfers.view'], <TransferList />)} />
        <Route path="transfers/new" element={P(['transfers.create'], <TransferForm />)} />
        <Route path="transfers/:id" element={P(['transfers.view'], <TransferDetail />)} />
        <Route path="returns" element={P(['returns.view'], <ReturnList />)} />
        <Route path="returns/new" element={P(['returns.create'], <ReturnForm />)} />
        <Route path="returns/:id" element={P(['returns.view'], <ReturnDetail />)} />
        <Route path="adjustments" element={P(['adjustments.view'], <AdjustmentList />)} />
        <Route path="adjustments/new" element={P(['adjustments.create'], <AdjustmentForm />)} />
        <Route path="adjustments/:id" element={P(['adjustments.view'], <AdjustmentDetail />)} />
        <Route path="suppliers" element={P(['suppliers.view'], <SuppliersPage />)} />
        <Route path="departments" element={P(['departments.view'], <DepartmentsPage />)} />
        <Route path="reports" element={P(['reports.view'], <Reports />)} />
        <Route path="import" element={<ImportPage />} />
        <Route path="users" element={P(['users.manage'], <UsersPage />)} />
        <Route path="roles" element={P(['roles.manage'], <RolesPage />)} />
        <Route path="settings" element={P(['settings.manage', 'masterdata.manage', 'period.lock'], <SettingsPage />)} />
        <Route path="audit-logs" element={P(['audit.view'], <AuditPage />)} />
        <Route path="backups" element={P(['backup.manage'], <BackupPage />)} />
        <Route path="guide" element={<Guide />} />
        <Route path="*" element={<Alert type="warning">Không tìm thấy trang.</Alert>} />
      </Route>
    </Routes>
  );
}
