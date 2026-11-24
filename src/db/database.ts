import type { SQLiteDatabase } from 'expo-sqlite';

export const DATABASE_NAME = 'quality_check.db';
const DATABASE_VERSION = 15;

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

export async function ensureDispatchTable(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
CREATE TABLE IF NOT EXISTS dispatches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dispatch_no TEXT NOT NULL UNIQUE,
  drawing_id INTEGER NOT NULL REFERENCES drawings(id),
  drawing_no TEXT NOT NULL DEFAULT '',
  part_name TEXT NOT NULL DEFAULT '',
  po_no TEXT NOT NULL DEFAULT '',
  invoice_no TEXT NOT NULL DEFAULT '',
  qty TEXT NOT NULL DEFAULT '',
  dispatched_by INTEGER NOT NULL REFERENCES employees(id),
  dispatched_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  notes TEXT NOT NULL DEFAULT '',
  pending_sync INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_dispatch_drawing ON dispatches(drawing_id);
`);
}

export async function migrateDbIfNeeded(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const currentDbVersion = row?.user_version ?? 0;

  if (currentDbVersion >= DATABASE_VERSION) {
    return;
  }

  console.log(`[DB] migrateDbIfNeeded: user_version ${currentDbVersion} -> ${DATABASE_VERSION}`);

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
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  pending_sync INTEGER NOT NULL DEFAULT 0
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
  treatment TEXT NOT NULL DEFAULT '',
  hardness TEXT NOT NULL DEFAULT '',
  image_uri TEXT,
  image_synced INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES employees(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  pending_sync INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dimensions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drawing_id INTEGER NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  dim_no INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  nominal REAL NOT NULL,
  nominal_text TEXT NOT NULL DEFAULT '',
  tol_upper REAL NOT NULL DEFAULT 0,
  tol_lower REAL NOT NULL DEFAULT 0,
  pending_sync INTEGER NOT NULL DEFAULT 0,
  UNIQUE(drawing_id, dim_no)
);

CREATE TABLE IF NOT EXISTS checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT,
  drawing_id INTEGER NOT NULL REFERENCES drawings(id),
  checked_by INTEGER NOT NULL REFERENCES employees(id),
  checked_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  result TEXT NOT NULL CHECK(result IN ('PASS','FAIL')),
  instrument TEXT NOT NULL DEFAULT '',
  inspector_notes TEXT NOT NULL DEFAULT '',
  inspector_name TEXT NOT NULL DEFAULT '',
  pending_sync INTEGER NOT NULL DEFAULT 0
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
  remarks TEXT NOT NULL DEFAULT '',
  sample_status TEXT NOT NULL DEFAULT '',
  pass INTEGER NOT NULL CHECK(pass IN (0,1)),
  instrument TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sync_tombstones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS dispatches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dispatch_no TEXT NOT NULL UNIQUE,
  drawing_id INTEGER NOT NULL REFERENCES drawings(id),
  drawing_no TEXT NOT NULL DEFAULT '',
  part_name TEXT NOT NULL DEFAULT '',
  po_no TEXT NOT NULL DEFAULT '',
  invoice_no TEXT NOT NULL DEFAULT '',
  qty TEXT NOT NULL DEFAULT '',
  dispatched_by INTEGER NOT NULL REFERENCES employees(id),
  dispatched_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  notes TEXT NOT NULL DEFAULT '',
  pending_sync INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS instruments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  pending_sync INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_dimensions_drawing ON dimensions(drawing_id);
CREATE INDEX IF NOT EXISTS idx_checks_drawing ON checks(drawing_id);
CREATE INDEX IF NOT EXISTS idx_measurements_check ON measurements(check_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_checks_client_id ON checks(client_id);
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

    await db.execAsync(`
INSERT OR IGNORE INTO instruments (name) VALUES
  ('Vernier Calliper'),
  ('Micrometer'),
  ('Height Gauge'),
  ('Dial Gauge'),
  ('Vernier Height Gauge'),
  ('Surface Plate');
`);
  } else {
    if (!(await columnExists(db, 'drawings', 'invoice_no'))) {
      await db.execAsync(`ALTER TABLE drawings ADD COLUMN invoice_no TEXT NOT NULL DEFAULT '';`);
    }
    if (!(await columnExists(db, 'drawings', 'invoice_date'))) {
      await db.execAsync(`ALTER TABLE drawings ADD COLUMN invoice_date TEXT NOT NULL DEFAULT '';`);
    }
    if (!(await columnExists(db, 'drawings', 'drawing_rev_date'))) {
      await db.execAsync(`ALTER TABLE drawings ADD COLUMN drawing_rev_date TEXT NOT NULL DEFAULT '';`);
    }
    if (!(await columnExists(db, 'drawings', 'po_no'))) {
      await db.execAsync(`ALTER TABLE drawings ADD COLUMN po_no TEXT NOT NULL DEFAULT '';`);
    }
    if (!(await columnExists(db, 'drawings', 'qty'))) {
      await db.execAsync(`ALTER TABLE drawings ADD COLUMN qty TEXT NOT NULL DEFAULT '';`);
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
    await db.execAsync(`ALTER TABLE measurements ADD COLUMN sample6 REAL;`);
  }
  if (!(await columnExists(db, 'measurements', 'sample7'))) {
    await db.execAsync(`ALTER TABLE measurements ADD COLUMN sample7 REAL;`);
  }
  if (!(await columnExists(db, 'measurements', 'sample8'))) {
    await db.execAsync(`ALTER TABLE measurements ADD COLUMN sample8 REAL;`);
  }
  if (!(await columnExists(db, 'measurements', 'sample9'))) {
    await db.execAsync(`ALTER TABLE measurements ADD COLUMN sample9 REAL;`);
  }
  if (!(await columnExists(db, 'measurements', 'sample10'))) {
    await db.execAsync(`ALTER TABLE measurements ADD COLUMN sample10 REAL;`);
  }

  if (!(await columnExists(db, 'measurements', 'remarks'))) {
    await db.execAsync(`ALTER TABLE measurements ADD COLUMN remarks TEXT NOT NULL DEFAULT '';`);
  }

  if (!(await columnExists(db, 'measurements', 'instrument'))) {
    await db.execAsync(`ALTER TABLE measurements ADD COLUMN instrument TEXT NOT NULL DEFAULT '';`);
  }

  if (!(await columnExists(db, 'checks', 'inspector_name'))) {
    await db.execAsync(`ALTER TABLE checks ADD COLUMN inspector_name TEXT NOT NULL DEFAULT '';`);
  }

  if (!(await columnExists(db, 'checks', 'client_id'))) {
    await db.execAsync(`ALTER TABLE checks ADD COLUMN client_id TEXT;`);
  }

  if (!(await columnExists(db, 'checks', 'pending_sync'))) {
    await db.execAsync(`ALTER TABLE checks ADD COLUMN pending_sync INTEGER NOT NULL DEFAULT 0;`);
  }

  if (!(await columnExists(db, 'drawings', 'pending_sync'))) {
    await db.execAsync(`ALTER TABLE drawings ADD COLUMN pending_sync INTEGER NOT NULL DEFAULT 0;`);
  }

  if (!(await columnExists(db, 'drawings', 'image_synced'))) {
    await db.execAsync(`
ALTER TABLE drawings ADD COLUMN image_synced INTEGER NOT NULL DEFAULT 0;
UPDATE drawings SET image_synced = 1 WHERE image_uri IS NULL OR image_uri = '';
`);
  }

  if (!(await columnExists(db, 'drawings', 'treatment'))) {
    await db.execAsync(`ALTER TABLE drawings ADD COLUMN treatment TEXT NOT NULL DEFAULT '';`);
  }
  if (!(await columnExists(db, 'drawings', 'hardness'))) {
    await db.execAsync(`ALTER TABLE drawings ADD COLUMN hardness TEXT NOT NULL DEFAULT '';`);
  }

  if (!(await columnExists(db, 'dimensions', 'nominal_text'))) {
    await db.execAsync(`ALTER TABLE dimensions ADD COLUMN nominal_text TEXT NOT NULL DEFAULT '';`);
  }

  if (!(await columnExists(db, 'measurements', 'sample_status'))) {
    await db.execAsync(`ALTER TABLE measurements ADD COLUMN sample_status TEXT NOT NULL DEFAULT '';`);
  }

  if (!(await columnExists(db, 'employees', 'pending_sync'))) {
    await db.execAsync(`ALTER TABLE employees ADD COLUMN pending_sync INTEGER NOT NULL DEFAULT 0;`);
  }

  if (!(await columnExists(db, 'dimensions', 'pending_sync'))) {
    await db.execAsync(`ALTER TABLE dimensions ADD COLUMN pending_sync INTEGER NOT NULL DEFAULT 0;`);
  }

  await db.execAsync(`
UPDATE checks SET client_id = 'CH-' || id WHERE client_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_checks_client_id ON checks(client_id);
CREATE INDEX IF NOT EXISTS idx_dimensions_drawing ON dimensions(drawing_id);
CREATE INDEX IF NOT EXISTS idx_checks_drawing ON checks(drawing_id);
CREATE INDEX IF NOT EXISTS idx_measurements_check ON measurements(check_id);
CREATE TABLE IF NOT EXISTS sync_tombstones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS dispatches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dispatch_no TEXT NOT NULL UNIQUE,
  drawing_id INTEGER NOT NULL REFERENCES drawings(id),
  drawing_no TEXT NOT NULL DEFAULT '',
  part_name TEXT NOT NULL DEFAULT '',
  po_no TEXT NOT NULL DEFAULT '',
  invoice_no TEXT NOT NULL DEFAULT '',
  qty TEXT NOT NULL DEFAULT '',
  dispatched_by INTEGER NOT NULL REFERENCES employees(id),
  dispatched_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  notes TEXT NOT NULL DEFAULT '',
  pending_sync INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_dispatch_drawing ON dispatches(drawing_id);
CREATE TABLE IF NOT EXISTS instruments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  pending_sync INTEGER NOT NULL DEFAULT 0
);
`);

  await db.execAsync(`
