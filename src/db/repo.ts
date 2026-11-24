import type { SQLiteDatabase } from 'expo-sqlite';
import type {
  CheckedDimensionRow,
  CheckRecord,
  CheckReport,
  Dimension,
  Dispatch,
  Drawing,
  DrawingReport,
  DrawingReportRow,
  Employee,
  Instrument,
  MeasurementRow,
  NewMeasurementInput,
  ReportDimension,
  Role,
} from './types';
import { isInTolerance } from '../utils';
import { ensureDispatchTable } from './database';

function makeClientId(): string {
  return `CH-${Date.now()}-${Math.floor(Math.random() * 0xffffffff).toString(16)}`;
}

async function addTombstone(db: SQLiteDatabase, kind: string, ref: string): Promise<void> {
  await db.runAsync('INSERT INTO sync_tombstones (kind, ref) VALUES (?, ?)', kind, String(ref));
}

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

export async function saveAuthenticatedEmployee(
  db: SQLiteDatabase,
  employee: { employee_id: string; name: string; role: Role },
  password: string
): Promise<Employee> {
  const employeeId = employee.employee_id.trim().toUpperCase();
  const existing = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM employees WHERE UPPER(employee_id) = UPPER(?)',
    employeeId
  );

  if (existing) {
    await db.runAsync(
      'UPDATE employees SET name = ?, password = ?, role = ?, pending_sync = 0 WHERE id = ?',
      employee.name,
      password,
      employee.role,
      existing.id
    );
  } else {
    await db.runAsync(
      'INSERT INTO employees (employee_id, name, password, role, pending_sync) VALUES (?, ?, ?, ?, 0)',
      employeeId,
      employee.name,
      password,
      employee.role
    );
  }

  const saved = await db.getFirstAsync<Employee>(
    'SELECT * FROM employees WHERE UPPER(employee_id) = UPPER(?)',
    employeeId
  );
  if (!saved) {
    throw new Error('Authenticated employee could not be saved locally');
  }
  return saved;
}

/** Loads an employee by id only - used to explain why a sign-in failed. */
export async function findEmployee(
  db: SQLiteDatabase,
  employeeId: string
): Promise<Employee | null> {
  const row = await db.getFirstAsync<Employee>(
    'SELECT * FROM employees WHERE UPPER(employee_id) = UPPER(?)',
    employeeId.trim()
  );
  return row ?? null;
}

/**
 * Stores a password the sync server has just verified. Needed when the row on
 * this device holds the server's bcrypt hash: the device cannot compare with a
 * hash, so once the server confirms the password we keep it locally and the
 * user can sign in offline from then on.
 */
export async function setLocalPassword(
  db: SQLiteDatabase,
  employeeId: string,
  password: string
): Promise<void> {
  await db.runAsync(
    'UPDATE employees SET password = ? WHERE UPPER(employee_id) = UPPER(?)',
    String(password),
    employeeId.trim()
  );
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
    'INSERT INTO employees (employee_id, name, password, role, pending_sync) VALUES (?, ?, ?, ?, 1)',
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
    'UPDATE employees SET employee_id = ?, name = ?, password = ?, role = ?, pending_sync = 1 WHERE id = ?',
    data.employee_id.trim(),
    data.name.trim(),
    data.password,
    data.role,
    id
  );
}

export async function deleteEmployee(db: SQLiteDatabase, id: number): Promise<void> {
  const row = await db.getFirstAsync<{ employee_id: string }>(
    'SELECT employee_id FROM employees WHERE id = ?',
    id
  );
  if (row) {
    await addTombstone(db, 'employee', row.employee_id);
  }
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
      (SELECT COUNT(*) FROM dimensions x WHERE x.drawing_id = d.id) AS dim_count,
      (SELECT COUNT(DISTINCT m.dimension_id)
         FROM measurements m
         JOIN checks c ON c.id = m.check_id
        WHERE c.drawing_id = d.id) AS checked_dim_count
     FROM drawings d
     LEFT JOIN employees e ON e.id = d.created_by
     ORDER BY d.created_at DESC`
  );
}

export async function getDrawing(db: SQLiteDatabase, id: number): Promise<Drawing | null> {
  const row = await db.getFirstAsync<Drawing>(
    `SELECT d.*, e.name AS designer_name,
      (SELECT COUNT(*) FROM dimensions x WHERE x.drawing_id = d.id) AS dim_count,
      (SELECT COUNT(DISTINCT m.dimension_id)
         FROM measurements m
         JOIN checks c ON c.id = m.check_id
        WHERE c.drawing_id = d.id) AS checked_dim_count
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
  treatment: string;
  hardness: string;
  image_uri: string | null;
}

