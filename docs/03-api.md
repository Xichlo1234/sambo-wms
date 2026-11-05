# 03 – Tài liệu API (REST)

- Tiền tố: `/api`. Định dạng trả về thống nhất:
  - Thành công: `{ "success": true, "data": …, "meta": { page, pageSize, total, totalPages } }`
  - Lỗi: `{ "success": false, "error": { "code", "message", "details" } }` – mã HTTP: 400 dữ liệu sai, 401 chưa đăng nhập, 403 không có quyền, 404, 409 trùng/xung đột trạng thái, 422 vi phạm quy tắc nghiệp vụ, 500.
- Xác thực: cookie `wms_sid` (httpOnly, SameSite=Strict). Mọi request ghi (POST/PUT/PATCH/DELETE) phải có header `X-Requested-With: wms` (chống CSRF).
- Danh sách hỗ trợ `page`, `pageSize` (≤200), `q`, các bộ lọc riêng; `?all=1` trả danh sách rút gọn cho ô chọn.
- Quyền ghi trong ngoặc [ ].

## Xác thực
| Method | Path | Mô tả |
|---|---|---|
| POST | /auth/login | `{username, password}` – khóa 15' sau 5 lần sai |
| POST | /auth/logout | Thu hồi phiên |
| GET | /auth/me | Thông tin người dùng + danh sách quyền |
| POST | /auth/change-password | `{current_password, new_password}` |

## Danh mục
| Path | Ghi chú |
|---|---|
| /items `GET, POST, PUT /:id, PATCH /:id/status` | [items.view/create/update/lock]; POST trả 409 `SIMILAR_ITEMS` kèm danh sách tương tự → gửi lại với `confirm_similar: true` |
| /items/lookup?q=&warehouse_id= | Tra cứu nhanh kèm tồn khả dụng |
| /items/check-similar `POST` | Kiểm tra trùng tên/quy cách |
| /categories, /units, /warehouses, /locations | CRUD + khóa [masterdata.manage] |
| /departments | [departments.manage] |
| /suppliers | [suppliers.manage]; tài khoản NH ẩn nếu thiếu `suppliers.view_sensitive` |

## Chứng từ kho mỏ
| Path | Hành động |
|---|---|
| /receipts | `GET`, `POST` (nháp), `PUT /:id`, `POST /:id/submit`, `/:id/approve` (ghi sổ), `/:id/reject {reason}`, `/:id/cancel {reason}`, `/:id/lines/:lineId/inspect {qty_release, qty_reject, note}` |
| /issues | `GET` (theo phạm vi bộ phận), `POST`, `PUT /:id`, `/submit`, `/approve {lines:[{id, qty_approved}]}`, `/reject`, `/issue {receiver_name, receiver_user_id, lines:[{id, allocations:[{location_id, qty}]}]}`, `/confirm {signature}`, `/cancel` |
| /transfers | `GET, POST, PUT /:id, /submit, /approve, /reject, /cancel` |
| /returns | `GET, POST, /submit, /inspect {lines:[{id, qty_usable, qty_damaged, qty_pending, inspection_note}]}, /approve, /reject, /cancel` |
| /adjustments | `GET, POST, /submit, /approve, /reject, /cancel` |
| /stocktakes | `GET, POST, /:id/freeze, POST /:id/lines, PUT /:id/counts, /submit, /approve, /reject, /cancel` |

Mọi body tạo chứng từ nhận `client_request_id` (UUID) để chống tạo trùng.

## Tồn kho & báo cáo
| Path | Mô tả |
|---|---|
| GET /stock/balances | `from,to` (NXT theo kỳ) hoặc `as_of` (tồn tại thời điểm); lọc `q, category_id, warehouse_id, kind, stock_status` |
| GET /stock/card | `item_id, warehouse_id, from, to, bucket` – thẻ kho |
| GET /stock/locations | Tồn theo vị trí của 1 mặt hàng + SL giữ chỗ |
| GET /stock/reconcile | Đối chiếu số dư ↔ sổ cái |
| GET /reports | Danh mục báo cáo |
| GET /reports/:key | Dữ liệu báo cáo (receipts, issues, nxt, stock-current, stock-asof, below-min, no-movement, consumption-dept, transactions, stocktake-variance, damaged-returns, stock-card) |
| GET /reports/:key/export?format=xlsx\|pdf | Xuất file [reports.export] |
| GET /print/:type/:id | Mẫu biểu PDF: receipt, issue, stocktake, transfer, return, adjustment |
| GET /dashboard?from&to | Chỉ số tổng hợp |
| GET /search?q= | Tìm kiếm toàn hệ thống theo quyền |

## Hệ thống
| Path | Mô tả |
|---|---|
| /users, /users/:id/status, /users/:id/reset-password, /users/lookup | [users.manage] |
| /roles, /roles/permissions | [roles.manage] |
| /settings `GET, PUT` | khóa kỳ cần [period.lock], còn lại [settings.manage] |
| /audit-logs | [audit.view] |
| /notifications, /notifications/read | Thông báo của người dùng |
| /attachments `GET ?entity_type&entity_id`, `POST` (multipart `files`, `entity_type`, `entity_id`, `category`), `GET /:id/download`, `DELETE /:id` | PDF/XLSX/DOCX/JPG/PNG, kiểm tra magic bytes, giới hạn dung lượng |
| /import/templates/:type, /import/:type/preview, /import/:type/error-report, /import/:type/commit, /import/history | type = items, opening_stock, suppliers, departments |
| /backups `GET, POST`, `/:id/verify`, `/:id/download`, `/:id/restore {confirm:"KHOI PHUC"}` | [backup.manage] |
| GET /health | Kiểm tra sức khỏe (không cần đăng nhập) |