INSERT OR IGNORE INTO instruments (name) VALUES
  ('Vernier Calliper'),
  ('Micrometer'),
  ('Height Gauge'),
  ('Dial Gauge'),
  ('Vernier Height Gauge'),
  ('Surface Plate');
`);

  await db.execAsync(`
UPDATE employees SET pending_sync = 1;
UPDATE drawings SET pending_sync = 1;
UPDATE dimensions SET pending_sync = 1;
UPDATE checks SET pending_sync = 1;
`);

  // v15: repair fractional balloon numbers. dim_no must be a whole number -
  // the sync server's integer column rejected values like 10.1, which rolled
  // back the entire push and left the app stuck on "Sync Failed" forever.
  const fractionalDims = await db.getAllAsync<{ id: number; drawing_id: number; dim_no: number }>(
    `SELECT id, drawing_id, dim_no FROM dimensions WHERE typeof(dim_no) != 'integer'`
  );
  for (const row of fractionalDims) {
    const parsed = Number(row.dim_no);
    let target = Number.isFinite(parsed) ? Math.max(1, Math.round(parsed)) : 1;
    // Never overwrite a different dimension: if the rounded number is taken,
    // walk up to the next free balloon number in this drawing.
    for (let guard = 0; guard < 1000; guard++) {
      const clash = await db.getFirstAsync<{ id: number }>(
        'SELECT id FROM dimensions WHERE drawing_id = ? AND dim_no = ? AND id != ?',
        row.drawing_id,
        target,
        row.id
      );
      if (!clash) break;
      target++;
    }
    await db.runAsync('UPDATE dimensions SET dim_no = ?, pending_sync = 1 WHERE id = ?', target, row.id);
    console.log(`[DB] repaired balloon number ${row.dim_no} -> ${target}`);
  }

  await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}
