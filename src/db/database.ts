import type { SQLiteDatabase } from 'expo-sqlite';

export const DATABASE_NAME = 'quality_check.db';
const DATABASE_VERSION = 4;

async function tableExists(db: SQLiteDatabase, table: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) as c FROM sqlite_master WHERE type = 'table' AND name = ?",
    table
  );
  return (row?.c ?? 0) > 0;
}

async function columnExists(db: SQLiteDatabase, table: string, column: string): Promise<boolean> {
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.some((r) => r.name === column);
}

export async function migrateDbIfNeeded(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const currentDbVersion = row?.user_version ?? 0;

  if (currentDbVersion >= DATABASE_VERSION) {
    return;
  }

  const fresh = !(await tableExists(db, 'employees'));

  if (fresh) {
    await db.execAsync(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','designer','qc')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS drawings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drawing_no TEXT NOT NULL UNIQUE,
  part_name TEXT NOT NULL,
  customer TEXT NOT NULL DEFAULT '',
  revision TEXT NOT NULL DEFAULT 'A',
  material TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'mm',
  notes TEXT NOT NULL DEFAULT '',
  invoice_no TEXT NOT NULL DEFAULT '',
  invoice_date TEXT NOT NULL DEFAULT '',
  drawing_rev_date TEXT NOT NULL DEFAULT '',
  po_no TEXT NOT NULL DEFAULT '',
  qty TEXT NOT NULL DEFAULT '',
  image_uri TEXT,
  created_by INTEGER NOT NULL REFERENCES employees(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS dimensions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drawing_id INTEGER NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  dim_no INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  nominal REAL NOT NULL,
  tol_upper REAL NOT NULL DEFAULT 0,
  tol_lower REAL NOT NULL DEFAULT 0,
  UNIQUE(drawing_id, dim_no)
);

CREATE TABLE IF NOT EXISTS checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drawing_id INTEGER NOT NULL REFERENCES drawings(id),
  checked_by INTEGER NOT NULL REFERENCES employees(id),
  checked_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  result TEXT NOT NULL CHECK(result IN ('PASS','FAIL')),
  instrument TEXT NOT NULL DEFAULT '',
  inspector_notes TEXT NOT NULL DEFAULT '',
  inspector_name TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS measurements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  check_id INTEGER NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  dimension_id INTEGER NOT NULL REFERENCES dimensions(id),
  sample1 REAL,
  sample2 REAL,
  sample3 REAL,
  sample4 REAL,
  sample5 REAL,
  sample6 REAL,
  sample7 REAL,
  sample8 REAL,
  sample9 REAL,
  sample10 REAL,
  pass INTEGER NOT NULL CHECK(pass IN (0,1))
);

CREATE INDEX IF NOT EXISTS idx_dimensions_drawing ON dimensions(drawing_id);
CREATE INDEX IF NOT EXISTS idx_checks_drawing ON checks(drawing_id);
CREATE INDEX IF NOT EXISTS idx_measurements_check ON measurements(check_id);
`);

    await db.runAsync(
      'INSERT INTO employees (employee_id, name, password, role) VALUES (?, ?, ?, ?)',
      'ADMIN',
      'Administrator',
      'admin123',
      'admin'
    );
    await db.runAsync(
      'INSERT INTO employees (employee_id, name, password, role) VALUES (?, ?, ?, ?)',
      'DES001',
      'Designer One',
      '1234',
      'designer'
    );
    await db.runAsync(
      'INSERT INTO employees (employee_id, name, password, role) VALUES (?, ?, ?, ?)',
      'QC001',
      'Quality Inspector One',
      '1234',
      'qc'
    );
  } else {
    if (!(await columnExists(db, 'drawings', 'invoice_no'))) {
      await db.execAsync(`
ALTER TABLE drawings ADD COLUMN invoice_no TEXT NOT NULL DEFAULT '';
ALTER TABLE drawings ADD COLUMN invoice_date TEXT NOT NULL DEFAULT '';
ALTER TABLE drawings ADD COLUMN drawing_rev_date TEXT NOT NULL DEFAULT '';
ALTER TABLE drawings ADD COLUMN po_no TEXT NOT NULL DEFAULT '';
ALTER TABLE drawings ADD COLUMN qty TEXT NOT NULL DEFAULT '';
`);
    }

    if (!(await columnExists(db, 'checks', 'instrument'))) {
      await db.execAsync(`ALTER TABLE checks ADD COLUMN instrument TEXT NOT NULL DEFAULT '';`);
    }

    if (!(await columnExists(db, 'measurements', 'sample1'))) {
      await db.execAsync(`
CREATE TABLE IF NOT EXISTS measurements_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  check_id INTEGER NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  dimension_id INTEGER NOT NULL REFERENCES dimensions(id),
  sample1 REAL,
  sample2 REAL,
  sample3 REAL,
  sample4 REAL,
  sample5 REAL,
  pass INTEGER NOT NULL CHECK(pass IN (0,1))
);

INSERT INTO measurements_new (check_id, dimension_id, sample1, sample2, sample3, sample4, sample5, pass)
  SELECT check_id, dimension_id, actual, NULL, NULL, NULL, NULL, pass FROM measurements;

DROP TABLE measurements;
ALTER TABLE measurements_new RENAME TO measurements;

CREATE INDEX IF NOT EXISTS idx_measurements_check ON measurements(check_id);
`);
    }
  }

  if (!(await columnExists(db, 'drawings', 'image_uri'))) {
    await db.execAsync(`ALTER TABLE drawings ADD COLUMN image_uri TEXT;`);
  }

  if (!(await columnExists(db, 'measurements', 'sample6'))) {
    await db.execAsync(`
ALTER TABLE measurements ADD COLUMN sample6 REAL;
ALTER TABLE measurements ADD COLUMN sample7 REAL;
ALTER TABLE measurements ADD COLUMN sample8 REAL;
ALTER TABLE measurements ADD COLUMN sample9 REAL;
ALTER TABLE measurements ADD COLUMN sample10 REAL;
`);
  }

  if (!(await columnExists(db, 'checks', 'inspector_name'))) {
    await db.execAsync(`ALTER TABLE checks ADD COLUMN inspector_name TEXT NOT NULL DEFAULT '';`);
  }

  await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}
