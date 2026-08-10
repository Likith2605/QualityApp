import type { SQLiteDatabase } from 'expo-sqlite';
import type {
  CheckRecord,
  CheckReport,
  Dimension,
  Drawing,
  Employee,
  MeasurementRow,
  NewMeasurementInput,
  Role,
} from './types';
import { isInTolerance } from '../utils';

export async function login(
  db: SQLiteDatabase,
  employeeId: string,
  password: string
): Promise<Employee | null> {
  const row = await db.getFirstAsync<Employee>(
    'SELECT * FROM employees WHERE UPPER(employee_id) = UPPER(?) AND password = ?',
    employeeId.trim(),
    password
  );
  return row ?? null;
}

export async function getEmployees(db: SQLiteDatabase): Promise<Employee[]> {
  return db.getAllAsync<Employee>('SELECT * FROM employees ORDER BY name COLLATE NOCASE');
}

export async function employeeIdExists(
  db: SQLiteDatabase,
  employeeId: string,
  excludeId?: number
): Promise<boolean> {
  if (excludeId) {
    const row = await db.getFirstAsync<{ c: number }>(
      'SELECT COUNT(*) as c FROM employees WHERE UPPER(employee_id) = UPPER(?) AND id != ?',
      employeeId.trim(),
      excludeId
    );
    return (row?.c ?? 0) > 0;
  }
  const row = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) as c FROM employees WHERE UPPER(employee_id) = UPPER(?)',
    employeeId.trim()
  );
  return (row?.c ?? 0) > 0;
}

export async function addEmployee(
  db: SQLiteDatabase,
  data: { employee_id: string; name: string; password: string; role: Role }
): Promise<void> {
  await db.runAsync(
    'INSERT INTO employees (employee_id, name, password, role) VALUES (?, ?, ?, ?)',
    data.employee_id.trim(),
    data.name.trim(),
    data.password,
    data.role
  );
}

export async function updateEmployee(
  db: SQLiteDatabase,
  id: number,
  data: { employee_id: string; name: string; password: string; role: Role }
): Promise<void> {
  await db.runAsync(
    'UPDATE employees SET employee_id = ?, name = ?, password = ?, role = ? WHERE id = ?',
    data.employee_id.trim(),
    data.name.trim(),
    data.password,
    data.role,
    id
  );
}

export async function deleteEmployee(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM employees WHERE id = ?', id);
}

export async function adminCount(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) as c FROM employees WHERE role = 'admin'"
  );
  return row?.c ?? 0;
}

export async function getDrawings(db: SQLiteDatabase): Promise<Drawing[]> {
  return db.getAllAsync<Drawing>(
    `SELECT d.*, e.name AS designer_name,
      (SELECT COUNT(*) FROM dimensions x WHERE x.drawing_id = d.id) AS dim_count
     FROM drawings d
     LEFT JOIN employees e ON e.id = d.created_by
     ORDER BY d.created_at DESC`
  );
}

export async function getDrawing(db: SQLiteDatabase, id: number): Promise<Drawing | null> {
  const row = await db.getFirstAsync<Drawing>(
    `SELECT d.*, e.name AS designer_name,
      (SELECT COUNT(*) FROM dimensions x WHERE x.drawing_id = d.id) AS dim_count
     FROM drawings d
     LEFT JOIN employees e ON e.id = d.created_by
     WHERE d.id = ?`,
    id
  );
  return row ?? null;
}

export async function drawingNoExists(
  db: SQLiteDatabase,
  drawingNo: string,
  excludeId?: number
): Promise<boolean> {
  if (excludeId) {
    const row = await db.getFirstAsync<{ c: number }>(
      'SELECT COUNT(*) as c FROM drawings WHERE UPPER(drawing_no) = UPPER(?) AND id != ?',
      drawingNo.trim(),
      excludeId
    );
    return (row?.c ?? 0) > 0;
  }
  const row = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) as c FROM drawings WHERE UPPER(drawing_no) = UPPER(?)',
    drawingNo.trim()
  );
  return (row?.c ?? 0) > 0;
}

