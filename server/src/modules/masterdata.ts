import { z } from 'zod';
import { crudRouter } from './crud';
import { normalizeText } from '../lib/text';
import { can } from '../lib/auth';
import { zOptStr } from '../lib/http';

const zCode = z.string().trim().min(1, 'Bắt buộc nhập mã').max(50).transform((s) => s.toUpperCase());
const zName = z.string().trim().min(1, 'Bắt buộc nhập tên').max(250);
const zOptInt = z.union([z.null(), z.literal('').transform(() => null), z.coerce.number().int().positive()]).optional();

export const unitsRouter = crudRouter({
  model: 'unit', entityType: 'unit', viewPerm: ['items.view'], managePerm: 'masterdata.manage',
  createSchema: z.object({ code: z.string().trim().min(1).max(20), name: zName }),
  searchFields: ['code', 'name'],
});

export const categoriesRouter = crudRouter({
  model: 'itemCategory', entityType: 'item_category', viewPerm: ['items.view'], managePerm: 'masterdata.manage',
  createSchema: z.object({ code: zCode, name: zName, parent_id: zOptInt, description: zOptStr }),
  searchFields: ['code', 'name'],
  include: { parent: { select: { id: true, code: true, name: true } } },
  lookupSelect: { id: true, code: true, name: true, parent_id: true },
});

export const warehousesRouter = crudRouter({
  model: 'warehouse', entityType: 'warehouse', viewPerm: ['items.view', 'stock.view'], managePerm: 'masterdata.manage',
  createSchema: z.object({
    code: zCode, name: zName, type: z.enum(['GENERAL', 'CHEMICAL']).default('GENERAL'),
    address: zOptStr, manager: zOptStr, description: zOptStr,
  }),
  searchFields: ['code', 'name'],
  lookupSelect: { id: true, code: true, name: true, type: true },
});

export const locationsRouter = crudRouter({
  model: 'warehouseLocation', entityType: 'warehouse_location', viewPerm: ['items.view', 'stock.view'], managePerm: 'masterdata.manage',
  createSchema: z.object({
    warehouse_id: z.coerce.number().int().positive('Chọn kho'), code: zCode, name: zName, zone: zOptStr, description: zOptStr,
  }),
  searchFields: ['code', 'name', 'zone'],
  include: { warehouse: { select: { id: true, code: true, name: true } } },
  orderBy: [{ warehouse_id: 'asc' }, { code: 'asc' }],
  extraWhere: (q) => (q.warehouse_id ? { warehouse_id: Number(q.warehouse_id) } : {}),
  lookupSelect: { id: true, code: true, name: true, warehouse_id: true },
});

export const departmentsRouter = crudRouter({
  model: 'department', entityType: 'department', viewPerm: ['departments.view', 'issues.create', 'issues.view_all', 'chemicals.request', 'purchase.request'], managePerm: 'departments.manage',
  createSchema: z.object({
    code: zCode, name: zName, manager_user_id: zOptInt, manager_name: zOptStr, area: zOptStr, description: zOptStr,
  }),
  searchFields: ['code', 'name', 'area', 'manager_name'],
  include: { members: { select: { id: true, username: true, full_name: true, position: true, status: true } } },
});

const supplierSchema = z.object({
  code: zCode, name: zName, address: zOptStr, country: zOptStr, contact_person: zOptStr, phone: zOptStr,
  email: z.union([z.string().trim().email('Email không hợp lệ'), z.literal('').transform(() => null), z.null()]).optional(),
  tax_code: zOptStr, supply_groups: zOptStr, bank_account: zOptStr, bank_name: zOptStr, payment_terms: zOptStr,
  cooperation_status: z.enum(['ACTIVE', 'PROBATION', 'SUSPENDED', 'STOPPED']).default('ACTIVE'), note: zOptStr,
});

export const suppliersRouter = crudRouter({
  model: 'supplier', entityType: 'supplier', viewPerm: ['suppliers.view', 'receipts.create'], managePerm: 'suppliers.manage',
  createSchema: supplierSchema,
  searchFields: ['code', 'name', 'search_text', 'tax_code', 'contact_person'],
  orderBy: { name: 'asc' },
  extraWhere: (q) => (q.cooperation_status ? { cooperation_status: String(q.cooperation_status) } : {}),
  beforeSave: (d, req, existing) => {
    // Người không có quyền xem dữ liệu nhạy cảm không được ghi đè tài khoản ngân hàng
    if (!can(req, 'suppliers.view_sensitive')) {
      delete d.bank_account;
      delete d.bank_name;
    }
    return { ...d, search_text: normalizeText(String(d.name ?? existing?.name ?? ''), String(d.code ?? existing?.code ?? '')) };
  },
  present: (row, req) => {
    if (can(req, 'suppliers.view_sensitive')) return row;
    const { bank_account, bank_name, ...rest } = row;
    return { ...rest, bank_account: bank_account ? '••••••' : null, bank_name: bank_name ? '••••••' : null };
  },
});
