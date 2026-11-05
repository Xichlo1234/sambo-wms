export const STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'Nháp', cls: 'bg-slate-100 text-slate-700' },
  SUBMITTED: { label: 'Chờ duyệt', cls: 'bg-amber-100 text-amber-800' },
  APPROVED: { label: 'Đã duyệt – chờ xuất', cls: 'bg-sky-100 text-sky-800' },
  COUNTING: { label: 'Đang kiểm đếm', cls: 'bg-indigo-100 text-indigo-800' },
  INSPECTED: { label: 'Đã kiểm tra – chờ duyệt', cls: 'bg-violet-100 text-violet-800' },
  POSTED: { label: 'Đã ghi sổ', cls: 'bg-emerald-100 text-emerald-800' },
  ISSUED: { label: 'Đã xuất – chờ xác nhận', cls: 'bg-teal-100 text-teal-800' },
  RECEIVED: { label: 'Đã nhận', cls: 'bg-emerald-100 text-emerald-800' },
  REJECTED: { label: 'Bị từ chối', cls: 'bg-red-100 text-red-700' },
  CANCELLED: { label: 'Đã hủy', cls: 'bg-slate-200 text-slate-500 line-through' },
  ACTIVE: { label: 'Đang dùng', cls: 'bg-emerald-100 text-emerald-800' },
  INACTIVE: { label: 'Đã khóa', cls: 'bg-slate-200 text-slate-600' },
};
export const STOCK_STATUS: Record<string, { label: string; cls: string }> = {
  OK: { label: 'Còn hàng', cls: 'bg-emerald-100 text-emerald-800' },
  LOW: { label: 'Sắp hết hàng', cls: 'bg-amber-100 text-amber-800' },
  BELOW_MIN: { label: 'Dưới tối thiểu', cls: 'bg-orange-100 text-orange-800' },
  OUT: { label: 'Hết hàng', cls: 'bg-red-100 text-red-700' },
  OVER_MAX: { label: 'Vượt tối đa', cls: 'bg-purple-100 text-purple-800' },
  PENDING_QC: { label: 'Chờ kiểm tra', cls: 'bg-sky-100 text-sky-800' },
};
export const MOVEMENT: Record<string, string> = {
  OPENING: 'Tồn đầu kỳ', RECEIPT: 'Nhập kho', ISSUE: 'Xuất kho', TRANSFER_OUT: 'Điều chuyển đi', TRANSFER_IN: 'Điều chuyển đến',
  RETURN: 'Hàng trả lại', ADJUSTMENT: 'Điều chỉnh', STOCKTAKE: 'Điều chỉnh kiểm kê', INSPECTION: 'Kiểm tra chất lượng',
};
export const BUCKET: Record<string, string> = { USABLE: 'Khả dụng', QUARANTINE: 'Chờ kiểm tra', DAMAGED: 'Hư hỏng' };
export const DOC_LINK: Record<string, string> = { RECEIPT: '/receipts', ISSUE: '/issues', TRANSFER: '/transfers', RETURN: '/returns', ADJUSTMENT: '/adjustments' };
export const ATTACH_CATEGORIES: Record<string, string> = {
  INVOICE: 'Hóa đơn', DELIVERY_NOTE: 'Phiếu giao hàng', PO: 'Đơn đặt hàng', PHOTO: 'Hình ảnh', TECH_DOC: 'Tài liệu kỹ thuật',
  CERT: 'Chứng nhận', CONTRACT: 'Hợp đồng', REPORT: 'Biên bản', SDS: 'SDS/MSDS', OTHER: 'Khác',
};
export const COOP_STATUS: Record<string, string> = { ACTIVE: 'Đang hợp tác', PROBATION: 'Thử nghiệm', SUSPENDED: 'Tạm ngưng', STOPPED: 'Ngừng hợp tác' };