export async function addDrawing(
  db: SQLiteDatabase,
  data: DrawingInput & { created_by: number }
): Promise<number> {
  const result = await db.runAsync(
    `INSERT INTO drawings
       (drawing_no, part_name, customer, revision, material, unit, notes,
        invoice_no, invoice_date, drawing_rev_date, po_no, qty, treatment, hardness,
        image_uri, created_by, pending_sync, image_synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
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
    data.treatment.trim(),
    data.hardness.trim(),
    data.image_uri ?? null,
    data.created_by,
    data.image_uri ? 0 : 1
  );
  return result.lastInsertRowId;
}

export async function updateDrawing(db: SQLiteDatabase, id: number, data: DrawingInput): Promise<void> {
  await db.runAsync(
    `UPDATE drawings
     SET drawing_no = ?, part_name = ?, customer = ?, revision = ?, material = ?, unit = ?, notes = ?,
         invoice_no = ?, invoice_date = ?, drawing_rev_date = ?, po_no = ?, qty = ?,
         treatment = ?, hardness = ?, image_uri = ?,
         pending_sync = 1, image_synced = ?
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
    data.treatment.trim(),
    data.hardness.trim(),
    data.image_uri ?? null,
    data.image_uri ? 0 : 1,
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
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<{ drawing_no: string }>(
      'SELECT drawing_no FROM drawings WHERE id = ?',
      id
    );
    if (row) {
      await addTombstone(db, 'drawing', row.drawing_no);
    }
    const dispatchRows = await db.getAllAsync<{ dispatch_no: string }>(
      'SELECT dispatch_no FROM dispatches WHERE drawing_id = ?',
      id
    );
    for (const dp of dispatchRows) {
      await addTombstone(db, 'dispatch', dp.dispatch_no);
    }
    await db.runAsync('DELETE FROM dispatches WHERE drawing_id = ?', id);
    await db.runAsync('DELETE FROM drawings WHERE id = ?', id);
  });
}

export async function deleteDrawingWithChecks(db: SQLiteDatabase, id: number): Promise<void> {
  await db.withTransactionAsync(async () => {
    const drawing = await db.getFirstAsync<{ drawing_no: string }>(
      'SELECT drawing_no FROM drawings WHERE id = ?',
      id
    );
    if (drawing) {
      await addTombstone(db, 'drawing', drawing.drawing_no);
    }
    const checkRows = await db.getAllAsync<{ client_id: string | null }>(
      'SELECT client_id FROM checks WHERE drawing_id = ?',
      id
    );
    for (const c of checkRows) {
      if (c.client_id) {
        await addTombstone(db, 'check', c.client_id);
      }
    }
    const dispatchRows = await db.getAllAsync<{ dispatch_no: string }>(
      'SELECT dispatch_no FROM dispatches WHERE drawing_id = ?',
      id
    );
    for (const dp of dispatchRows) {
      await addTombstone(db, 'dispatch', dp.dispatch_no);
    }
    await db.runAsync(
      'DELETE FROM measurements WHERE check_id IN (SELECT id FROM checks WHERE drawing_id = ?)',
      id
    );
    await db.runAsync('DELETE FROM checks WHERE drawing_id = ?', id);
    await db.runAsync('DELETE FROM dimensions WHERE drawing_id = ?', id);
    await db.runAsync('DELETE FROM dispatches WHERE drawing_id = ?', id);
    await db.runAsync('DELETE FROM drawings WHERE id = ?', id);
  });
}

