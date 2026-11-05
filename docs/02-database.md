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

## Nhóm kho hóa chất (tách biệt)
| Bảng | Ghi chú |
|---|---|
| chemicals | Hồ sơ hóa chất: định danh (CAS, công thức, nồng độ…), GHS (mảng biểu tượng), câu H/P, bảo quản, nhiệt độ, thông gió, PCCC, PPE, sơ cứu, xử lý tràn đổ, `is_controlled`, `safety_verified_by/at` |
| chemical_batches | **Lô**: mã lô NSX, mã lô nội bộ (unique), NSX, ngày nhập, HSD, SL nhập/còn, vị trí, `qc_status` (PENDING/PASSED/QUARANTINE/FAILED), bao bì bất thường. CHECK tồn ≥ 0, HSD ≥ NSX |
| chemical_receipts / _items | Phiếu nhập: 5 cờ kiểm tra tiếp nhận; dòng: lô, NSX, HSD, kết quả (PASSED/QUARANTINE/FAILED), bao bì/nhãn, liên kết dòng PO |
| chemical_issues / _items | Yêu cầu sử dụng: mục đích, khu vực, người chịu trách nhiệm, HSE xác nhận; dòng: SL yêu cầu/duyệt/xuất + `batch_detail` (lô đã xuất) |
| chemical_movements | Sổ cái theo lô – **trigger bất biến** |
| chemical_safety_documents | SDS, tài liệu kỹ thuật, COA, hình bao bì, hướng dẫn sự cố – phiên bản, ngày ban hành, hạn rà soát, xác nhận chuyên môn; SDS mới tự đánh dấu bản cũ "SUPERSEDED" |
| chemical_storage_requirements | Quy tắc lưu trữ không tương thích theo cặp hóa chất, căn cứ SDS, người xác nhận (chỉ quy tắc đã xác nhận mới cảnh báo) |
| chemical_inspections | Nhật ký kiểm tra kho: nhiệt độ, độ ẩm, 6 hạng mục, phát hiện, biện pháp |
| chemical_incidents | Nhật ký sự cố: loại, mức độ, mô tả, biện pháp, đóng sự cố |
| chemical_stocktakes / _items | Kiểm kê theo **lô**: tồn sổ, thực tế, tình trạng bao bì, giải trình |
| chemical_adjustments / _items | Điều chỉnh / **tiêu hủy** / theo kiểm kê – theo lô, cần phê duyệt (bổ sung so với danh sách gợi ý để xử lý hóa chất hết hạn) |

## Nhóm mua hàng & nhà cung cấp
| Bảng | Ghi chú |
|---|---|
| purchase_requests / _items | Đề nghị mua; dòng là vật tư HOẶC hóa chất; trạng thái `PurchaseStatus` |
| supplier_quotes / _items | Yêu cầu báo giá theo NCC, giá phản hồi, tiền tệ, thời gian giao, hiệu lực |
| purchase_orders / _items | PO: dòng có `qty_ordered`, `qty_received` (cập nhật khi phiếu nhập được duyệt, khóa dòng `FOR UPDATE`, không vượt SL đặt). CHECK mỗi dòng đúng một loại hàng |
| supplier_evaluations | Điểm 1–5 × 4 tiêu chí, tổng điểm /100, xếp loại A–D, số liệu kỳ (JSON) |
| supplier_complaints | Khiếu nại NCC & kết quả xử lý (bổ sung để theo dõi "lịch sử khiếu nại") |
| stock_receipts.purchase_order_id, stock_receipt_items.po_item_id | Liên kết PO ↔ phiếu nhập kho mỏ (migration bổ sung cột, không đổi dữ liệu cũ) |

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
- Bảng nhóm **hóa chất** và **mua hàng** được thêm bằng migration `20261106000000_chemicals_purchasing` (chỉ thêm bảng/cột, không sửa/xóa dữ liệu đang có).
- `chemical_receipts` dùng chung enum trạng thái với kho mỏ nhưng nhãn theo nghiệp vụ 6.3: DRAFT = Chờ kiểm tra, SUBMITTED = Chờ phê duyệt, POSTED = Đã nhập kho, REJECTED = Từ chối tiếp nhận; "Không đạt yêu cầu" và "Cách ly" là kết quả ở cấp dòng/lô.

## Chỉ mục quan trọng
`stock_movements(item_id, posted_at)`, `(warehouse_id, posted_at)`, `(doc_type, doc_id)`, `(department_id, posted_at)`; `items` GIN trigram trên `search_text`, `code`; chứng từ `(status, doc_date)`; `audit_logs(created_at)`, `(entity_type, entity_id)`.