export interface DrawingInput {
  drawing_no: string;
  part_name: string;
  customer: string;
  revision: string;
  material: string;
  unit: string;
  notes: string;
  invoice_no: string;
  invoice_date: string;
  drawing_rev_date: string;
  po_no: string;
  qty: string;
  image_uri: string | null;
}

export async function addDrawing(
  db: SQLiteDatabase,
  data: DrawingInput & { created_by: number }
): Promise<number> {
  const result = await db.runAsync(
    `INSERT INTO drawings
       (drawing_no, part_name, customer, revision, material, unit, notes,
        invoice_no, invoice_date, drawing_rev_date, po_no, qty, image_uri, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    data.drawing_no.trim(),
    data.part_name.trim(),
    data.customer.trim(),
    data.revision.trim(),
    data.material.trim(),
    data.unit.trim(),
    data.notes.trim(),
    data.invoice_no.trim(),
    data.invoice_date.trim(),
    data.drawing_rev_date.trim(),
    data.po_no.trim(),
    data.qty.trim(),
    data.image_uri ?? null,
    data.created_by
  );
  return result.lastInsertRowId;
}

export async function updateDrawing(db: SQLiteDatabase, id: number, data: DrawingInput): Promise<void> {
  await db.runAsync(
    `UPDATE drawings
     SET drawing_no = ?, part_name = ?, customer = ?, revision = ?, material = ?, unit = ?, notes = ?,
         invoice_no = ?, invoice_date = ?, drawing_rev_date = ?, po_no = ?, qty = ?, image_uri = ?
     WHERE id = ?`,
    data.drawing_no.trim(),
    data.part_name.trim(),
    data.customer.trim(),
    data.revision.trim(),
    data.material.trim(),
    data.unit.trim(),
    data.notes.trim(),
    data.invoice_no.trim(),
    data.invoice_date.trim(),
    data.drawing_rev_date.trim(),
    data.po_no.trim(),
    data.qty.trim(),
    data.image_uri ?? null,
    id
  );
}

export async function drawingCheckCount(db: SQLiteDatabase, drawingId: number): Promise<number> {
  const row = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) as c FROM checks WHERE drawing_id = ?',
    drawingId
  );
  return row?.c ?? 0;
}

export async function deleteDrawing(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM drawings WHERE id = ?', id);
}

export async function getDimensions(db: SQLiteDatabase, drawingId: number): Promise<Dimension[]> {
  return db.getAllAsync<Dimension>(
    'SELECT * FROM dimensions WHERE drawing_id = ? ORDER BY dim_no',
    drawingId
  );
}

export async function addDimension(
  db: SQLiteDatabase,
  data: { drawing_id: number; dim_no: number; description: string; nominal: number; tol_upper: number; tol_lower: number }
): Promise<number> {
  const result = await db.runAsync(
    `INSERT INTO dimensions (drawing_id, dim_no, description, nominal, tol_upper, tol_lower)
     VALUES (?, ?, ?, ?, ?, ?)`,
    data.drawing_id,
    data.dim_no,
    data.description.trim(),
    data.nominal,
    Math.abs(data.tol_upper || 0),
    -Math.abs(data.tol_lower || 0)
  );
  return result.lastInsertRowId;
}

export async function updateDimension(
  db: SQLiteDatabase,
  id: number,
  data: { dim_no: number; description: string; nominal: number; tol_upper: number; tol_lower: number }
): Promise<void> {
  await db.runAsync(
    'UPDATE dimensions SET dim_no = ?, description = ?, nominal = ?, tol_upper = ?, tol_lower = ? WHERE id = ?',
    data.dim_no,
    data.description.trim(),
    data.nominal,
    Math.abs(data.tol_upper || 0),
    -Math.abs(data.tol_lower || 0),
    id
  );
}

export async function dimensionCheckCount(db: SQLiteDatabase, dimensionId: number): Promise<number> {
  const row = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) as c FROM measurements WHERE dimension_id = ?',
    dimensionId
  );
  return row?.c ?? 0;
}

export async function deleteDimension(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM dimensions WHERE id = ?', id);
}

export async function createCheck(
  db: SQLiteDatabase,
  data: {
    drawingId: number;
    checkedBy: number;
    instrument: string;
    inspectorNotes: string;
    inspectorName: string;
    measurements: NewMeasurementInput[];
  }
): Promise<number> {
  let checkId = 0;
  await db.withExclusiveTransactionAsync(async (txn) => {
    const anyFail = data.measurements.some((m) => !dimensionPasses(m));
    const result: string = anyFail ? 'FAIL' : 'PASS';

    const insert = await txn.runAsync(
      'INSERT INTO checks (drawing_id, checked_by, result, instrument, inspector_notes, inspector_name) VALUES (?, ?, ?, ?, ?, ?)',
      data.drawingId,
      data.checkedBy,
      result,
      data.instrument.trim(),
      data.inspectorNotes.trim(),
      data.inspectorName.trim()
    );
    checkId = insert.lastInsertRowId;

    for (const m of data.measurements) {
      await txn.runAsync(
        `INSERT INTO measurements
           (check_id, dimension_id, sample1, sample2, sample3, sample4, sample5,
            sample6, sample7, sample8, sample9, sample10, pass)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        checkId,
        m.dimensionId,
        m.samples[0] ?? null,
        m.samples[1] ?? null,
        m.samples[2] ?? null,
        m.samples[3] ?? null,
        m.samples[4] ?? null,
        m.samples[5] ?? null,
        m.samples[6] ?? null,
        m.samples[7] ?? null,
        m.samples[8] ?? null,
        m.samples[9] ?? null,
        dimensionPasses(m) ? 1 : 0
      );
    }
  });

  return checkId;
}