export async function deleteCheck(db: SQLiteDatabase, checkId: number): Promise<void> {
  await db.withTransactionAsync(async () => {
    const check = await db.getFirstAsync<{ client_id: string | null }>(
      'SELECT client_id FROM checks WHERE id = ?',
      checkId
    );
    if (check?.client_id) {
      await addTombstone(db, 'check', check.client_id);
    }
    await db.runAsync('DELETE FROM measurements WHERE check_id = ?', checkId);
    await db.runAsync('DELETE FROM checks WHERE id = ?', checkId);
  });
}

export async function getDimensions(db: SQLiteDatabase, drawingId: number): Promise<Dimension[]> {
  return db.getAllAsync<Dimension>(
    'SELECT * FROM dimensions WHERE drawing_id = ? ORDER BY dim_no',
    drawingId
  );
}

/**
 * Balloon numbers (dim_no) must be whole numbers: the sync server stores
 * dim_no as an integer and rejects decimals like 10.1, which used to fail
 * the ENTIRE sync push ("Sync Failed" forever). Round at the data layer so
 * no screen or import can introduce a fractional balloon number again.
 */
function toWholeBalloonNo(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.round(n));
}

export async function addDimension(
  db: SQLiteDatabase,
  data: { drawing_id: number; dim_no: number; description: string; nominal: number; nominal_text?: string; tol_upper: number; tol_lower: number }
): Promise<number> {
  const result = await db.runAsync(
    `INSERT INTO dimensions (drawing_id, dim_no, description, nominal, nominal_text, tol_upper, tol_lower, pending_sync)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    data.drawing_id,
    toWholeBalloonNo(data.dim_no),
    data.description.trim(),
    data.nominal,
    (data.nominal_text ?? '').trim(),
    Number(data.tol_upper || 0),
    Number(data.tol_lower || 0)
  );
  return result.lastInsertRowId;
}

export async function importDimensions(
  db: SQLiteDatabase,
  drawingId: number,
  dims: { dim_no: number; description: string; nominal: number; nominal_text?: string; tol_upper: number; tol_lower: number }[]
): Promise<{ imported: number; skipped: number; lastError: string }> {
  let imported = 0;
  let skipped = 0;
  let lastError = '';
  await db.withTransactionAsync(async () => {
    for (const d of dims) {
      try {
        await db.runAsync(
          `INSERT INTO dimensions (drawing_id, dim_no, description, nominal, nominal_text, tol_upper, tol_lower, pending_sync)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
          drawingId,
          toWholeBalloonNo(d.dim_no),
          d.description.trim(),
          d.nominal,
          (d.nominal_text ?? '').trim(),
          Number(d.tol_upper || 0),
          Number(d.tol_lower || 0)
        );
        imported++;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        skipped++;
      }
    }
  });
  return { imported, skipped, lastError };
}

