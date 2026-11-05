// TEST_DATABASE_URL do globalSetup tạo (DB tạm riêng cho mỗi lần chạy)
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL!;
process.env.STORAGE_DIR = './storage-test';
process.env.BACKUP_CRON = '';
process.env.PG_BIN_DIR = process.env.PG_BIN_DIR_TEST || '/usr/lib/postgresql/16/bin';
