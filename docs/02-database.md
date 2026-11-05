# 02 – Cấu trúc cơ sở dữ liệu (PostgreSQL)

Nguồn chuẩn: `server/prisma/schema.prisma` + `server/prisma/migrations/*` (gồm SQL bổ sung: CHECK constraint, trigger, chỉ mục trigram).
Mọi bảng nghiệp vụ có `id`, `created_at`, `updated_at`, `created_by`, `updated_by` (khi phù hợp) và trạng thái dữ liệu (`status`).

## Nhóm người dùng & phân quyền
| Bảng | Mục đích | Ràng buộc chính |
|---|---|---|
| users | Tài khoản, bộ phận, khóa tài khoản, đếm sai mật khẩu | `username` unique; không xóa – chỉ khóa |
| roles / permissions / user_roles / role_permissions | RBAC | mã quyền `module.action` unique |
| sessions | Phiên đăng nhập (lưu hash token, IP, user-agent, hết hạn, thu hồi) | `token_hash` unique |
| departments | Bộ phận sử dụng, người phụ trách, khu vực | `code` unique |

## Nhóm danh mục
| Bảng | Mục đích |
|---|---|
| warehouses | Kho (type GENERAL = kho mỏ, CHEMICAL = kho hóa chất) – sẵn sàng nhiều kho |
| warehouse_locations | Vị trí lưu kho, unique (kho, mã vị trí) |
| item_categories | Nhóm vật tư, phân nhóm qua `parent_id` |
| units | Đơn vị tính |
| items | Vật tư & thiết bị (`kind`), mức tồn min/max/an toàn, định mức xuất, mã vạch unique, `search_text` (không dấu, chỉ mục trigram GIN để tìm nhanh & cảnh báo trùng) |
| suppliers | Nhà cung cấp; `bank_account`, `bank_name` là dữ liệu nhạy cảm (ẩn theo quyền) |

## Nhóm nhập – xuất kho mỏ
| Bảng | Ghi chú |
|---|---|
| stock_receipts / stock_receipt_items | Dòng: `qty_doc`, `qty_received` = `qty_accepted` + `qty_pending` + `qty_rejected` (CHECK); `inspection_status` |
| stock_issues / stock_issue_items | `qty_requested` → `qty_approved` (giữ chỗ) → `qty_issued` ≤ `qty_approved` (CHECK); chữ ký điện tử `receive_signature` |
| stock_transfers / _items | Vị trí đi/đến, người giao/nhận, thời gian bàn giao |
| stock_returns / _items | `qty_usable` / `qty_damaged` / `qty_pending` |
| stock_adjustments / _items | `source` MANUAL / STOCKTAKE / OPENING; `qty_delta` ≠ 0 |
| stocktakes / stocktake_items | `book_qty` (chốt sổ), `counted_qty`, `reason`; unique (đợt, mặt hàng, vị trí) |
| **stock_movements** | Sổ cái bất biến: `qty_in`/`qty_out`, `balance_after`, `location_balance_after`, `doc_type/doc_id/doc_code`, `doc_date`, `posted_at`, người thực hiện. **Trigger cấm UPDATE/DELETE** |
| **inventory_balances** | Số dư (kho, vị trí, mặt hàng): `qty_usable`, `qty_quarantine`, `qty_damaged` – **CHECK ≥ 0** |

Công thức: Tồn cuối kỳ = Tồn đầu kỳ + Nhập hợp lệ − Xuất hợp lệ ± Điều chỉnh hợp lệ = Σ(qty_in − qty_out) của sổ cái đến thời điểm cần xem.

## Nhóm kiểm soát
| Bảng | Mục đích |
|---|---|
| approval_history | Lịch sử tạo/gửi/duyệt/từ chối/hủy/xuất/xác nhận của từng chứng từ |
| audit_logs | Nhật ký: người, hành động, đối tượng, dữ liệu trước/sau, IP, user-agent, phiên. **Trigger cấm sửa/xóa** |
| attachments | Tài liệu đính kèm (tên lưu ngẫu nhiên, MIME, SHA-256, xóa mềm) |
| notifications | Thông báo cho người dùng |
| system_settings | Cấu hình (khóa kỳ, PP tính giá, tiền tệ, ngưỡng cảnh báo) |
| doc_sequences | Đánh số chứng từ theo năm (PN2026-00001…), an toàn đồng thời |
| backup_logs | Lịch sử sao lưu, SHA-256, kết quả kiểm tra toàn vẹn |
| import_batches | Lịch sử import Excel, số dòng thành công/bỏ qua/lỗi |

## Bổ sung / điều chỉnh so với danh sách gợi ý (lý do)
- **sessions** (mới): phiên đăng nhập thu hồi được (đăng xuất, khóa tài khoản, đổi mật khẩu) – an toàn hơn JWT không thu hồi được.
- **doc_sequences** (mới): đánh số chứng từ liên tục, không trùng khi nhiều người lập cùng lúc.
- **import_batches** (mới): truy vết các lần nhập dữ liệu ban đầu.
- **approval_requests** không tạo bảng riêng: trạng thái chờ duyệt nằm ngay trên chứng từ (`status = SUBMITTED`) + `approval_history`. Tránh trùng lặp dữ liệu và lệch trạng thái giữa 2 nơi. Khi công ty xác nhận duyệt nhiều cấp sẽ bổ sung bảng cấu hình luồng duyệt.
- **stock_adjustments** dùng chung cho điều chỉnh tay, điều chỉnh kiểm kê và **tồn đầu kỳ** (import) → mọi biến động tồn đều qua phê duyệt & sổ cái.
- Ba loại tồn (khả dụng / chờ kiểm tra / hư hỏng) là cột trong `inventory_balances` và thuộc tính `bucket` trong sổ cái – đáp ứng yêu cầu "hàng chờ kiểm tra", "chỉ tăng tồn khả dụng khi kiểm tra đạt".
- Bảng nhóm **hóa chất** và **mua hàng** sẽ được thêm bằng migration mới ở Giai đoạn 4–5 (không sửa bảng đang chạy).

## Chỉ mục quan trọng
`stock_movements(item_id, posted_at)`, `(warehouse_id, posted_at)`, `(doc_type, doc_id)`, `(department_id, posted_at)`; `items` GIN trigram trên `search_text`, `code`; chứng từ `(status, doc_date)`; `audit_logs(created_at)`, `(entity_type, entity_id)`.