export async function updateDimension(
  db: SQLiteDatabase,
  id: number,
  data: { dim_no: number; description: string; nominal: number; nominal_text?: string; tol_upper: number; tol_lower: number }
): Promise<void> {
  await db.runAsync(
    'UPDATE dimensions SET dim_no = ?, description = ?, nominal = ?, nominal_text = ?, tol_upper = ?, tol_lower = ?, pending_sync = 1 WHERE id = ?',
    toWholeBalloonNo(data.dim_no),
    data.description.trim(),
    data.nominal,
    (data.nominal_text ?? '').trim(),
    Number(data.tol_upper || 0),
    Number(data.tol_lower || 0),
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
  const row = await db.getFirstAsync<{ drawing_no: string; dim_no: number }>(
    `SELECT dw.drawing_no, d.dim_no
     FROM dimensions d JOIN drawings dw ON dw.id = d.drawing_id
     WHERE d.id = ?`,
    id
  );
  if (row) {
    await addTombstone(db, 'dimension', `${row.drawing_no}:${row.dim_no}`);
  }
  await db.runAsync('DELETE FROM dimensions WHERE id = ?', id);
}

export async function createCheck(
  db: SQLiteDatabase,
  data: {
    drawingId: number;
    checkedBy: number;
    inspectorNotes: string;
    inspectorName: string;
    measurements: NewMeasurementInput[];
  }
): Promise<number> {
  let checkId = 0;
  const instrumentPairs: { dimId: number; instrument: string }[] = [];

  await db.withTransactionAsync(async () => {
    const anyFail = data.measurements.some((m) => !dimensionPasses(m));
    const result: string = anyFail ? 'FAIL' : 'PASS';
    const clientId = makeClientId();

    const insert = await db.runAsync(
      `INSERT INTO checks (client_id, drawing_id, checked_by, result, inspector_notes, inspector_name, pending_sync)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      clientId,
      data.drawingId,
      data.checkedBy,
      result,
      data.inspectorNotes.trim(),
      data.inspectorName.trim()
    );
    checkId = insert.lastInsertRowId;

    for (const m of data.measurements) {
      await db.runAsync(
        `INSERT INTO measurements
           (check_id, dimension_id, sample1, sample2, sample3, sample4, sample5,
            sample6, sample7, sample8, sample9, sample10, remarks, pass, instrument, sample_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        m.remarks?.trim() ?? '',
        dimensionPasses(m) ? 1 : 0,
        m.instrument?.trim() ?? '',
        (m.statuses ?? []).filter((s) => s === 'OK' || s === 'NOT OK').join('|')
      );
      const inst = m.instrument?.trim() ?? '';
      if (inst) {
        instrumentPairs.push({ dimId: m.dimensionId, instrument: inst });
      }
    }
  });

  // The instrument is the 15th bound parameter of the INSERT, which expo-sqlite on
  // web does not reliably persist. Force it in via raw SQL after the transaction commits.
  for (const { dimId, instrument } of instrumentPairs) {
    const safe = instrument.replace(/'/g, "''");
    await db.execAsync(
      `UPDATE measurements SET instrument = '${safe}' WHERE check_id = ${checkId} AND dimension_id = ${dimId}`
    );
  }

  return checkId;
}

function dimensionPasses(m: NewMeasurementInput): boolean {
  const statuses = (m.statuses ?? []).filter((s) => s === 'OK' || s === 'NOT OK');
  if (statuses.length > 0) {
    return statuses.every((s) => s === 'OK');
  }
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
            d.treatment, d.hardness,
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
            d.invoice_no, d.invoice_date, d.drawing_rev_date, d.po_no, d.qty,
            d.treatment, d.hardness
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
    `WITH ranked_measurements AS (
       SELECT m.id, m.check_id, m.dimension_id,
              ROW_NUMBER() OVER (
                PARTITION BY m.dimension_id
                ORDER BY c.checked_at DESC, c.id DESC, m.id DESC
              ) AS row_number
       FROM measurements m
       JOIN checks c ON c.id = m.check_id
       WHERE c.drawing_id = ?
     )
     SELECT m.id, m.check_id, m.dimension_id,
            m.sample1, m.sample2, m.sample3, m.sample4, m.sample5,
            m.sample6, m.sample7, m.sample8, m.sample9, m.sample10,
            m.remarks, m.pass, m.instrument, m.sample_status,
            c.checked_at, c.inspector_name,
            e.name AS inspector_employee_name,
            d.dim_no, d.description, d.nominal, d.nominal_text, d.tol_upper, d.tol_lower
     FROM ranked_measurements ranked
     JOIN measurements m ON m.id = ranked.id
     JOIN checks c ON c.id = m.check_id
     JOIN dimensions d ON d.id = m.dimension_id
     JOIN employees e ON e.id = c.checked_by
     WHERE ranked.row_number = 1
     ORDER BY d.dim_no`,
    check.drawing_id
  );
  const dims = await db.getAllAsync<ReportDimension>(
    `SELECT d.id, d.dim_no, d.description, d.nominal, d.nominal_text, d.tol_upper, d.tol_lower,
            EXISTS(SELECT 1 FROM measurements m WHERE m.dimension_id = d.id AND m.check_id IN (SELECT id FROM checks WHERE drawing_id = d.drawing_id)) AS checked
     FROM dimensions d
     WHERE d.drawing_id = ?
     ORDER BY d.dim_no`,
    check.drawing_id
  );
  return { check, rows, dims };
}

export async function getCheckedDimensions(
  db: SQLiteDatabase,
  drawingId: number
): Promise<CheckedDimensionRow[]> {
  const rows = await db.getAllAsync<CheckedDimensionRow>(
    `SELECT m.id, m.check_id, m.dimension_id, m.sample1, m.sample2, m.sample3, m.sample4, m.sample5,
            m.sample6, m.sample7, m.sample8, m.sample9, m.sample10, m.remarks, m.pass,
            m.sample_status,
            d.dim_no, d.description, d.nominal, d.nominal_text, d.tol_upper, d.tol_lower,
            c.checked_at, m.instrument AS instrument, c.inspector_name,
            e.name AS inspector_employee_name
     FROM measurements m
     JOIN dimensions d ON d.id = m.dimension_id
     JOIN checks c ON c.id = m.check_id
     JOIN employees e ON e.id = c.checked_by
     WHERE c.drawing_id = ?
     ORDER BY d.dim_no, c.checked_at DESC, m.id DESC`,
    drawingId
  );
  const latest = new Map<number, CheckedDimensionRow>();
  for (const row of rows) {
    if (!latest.has(row.dimension_id)) {
      latest.set(row.dimension_id, row);
    }
  }
  return [...latest.values()];
}

export async function getDrawingReport(
  db: SQLiteDatabase,
  drawingId: number
): Promise<DrawingReport | null> {
  const drawing = await getDrawing(db, drawingId);
  if (!drawing) {
    return null;
  }
  const checks = await db.getAllAsync<CheckRecord>(
    `SELECT c.*, e.name AS inspector_employee_name, e.employee_id AS inspector_employee_id,
            d.drawing_no, d.part_name, d.customer, d.revision, d.material, d.unit,
            d.invoice_no, d.invoice_date, d.drawing_rev_date, d.po_no, d.qty,
            d.treatment, d.hardness
     FROM checks c
     JOIN employees e ON e.id = c.checked_by
     JOIN drawings d ON d.id = c.drawing_id
     WHERE c.drawing_id = ?
     ORDER BY c.checked_at ASC, c.id ASC`,
    drawingId
  );
  const raw = await db.getAllAsync<DrawingReportRow>(
    `SELECT m.id, m.check_id, m.dimension_id, m.sample1, m.sample2, m.sample3, m.sample4, m.sample5,
            m.sample6, m.sample7, m.sample8, m.sample9, m.sample10, m.remarks, m.pass,
            m.sample_status,
            d.dim_no, d.description, d.nominal, d.nominal_text, d.tol_upper, d.tol_lower,
            c.checked_at, m.instrument AS instrument, c.inspector_name,
            e.name AS inspector_employee_name, e.employee_id AS inspector_employee_id
     FROM measurements m
     JOIN dimensions d ON d.id = m.dimension_id
     JOIN checks c ON c.id = m.check_id
     JOIN employees e ON e.id = c.checked_by
     WHERE c.drawing_id = ?
     ORDER BY d.dim_no, c.checked_at DESC, m.id DESC`,
    drawingId
  );
  const rows = new Map<number, DrawingReportRow>();
  for (const row of raw) {
    if (!rows.has(row.dimension_id)) {
      rows.set(row.dimension_id, row);
    }
  }
  const dims = await db.getAllAsync<ReportDimension>(
    `SELECT d.id, d.dim_no, d.description, d.nominal, d.nominal_text, d.tol_upper, d.tol_lower,
            EXISTS(SELECT 1 FROM measurements m WHERE m.dimension_id = d.id) AS checked
     FROM dimensions d
     WHERE d.drawing_id = ?
     ORDER BY d.dim_no`,
    drawingId
  );
  return {
    drawing,
    checks,
    rows: [...rows.values()],
    dims,
  };
}

export interface DispatchInput {
  dispatch_no: string;
  drawing_id: number;
  drawing_no: string;
  part_name: string;
  po_no: string;
  invoice_no: string;
  qty: string;
  dispatched_by: number;
  notes?: string;
}

export async function addDispatch(db: SQLiteDatabase, data: DispatchInput): Promise<number> {
  await ensureDispatchTable(db);
  const result = await db.runAsync(
    `INSERT INTO dispatches
       (dispatch_no, drawing_id, drawing_no, part_name, po_no, invoice_no, qty,
        dispatched_by, dispatched_at, notes, pending_sync)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), ?, 1)`,
    data.dispatch_no.trim(),
    data.drawing_id,
    data.drawing_no.trim(),
    data.part_name.trim(),
    data.po_no.trim(),
    data.invoice_no.trim(),
    data.qty.trim(),
    data.dispatched_by,
    String(data.notes ?? '').trim()
  );
  return result.lastInsertRowId;
}

export async function getDispatches(db: SQLiteDatabase): Promise<Dispatch[]> {
  return db.getAllAsync<Dispatch>(
    `SELECT d.*, e.name AS dispatcher_name, e.employee_id AS dispatcher_employee_id
     FROM dispatches d
     LEFT JOIN employees e ON e.id = d.dispatched_by
     ORDER BY d.dispatched_at DESC, d.id DESC`
  );
}

export async function getInstruments(db: SQLiteDatabase): Promise<Instrument[]> {
  return db.getAllAsync<Instrument>(
    'SELECT id, name FROM instruments ORDER BY name COLLATE NOCASE'
  );
}

export async function addInstrument(db: SQLiteDatabase, name: string): Promise<Instrument | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  try {
    const result = await db.runAsync(
      'INSERT INTO instruments (name, pending_sync) VALUES (?, 1)',
      trimmed
    );
    return { id: result.lastInsertRowId, name: trimmed };
  } catch {
    const existing = await db.getFirstAsync<Instrument>(
      'SELECT id, name FROM instruments WHERE UPPER(name) = UPPER(?)',
      trimmed
    );
    return existing ?? null;
  }
}

