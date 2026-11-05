/**
 * Danh mục quyền (RBAC). Mã quyền = <module>.<hành động>.
 * Seed sẽ đồng bộ danh mục này vào bảng permissions (chỉ THÊM quyền mới, không xóa quyền cũ).
 */
export const PERMISSIONS: { code: string; module: string; name: string }[] = [
  // Tổng quan
  { code: 'dashboard.view', module: 'Tổng quan', name: 'Xem Dashboard' },
  // Danh mục vật tư
  { code: 'items.view', module: 'Danh mục vật tư', name: 'Xem danh mục vật tư/thiết bị' },
  { code: 'items.create', module: 'Danh mục vật tư', name: 'Tạo vật tư/thiết bị' },
  { code: 'items.update', module: 'Danh mục vật tư', name: 'Sửa vật tư/thiết bị' },
  { code: 'items.lock', module: 'Danh mục vật tư', name: 'Khóa/mở khóa vật tư' },
  { code: 'items.import', module: 'Danh mục vật tư', name: 'Import danh mục từ Excel' },
  { code: 'masterdata.manage', module: 'Danh mục vật tư', name: 'Quản lý nhóm vật tư, đơn vị tính, kho, vị trí' },
  // Nhập kho
  { code: 'receipts.view', module: 'Nhập kho', name: 'Xem phiếu nhập' },
  { code: 'receipts.create', module: 'Nhập kho', name: 'Lập/sửa phiếu nhập (nháp)' },
  { code: 'receipts.approve', module: 'Nhập kho', name: 'Phê duyệt & ghi sổ phiếu nhập' },
  { code: 'receipts.inspect', module: 'Nhập kho', name: 'Xử lý hàng chờ kiểm tra' },
  { code: 'receipts.cancel', module: 'Nhập kho', name: 'Hủy phiếu nhập chưa ghi sổ' },
  // Xuất kho
  { code: 'issues.view', module: 'Xuất kho', name: 'Xem phiếu xuất của bộ phận mình' },
  { code: 'issues.view_all', module: 'Xuất kho', name: 'Xem phiếu xuất của mọi bộ phận' },
  { code: 'issues.create', module: 'Xuất kho', name: 'Lập yêu cầu cấp vật tư' },
  { code: 'issues.approve', module: 'Xuất kho', name: 'Phê duyệt yêu cầu cấp vật tư' },
  { code: 'issues.issue', module: 'Xuất kho', name: 'Thực hiện xuất kho (ghi sổ)' },
  { code: 'issues.confirm', module: 'Xuất kho', name: 'Xác nhận đã nhận vật tư' },
  { code: 'issues.cancel', module: 'Xuất kho', name: 'Hủy phiếu xuất chưa ghi sổ' },
  // Tồn kho
  { code: 'stock.view', module: 'Tồn kho', name: 'Xem tồn kho, thẻ kho' },
  { code: 'stock.view_value', module: 'Tồn kho', name: 'Xem giá trị tồn kho / đơn giá' },
  // Điều chuyển, trả lại, điều chỉnh, kiểm kê
  { code: 'transfers.view', module: 'Điều chuyển', name: 'Xem phiếu điều chuyển' },
  { code: 'transfers.create', module: 'Điều chuyển', name: 'Lập phiếu điều chuyển' },
  { code: 'transfers.approve', module: 'Điều chuyển', name: 'Phê duyệt & ghi sổ điều chuyển' },
  { code: 'returns.view', module: 'Hàng trả lại', name: 'Xem phiếu trả lại' },
  { code: 'returns.create', module: 'Hàng trả lại', name: 'Lập phiếu trả vật tư' },
  { code: 'returns.inspect', module: 'Hàng trả lại', name: 'Kiểm tra chất lượng hàng trả lại' },
  { code: 'returns.approve', module: 'Hàng trả lại', name: 'Phê duyệt & ghi sổ hàng trả lại' },
  { code: 'adjustments.view', module: 'Điều chỉnh tồn', name: 'Xem phiếu điều chỉnh' },
  { code: 'adjustments.create', module: 'Điều chỉnh tồn', name: 'Lập phiếu điều chỉnh / import tồn đầu kỳ' },
  { code: 'adjustments.approve', module: 'Điều chỉnh tồn', name: 'Phê duyệt & ghi sổ điều chỉnh' },
  { code: 'stocktakes.view', module: 'Kiểm kê', name: 'Xem đợt kiểm kê' },
  { code: 'stocktakes.create', module: 'Kiểm kê', name: 'Tạo đợt kiểm kê, chốt tồn sổ' },
  { code: 'stocktakes.count', module: 'Kiểm kê', name: 'Nhập số kiểm đếm, giải trình' },
  { code: 'stocktakes.approve', module: 'Kiểm kê', name: 'Phê duyệt kết quả kiểm kê' },
  // Nhà cung cấp, bộ phận
  { code: 'suppliers.view', module: 'Nhà cung cấp', name: 'Xem nhà cung cấp' },
  { code: 'suppliers.manage', module: 'Nhà cung cấp', name: 'Tạo/sửa/khóa nhà cung cấp' },
  { code: 'suppliers.view_sensitive', module: 'Nhà cung cấp', name: 'Xem tài khoản ngân hàng NCC' },
  { code: 'departments.view', module: 'Bộ phận', name: 'Xem bộ phận sử dụng' },
  { code: 'departments.manage', module: 'Bộ phận', name: 'Quản lý bộ phận sử dụng' },
  // Báo cáo
  { code: 'reports.view', module: 'Báo cáo', name: 'Xem báo cáo' },
  { code: 'reports.export', module: 'Báo cáo', name: 'Xuất Excel/PDF, in báo cáo' },
  // Tài liệu
  { code: 'attachments.upload', module: 'Tài liệu', name: 'Tải lên tài liệu đính kèm' },
  { code: 'attachments.delete', module: 'Tài liệu', name: 'Gỡ tài liệu đính kèm (chứng từ chưa ghi sổ)' },
  // Hệ thống
  { code: 'users.manage', module: 'Hệ thống', name: 'Quản lý người dùng' },
  { code: 'roles.manage', module: 'Hệ thống', name: 'Quản lý vai trò & phân quyền' },
  { code: 'settings.manage', module: 'Hệ thống', name: 'Cấu hình hệ thống' },
  { code: 'period.lock', module: 'Hệ thống', name: 'Khóa/mở kỳ kho' },
  { code: 'audit.view', module: 'Hệ thống', name: 'Xem nhật ký hoạt động' },
  { code: 'backup.manage', module: 'Hệ thống', name: 'Sao lưu & khôi phục dữ liệu' },
  { code: 'import.run', module: 'Hệ thống', name: 'Import dữ liệu ban đầu (NCC, bộ phận)' },
];

