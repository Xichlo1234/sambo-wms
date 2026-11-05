-- CreateEnum
CREATE TYPE "PhysicalState" AS ENUM ('SOLID', 'LIQUID', 'GAS', 'OTHER');

-- CreateEnum
CREATE TYPE "BatchQcStatus" AS ENUM ('PENDING', 'PASSED', 'QUARANTINE', 'FAILED');

-- CreateEnum
CREATE TYPE "ChemLineResult" AS ENUM ('PASSED', 'QUARANTINE', 'FAILED');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ORDERED', 'SENT', 'PARTIAL', 'RECEIVED', 'CLOSED', 'CANCELLED');

-- DropIndex

-- DropIndex

-- DropIndex

-- AlterTable
ALTER TABLE "stock_receipt_items" ADD COLUMN     "po_item_id" INTEGER;

-- AlterTable
ALTER TABLE "stock_receipts" ADD COLUMN     "purchase_order_id" INTEGER;

-- CreateTable
CREATE TABLE "chemicals" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(250) NOT NULL,
    "trade_name" VARCHAR(250),
    "name_en" VARCHAR(250),
    "scientific_name" VARCHAR(250),
    "cas_number" VARCHAR(50),
    "formula" VARCHAR(100),
    "concentration" VARCHAR(100),
    "chemical_group" VARCHAR(150),
    "manufacturer" VARCHAR(200),
    "supplier_id" INTEGER,
    "unit_id" INTEGER NOT NULL,
    "packaging" VARCHAR(200),
    "physical_state" "PhysicalState" NOT NULL DEFAULT 'OTHER',
    "hazard_level" VARCHAR(50),
    "ghs_classification" TEXT,
    "ghs_pictograms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hazard_statements" TEXT,
    "precautionary_statements" TEXT,
    "storage_conditions" TEXT,
    "storage_temp_min" DECIMAL(8,2),
    "storage_temp_max" DECIMAL(8,2),
    "ventilation_req" TEXT,
    "fire_req" TEXT,
    "ppe_req" TEXT,
    "first_aid" TEXT,
    "spill_response" TEXT,
    "default_shelf_life_days" INTEGER,
    "is_controlled" BOOLEAN NOT NULL DEFAULT false,
    "min_stock" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "safety_notes" TEXT,
    "safety_verified_by" INTEGER,
    "safety_verified_at" TIMESTAMP(3),
    "search_text" TEXT NOT NULL DEFAULT '',
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,

    CONSTRAINT "chemicals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chemical_batches" (
    "id" SERIAL NOT NULL,
    "chemical_id" INTEGER NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "location_id" INTEGER NOT NULL,
    "batch_no" VARCHAR(100) NOT NULL,
    "internal_code" VARCHAR(40) NOT NULL,
    "mfg_date" DATE,
    "received_date" DATE NOT NULL,
    "expiry_date" DATE,
    "qty_received" DECIMAL(18,4) NOT NULL,
    "qty_on_hand" DECIMAL(18,4) NOT NULL,
    "supplier_id" INTEGER,
    "manufacturer" VARCHAR(200),
    "storage_note" TEXT,
    "qc_status" "BatchQcStatus" NOT NULL DEFAULT 'PENDING',
    "qc_note" TEXT,
    "abnormal" BOOLEAN NOT NULL DEFAULT false,
    "abnormal_note" TEXT,
    "receipt_id" INTEGER,
    "receipt_line_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,

    CONSTRAINT "chemical_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chemical_receipts" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "client_request_id" VARCHAR(64),
    "warehouse_id" INTEGER NOT NULL,
    "doc_date" DATE NOT NULL,
    "received_date" DATE NOT NULL,
    "supplier_id" INTEGER,
    "purchase_order_id" INTEGER,
    "supplier_doc_no" VARCHAR(100),
    "deliverer_name" VARCHAR(150),
    "transport_note" TEXT,
    "chk_packaging" BOOLEAN NOT NULL DEFAULT false,
    "chk_label" BOOLEAN NOT NULL DEFAULT false,
    "chk_documents" BOOLEAN NOT NULL DEFAULT false,
    "chk_sds" BOOLEAN NOT NULL DEFAULT false,
    "chk_transport" BOOLEAN NOT NULL DEFAULT false,
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

    CONSTRAINT "chemical_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chemical_receipt_items" (
    "id" SERIAL NOT NULL,
    "receipt_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "chemical_id" INTEGER NOT NULL,
    "location_id" INTEGER NOT NULL,
    "po_item_id" INTEGER,
    "batch_no" VARCHAR(100),
    "mfg_date" DATE,
    "expiry_date" DATE,
    "qty_doc" DECIMAL(18,4) NOT NULL,
    "qty_received" DECIMAL(18,4) NOT NULL,
    "result" "ChemLineResult" NOT NULL DEFAULT 'PASSED',
    "packaging_ok" BOOLEAN NOT NULL DEFAULT true,
    "label_ok" BOOLEAN NOT NULL DEFAULT true,
    "condition_note" TEXT,
    "unit_price" DECIMAL(18,4),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chemical_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chemical_issues" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "client_request_id" VARCHAR(64),
    "warehouse_id" INTEGER NOT NULL,
    "doc_date" DATE NOT NULL,
    "department_id" INTEGER NOT NULL,
    "requester_id" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "work_area" VARCHAR(200) NOT NULL,
    "responsible_person" VARCHAR(150) NOT NULL,
    "requires_hse" BOOLEAN NOT NULL DEFAULT false,
    "hse_confirmed_by" INTEGER,
    "hse_confirmed_at" TIMESTAMP(3),
    "hse_note" TEXT,
    "receiver_name" VARCHAR(150),
    "receiver_user_id" INTEGER,
    "receive_confirmed_at" TIMESTAMP(3),
    "receive_signature" VARCHAR(150),
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "reject_reason" TEXT,
    "cancel_reason" TEXT,
    "issued_at" TIMESTAMP(3),
    "issued_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "submitted_at" TIMESTAMP(3),
    "approved_by" INTEGER,
    "approved_at" TIMESTAMP(3),
    "cancelled_by" INTEGER,
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "chemical_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chemical_issue_items" (
    "id" SERIAL NOT NULL,
    "issue_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "chemical_id" INTEGER NOT NULL,
    "qty_requested" DECIMAL(18,4) NOT NULL,
    "qty_approved" DECIMAL(18,4),
    "qty_issued" DECIMAL(18,4),
    "batch_detail" JSONB,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chemical_issue_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chemical_movements" (
    "id" BIGSERIAL NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "chemical_id" INTEGER NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "location_id" INTEGER NOT NULL,
    "movement_type" VARCHAR(20) NOT NULL,
    "qty_in" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "qty_out" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "balance_after" DECIMAL(18,4) NOT NULL,
    "doc_type" VARCHAR(30) NOT NULL,
    "doc_id" INTEGER NOT NULL,
    "doc_code" VARCHAR(30) NOT NULL,
    "doc_date" DATE NOT NULL,
    "posted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "department_id" INTEGER,
    "user_id" INTEGER NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chemical_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chemical_safety_documents" (
    "id" SERIAL NOT NULL,
    "chemical_id" INTEGER NOT NULL,
    "doc_type" VARCHAR(30) NOT NULL,
    "title" VARCHAR(250) NOT NULL,
    "version" VARCHAR(50),
    "language" VARCHAR(20),
    "issue_date" DATE,
    "review_date" DATE,
    "attachment_id" INTEGER,
    "verified_by" INTEGER,
    "verified_at" TIMESTAMP(3),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER NOT NULL,

    CONSTRAINT "chemical_safety_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chemical_storage_requirements" (
    "id" SERIAL NOT NULL,
    "chemical_a_id" INTEGER NOT NULL,
    "chemical_b_id" INTEGER NOT NULL,
    "rule" VARCHAR(30) NOT NULL DEFAULT 'INCOMPATIBLE',
    "description" TEXT NOT NULL,
    "source_ref" VARCHAR(200),
    "verified_by" INTEGER,
    "verified_at" TIMESTAMP(3),
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER NOT NULL,

    CONSTRAINT "chemical_storage_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chemical_inspections" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "inspected_at" TIMESTAMP(3) NOT NULL,
    "inspector_id" INTEGER NOT NULL,
    "temperature" DECIMAL(6,2),
    "humidity" DECIMAL(6,2),
    "ventilation_ok" BOOLEAN NOT NULL,
    "fire_equipment_ok" BOOLEAN NOT NULL,
    "spill_kit_ok" BOOLEAN NOT NULL,
    "labeling_ok" BOOLEAN NOT NULL,
    "segregation_ok" BOOLEAN NOT NULL,
    "ppe_ok" BOOLEAN NOT NULL,
    "findings" TEXT,
    "actions" TEXT,
    "result" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chemical_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chemical_incidents" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "warehouse_id" INTEGER,
    "location_text" VARCHAR(200),
    "chemical_id" INTEGER,
    "batch_id" INTEGER,
    "incident_type" VARCHAR(30) NOT NULL,
    "severity" VARCHAR(20) NOT NULL,
    "description" TEXT NOT NULL,
    "actions_taken" TEXT,
    "injuries" TEXT,
    "reported_by" INTEGER NOT NULL,
    "handled_by" INTEGER,
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMP(3),
    "close_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chemical_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chemical_stocktakes" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "snapshot_at" TIMESTAMP(3),
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "reject_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "approved_by" INTEGER,
    "approved_at" TIMESTAMP(3),

    CONSTRAINT "chemical_stocktakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chemical_stocktake_items" (
    "id" SERIAL NOT NULL,
    "stocktake_id" INTEGER NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "book_qty" DECIMAL(18,4) NOT NULL,
    "counted_qty" DECIMAL(18,4),
    "packaging_ok" BOOLEAN,
    "packaging_note" TEXT,
    "reason" TEXT,
    "counted_by" INTEGER,
    "counted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chemical_stocktake_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chemical_adjustments" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "warehouse_id" INTEGER NOT NULL,
    "adj_type" VARCHAR(20) NOT NULL,
    "stocktake_id" INTEGER,
    "doc_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "disposal_method" TEXT,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "reject_reason" TEXT,
    "cancel_reason" TEXT,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "approved_by" INTEGER,
    "approved_at" TIMESTAMP(3),

    CONSTRAINT "chemical_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chemical_adjustment_items" (
    "id" SERIAL NOT NULL,
    "adjustment_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "qty_delta" DECIMAL(18,4) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chemical_adjustment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requests" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "client_request_id" VARCHAR(64),
    "request_date" DATE NOT NULL,
    "department_id" INTEGER NOT NULL,
    "requester_id" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "priority" VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
    "needed_date" DATE,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
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

    CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_request_items" (
    "id" SERIAL NOT NULL,
    "request_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" INTEGER,
    "chemical_id" INTEGER,
    "description" VARCHAR(300),
    "qty" DECIMAL(18,4) NOT NULL,
    "unit_code" VARCHAR(20),
    "needed_date" DATE,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_quotes" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "request_id" INTEGER,
    "supplier_id" INTEGER NOT NULL,
    "quote_no" VARCHAR(100),
    "requested_at" DATE NOT NULL,
    "quote_date" DATE,
    "valid_until" DATE,
    "currency" VARCHAR(10),
    "delivery_days" INTEGER,
    "payment_terms" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER NOT NULL,

    CONSTRAINT "supplier_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_quote_items" (
    "id" SERIAL NOT NULL,
    "quote_id" INTEGER NOT NULL,
    "pr_item_id" INTEGER,
    "item_id" INTEGER,
    "chemical_id" INTEGER,
    "qty" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,4),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_quote_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "client_request_id" VARCHAR(64),
    "supplier_id" INTEGER NOT NULL,
    "request_id" INTEGER,
    "quote_id" INTEGER,
    "order_date" DATE NOT NULL,
    "expected_date" DATE,
    "currency" VARCHAR(10),
    "exchange_rate" DECIMAL(18,6),
    "payment_terms" TEXT,
    "delivery_terms" TEXT,
    "total_amount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "reject_reason" TEXT,
    "cancel_reason" TEXT,
    "close_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER,
    "submitted_at" TIMESTAMP(3),
    "approved_by" INTEGER,
    "approved_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "pr_item_id" INTEGER,
    "item_id" INTEGER,
    "chemical_id" INTEGER,
    "description" VARCHAR(300),
    "qty_ordered" DECIMAL(18,4) NOT NULL,
    "qty_received" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unit_price" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_evaluations" (
    "id" SERIAL NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "quality_score" INTEGER NOT NULL,
    "delivery_score" INTEGER NOT NULL,
    "price_score" INTEGER NOT NULL,
    "service_score" INTEGER NOT NULL,
    "total_score" DECIMAL(5,2) NOT NULL,
    "classification" VARCHAR(20) NOT NULL,
    "metrics" JSONB,
    "comment" TEXT,
    "evaluator_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_complaints" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "complaint_date" DATE NOT NULL,
    "subject" VARCHAR(250) NOT NULL,
    "description" TEXT NOT NULL,
    "related_doc" VARCHAR(60),
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER NOT NULL,

    CONSTRAINT "supplier_complaints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chemicals_code_key" ON "chemicals"("code");

-- CreateIndex
CREATE INDEX "chemicals_status_idx" ON "chemicals"("status");

-- CreateIndex
CREATE UNIQUE INDEX "chemical_batches_internal_code_key" ON "chemical_batches"("internal_code");

-- CreateIndex
CREATE UNIQUE INDEX "chemical_batches_receipt_line_id_key" ON "chemical_batches"("receipt_line_id");

-- CreateIndex
CREATE INDEX "chemical_batches_chemical_id_expiry_date_idx" ON "chemical_batches"("chemical_id", "expiry_date");

-- CreateIndex
CREATE INDEX "chemical_batches_expiry_date_idx" ON "chemical_batches"("expiry_date");

-- CreateIndex
CREATE INDEX "chemical_batches_qc_status_idx" ON "chemical_batches"("qc_status");

-- CreateIndex
CREATE UNIQUE INDEX "chemical_receipts_code_key" ON "chemical_receipts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "chemical_receipts_client_request_id_key" ON "chemical_receipts"("client_request_id");

-- CreateIndex
CREATE INDEX "chemical_receipts_status_doc_date_idx" ON "chemical_receipts"("status", "doc_date");

-- CreateIndex
CREATE INDEX "chemical_receipt_items_receipt_id_idx" ON "chemical_receipt_items"("receipt_id");

-- CreateIndex
CREATE UNIQUE INDEX "chemical_issues_code_key" ON "chemical_issues"("code");

-- CreateIndex
CREATE UNIQUE INDEX "chemical_issues_client_request_id_key" ON "chemical_issues"("client_request_id");

-- CreateIndex
CREATE INDEX "chemical_issues_status_doc_date_idx" ON "chemical_issues"("status", "doc_date");

-- CreateIndex
CREATE INDEX "chemical_issue_items_issue_id_idx" ON "chemical_issue_items"("issue_id");

-- CreateIndex
CREATE INDEX "chemical_movements_chemical_id_posted_at_idx" ON "chemical_movements"("chemical_id", "posted_at");

-- CreateIndex
CREATE INDEX "chemical_movements_batch_id_posted_at_idx" ON "chemical_movements"("batch_id", "posted_at");

-- CreateIndex
CREATE INDEX "chemical_movements_doc_type_doc_id_idx" ON "chemical_movements"("doc_type", "doc_id");

-- CreateIndex
CREATE INDEX "chemical_safety_documents_chemical_id_doc_type_idx" ON "chemical_safety_documents"("chemical_id", "doc_type");

-- CreateIndex
CREATE UNIQUE INDEX "chemical_storage_requirements_chemical_a_id_chemical_b_id_key" ON "chemical_storage_requirements"("chemical_a_id", "chemical_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "chemical_inspections_code_key" ON "chemical_inspections"("code");

-- CreateIndex
CREATE INDEX "chemical_inspections_inspected_at_idx" ON "chemical_inspections"("inspected_at");

-- CreateIndex
CREATE UNIQUE INDEX "chemical_incidents_code_key" ON "chemical_incidents"("code");

-- CreateIndex
CREATE INDEX "chemical_incidents_occurred_at_idx" ON "chemical_incidents"("occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "chemical_stocktakes_code_key" ON "chemical_stocktakes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "chemical_stocktake_items_stocktake_id_batch_id_key" ON "chemical_stocktake_items"("stocktake_id", "batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "chemical_adjustments_code_key" ON "chemical_adjustments"("code");

-- CreateIndex
CREATE UNIQUE INDEX "chemical_adjustments_stocktake_id_key" ON "chemical_adjustments"("stocktake_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requests_code_key" ON "purchase_requests"("code");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requests_client_request_id_key" ON "purchase_requests"("client_request_id");

-- CreateIndex
CREATE INDEX "purchase_requests_status_idx" ON "purchase_requests"("status");

-- CreateIndex
CREATE INDEX "purchase_request_items_request_id_idx" ON "purchase_request_items"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_quotes_code_key" ON "supplier_quotes"("code");

-- CreateIndex
CREATE INDEX "supplier_quotes_request_id_idx" ON "supplier_quotes"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_code_key" ON "purchase_orders"("code");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_client_request_id_key" ON "purchase_orders"("client_request_id");

-- CreateIndex
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders"("status");

-- CreateIndex
CREATE INDEX "purchase_orders_supplier_id_idx" ON "purchase_orders"("supplier_id");

-- CreateIndex
CREATE INDEX "purchase_order_items_order_id_idx" ON "purchase_order_items"("order_id");

-- CreateIndex
CREATE INDEX "supplier_evaluations_supplier_id_idx" ON "supplier_evaluations"("supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_complaints_code_key" ON "supplier_complaints"("code");

-- CreateIndex
CREATE INDEX "supplier_complaints_supplier_id_idx" ON "supplier_complaints"("supplier_id");

-- AddForeignKey
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_receipt_items" ADD CONSTRAINT "stock_receipt_items_po_item_id_fkey" FOREIGN KEY ("po_item_id") REFERENCES "purchase_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemicals" ADD CONSTRAINT "chemicals_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemicals" ADD CONSTRAINT "chemicals_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemical_batches" ADD CONSTRAINT "chemical_batches_chemical_id_fkey" FOREIGN KEY ("chemical_id") REFERENCES "chemicals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemical_batches" ADD CONSTRAINT "chemical_batches_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemical_batches" ADD CONSTRAINT "chemical_batches_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "warehouse_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemical_batches" ADD CONSTRAINT "chemical_batches_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemical_batches" ADD CONSTRAINT "chemical_batches_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "chemical_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemical_receipts" ADD CONSTRAINT "chemical_receipts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemical_receipts" ADD CONSTRAINT "chemical_receipts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemical_receipts" ADD CONSTRAINT "chemical_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemical_receipts" ADD CONSTRAINT "chemical_receipts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemical_receipt_items" ADD CONSTRAINT "chemical_receipt_items_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "chemical_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemical_receipt_items" ADD CONSTRAINT "chemical_receipt_items_chemical_id_fkey" FOREIGN KEY ("chemical_id") REFERENCES "chemicals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemical_receipt_items" ADD CONSTRAINT "chemical_receipt_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "warehouse_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemical_receipt_items" ADD CONSTRAINT "chemical_receipt_items_po_item_id_fkey" FOREIGN KEY ("po_item_id") REFERENCES "purchase_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemical_issues" ADD CONSTRAINT "chemical_issues_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemical_issues" ADD CONSTRAINT "chemical_issues_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemical_issues" ADD CONSTRAINT "chemical_issues_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemical_issue_items" ADD CONSTRAINT "chemical_issue_items_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "chemical_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemical_issue_items" ADD CONSTRAINT "chemical_issue_items_chemical_id_fkey" FOREIGN KEY ("chemical_id") REFERENCES "chemicals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemical_movements" ADD CONSTRAINT "chemical_movements_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "chemical_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemical_safety_documents" ADD CONSTRAINT "chemical_safety_documents_chemical_id_fkey" FOREIGN KEY ("chemical_id") REFERENCES "chemicals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemical_stocktake_items" ADD CONSTRAINT "chemical_stocktake_items_stocktake_id_fkey" FOREIGN KEY ("stocktake_id") REFERENCES "chemical_stocktakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chemical_adjustment_items" ADD CONSTRAINT "chemical_adjustment_items_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "chemical_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_chemical_id_fkey" FOREIGN KEY ("chemical_id") REFERENCES "chemicals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "purchase_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quote_items" ADD CONSTRAINT "supplier_quote_items_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "supplier_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_chemical_id_fkey" FOREIGN KEY ("chemical_id") REFERENCES "chemicals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_evaluations" ADD CONSTRAINT "supplier_evaluations_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_complaints" ADD CONSTRAINT "supplier_complaints_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================
-- RÀNG BUỘC NGHIỆP VỤ KHO HÓA CHẤT & MUA HÀNG
-- =====================================================================
ALTER TABLE "chemical_batches"
  ADD CONSTRAINT "chk_batch_qty_nonneg" CHECK ("qty_on_hand" >= 0 AND "qty_received" >= 0),
  ADD CONSTRAINT "chk_batch_dates" CHECK ("expiry_date" IS NULL OR "mfg_date" IS NULL OR "expiry_date" >= "mfg_date");
ALTER TABLE "chemical_movements"
  ADD CONSTRAINT "chk_chem_movement_qty" CHECK ("qty_in" >= 0 AND "qty_out" >= 0 AND ("qty_in" > 0 OR "qty_out" > 0) AND "balance_after" >= 0);
ALTER TABLE "chemical_receipt_items"
  ADD CONSTRAINT "chk_chem_receipt_qty" CHECK ("qty_doc" >= 0 AND "qty_received" >= 0),
  ADD CONSTRAINT "chk_chem_receipt_dates" CHECK ("expiry_date" IS NULL OR "mfg_date" IS NULL OR "expiry_date" >= "mfg_date");
ALTER TABLE "chemical_issue_items"
  ADD CONSTRAINT "chk_chem_issue_qty" CHECK ("qty_requested" > 0 AND ("qty_issued" IS NULL OR "qty_issued" <= COALESCE("qty_approved", 0)));
ALTER TABLE "chemical_adjustment_items" ADD CONSTRAINT "chk_chem_adj_qty" CHECK ("qty_delta" <> 0);
ALTER TABLE "purchase_request_items"
  ADD CONSTRAINT "chk_pr_qty" CHECK ("qty" > 0),
  ADD CONSTRAINT "chk_pr_target" CHECK ("item_id" IS NOT NULL OR "chemical_id" IS NOT NULL OR "description" IS NOT NULL);
ALTER TABLE "purchase_order_items"
  ADD CONSTRAINT "chk_po_qty" CHECK ("qty_ordered" > 0 AND "qty_received" >= 0 AND "unit_price" >= 0),
  ADD CONSTRAINT "chk_po_target" CHECK (("item_id" IS NOT NULL)::int + ("chemical_id" IS NOT NULL)::int = 1);
ALTER TABLE "supplier_evaluations" ADD CONSTRAINT "chk_eval_scores" CHECK (
  "quality_score" BETWEEN 1 AND 5 AND "delivery_score" BETWEEN 1 AND 5 AND "price_score" BETWEEN 1 AND 5 AND "service_score" BETWEEN 1 AND 5);
ALTER TABLE "chemical_storage_requirements" ADD CONSTRAINT "chk_pair_order" CHECK ("chemical_a_id" < "chemical_b_id");

CREATE TRIGGER trg_chemical_movements_immutable
  BEFORE UPDATE OR DELETE ON "chemical_movements"
  FOR EACH ROW EXECUTE FUNCTION wms_forbid_ledger_change();
CREATE TRIGGER trg_chem_receipts_no_delete BEFORE DELETE ON "chemical_receipts" FOR EACH ROW EXECUTE FUNCTION wms_forbid_posted_doc_delete();
CREATE TRIGGER trg_chem_issues_no_delete BEFORE DELETE ON "chemical_issues" FOR EACH ROW EXECUTE FUNCTION wms_forbid_posted_doc_delete();
CREATE TRIGGER trg_chem_adjust_no_delete BEFORE DELETE ON "chemical_adjustments" FOR EACH ROW EXECUTE FUNCTION wms_forbid_posted_doc_delete();

CREATE INDEX "chemicals_search_trgm" ON "chemicals" USING GIN ("search_text" gin_trgm_ops);