export async function deleteInstrument(db: SQLiteDatabase, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  await addTombstone(db, 'instrument', trimmed);
  await db.runAsync('DELETE FROM instruments WHERE UPPER(name) = UPPER(?)', trimmed);
}

export async function getDispatch(db: SQLiteDatabase, id: number): Promise<Dispatch | null> {
  const row = await db.getFirstAsync<Dispatch>(
    `SELECT d.*, e.name AS dispatcher_name, e.employee_id AS dispatcher_employee_id
     FROM dispatches d
     LEFT JOIN employees e ON e.id = d.dispatched_by
     WHERE d.id = ?`,
    id
  );
  return row ?? null;
}

export async function getDrawingDispatches(db: SQLiteDatabase, drawingId: number): Promise<Dispatch[]> {
  return db.getAllAsync<Dispatch>(
    `SELECT d.*, e.name AS dispatcher_name, e.employee_id AS dispatcher_employee_id
     FROM dispatches d
     LEFT JOIN employees e ON e.id = d.dispatched_by
     WHERE d.drawing_id = ?
     ORDER BY d.dispatched_at DESC, d.id DESC`,
    drawingId
  );
}

export async function deleteDispatch(db: SQLiteDatabase, id: number): Promise<void> {
  const row = await db.getFirstAsync<{ dispatch_no: string }>(
    'SELECT dispatch_no FROM dispatches WHERE id = ?',
    id
  );
  if (row) {
    await addTombstone(db, 'dispatch', row.dispatch_no);
  }
  await db.runAsync('DELETE FROM dispatches WHERE id = ?', id);
}
