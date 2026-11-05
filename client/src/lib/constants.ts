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
export const DOC_LINK: Record<string, string> = { RECEIPT: '/receipts', ISSUE: '/issues', TRANSFER: '/transfers', RETURN: '/returns', ADJUSTMENT: '/adjustments', CHEM_RECEIPT: '/chem-receipts', CHEM_ISSUE: '/chem-issues', CHEM_ADJUST: '/chem-adjustments' };
export const ATTACH_CATEGORIES: Record<string, string> = {
  INVOICE: 'Hóa đơn', DELIVERY_NOTE: 'Phiếu giao hàng', PO: 'Đơn đặt hàng', PHOTO: 'Hình ảnh', TECH_DOC: 'Tài liệu kỹ thuật',
  CERT: 'Chứng nhận', CONTRACT: 'Hợp đồng', REPORT: 'Biên bản', SDS: 'SDS/MSDS', OTHER: 'Khác',
};
export const COOP_STATUS: Record<string, string> = { ACTIVE: 'Đang hợp tác', PROBATION: 'Thử nghiệm', SUSPENDED: 'Tạm ngưng', STOPPED: 'Ngừng hợp tác' };

export const QC_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'Chờ kiểm tra', cls: 'bg-sky-100 text-sky-800' },
  PASSED: { label: 'Đạt', cls: 'bg-emerald-100 text-emerald-800' },
  QUARANTINE: { label: 'Cách ly', cls: 'bg-orange-100 text-orange-800' },
  FAILED: { label: 'Không đạt', cls: 'bg-red-100 text-red-700' },
};
export const LINE_RESULT: Record<string, { label: string; cls: string }> = {
  PASSED: { label: 'Đạt', cls: 'bg-emerald-100 text-emerald-800' },
  QUARANTINE: { label: 'Cách ly', cls: 'bg-orange-100 text-orange-800' },
  FAILED: { label: 'Không đạt yêu cầu', cls: 'bg-red-100 text-red-700' },
};
/** Nhãn trạng thái phiếu nhập hóa chất theo nghiệp vụ 6.3 */
export const CHEM_RECEIPT_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'Chờ kiểm tra', cls: 'bg-sky-100 text-sky-800' },
  SUBMITTED: { label: 'Chờ phê duyệt', cls: 'bg-amber-100 text-amber-800' },
  POSTED: { label: 'Đã nhập kho', cls: 'bg-emerald-100 text-emerald-800' },
  REJECTED: { label: 'Từ chối tiếp nhận', cls: 'bg-red-100 text-red-700' },
  CANCELLED: { label: 'Đã hủy', cls: 'bg-slate-200 text-slate-500 line-through' },
};
export const SDS_STATE: Record<string, { label: string; cls: string }> = {
  OK: { label: 'SDS hiệu lực', cls: 'bg-emerald-100 text-emerald-800' },
  UNVERIFIED: { label: 'SDS chưa xác nhận', cls: 'bg-amber-100 text-amber-800' },
  EXPIRED: { label: 'SDS quá hạn', cls: 'bg-red-100 text-red-700' },
  MISSING: { label: 'Chưa có SDS', cls: 'bg-red-100 text-red-700' },
};
export const GHS: Record<string, string> = {
  GHS01: 'Chất nổ', GHS02: 'Chất dễ cháy', GHS03: 'Chất oxy hóa', GHS04: 'Khí nén', GHS05: 'Ăn mòn',
  GHS06: 'Độc cấp tính', GHS07: 'Cảnh báo (kích ứng…)', GHS08: 'Nguy hại sức khỏe', GHS09: 'Nguy hại môi trường',
};
export const PURCHASE_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'Nháp', cls: 'bg-slate-100 text-slate-700' },
  SUBMITTED: { label: 'Chờ duyệt', cls: 'bg-amber-100 text-amber-800' },
  APPROVED: { label: 'Đã duyệt', cls: 'bg-sky-100 text-sky-800' },
  REJECTED: { label: 'Bị từ chối', cls: 'bg-red-100 text-red-700' },
  ORDERED: { label: 'Đã lập PO', cls: 'bg-indigo-100 text-indigo-800' },
  SENT: { label: 'Đã gửi NCC', cls: 'bg-indigo-100 text-indigo-800' },
  PARTIAL: { label: 'Giao một phần', cls: 'bg-teal-100 text-teal-800' },
  RECEIVED: { label: 'Đã giao đủ', cls: 'bg-emerald-100 text-emerald-800' },
  CLOSED: { label: 'Đã đóng', cls: 'bg-slate-200 text-slate-600' },
  CANCELLED: { label: 'Đã hủy', cls: 'bg-slate-200 text-slate-500 line-through' },
};
export const QUOTE_STATUS: Record<string, { label: string; cls: string }> = {
  REQUESTED: { label: 'Đã gửi yêu cầu', cls: 'bg-slate-100 text-slate-700' },
  RECEIVED: { label: 'Đã nhận báo giá', cls: 'bg-sky-100 text-sky-800' },
  SELECTED: { label: 'Được chọn', cls: 'bg-emerald-100 text-emerald-800' },
  REJECTED: { label: 'Không chọn', cls: 'bg-slate-200 text-slate-500' },
};
export const PRIORITY: Record<string, { label: string; cls: string }> = {
  LOW: { label: 'Thấp', cls: 'bg-slate-100 text-slate-600' }, NORMAL: { label: 'Bình thường', cls: 'bg-sky-100 text-sky-800' },
  HIGH: { label: 'Cao', cls: 'bg-orange-100 text-orange-800' }, URGENT: { label: 'Khẩn cấp', cls: 'bg-red-100 text-red-700' },
};
export const INCIDENT_TYPE: Record<string, string> = { SPILL: 'Tràn đổ', LEAK: 'Rò rỉ', FIRE: 'Cháy', EXPOSURE: 'Phơi nhiễm', PACKAGING: 'Hư hỏng bao bì', OTHER: 'Khác' };
export const SEVERITY: Record<string, { label: string; cls: string }> = {
  LOW: { label: 'Thấp', cls: 'bg-slate-100 text-slate-700' }, MEDIUM: { label: 'Trung bình', cls: 'bg-amber-100 text-amber-800' },
  HIGH: { label: 'Cao', cls: 'bg-orange-100 text-orange-800' }, CRITICAL: { label: 'Nghiêm trọng', cls: 'bg-red-100 text-red-700' },
};
