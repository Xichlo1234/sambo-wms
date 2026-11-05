-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "DocStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'COUNTING', 'INSPECTED', 'POSTED', 'ISSUED', 'RECEIVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WarehouseType" AS ENUM ('GENERAL', 'CHEMICAL');

-- CreateEnum
CREATE TYPE "ItemKind" AS ENUM ('MATERIAL', 'EQUIPMENT');

-- CreateEnum
CREATE TYPE "StockBucket" AS ENUM ('USABLE', 'QUARANTINE', 'DAMAGED');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('OPENING', 'RECEIPT', 'ISSUE', 'TRANSFER_OUT', 'TRANSFER_IN', 'RETURN', 'ADJUSTMENT', 'STOCKTAKE', 'INSPECTION');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('NONE', 'PENDING', 'RELEASED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AdjustmentSource" AS ENUM ('MANUAL', 'STOCKTAKE', 'OPENING');

-- CreateEnum
CREATE TYPE "StocktakeScope" AS ENUM ('ALL', 'CATEGORY', 'LOCATION', 'ITEMS');

-- CreateEnum
CREATE TYPE "BackupType" AS ENUM ('AUTO', 'MANUAL');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" VARCHAR(50) NOT NULL,
    "full_name" VARCHAR(150) NOT NULL,
    "email" VARCHAR(150),
    "phone" VARCHAR(30),
    "position" VARCHAR(100),
    "password_hash" TEXT NOT NULL,
    "department_id" INTEGER,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "module" VARCHAR(50) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" INTEGER NOT NULL,
    "role_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" INTEGER NOT NULL,
    "permission_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "user_id" INTEGER NOT NULL,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "manager_user_id" INTEGER,
    "manager_name" VARCHAR(150),
    "area" VARCHAR(200),
    "description" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "type" "WarehouseType" NOT NULL DEFAULT 'GENERAL',
    "address" TEXT,
    "manager" VARCHAR(150),
    "description" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_locations" (
    "id" SERIAL NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "zone" VARCHAR(100),
    "description" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,

    CONSTRAINT "warehouse_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_categories" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "parent_id" INTEGER,
    "description" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,

    CONSTRAINT "item_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(250) NOT NULL,
    "name_en" VARCHAR(250),
    "kind" "ItemKind" NOT NULL DEFAULT 'MATERIAL',
    "category_id" INTEGER NOT NULL,
    "subcategory_id" INTEGER,
    "specification" TEXT,
    "model" VARCHAR(150),
    "manufacturer" VARCHAR(150),
    "origin" VARCHAR(100),
    "unit_id" INTEGER NOT NULL,
    "barcode" VARCHAR(100),
    "default_location_id" INTEGER,
    "min_stock" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "max_stock" DECIMAL(18,4),
    "safety_stock" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "max_issue_qty" DECIMAL(18,4),
    "preferred_supplier_id" INTEGER,
    "serial_no" VARCHAR(100),
    "asset_code" VARCHAR(100),
    "search_text" TEXT NOT NULL DEFAULT '',
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(250) NOT NULL,
    "address" TEXT,
    "country" VARCHAR(100),
    "contact_person" VARCHAR(150),
    "phone" VARCHAR(50),
    "email" VARCHAR(150),
    "tax_code" VARCHAR(50),
    "supply_groups" TEXT,
    "bank_account" VARCHAR(100),
    "bank_name" VARCHAR(200),
    "payment_terms" TEXT,
    "cooperation_status" VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "search_text" TEXT NOT NULL DEFAULT '',
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_receipts" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "client_request_id" VARCHAR(64),
    "warehouse_id" INTEGER NOT NULL,
    "doc_date" DATE NOT NULL,
    "received_date" DATE,
    "posted_at" TIMESTAMP(3),
    "supplier_id" INTEGER,
    "po_number" VARCHAR(50),
    "supplier_doc_no" VARCHAR(100),
    "deliverer_name" VARCHAR(150),
    "receiver_user_id" INTEGER,
    "receiver_name" VARCHAR(150),
    "department_id" INTEGER,
    "currency" VARCHAR(10),
    "exchange_rate" DECIMAL(18,6),
    "docs_checked" BOOLEAN NOT NULL DEFAULT false,
    "qty_checked" BOOLEAN NOT NULL DEFAULT false,
    "spec_checked" BOOLEAN NOT NULL DEFAULT false,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "reject_reason" TEXT,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "submitted_by" INTEGER,
    "submitted_at" TIMESTAMP(3),
    "approved_by" INTEGER,
    "approved_at" TIMESTAMP(3),
    "cancelled_by" INTEGER,
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "stock_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_receipt_items" (
    "id" SERIAL NOT NULL,
    "receipt_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "location_id" INTEGER NOT NULL,
    "qty_doc" DECIMAL(18,4) NOT NULL,
    "qty_received" DECIMAL(18,4) NOT NULL,
    "qty_accepted" DECIMAL(18,4) NOT NULL,
    "qty_pending" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "qty_rejected" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unit_price" DECIMAL(18,4),
    "amount" DECIMAL(20,4),
    "condition_note" TEXT,
    "note" TEXT,
    "inspection_status" "InspectionStatus" NOT NULL DEFAULT 'NONE',
    "inspected_by" INTEGER,
    "inspected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_issues" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "client_request_id" VARCHAR(64),
    "warehouse_id" INTEGER NOT NULL,
    "doc_date" DATE NOT NULL,
    "issued_at" TIMESTAMP(3),
    "department_id" INTEGER NOT NULL,
    "requester_id" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "work_area" VARCHAR(200),
    "receiver_user_id" INTEGER,
    "receiver_name" VARCHAR(150),
    "receive_confirmed_at" TIMESTAMP(3),
    "receive_confirmed_by" INTEGER,
    "receive_signature" VARCHAR(150),
    "quota_warning" BOOLEAN NOT NULL DEFAULT false,
    "quota_note" TEXT,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "reject_reason" TEXT,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "submitted_at" TIMESTAMP(3),
    "approved_by" INTEGER,
    "approved_at" TIMESTAMP(3),
    "issued_by" INTEGER,
    "cancelled_by" INTEGER,
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "stock_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_issue_items" (
    "id" SERIAL NOT NULL,
    "issue_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "location_id" INTEGER,
    "qty_requested" DECIMAL(18,4) NOT NULL,
    "qty_approved" DECIMAL(18,4),
    "qty_issued" DECIMAL(18,4),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_issue_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "client_request_id" VARCHAR(64),
    "from_warehouse_id" INTEGER NOT NULL,
    "to_warehouse_id" INTEGER NOT NULL,
    "doc_date" DATE NOT NULL,
    "sender_name" VARCHAR(150),
    "receiver_name" VARCHAR(150),
    "handover_at" TIMESTAMP(3),
    "posted_at" TIMESTAMP(3),
    "reason" TEXT,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "reject_reason" TEXT,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "submitted_at" TIMESTAMP(3),
    "approved_by" INTEGER,
    "approved_at" TIMESTAMP(3),
    "cancelled_by" INTEGER,
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_items" (
    "id" SERIAL NOT NULL,
    "transfer_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "from_location_id" INTEGER NOT NULL,
    "to_location_id" INTEGER NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_transfer_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_returns" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "client_request_id" VARCHAR(64),
    "warehouse_id" INTEGER NOT NULL,
    "department_id" INTEGER NOT NULL,
    "related_issue_id" INTEGER,
    "doc_date" DATE NOT NULL,
    "returned_by_name" VARCHAR(150),
    "reason" TEXT,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "reject_reason" TEXT,
    "cancel_reason" TEXT,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "submitted_at" TIMESTAMP(3),
    "inspected_by" INTEGER,
    "inspected_at" TIMESTAMP(3),
    "approved_by" INTEGER,
    "approved_at" TIMESTAMP(3),
    "cancelled_by" INTEGER,
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "stock_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_return_items" (
    "id" SERIAL NOT NULL,
    "return_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "location_id" INTEGER NOT NULL,
    "qty_returned" DECIMAL(18,4) NOT NULL,
    "qty_usable" DECIMAL(18,4),
    "qty_damaged" DECIMAL(18,4),
    "qty_pending" DECIMAL(18,4),
    "reason" TEXT,
    "inspection_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "client_request_id" VARCHAR(64),
    "warehouse_id" INTEGER NOT NULL,
    "source" "AdjustmentSource" NOT NULL DEFAULT 'MANUAL',
    "stocktake_id" INTEGER,
    "doc_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "reject_reason" TEXT,
    "cancel_reason" TEXT,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "submitted_at" TIMESTAMP(3),
    "approved_by" INTEGER,
    "approved_at" TIMESTAMP(3),
    "cancelled_by" INTEGER,
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustment_items" (
    "id" SERIAL NOT NULL,
    "adjustment_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "location_id" INTEGER NOT NULL,
    "bucket" "StockBucket" NOT NULL DEFAULT 'USABLE',
    "qty_delta" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,4),
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_adjustment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocktakes" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "scope_type" "StocktakeScope" NOT NULL,
    "scope_ref" JSONB,
    "snapshot_at" TIMESTAMP(3),
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "reject_reason" TEXT,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "submitted_at" TIMESTAMP(3),
    "approved_by" INTEGER,
    "approved_at" TIMESTAMP(3),
    "cancelled_by" INTEGER,
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "stocktakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocktake_items" (
    "id" SERIAL NOT NULL,
    "stocktake_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "location_id" INTEGER NOT NULL,
    "book_qty" DECIMAL(18,4) NOT NULL,
    "counted_qty" DECIMAL(18,4),
    "reason" TEXT,
    "counted_by" INTEGER,
    "counted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stocktake_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" BIGSERIAL NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "location_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "bucket" "StockBucket" NOT NULL,
    "movement_type" "MovementType" NOT NULL,
    "qty_in" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "qty_out" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "balance_after" DECIMAL(18,4) NOT NULL,
    "location_balance_after" DECIMAL(18,4) NOT NULL,
    "unit_cost" DECIMAL(18,4),
    "doc_type" VARCHAR(30) NOT NULL,
    "doc_id" INTEGER NOT NULL,
    "doc_code" VARCHAR(30) NOT NULL,
    "doc_line_id" INTEGER,
    "doc_date" DATE NOT NULL,
    "posted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "department_id" INTEGER,
    "supplier_id" INTEGER,
    "user_id" INTEGER NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_balances" (
    "id" SERIAL NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "location_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "qty_usable" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "qty_quarantine" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "qty_damaged" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "last_movement_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_history" (
    "id" BIGSERIAL NOT NULL,
    "entity_type" VARCHAR(40) NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "action" VARCHAR(30) NOT NULL,
    "from_status" VARCHAR(20),
    "to_status" VARCHAR(20),
    "user_id" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER,
    "username" VARCHAR(50),
    "action" VARCHAR(40) NOT NULL,
    "entity_type" VARCHAR(40) NOT NULL,
    "entity_id" VARCHAR(40),
    "entity_code" VARCHAR(60),
    "before_data" JSONB,
    "after_data" JSONB,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(300),
    "session_id" VARCHAR(40),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" SERIAL NOT NULL,
    "entity_type" VARCHAR(40) NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "category" VARCHAR(30) NOT NULL DEFAULT 'OTHER',
    "file_name" VARCHAR(255) NOT NULL,
    "stored_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(120) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" INTEGER,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "message" TEXT,
    "link" VARCHAR(300),
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" VARCHAR(80) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "doc_sequences" (
    "doc_type" VARCHAR(20) NOT NULL,
    "period" VARCHAR(10) NOT NULL,
    "last_no" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doc_sequences_pkey" PRIMARY KEY ("doc_type","period")
);

-- CreateTable
CREATE TABLE "backup_logs" (
    "id" SERIAL NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "size_bytes" BIGINT,
    "sha256" VARCHAR(64),
    "type" "BackupType" NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "message" TEXT,
    "verified_at" TIMESTAMP(3),
    "verify_ok" BOOLEAN,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backup_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" SERIAL NOT NULL,
    "import_type" VARCHAR(40) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "total_rows" INTEGER NOT NULL,
    "success_rows" INTEGER NOT NULL,
    "error_rows" INTEGER NOT NULL,
    "skipped_rows" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL,
    "summary" JSONB,
    "ref_doc" VARCHAR(40),
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_department_id_idx" ON "users"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_locations_warehouse_id_code_key" ON "warehouse_locations"("warehouse_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "item_categories_code_key" ON "item_categories"("code");

-- CreateIndex
CREATE INDEX "item_categories_parent_id_idx" ON "item_categories"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "units_code_key" ON "units"("code");

-- CreateIndex
CREATE UNIQUE INDEX "items_code_key" ON "items"("code");

-- CreateIndex
CREATE UNIQUE INDEX "items_barcode_key" ON "items"("barcode");

-- CreateIndex
CREATE INDEX "items_category_id_idx" ON "items"("category_id");

-- CreateIndex
CREATE INDEX "items_kind_status_idx" ON "items"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "stock_receipts_code_key" ON "stock_receipts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "stock_receipts_client_request_id_key" ON "stock_receipts"("client_request_id");

-- CreateIndex
CREATE INDEX "stock_receipts_status_doc_date_idx" ON "stock_receipts"("status", "doc_date");

-- CreateIndex
CREATE INDEX "stock_receipts_supplier_id_idx" ON "stock_receipts"("supplier_id");

-- CreateIndex
CREATE INDEX "stock_receipt_items_receipt_id_idx" ON "stock_receipt_items"("receipt_id");

-- CreateIndex
CREATE INDEX "stock_receipt_items_item_id_idx" ON "stock_receipt_items"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_issues_code_key" ON "stock_issues"("code");

-- CreateIndex
CREATE UNIQUE INDEX "stock_issues_client_request_id_key" ON "stock_issues"("client_request_id");

-- CreateIndex
CREATE INDEX "stock_issues_status_doc_date_idx" ON "stock_issues"("status", "doc_date");

-- CreateIndex
CREATE INDEX "stock_issues_department_id_idx" ON "stock_issues"("department_id");

-- CreateIndex
CREATE INDEX "stock_issue_items_issue_id_idx" ON "stock_issue_items"("issue_id");

-- CreateIndex
CREATE INDEX "stock_issue_items_item_id_idx" ON "stock_issue_items"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_code_key" ON "stock_transfers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_client_request_id_key" ON "stock_transfers"("client_request_id");

-- CreateIndex
CREATE INDEX "stock_transfers_status_doc_date_idx" ON "stock_transfers"("status", "doc_date");

-- CreateIndex
CREATE INDEX "stock_transfer_items_transfer_id_idx" ON "stock_transfer_items"("transfer_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_returns_code_key" ON "stock_returns"("code");

-- CreateIndex
CREATE UNIQUE INDEX "stock_returns_client_request_id_key" ON "stock_returns"("client_request_id");

-- CreateIndex
CREATE INDEX "stock_returns_status_doc_date_idx" ON "stock_returns"("status", "doc_date");

-- CreateIndex
CREATE INDEX "stock_return_items_return_id_idx" ON "stock_return_items"("return_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_code_key" ON "stock_adjustments"("code");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_client_request_id_key" ON "stock_adjustments"("client_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_stocktake_id_key" ON "stock_adjustments"("stocktake_id");

-- CreateIndex
CREATE INDEX "stock_adjustments_status_doc_date_idx" ON "stock_adjustments"("status", "doc_date");

-- CreateIndex
CREATE INDEX "stock_adjustment_items_adjustment_id_idx" ON "stock_adjustment_items"("adjustment_id");

-- CreateIndex
CREATE UNIQUE INDEX "stocktakes_code_key" ON "stocktakes"("code");

-- CreateIndex
CREATE INDEX "stocktakes_status_idx" ON "stocktakes"("status");

-- CreateIndex
CREATE UNIQUE INDEX "stocktake_items_stocktake_id_item_id_location_id_key" ON "stocktake_items"("stocktake_id", "item_id", "location_id");

-- CreateIndex
CREATE INDEX "stock_movements_item_id_posted_at_idx" ON "stock_movements"("item_id", "posted_at");

-- CreateIndex
CREATE INDEX "stock_movements_warehouse_id_posted_at_idx" ON "stock_movements"("warehouse_id", "posted_at");

-- CreateIndex
CREATE INDEX "stock_movements_doc_type_doc_id_idx" ON "stock_movements"("doc_type", "doc_id");

-- CreateIndex
CREATE INDEX "stock_movements_department_id_posted_at_idx" ON "stock_movements"("department_id", "posted_at");

-- CreateIndex
CREATE INDEX "inventory_balances_item_id_idx" ON "inventory_balances"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_balances_warehouse_id_location_id_item_id_key" ON "inventory_balances"("warehouse_id", "location_id", "item_id");

-- CreateIndex
CREATE INDEX "approval_history_entity_type_entity_id_idx" ON "approval_history"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_stored_name_key" ON "attachments"("stored_name");

-- CreateIndex
CREATE INDEX "attachments_entity_type_entity_id_idx" ON "attachments"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_locations" ADD CONSTRAINT "warehouse_locations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_categories" ADD CONSTRAINT "item_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "item_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "item_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_default_location_id_fkey" FOREIGN KEY ("default_location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_preferred_supplier_id_fkey" FOREIGN KEY ("preferred_supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipt_items" ADD CONSTRAINT "stock_receipt_items_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "stock_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipt_items" ADD CONSTRAINT "stock_receipt_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipt_items" ADD CONSTRAINT "stock_receipt_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "warehouse_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_issues" ADD CONSTRAINT "stock_issues_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_issues" ADD CONSTRAINT "stock_issues_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_issues" ADD CONSTRAINT "stock_issues_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_issues" ADD CONSTRAINT "stock_issues_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_issues" ADD CONSTRAINT "stock_issues_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_issue_items" ADD CONSTRAINT "stock_issue_items_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "stock_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_issue_items" ADD CONSTRAINT "stock_issue_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_issue_items" ADD CONSTRAINT "stock_issue_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_warehouse_id_fkey" FOREIGN KEY ("from_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_warehouse_id_fkey" FOREIGN KEY ("to_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "warehouse_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "warehouse_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_returns" ADD CONSTRAINT "stock_returns_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_returns" ADD CONSTRAINT "stock_returns_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_returns" ADD CONSTRAINT "stock_returns_related_issue_id_fkey" FOREIGN KEY ("related_issue_id") REFERENCES "stock_issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_returns" ADD CONSTRAINT "stock_returns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_return_items" ADD CONSTRAINT "stock_return_items_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "stock_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_return_items" ADD CONSTRAINT "stock_return_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_return_items" ADD CONSTRAINT "stock_return_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "warehouse_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_stocktake_id_fkey" FOREIGN KEY ("stocktake_id") REFERENCES "stocktakes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_items" ADD CONSTRAINT "stock_adjustment_items_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "stock_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_items" ADD CONSTRAINT "stock_adjustment_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_items" ADD CONSTRAINT "stock_adjustment_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "warehouse_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_items" ADD CONSTRAINT "stocktake_items_stocktake_id_fkey" FOREIGN KEY ("stocktake_id") REFERENCES "stocktakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_items" ADD CONSTRAINT "stocktake_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_items" ADD CONSTRAINT "stocktake_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "warehouse_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "warehouse_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "warehouse_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_history" ADD CONSTRAINT "approval_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- RÀNG BUỘC NGHIỆP VỤ BỔ SUNG (không biểu diễn được bằng Prisma schema)
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Tồn kho không bao giờ âm
ALTER TABLE "inventory_balances"
  ADD CONSTRAINT "chk_balance_usable_nonneg" CHECK ("qty_usable" >= 0),
  ADD CONSTRAINT "chk_balance_quarantine_nonneg" CHECK ("qty_quarantine" >= 0),
  ADD CONSTRAINT "chk_balance_damaged_nonneg" CHECK ("qty_damaged" >= 0);

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "chk_movement_qty" CHECK ("qty_in" >= 0 AND "qty_out" >= 0 AND ("qty_in" > 0 OR "qty_out" > 0)),
  ADD CONSTRAINT "chk_movement_balance_nonneg" CHECK ("balance_after" >= 0 AND "location_balance_after" >= 0);

-- Dòng phiếu nhập: SL thực nhận = đạt + chờ kiểm tra + không đạt
ALTER TABLE "stock_receipt_items"
  ADD CONSTRAINT "chk_receipt_line_qty" CHECK (
    "qty_doc" >= 0 AND "qty_received" >= 0 AND "qty_accepted" >= 0 AND "qty_pending" >= 0 AND "qty_rejected" >= 0
    AND "qty_received" = "qty_accepted" + "qty_pending" + "qty_rejected");

ALTER TABLE "stock_issue_items"
  ADD CONSTRAINT "chk_issue_line_qty" CHECK (
    "qty_requested" > 0 AND ("qty_approved" IS NULL OR "qty_approved" >= 0)
    AND ("qty_issued" IS NULL OR ("qty_issued" >= 0 AND "qty_issued" <= COALESCE("qty_approved", 0))));

ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "chk_transfer_line_qty" CHECK ("qty" > 0);
ALTER TABLE "stock_return_items" ADD CONSTRAINT "chk_return_line_qty" CHECK ("qty_returned" > 0);
ALTER TABLE "stock_adjustment_items" ADD CONSTRAINT "chk_adjustment_line_qty" CHECK ("qty_delta" <> 0);

ALTER TABLE "items"
  ADD CONSTRAINT "chk_item_stock_levels" CHECK ("min_stock" >= 0 AND "safety_stock" >= 0 AND ("max_stock" IS NULL OR "max_stock" >= "min_stock"));

-- Sổ cái kho bất biến: cấm UPDATE / DELETE
CREATE OR REPLACE FUNCTION wms_forbid_ledger_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements là sổ cái bất biến – không được sửa/xóa. Hãy lập chứng từ điều chỉnh.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stock_movements_immutable
  BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION wms_forbid_ledger_change();

-- Không xóa chứng từ đã ghi sổ
CREATE OR REPLACE FUNCTION wms_forbid_posted_doc_delete() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('POSTED','ISSUED','RECEIVED') THEN
    RAISE EXCEPTION 'Không được xóa chứng từ đã ghi sổ (%).', OLD.code;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_receipts_no_delete BEFORE DELETE ON "stock_receipts" FOR EACH ROW EXECUTE FUNCTION wms_forbid_posted_doc_delete();
CREATE TRIGGER trg_issues_no_delete BEFORE DELETE ON "stock_issues" FOR EACH ROW EXECUTE FUNCTION wms_forbid_posted_doc_delete();
CREATE TRIGGER trg_transfers_no_delete BEFORE DELETE ON "stock_transfers" FOR EACH ROW EXECUTE FUNCTION wms_forbid_posted_doc_delete();
CREATE TRIGGER trg_returns_no_delete BEFORE DELETE ON "stock_returns" FOR EACH ROW EXECUTE FUNCTION wms_forbid_posted_doc_delete();
CREATE TRIGGER trg_adjustments_no_delete BEFORE DELETE ON "stock_adjustments" FOR EACH ROW EXECUTE FUNCTION wms_forbid_posted_doc_delete();

-- Nhật ký hoạt động chỉ được ghi thêm
CREATE TRIGGER trg_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION wms_forbid_ledger_change();

-- Tìm kiếm nhanh / cảnh báo trùng tên (trigram)
CREATE INDEX "items_search_trgm" ON "items" USING GIN ("search_text" gin_trgm_ops);
CREATE INDEX "items_code_trgm" ON "items" USING GIN ("code" gin_trgm_ops);
CREATE INDEX "suppliers_search_trgm" ON "suppliers" USING GIN ("search_text" gin_trgm_ops);