function dimensionPasses(m: NewMeasurementInput): boolean {
  const samples = m.samples.filter((s) => typeof s === 'number' && Number.isFinite(s));
  if (samples.length === 0) {
    return false;
  }
  return samples.every((s) => isInTolerance(s, m.nominal, m.tol_upper, m.tol_lower));
}

export async function getChecks(db: SQLiteDatabase): Promise<CheckRecord[]> {
  return db.getAllAsync<CheckRecord>(
    `SELECT c.*, e.name AS inspector_employee_name, e.employee_id AS inspector_employee_id,
            d.drawing_no, d.part_name, d.customer, d.revision, d.material, d.unit,
            d.invoice_no, d.invoice_date, d.drawing_rev_date, d.po_no, d.qty,
            (SELECT COUNT(*) FROM measurements m WHERE m.check_id = c.id AND m.pass = 1) AS ok_count,
            (SELECT COUNT(*) FROM measurements m WHERE m.check_id = c.id AND m.pass = 0) AS ng_count
     FROM checks c
     JOIN employees e ON e.id = c.checked_by
     JOIN drawings d ON d.id = c.drawing_id
     ORDER BY c.checked_at DESC`
  );
}

export async function getCheckReport(
  db: SQLiteDatabase,
  checkId: number
): Promise<CheckReport | null> {
  const check = await db.getFirstAsync<CheckRecord>(
    `SELECT c.*, e.name AS inspector_employee_name, e.employee_id AS inspector_employee_id,
            d.drawing_no, d.part_name, d.customer, d.revision, d.material, d.unit,
            d.invoice_no, d.invoice_date, d.drawing_rev_date, d.po_no, d.qty
     FROM checks c
     JOIN employees e ON e.id = c.checked_by
     JOIN drawings d ON d.id = c.drawing_id
     WHERE c.id = ?`,
    checkId
  );
  if (!check) {
    return null;
  }
  const rows = await db.getAllAsync<MeasurementRow>(
    `SELECT m.*, d.dim_no, d.description, d.nominal, d.tol_upper, d.tol_lower
     FROM measurements m
     JOIN dimensions d ON d.id = m.dimension_id
     WHERE m.check_id = ?
     ORDER BY d.dim_no`,
    checkId
  );
  return { check, rows };
}