const ALL = PERMISSIONS.map((p) => p.code);
const VIEW_STOCK = ['dashboard.view', 'items.view', 'stock.view', 'suppliers.view', 'departments.view'];

/** Vai trò mặc định – Super Admin có thể chỉnh sửa trong giao diện Phân quyền. */
export const DEFAULT_ROLES: { code: string; name: string; description: string; permissions: string[] }[] = [
  { code: 'SUPER_ADMIN', name: 'Super Admin', description: 'Toàn quyền cấu hình hệ thống', permissions: ALL },
  {
    code: 'WAREHOUSE_MANAGER', name: 'Warehouse Manager', description: 'Giám sát kho, phê duyệt nhập/xuất/kiểm kê',
    permissions: [...VIEW_STOCK, 'items.create', 'items.update', 'items.lock', 'items.import', 'masterdata.manage',
      'receipts.view', 'receipts.approve', 'receipts.inspect', 'receipts.cancel',
      'issues.view', 'issues.view_all', 'issues.approve', 'issues.issue', 'issues.cancel',
      'transfers.view', 'transfers.approve', 'returns.view', 'returns.inspect', 'returns.approve',
      'adjustments.view', 'adjustments.approve', 'stocktakes.view', 'stocktakes.create', 'stocktakes.approve',
      'reports.view', 'reports.export', 'attachments.upload', 'audit.view', 'period.lock'],
  },
  {
    code: 'WAREHOUSE_OFFICER', name: 'Warehouse Officer', description: 'Lập phiếu nhập/xuất, kiểm kê, quản lý tồn (không tự duyệt)',
    permissions: [...VIEW_STOCK, 'items.create', 'items.update', 'items.import',
      'receipts.view', 'receipts.create', 'receipts.cancel', 'receipts.inspect',
      'issues.view', 'issues.view_all', 'issues.issue', 'issues.cancel',
      'transfers.view', 'transfers.create', 'returns.view', 'returns.create', 'returns.inspect',
      'adjustments.view', 'adjustments.create', 'stocktakes.view', 'stocktakes.create', 'stocktakes.count',
      'reports.view', 'reports.export', 'attachments.upload', 'attachments.delete'],
  },
  {
    code: 'PROCUREMENT_OFFICER', name: 'Procurement Officer', description: 'Quản lý nhà cung cấp, mua hàng',
    permissions: [...VIEW_STOCK, 'suppliers.manage', 'suppliers.view_sensitive', 'receipts.view', 'reports.view', 'reports.export', 'attachments.upload', 'import.run'],
  },
  {
    code: 'DEPARTMENT_USER', name: 'Department User', description: 'Tạo yêu cầu cấp vật tư/hóa chất, xem lịch sử bộ phận',
    permissions: ['dashboard.view', 'items.view', 'stock.view', 'issues.view', 'issues.create', 'issues.confirm', 'returns.view', 'returns.create'],
  },
  {
    code: 'CHEMICAL_STORE_OFFICER', name: 'Chemical Store Officer', description: 'Quản lý kho hóa chất (phân hệ 5.2)',
    permissions: [...VIEW_STOCK, 'reports.view', 'reports.export', 'attachments.upload'],
  },
  {
    code: 'HSE_OFFICER', name: 'HSE/Chemical Safety Officer', description: 'Kiểm tra hồ sơ an toàn hóa chất, SDS/MSDS',
    permissions: [...VIEW_STOCK, 'reports.view'],
  },
  {
    code: 'ACCOUNTANT', name: 'Accountant', description: 'Xem báo cáo NXT, kiểm tra chứng từ, đối chiếu số liệu',
    permissions: [...VIEW_STOCK, 'stock.view_value', 'receipts.view', 'issues.view', 'issues.view_all', 'transfers.view',
      'returns.view', 'adjustments.view', 'stocktakes.view', 'reports.view', 'reports.export'],
  },
  {
    code: 'DIRECTOR', name: 'Director', description: 'Xem Dashboard, báo cáo tổng hợp, phê duyệt theo thẩm quyền',
    permissions: [...VIEW_STOCK, 'stock.view_value', 'receipts.view', 'issues.view', 'issues.view_all', 'transfers.view',
      'returns.view', 'adjustments.view', 'stocktakes.view', 'reports.view', 'reports.export', 'audit.view'],
  },
];
