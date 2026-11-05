/**
 * SEED – chạy an toàn nhiều lần (idempotent), dùng sau mỗi lần cập nhật:
 *  - Đồng bộ danh mục quyền: chỉ THÊM quyền mới.
 *  - Vai trò mặc định: chỉ tạo nếu chưa có; vai trò SUPER_ADMIN luôn được bổ sung quyền mới.
 *  - Tài khoản admin: chỉ tạo nếu chưa có (mật khẩu từ SEED_ADMIN_PASSWORD, bắt buộc đổi khi đăng nhập lần đầu).
 *  - Danh mục cấu hình ban đầu (kho, đơn vị tính, nhóm vật tư, bộ phận mẫu): chỉ tạo khi bảng còn trống.
 *  - KHÔNG BAO GIỜ ghi đè hay xóa dữ liệu đã có.
 * Dữ liệu demo (vật tư, giao dịch mẫu) chỉ tạo khi SEED_DEMO=true – dùng cho môi trường đào tạo/kiểm thử.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { PERMISSIONS, DEFAULT_ROLES } from '../src/lib/permissions';
import { normalizeText } from '../src/lib/text';

const prisma = new PrismaClient();

async function main() {
  // 1. Quyền
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({ where: { code: p.code }, create: p, update: { module: p.module, name: p.name } });
  }
  const allPerms = await prisma.permission.findMany();
  const permId = new Map(allPerms.map((p) => [p.code, p.id]));

  // 2. Vai trò
  for (const r of DEFAULT_ROLES) {
    let role = await prisma.role.findUnique({ where: { code: r.code } });
    if (!role) {
      role = await prisma.role.create({ data: { code: r.code, name: r.name, description: r.description, is_system: true } });
      await prisma.rolePermission.createMany({ data: r.permissions.filter((c) => permId.has(c)).map((c) => ({ role_id: role!.id, permission_id: permId.get(c)! })), skipDuplicates: true });
      console.log('  + vai trò', r.code);
    } else if (r.code === 'SUPER_ADMIN') {
      await prisma.rolePermission.createMany({ data: allPerms.map((p) => ({ role_id: role!.id, permission_id: p.id })), skipDuplicates: true });
    }
  }

  // 3. Admin
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'SUPER_ADMIN' } });
  if (!(await prisma.user.findUnique({ where: { username: 'admin' } }))) {
    const pw = process.env.SEED_ADMIN_PASSWORD || 'Admin@2026';
    await prisma.user.create({
      data: { username: 'admin', full_name: 'Quản trị hệ thống', password_hash: await bcrypt.hash(pw, 10), must_change_password: true, roles: { create: [{ role_id: adminRole.id }] } },
    });
    console.log(`  + tài khoản admin (mật khẩu ban đầu: ${process.env.SEED_ADMIN_PASSWORD ? '[SEED_ADMIN_PASSWORD]' : pw}) – BẮT BUỘC đổi khi đăng nhập lần đầu`);
  }

  // 4. Kho (1 kho tổng vật tư + 1 kho hóa chất – kiến trúc hỗ trợ thêm nhiều kho)
  if ((await prisma.warehouse.count()) === 0) {
    const wh = await prisma.warehouse.create({ data: { code: 'KHO-TONG', name: 'Kho tổng – Mỏ', type: 'GENERAL' } });
    await prisma.warehouse.create({ data: { code: 'KHO-HC', name: 'Kho hóa chất', type: 'CHEMICAL' } });
    await prisma.warehouseLocation.createMany({
      data: [
        { warehouse_id: wh.id, code: 'NHAN-HANG', name: 'Khu nhận hàng / chờ kiểm tra', zone: 'Nhận hàng' },
        { warehouse_id: wh.id, code: 'A-01', name: 'Dãy A – Kệ 01', zone: 'A' },
        { warehouse_id: wh.id, code: 'A-02', name: 'Dãy A – Kệ 02', zone: 'A' },
        { warehouse_id: wh.id, code: 'B-01', name: 'Dãy B – Kệ 01', zone: 'B' },
        { warehouse_id: wh.id, code: 'BAI-NGOAI', name: 'Bãi ngoài trời', zone: 'Bãi' },
      ],
    });
    console.log('  + kho & vị trí mẫu');
  }

  // 5. Đơn vị tính
  if ((await prisma.unit.count()) === 0) {
    const units = [['CAI', 'Cái'], ['BO', 'Bộ'], ['CHIEC', 'Chiếc'], ['KG', 'Kg'], ['TAN', 'Tấn'], ['M', 'Mét'], ['M2', 'Mét vuông'], ['M3', 'Mét khối'], ['LIT', 'Lít'], ['CUON', 'Cuộn'], ['HOP', 'Hộp'], ['THUNG', 'Thùng'], ['BAO', 'Bao'], ['DOI', 'Đôi'], ['TAM', 'Tấm'], ['CAY', 'Cây'], ['CAN', 'Can'], ['PHUY', 'Phuy'], ['GOI', 'Gói'], ['VIEN', 'Viên']];
    await prisma.unit.createMany({ data: units.map(([code, name]) => ({ code, name })) });
  }

  // 6. Nhóm vật tư (theo phạm vi phân hệ 5.1)
  if ((await prisma.itemCategory.count()) === 0) {
    const cats = [['TH', 'Vật tư tiêu hao'], ['PT', 'Phụ tùng máy móc, thiết bị khai thác'], ['CK', 'Vật tư cơ khí'], ['DI', 'Vật tư điện'], ['XD', 'Vật liệu xây dựng'], ['CC', 'Công cụ, dụng cụ'], ['BH', 'Thiết bị bảo hộ lao động (PPE)'], ['TB', 'Thiết bị, máy móc'], ['KH', 'Hàng hóa, vật tư khác']];
    await prisma.itemCategory.createMany({ data: cats.map(([code, name]) => ({ code, name })) });
  }

  // 7. Bộ phận (dữ liệu mẫu – công ty tự cấu hình lại)
  if ((await prisma.department.count()) === 0) {
    const depts = [['MINING', 'Khai thác (Mining)'], ['PLANT', 'Nhà máy chế biến (Processing Plant)'], ['MAINT', 'Bảo trì (Maintenance)'], ['MECH', 'Cơ khí (Mechanical)'], ['ELEC', 'Điện (Electrical)'], ['CIVIL', 'Xây dựng (Civil Construction)'], ['ADMIN', 'Hành chính (Administration)'], ['SEC', 'An ninh (Security)'], ['HSE', 'An toàn – Sức khỏe – Môi trường (HSE)']];
    await prisma.department.createMany({ data: depts.map(([code, name]) => ({ code, name })) });
  }

  if (process.env.SEED_DEMO === 'true') await demo();
  console.log('Seed hoàn tất.');
}

/** Dữ liệu demo cho môi trường ĐÀO TẠO/KIỂM THỬ – không chạy trên production */
async function demo() {
  if ((await prisma.item.count()) > 0) return console.log('  (bỏ qua demo – đã có vật tư)');
  const pw = await bcrypt.hash('Demo@2026', 10);
  const role = async (c: string) => (await prisma.role.findUniqueOrThrow({ where: { code: c } })).id;
  const dept = async (c: string) => (await prisma.department.findUniqueOrThrow({ where: { code: c } })).id;
  const users: [string, string, string, string | null][] = [
    ['quanlykho', 'Nguyễn Văn Quản', 'WAREHOUSE_MANAGER', null], ['thukho', 'Trần Thị Kho', 'WAREHOUSE_OFFICER', null],
    ['thukho2', 'Lê Văn Kiểm', 'WAREHOUSE_OFFICER', null], ['muahang', 'Phạm Mua Hàng', 'PROCUREMENT_OFFICER', null],
    ['baotri', 'Hoàng Bảo Trì', 'DEPARTMENT_USER', 'MAINT'], ['khaithac', 'Vũ Khai Thác', 'DEPARTMENT_USER', 'MINING'],
    ['ketoan', 'Đỗ Kế Toán', 'ACCOUNTANT', null], ['giamdoc', 'Bùi Giám Đốc', 'DIRECTOR', null], ['hse', 'Ngô An Toàn', 'HSE_OFFICER', 'HSE'],
  ];
  for (const [username, full_name, r, d] of users) {
    await prisma.user.create({ data: { username, full_name, password_hash: pw, must_change_password: false, department_id: d ? await dept(d) : null, roles: { create: [{ role_id: await role(r) }] } } });
  }
  const cat = async (c: string) => (await prisma.itemCategory.findUniqueOrThrow({ where: { code: c } })).id;
  const unit = async (c: string) => (await prisma.unit.findUniqueOrThrow({ where: { code: c } })).id;
  const loc = async (c: string) => (await prisma.warehouseLocation.findFirstOrThrow({ where: { code: c } })).id;
  const items: [string, string, string, string, string, number, number | null, string][] = [
    ['TH-0001', 'Que hàn KT-421 Ø3.2', 'TH', 'KG', 'A-01', 20, 200, 'Que hàn thép cacbon'],
    ['TH-0002', 'Đá mài Ø100', 'TH', 'VIEN', 'A-01', 50, 500, 'Đá mài cầm tay'],
    ['PT-0001', 'Lọc dầu động cơ máy xúc CAT 336', 'PT', 'CAI', 'A-02', 4, 30, 'P/N 1R-0716'],
    ['PT-0002', 'Răng gầu máy xúc', 'PT', 'CAI', 'B-01', 10, 60, 'Loại J350'],
    ['CK-0001', 'Bulong lục giác M16x60', 'CK', 'CAI', 'A-02', 100, 1000, 'Thép 8.8 mạ kẽm'],
    ['DI-0001', 'Cáp điện CVV 3x4mm2', 'DI', 'M', 'B-01', 100, 1000, 'Cadivi'],
    ['BH-0001', 'Giày bảo hộ mũi thép', 'BH', 'DOI', 'A-01', 20, 150, 'Size 39-44'],
    ['BH-0002', 'Mũ bảo hộ', 'BH', 'CAI', 'A-01', 30, 200, 'Tiêu chuẩn EN397'],
    ['XD-0001', 'Xi măng PCB40', 'XD', 'BAO', 'BAI-NGOAI', 50, 400, 'Bao 50kg'],
  ];
  for (const [code, name, c, u, l, min, max, spec] of items) {
    await prisma.item.create({ data: { code, name, category_id: await cat(c), unit_id: await unit(u), default_location_id: await loc(l), min_stock: min, max_stock: max, specification: spec, search_text: normalizeText(name, spec) } });
  }
  await prisma.item.create({ data: { code: 'TB-0001', name: 'Máy bơm nước thải 15kW', kind: 'EQUIPMENT', category_id: await cat('TB'), unit_id: await unit('CHIEC'), default_location_id: await loc('BAI-NGOAI'), min_stock: 1, search_text: normalizeText('Máy bơm nước thải 15kW'), serial_no: 'PUMP-2026-001' } });
  await prisma.supplier.create({ data: { code: 'NCC001', name: 'Công ty TNHH Thiết bị Mỏ Miền Bắc', country: 'Việt Nam', search_text: normalizeText('Công ty TNHH Thiết bị Mỏ Miền Bắc NCC001') } });
  await prisma.supplier.create({ data: { code: 'NCC002', name: 'Công ty CP Vật tư Công nghiệp Sài Gòn', country: 'Việt Nam', search_text: normalizeText('Công ty CP Vật tư Công nghiệp Sài Gòn NCC002') } });
  console.log('  + dữ liệu demo (mật khẩu demo: Demo@2026)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
