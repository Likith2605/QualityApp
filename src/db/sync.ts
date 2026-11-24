import type { SQLiteDatabase } from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';
import { Directory, File, Paths } from 'expo-file-system';
import { ensureDispatchTable } from './database';
import { isBcryptHash } from '../utils';
import { DEFAULT_API_URL } from '../config';
import type { Role } from './types';

const SERVER_URL_KEY = 'sync_server_url';
const TOKEN_KEY = 'sync_token';
const LAST_SYNC_KEY = 'sync_last_status';
const SYNC_CREDS_KEY = 'sync_login';

export interface SyncResult {
  ok: boolean;
  message: string;
  /** True when the app had to re-login to the server automatically (expired session). */
  recovered?: boolean;
}

export interface ServerLoginResult extends SyncResult {
  employee?: { employee_id: string; name: string; role: Role };
}

function isRole(value: unknown): value is Role {
  return value === 'admin' || value === 'designer' || value === 'qc';
}

export interface SyncOptions {
  signal?: AbortSignal;
  shouldContinue?: () => boolean;
}

const SYNC_CANCELLED_MESSAGE = 'Sync cancelled';

function isSyncActive(options?: SyncOptions): boolean {
  return !options?.signal?.aborted && (!options?.shouldContinue || options.shouldContinue());
}

function assertSyncActive(options?: SyncOptions): void {
  if (!isSyncActive(options)) throw new Error(SYNC_CANCELLED_MESSAGE);
}

export async function getServerUrl(): Promise<string> {
  const custom = await Storage.getItem(SERVER_URL_KEY);
  if (custom && custom.trim()) return custom.trim();
  return DEFAULT_API_URL || '';
}

export async function setServerUrl(url: string): Promise<void> {
  const clean = url.trim().replace(/\/+$/, '');
  if (clean) {
    await Storage.setItem(SERVER_URL_KEY, clean);
  } else {
    await Storage.removeItem(SERVER_URL_KEY);
  }
}

export async function hasSyncConfigured(): Promise<boolean> {
  const url = await getServerUrl();
  return url.length > 0;
}

export async function getSyncStatus(): Promise<string> {
  return (await Storage.getItem(LAST_SYNC_KEY)) ?? '';
}

async function setSyncStatus(s: string): Promise<void> {
  await Storage.setItem(LAST_SYNC_KEY, s);
}

async function getToken(): Promise<string> {
  return (await Storage.getItem(TOKEN_KEY)) ?? '';
}

export async function getSyncToken(): Promise<string> {
  return getToken();
}

async function setToken(token: string): Promise<void> {
  if (token) {
    await Storage.setItem(TOKEN_KEY, token);
  } else {
    await Storage.removeItem(TOKEN_KEY);
  }
}

// Credentials of the last successful server login. Kept so the sync engine can
// silently re-authenticate when the server session expires (server restart,
// session cleanup, token invalidation) instead of failing forever.
async function saveSyncCredentials(employeeId: string, password: string): Promise<void> {
  try {
    await Storage.setItem(
      SYNC_CREDS_KEY,
      JSON.stringify({ employee_id: employeeId, password })
    );
  } catch {
    /* best-effort */
  }
}

async function loadSyncCredentials(): Promise<{ employeeId: string; password: string } | null> {
  try {
    const raw = await Storage.getItem(SYNC_CREDS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { employee_id?: string; password?: string };
    if (!parsed?.employee_id || !parsed?.password) return null;
    return { employeeId: String(parsed.employee_id), password: String(parsed.password) };
  } catch {
    return null;
  }
}

/**
 * Ensure we hold a valid server session. If the current token is missing or has
 * been invalidated (e.g. the server was restarted), log in again using the
 * stored credentials. Returns true when a usable token is available afterwards.
 */
export async function ensureServerSession(): Promise<boolean> {
  const url = await getServerUrl();
  if (!url) return false;
  const creds = await loadSyncCredentials();
  if (!creds) return false;
  return tryLogin(url, creds.employeeId, creds.password);
}

export async function clearSyncSession(): Promise<void> {
  await setToken('');
}

export async function testServerConnection(url?: string): Promise<SyncResult> {
  const base = url?.trim().replace(/\/+$/, '') || (await getServerUrl());
  if (!base) {
    return { ok: false, message: 'Enter a server address first' };
  }
  if (!/^https?:\/\//i.test(base)) {
    return { ok: false, message: 'Address must start with http:// or https://' };
  }
  // Raw fetch (not api()) so we can tell "network unreachable" apart from
  // "server reachable but reporting an internal error (e.g. database down)".
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(base + '/api/health', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    let body: { ok?: boolean; error?: string } | null = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (res.ok && body?.ok) {
      return { ok: true, message: 'Connected to server' };
    }
    if (body?.error) {
      return { ok: false, message: `Server reachable, but error: ${body.error}` };
    }
    if (body) {
      return { ok: false, message: 'Server did not respond correctly' };
    }
    return { ok: false, message: `Server responded with HTTP ${res.status}` };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return { ok: false, message: 'Request timed out. Check the server address and try again.' };
    }
    return { ok: false, message: `Cannot reach server: ${e instanceof Error ? e.message : 'network error'}` };
  } finally {
    clearTimeout(timer);
  }
}

const REQUEST_TIMEOUT_MS = 8000;

/** Error thrown for non-2xx responses; keeps the HTTP status for recovery logic. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function api(
  url: string,
  path: string,
  options: { method?: string; token?: string; body?: unknown; timeout?: number; signal?: AbortSignal } = {}
): Promise<any> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', abort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), options.timeout ?? REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url + path, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    if (e instanceof Error && e.name === 'AbortError') {
      if (options.signal?.aborted) throw new Error('Sync cancelled');
      throw new Error('Request timed out. Check the server address and try again.');
    }
    throw e;
  }
  clearTimeout(timer);
  options.signal?.removeEventListener('abort', abort);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j && j.error) msg = j.error;
    } catch {
      /* keep fallback message */
    }
    throw new ApiError(res.status, msg);
  }
  return res.json();
}

export async function serverLogin(
  employeeId: string,
  password: string
): Promise<ServerLoginResult> {
  const url = await getServerUrl();
  if (!url) {
    return { ok: false, message: 'No sync server configured' };
  }
  try {
    const j = await api(url, '/api/login', {
      method: 'POST',
      body: { employee_id: employeeId, password },
    });
    const employee = j?.employee;
    if (
      !j?.token ||
      typeof employee?.employee_id !== 'string' ||
      typeof employee?.name !== 'string' ||
      !isRole(employee?.role)
    ) {
      throw new Error('Login server returned an invalid response');
    }
    await setToken(j.token);
    await saveSyncCredentials(employeeId, password);
    return {
      ok: true,
      message: 'Server login successful',
      employee: {
        employee_id: employee.employee_id,
        name: employee.name,
        role: employee.role,
      },
    };
  } catch (e) {
    await setToken('');
    return { ok: false, message: e instanceof Error ? e.message : 'Server login failed' };
  }
}

async function tryLogin(url: string, employeeId: string, password: string): Promise<boolean> {
  try {
    const j = await api(url, '/api/login', {
      method: 'POST',
      body: { employee_id: employeeId, password },
    });
    await setToken(j.token);
    return true;
  } catch {
    return false;
  }
}

export async function connectToServer(employee: {
  employee_id: string;
  name: string;
  password: string;
  role: string;
}): Promise<SyncResult> {
  const url = await getServerUrl();
  if (!url) {
    return { ok: false, message: 'No sync server configured' };
  }
  // Remember the credentials even if this attempt fails (e.g. logged in while
  // offline): the auto-sync engine uses them to recover the session later
  // without bothering the user.
  await saveSyncCredentials(employee.employee_id, employee.password);
  try {
    if (await tryLogin(url, employee.employee_id, employee.password)) {
      await saveSyncCredentials(employee.employee_id, employee.password);
      return { ok: true, message: 'Server login successful' };
    }
    await api(url, '/api/register', {
      method: 'POST',
      body: {
        employee_id: employee.employee_id,
        name: employee.name,
        password: employee.password,
        role: employee.role,
      },
    });
    if (await tryLogin(url, employee.employee_id, employee.password)) {
      await saveSyncCredentials(employee.employee_id, employee.password);
      return { ok: true, message: 'Registered and logged in to server' };
    }
    await setToken('');
    return { ok: false, message: 'Server login failed' };
  } catch (e) {
    await setToken('');
    return { ok: false, message: e instanceof Error ? e.message : 'Server connection failed' };
  }
}

export async function serverLogout(): Promise<void> {
  const url = await getServerUrl();
  const token = await getToken();
  if (url && token) {
    try {
      await api(url, '/api/logout', { method: 'POST', token });
    } catch {
      /* ignore */
    }
  }
  await setToken('');
  // Drop stored sync credentials too, so a different user logging in on this
  // device can never trigger an automatic re-login as the previous user.
  try {
    await Storage.removeItem(SYNC_CREDS_KEY);
  } catch {
    /* best-effort */
  }
}

interface ServerCheck {
  client_id: string;
  drawing_no: string;
  checked_by: string | null;
  checked_at: string;
  result: string;
  instrument: string;
  inspector_notes: string;
  inspector_name: string;
  measurements: Array<Record<string, unknown>>;
}

interface PushCounts {
  employees: number;
  drawings: number;
  dimensions: number;
  checks: number;
  dispatches: number;
  instruments: number;
  deletes: number;
}

function imagesDir(): Directory {
  const dir = new Directory(Paths.document, 'drawings');
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  return dir;
}

function isLocalImageUri(uri: string): boolean {
  const lower = uri.toLowerCase();
  return !lower.startsWith('http://') && !lower.startsWith('https://') && !lower.startsWith('data:') && !lower.startsWith('content://');
}

async function uploadPendingImages(
  db: SQLiteDatabase,
  url: string,
  token: string,
  options?: SyncOptions
): Promise<{ uploaded: number; failed: number }> {
  assertSyncActive(options);
  const rows = await db.getAllAsync<{ id: number; drawing_no: string; image_uri: string | null }>(
    `SELECT id, drawing_no, image_uri FROM drawings
     WHERE image_synced = 0 AND image_uri IS NOT NULL AND image_uri != ''`
  );
  let uploaded = 0;
  let failed = 0;
  for (const row of rows) {
    assertSyncActive(options);
    if (!row.image_uri || !isLocalImageUri(row.image_uri)) continue;
    try {
      const file = new File(row.image_uri);
      if (!file.exists) continue;
      const fileName = row.image_uri.split('/').pop() ?? 'drawing';
      const base64 = await file.base64();
      await api(url, '/api/upload', {
        method: 'POST',
        token,
        body: { drawing_no: row.drawing_no, filename: fileName,         data: base64 },
        ...(options?.signal ? { signal: options.signal } : {}),
      });
      assertSyncActive(options);
      await db.runAsync('UPDATE drawings SET image_synced = 1 WHERE id = ?', row.id);

      uploaded++;
    } catch {
      failed++;
    }
  }
  return { uploaded, failed };
}

async function buildPush(
  db: SQLiteDatabase
): Promise<{ payload: Record<string, unknown> | null; counts: PushCounts }> {
  const employees = await db.getAllAsync<{ employee_id: string; name: string; password: string; role: string }>(
    'SELECT employee_id, name, password, role FROM employees WHERE pending_sync = 1'
  );
  const drawings = await db.getAllAsync<Record<string, unknown>>(
    `SELECT d.drawing_no, d.part_name, d.customer, d.revision, d.material, d.unit, d.notes,
            d.invoice_no, d.invoice_date, d.drawing_rev_date, d.po_no, d.qty,
            d.treatment, d.hardness,
            (SELECT e.employee_id FROM employees e WHERE e.id = d.created_by) AS created_by
     FROM drawings d
     WHERE d.pending_sync = 1`
  );
  const dimensions = await db.getAllAsync<Record<string, unknown>>(
    `SELECT dw.drawing_no, d.dim_no, d.description, d.nominal, d.nominal_text, d.tol_upper, d.tol_lower
     FROM dimensions d
     JOIN drawings dw ON dw.id = d.drawing_id
     WHERE d.pending_sync = 1`
  );
  const checks = await db.getAllAsync<Record<string, unknown>>(
    `SELECT c.id AS local_id, c.client_id, c.checked_at, c.result, c.instrument,
            c.inspector_notes, c.inspector_name, dw.drawing_no,
            (SELECT e.employee_id FROM employees e WHERE e.id = c.checked_by) AS checked_by
     FROM checks c
     JOIN drawings dw ON dw.id = c.drawing_id
     WHERE c.pending_sync = 1`
  );
  const measurements = await db.getAllAsync<Record<string, unknown>>(
    `SELECT m.check_id AS local_check_id, d.dim_no,
            m.sample1, m.sample2, m.sample3, m.sample4, m.sample5,
            m.sample6, m.sample7, m.sample8, m.sample9, m.sample10, m.remarks, m.pass, m.instrument,
            m.sample_status
     FROM measurements m
     JOIN checks c ON c.id = m.check_id
     JOIN dimensions d ON d.id = m.dimension_id
     WHERE c.pending_sync = 1`
  );
  const dispatches = await db.getAllAsync<Record<string, unknown>>(
    `SELECT d.dispatch_no, d.drawing_no, d.part_name, d.po_no, d.invoice_no, d.qty,
            d.dispatched_at, d.notes,
            (SELECT e.employee_id FROM employees e WHERE e.id = d.dispatched_by) AS dispatched_by
     FROM dispatches d
     WHERE d.pending_sync = 1`
  );
  const tombstones = await db.getAllAsync<{ kind: string; ref: string }>(
    'SELECT kind, ref FROM sync_tombstones'
  );
  const instruments = await db.getAllAsync<{ name: string }>(
    'SELECT name FROM instruments WHERE pending_sync = 1'
  );

  const measureMap = new Map<number, Array<Record<string, unknown>>>();
  for (const m of measurements) {
    const key = Number(m.local_check_id);
    if (!measureMap.has(key)) {
      measureMap.set(key, []);
    }
    measureMap.get(key)!.push({
      dim_no: Math.round(Number(m.dim_no)),
      sample1: (m.sample1 as number | null) ?? null,
      sample2: (m.sample2 as number | null) ?? null,
      sample3: (m.sample3 as number | null) ?? null,
      sample4: (m.sample4 as number | null) ?? null,
      sample5: (m.sample5 as number | null) ?? null,
      sample6: (m.sample6 as number | null) ?? null,
      sample7: (m.sample7 as number | null) ?? null,
      sample8: (m.sample8 as number | null) ?? null,
      sample9: (m.sample9 as number | null) ?? null,
      sample10: (m.sample10 as number | null) ?? null,
      remarks: String(m.remarks ?? ''),
      pass: (m.pass as number) ?? 0,
      instrument: String(m.instrument ?? ''),
      sample_status: String(m.sample_status ?? ''),
    });
  }

  const checksPayload: ServerCheck[] = checks.map((c) => ({
    client_id: String(c.client_id ?? `CH-${c.local_id}`),
    drawing_no: String(c.drawing_no),
    checked_by: c.checked_by ? String(c.checked_by) : null,
    checked_at: String(c.checked_at),
    result: String(c.result),
    instrument: String(c.instrument ?? ''),
    inspector_notes: String(c.inspector_notes ?? ''),
    inspector_name: String(c.inspector_name ?? ''),
    measurements: measureMap.get(Number(c.local_id)) ?? [],
  }));

  const dimensionsPayload = dimensions.map((d) => ({
    drawing_no: String(d.drawing_no),
    // dim_no MUST be a whole number: the server column is integer and a
    // value like 10.1 used to make the whole push fail with HTTP 500,
    // leaving the app stuck on "Sync Failed".
    dim_no: Math.round(Number(d.dim_no)),
    description: String(d.description ?? ''),
    nominal: Number(d.nominal || 0),
    nominal_text: String(d.nominal_text ?? ''),
    tol_upper: Number(d.tol_upper || 0),
    tol_lower: Number(d.tol_lower || 0),
  }));

  const deletedEmployees: string[] = [];
  const deletedDrawings: string[] = [];
  const deletedDimensions: Array<{ drawing_no: string; dim_no: number }> = [];
  const deletedChecks: string[] = [];
  const deletedDispatches: string[] = [];
  const deletedInstruments: string[] = [];
  for (const t of tombstones) {
    if (t.kind === 'employee') deletedEmployees.push(t.ref);
    else if (t.kind === 'drawing') deletedDrawings.push(t.ref);
    else if (t.kind === 'dimension') {
      const [drawingNo, dimNo] = t.ref.split(':');
      deletedDimensions.push({ drawing_no: drawingNo, dim_no: Number(dimNo) });
    } else if (t.kind === 'check') deletedChecks.push(t.ref);
    else if (t.kind === 'dispatch') deletedDispatches.push(t.ref);
    else if (t.kind === 'instrument') deletedInstruments.push(t.ref);
  }

  const payload: Record<string, unknown> = {};
  if (employees.length > 0) payload.employees = employees;
  if (drawings.length > 0) payload.drawings = drawings;
  if (dimensionsPayload.length > 0) payload.dimensions = dimensionsPayload;
  if (checksPayload.length > 0) payload.checks = checksPayload;
  if (dispatches.length > 0) payload.dispatches = dispatches;
  if (instruments.length > 0) payload.instruments = instruments;
  if (deletedEmployees.length > 0) payload.deleted_employees = deletedEmployees;
  if (deletedDrawings.length > 0) payload.deleted_drawings = deletedDrawings;
  if (deletedDimensions.length > 0) payload.deleted_dimensions = deletedDimensions;
  if (deletedChecks.length > 0) payload.deleted_checks = deletedChecks;
  if (deletedDispatches.length > 0) payload.deleted_dispatches = deletedDispatches;
  if (deletedInstruments.length > 0) payload.deleted_instruments = deletedInstruments;

  const counts = {
    employees: employees.length,
    drawings: drawings.length,
    dimensions: dimensionsPayload.length,
    checks: checksPayload.length,
    dispatches: dispatches.length,
    instruments: instruments.length,
    deletes: deletedEmployees.length + deletedDrawings.length + deletedDimensions.length + deletedChecks.length + deletedDispatches.length + deletedInstruments.length,
  };

  return Object.keys(payload).length > 0
    ? { payload, counts }
    : { payload: null, counts };
}

async function markPushed(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    UPDATE employees SET pending_sync = 0 WHERE pending_sync = 1;
    UPDATE drawings SET pending_sync = 0 WHERE pending_sync = 1;
    UPDATE dimensions SET pending_sync = 0 WHERE pending_sync = 1;
    UPDATE checks SET pending_sync = 0 WHERE pending_sync = 1;
    UPDATE dispatches SET pending_sync = 0 WHERE pending_sync = 1;
    UPDATE instruments SET pending_sync = 0 WHERE pending_sync = 1;
    DELETE FROM sync_tombstones;
  `);
}

async function upsertEmployee(db: SQLiteDatabase, row: any): Promise<void> {
  const incomingPassword = String(row.password ?? '');
  const existing = await db.getFirstAsync<{ id: number; password: string }>(
    'SELECT id, password FROM employees WHERE UPPER(employee_id) = UPPER(?)',
    row.employee_id
  );
  if (existing) {
    // This device verifies sign-in with a plain-text comparison (see repo.login),
    // while the sync server seeds accounts with bcrypt hashes. Never let a hash
    // arriving from the server overwrite a password this device can still
    // verify - otherwise the user is locked out on this device.
    const keepLocal =
      !incomingPassword ||
      (isBcryptHash(incomingPassword) && !isBcryptHash(existing.password));
    await db.runAsync(
      `UPDATE employees SET name = ?, password = ?, role = ?, pending_sync = 0 WHERE id = ?`,
      String(row.name),
      keepLocal ? existing.password : incomingPassword,
      String(row.role ?? 'designer'),
      existing.id
    );
  } else {
    await db.runAsync(
      `INSERT INTO employees (employee_id, name, password, role, pending_sync) VALUES (?, ?, ?, ?, 0)`,
      String(row.employee_id).trim(),
      String(row.name),
      incomingPassword,
      String(row.role ?? 'designer')
    );
  }
}

async function upsertDrawing(db: SQLiteDatabase, row: any, empIdByServer: Map<number, number>): Promise<void> {
  const existing = await db.getFirstAsync<{ id: number; image_uri: string | null }>(
    'SELECT id, image_uri FROM drawings WHERE UPPER(drawing_no) = UPPER(?)',
    row.drawing_no
  );
  const createdBy = row.created_by ? empIdByServer.get(Number(row.created_by)) : undefined;
  const serverImage = String(row.image_uri || '');
  const nextImageUri = serverImage ? serverImage : (existing?.image_uri ?? null);
  if (existing) {
    await db.runAsync(
      `UPDATE drawings SET part_name = ?, customer = ?, revision = ?, material = ?, unit = ?, notes = ?,
         invoice_no = ?, invoice_date = ?, drawing_rev_date = ?, po_no = ?, qty = ?,
         treatment = ?, hardness = ?, image_uri = ?,
         created_by = ?, pending_sync = 0
       WHERE id = ?`,
      String(row.part_name ?? ''),
      String(row.customer ?? ''),
      String(row.revision ?? 'A'),
      String(row.material ?? ''),
      String(row.unit ?? 'mm'),
      String(row.notes ?? ''),
      String(row.invoice_no ?? ''),
      String(row.invoice_date ?? ''),
      String(row.drawing_rev_date ?? ''),
      String(row.po_no ?? ''),
      String(row.qty ?? ''),
      String(row.treatment ?? ''),
      String(row.hardness ?? ''),
      nextImageUri,
      createdBy ?? existing.id,
      existing.id
    );
  } else {
    await db.runAsync(
      `INSERT INTO drawings
         (drawing_no, part_name, customer, revision, material, unit, notes,
          invoice_no, invoice_date, drawing_rev_date, po_no, qty, treatment, hardness,
          image_uri, created_by, pending_sync, image_synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      String(row.drawing_no).trim(),
      String(row.part_name ?? ''),
      String(row.customer ?? ''),
      String(row.revision ?? 'A'),
      String(row.material ?? ''),
      String(row.unit ?? 'mm'),
      String(row.notes ?? ''),
      String(row.invoice_no ?? ''),
      String(row.invoice_date ?? ''),
      String(row.drawing_rev_date ?? ''),
      String(row.po_no ?? ''),
      String(row.qty ?? ''),
      String(row.treatment ?? ''),
      String(row.hardness ?? ''),
      nextImageUri,
      createdBy ?? 1,
      serverImage ? 0 : 1
    );
  }
}

async function upsertDimension(
  db: SQLiteDatabase,
  row: any,
  drawingIdByServer: Map<number, number>
): Promise<void> {
  const drawingId = row.drawing_id ? drawingIdByServer.get(Number(row.drawing_id)) : undefined;
  if (!drawingId) return;
  const existing = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM dimensions WHERE drawing_id = ? AND dim_no = ?',
    drawingId,
    Number(row.dim_no)
  );
  const values = {
    description: String(row.description ?? ''),
    nominal: Number(row.nominal || 0),
    nominal_text: String(row.nominal_text ?? ''),
    tol_upper: Number(row.tol_upper || 0),
    tol_lower: Number(row.tol_lower || 0),
  };
  if (existing) {
    await db.runAsync(
      `UPDATE dimensions SET description = ?, nominal = ?, nominal_text = ?, tol_upper = ?, tol_lower = ?, pending_sync = 0
       WHERE id = ?`,
      values.description,
      values.nominal,
      values.nominal_text,
      values.tol_upper,
      values.tol_lower,
      existing.id
    );
  } else {
    await db.runAsync(
      `INSERT INTO dimensions (drawing_id, dim_no, description, nominal, nominal_text, tol_upper, tol_lower, pending_sync)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      drawingId,
      Number(row.dim_no),
      values.description,
      values.nominal,
      values.nominal_text,
      values.tol_upper,
      values.tol_lower
    );
  }
}

async function upsertDispatch(
  db: SQLiteDatabase,
  row: any,
  drawingIdByServer: Map<number, number>,
  empIdByServer: Map<number, number>
): Promise<void> {
  const dispatchNo = String(row.dispatch_no);
  if (!dispatchNo) return;
  await ensureDispatchTable(db);
  const localDrawingId = row.drawing_id ? drawingIdByServer.get(Number(row.drawing_id)) : undefined;
  if (!localDrawingId) return;
  const dispatchedBy = row.dispatched_by ? empIdByServer.get(Number(row.dispatched_by)) : undefined;
  const existing = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM dispatches WHERE dispatch_no = ?',
    dispatchNo
  );
  if (existing) {
    await db.runAsync(
      `UPDATE dispatches SET drawing_id = ?, drawing_no = ?, part_name = ?, po_no = ?, invoice_no = ?,
         qty = ?, dispatched_by = ?, dispatched_at = ?, notes = ?, pending_sync = 0
       WHERE id = ?`,
      localDrawingId,
      String(row.drawing_no ?? ''),
      String(row.part_name ?? ''),
      String(row.po_no ?? ''),
      String(row.invoice_no ?? ''),
      String(row.qty ?? ''),
      dispatchedBy ?? existing.id,
      String(row.dispatched_at),
      String(row.notes ?? ''),
      existing.id
    );
  } else {
    await db.runAsync(
      `INSERT INTO dispatches
         (dispatch_no, drawing_id, drawing_no, part_name, po_no, invoice_no, qty,
          dispatched_by, dispatched_at, notes, pending_sync)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      dispatchNo,
      localDrawingId,
      String(row.drawing_no ?? ''),
      String(row.part_name ?? ''),
      String(row.po_no ?? ''),
      String(row.invoice_no ?? ''),
      String(row.qty ?? ''),
      dispatchedBy ?? 1,
      String(row.dispatched_at),
      String(row.notes ?? '')
    );
  }
}

async function applyPull(
  db: SQLiteDatabase,
  data: any,
  url: string,
  options?: SyncOptions
): Promise<number> {
  assertSyncActive(options);
  let received = 0;
  const empIdByServer = new Map<number, number>();
  for (const row of data.employees ?? []) {
    assertSyncActive(options);
    await upsertEmployee(db, row);
    received++;
    const local = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM employees WHERE UPPER(employee_id) = UPPER(?)',
      row.employee_id
    );
    if (local) empIdByServer.set(Number(row.id), local.id);
  }

  const drawingIdByServer = new Map<number, number>();
  for (const row of data.drawings ?? []) {
    assertSyncActive(options);
    await upsertDrawing(db, row, empIdByServer);
    received++;
    const local = await db.getFirstAsync<{ id: number; image_uri: string | null }>(
      'SELECT id, image_uri FROM drawings WHERE UPPER(drawing_no) = UPPER(?)',
      row.drawing_no
    );
    if (local) {
      drawingIdByServer.set(Number(row.id), local.id);
      const serverImage = String(row.image_uri || '');
      if (serverImage.startsWith('/uploads/')) {
        try {
          const fileName = serverImage.split('/').pop() ?? '';
          const dest = new File(imagesDir(), fileName);
          if (!dest.exists) {
            await File.downloadFileAsync(url + serverImage, dest);
          }
          if (dest.exists) {
            await db.runAsync(
              'UPDATE drawings SET image_uri = ?, image_synced = 1 WHERE id = ?',
              dest.uri,
              local.id
            );
          }
        } catch {
          // image download failed; keep whatever is stored locally
        }
      } else if (!serverImage && local.image_uri && isLocalImageUri(local.image_uri)) {
        await db.runAsync('UPDATE drawings SET image_synced = 0 WHERE id = ?', local.id);
      }
    }
  }

  for (const row of data.dimensions ?? []) {
    assertSyncActive(options);
    await upsertDimension(db, row, drawingIdByServer);
    received++;
  }

  const dimIdByServer = new Map<number, number>();
  for (const row of data.dimensions ?? []) {
    assertSyncActive(options);
    const localDrawingId = row.drawing_id ? drawingIdByServer.get(Number(row.drawing_id)) : undefined;
    if (!localDrawingId) continue;
    const localDim = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM dimensions WHERE drawing_id = ? AND dim_no = ?',
      localDrawingId,
      Number(row.dim_no)
    );
    if (localDim) dimIdByServer.set(Number(row.id), localDim.id);
  }

  const checkIdByClient = new Map<string, number>();
  for (const row of data.checks ?? []) {
    assertSyncActive(options);
    const clientId = String(row.client_id);
    const drawingId = row.drawing_id ? drawingIdByServer.get(Number(row.drawing_id)) : undefined;
    const checkedBy = row.checked_by ? empIdByServer.get(Number(row.checked_by)) : undefined;
    const existing = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM checks WHERE client_id = ?',
      clientId
    );
    if (existing) {
      await db.runAsync(
        `UPDATE checks SET drawing_id = ?, checked_by = ?, checked_at = ?, result = ?, instrument = ?,
           inspector_notes = ?, inspector_name = ?, pending_sync = 0
         WHERE id = ?`,
        drawingId ?? existing.id,
        checkedBy ?? existing.id,
        String(row.checked_at),
        String(row.result),
        String(row.instrument ?? ''),
        String(row.inspector_notes ?? ''),
        String(row.inspector_name ?? ''),
        existing.id
      );
      checkIdByClient.set(clientId, existing.id);
    } else {
      const insert = await db.runAsync(
        `INSERT INTO checks (client_id, drawing_id, checked_by, checked_at, result, instrument,
           inspector_notes, inspector_name, pending_sync)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        clientId,
        drawingId ?? 1,
        checkedBy ?? 1,
        String(row.checked_at),
        String(row.result),
        String(row.instrument ?? ''),
        String(row.inspector_notes ?? ''),
        String(row.inspector_name ?? '')
      );
      checkIdByClient.set(clientId, insert.lastInsertRowId);
    }
    received++;
  }

  for (const row of data.checks ?? []) {
    assertSyncActive(options);
    const clientId = String(row.client_id);
    const localCheckId = checkIdByClient.get(clientId);
    if (!localCheckId) continue;
    await db.runAsync('DELETE FROM measurements WHERE check_id = ?', localCheckId);
    const serverCheckId = Number(row.id);
    for (const m of data.measurements ?? []) {
      if (Number(m.check_id) !== serverCheckId) continue;
      const localDimId = dimIdByServer.get(Number(m.dimension_id));
      if (!localDimId) continue;
      await db.runAsync(
        `INSERT INTO measurements
           (check_id, dimension_id, sample1, sample2, sample3, sample4, sample5,
            sample6, sample7, sample8, sample9, sample10, remarks, pass, instrument, sample_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        localCheckId,
        localDimId,
        m.sample1 ?? null,
        m.sample2 ?? null,
        m.sample3 ?? null,
        m.sample4 ?? null,
        m.sample5 ?? null,
        m.sample6 ?? null,
        m.sample7 ?? null,
        m.sample8 ?? null,
        m.sample9 ?? null,
        m.sample10 ?? null,
        String(m.remarks ?? ''),
        m.pass ? 1 : 0,
        String(m.instrument ?? ''),
        String(m.sample_status ?? '')
      );
      const inst = m.instrument != null ? String(m.instrument) : '';
      if (inst) {
        const safe = inst.replace(/'/g, "''");
        await db.execAsync(
          `UPDATE measurements SET instrument = '${safe}' WHERE check_id = ${localCheckId} AND dimension_id = ${localDimId}`
        );
      }
      received++;
    }
  }

  for (const row of data.dispatches ?? []) {
    assertSyncActive(options);
    await upsertDispatch(db, row, drawingIdByServer, empIdByServer);
    received++;
  }

  for (const row of data.instruments ?? []) {
    assertSyncActive(options);
    if (!row || !row.name) continue;
    await db.runAsync(
      'INSERT OR IGNORE INTO instruments (name, pending_sync) VALUES (?, 0)',
      String(row.name)
    );
    received++;
  }

  for (const empId of data.deleted_employees ?? []) {
    assertSyncActive(options);
    try {
      await db.runAsync('DELETE FROM employees WHERE UPPER(employee_id) = UPPER(?)', String(empId));
      received++;
    } catch {
      // employee may still be referenced locally; skip hard delete
    }
  }
  for (const drawingNo of data.deleted_drawings ?? []) {
    assertSyncActive(options);
    const local = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM drawings WHERE UPPER(drawing_no) = UPPER(?)',
      String(drawingNo)
    );
    if (!local) continue;
    await db.runAsync(
      'DELETE FROM measurements WHERE check_id IN (SELECT id FROM checks WHERE drawing_id = ?)',
      local.id
    );
    await db.runAsync('DELETE FROM checks WHERE drawing_id = ?', local.id);
    await db.runAsync('DELETE FROM dimensions WHERE drawing_id = ?', local.id);
    await db.runAsync('DELETE FROM dispatches WHERE drawing_id = ?', local.id);
    await db.runAsync('DELETE FROM drawings WHERE id = ?', local.id);
    received++;
  }
  for (const dimKey of data.deleted_dimensions ?? []) {
    assertSyncActive(options);
    if (!dimKey) continue;
    const local = await db.getFirstAsync<{ id: number }>(
      `SELECT d.id FROM dimensions d JOIN drawings dw ON dw.id = d.drawing_id
       WHERE dw.drawing_no = ? AND d.dim_no = ?`,
      String(dimKey.drawing_no),
      Number(dimKey.dim_no)
    );
    if (!local) continue;
    await db.runAsync('DELETE FROM measurements WHERE dimension_id = ?', local.id);
    await db.runAsync('DELETE FROM dimensions WHERE id = ?', local.id);
    received++;
  }
  for (const clientId of data.deleted_checks ?? []) {
    assertSyncActive(options);
    const local = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM checks WHERE client_id = ?',
      String(clientId)
    );
    if (!local) continue;
    await db.runAsync('DELETE FROM measurements WHERE check_id = ?', local.id);
    await db.runAsync('DELETE FROM checks WHERE id = ?', local.id);
    received++;
  }
  for (const dispatchNo of data.deleted_dispatches ?? []) {
    assertSyncActive(options);
    const local = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM dispatches WHERE dispatch_no = ?',
      String(dispatchNo)
    );
    if (!local) continue;
    await db.runAsync('DELETE FROM dispatches WHERE id = ?', local.id);
    received++;
  }
  for (const name of data.deleted_instruments ?? []) {
    assertSyncActive(options);
    await db.runAsync(
      'DELETE FROM instruments WHERE UPPER(name) = UPPER(?) AND pending_sync = 0',
      String(name)
    );
    received++;
  }
  return received;
}

let syncChain: Promise<void> = Promise.resolve();

function withSyncLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = syncChain.then(operation, operation);
  syncChain = result.then(() => undefined, () => undefined);
  return result;
}

async function performSync(db: SQLiteDatabase, options: SyncOptions = {}): Promise<SyncResult> {
  try {
    assertSyncActive(options);
    const url = await getServerUrl();
    assertSyncActive(options);
    if (!url) {
      return { ok: false, message: 'No sync server configured' };
    }
    let token = await getToken();
    let recovered = false;
    assertSyncActive(options);
    if (!token) {
      // No session on this device (fresh install, cleared storage): log in
      // again with the stored credentials instead of stalling forever.
      token = (await ensureServerSession()) ? await getToken() : '';
      if (!token) {
        return { ok: false, message: 'Not logged in to sync server. Open the app while online once to reconnect.' };
      }
      recovered = true;
    }

    // Runs an authenticated call; on 401 (expired/invalidated server session)
    // it re-logs-in once and retries, so a server restart never leaves the
    // app permanently stuck on "Sync failed".
    const callWithRecovery = async (run: (tok: string) => Promise<any>): Promise<any> => {
      try {
        return await run(token);
      } catch (e) {
        if (!(e instanceof ApiError) || (e.status !== 401 && e.status !== 403)) throw e;
        assertSyncActive(options);
        if (!(await ensureServerSession())) {
          throw new Error('Sync session expired and re-login failed. Check the server address and your credentials.');
        }
        recovered = true;
        token = (await getToken()) || token;
        assertSyncActive(options);
        return run(token);
      }
    };

    const built = await buildPush(db);
    assertSyncActive(options);
    if (built.payload) {
      await callWithRecovery((tok) =>
        api(url, '/api/sync/push', {
          method: 'POST',
          token: tok,
          body: built.payload,
          ...(options.signal ? { signal: options.signal } : {}),
        })
      );
      assertSyncActive(options);
      await markPushed(db);
    }
    const images = await uploadPendingImages(db, url, token, options);
    assertSyncActive(options);
    const data = await callWithRecovery((tok) =>
      api(url, '/api/sync/pull', {
        method: 'GET',
        token: tok,
        ...(options.signal ? { signal: options.signal } : {}),
      })
    );
    assertSyncActive(options);
    const received = await applyPull(db, data, url, options);
    assertSyncActive(options);
    const pushed =
      (built.counts.employees ?? 0) +
      (built.counts.drawings ?? 0) +
      (built.counts.dimensions ?? 0) +
      (built.counts.checks ?? 0) +
      (built.counts.dispatches ?? 0) +
      (built.counts.instruments ?? 0) +
      (built.counts.deletes ?? 0);
    const imgNote = images.failed > 0 ? `, ${images.failed} image(s) failed` : `, ${images.uploaded} image(s) uploaded`;
    const msg = `Synced at ${new Date().toLocaleTimeString()}: uploaded ${pushed}, downloaded ${received}${imgNote}`;
    await setSyncStatus(msg);
    return { ok: true, message: msg, recovered };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Sync failed';
    if (msg === SYNC_CANCELLED_MESSAGE) {
      return { ok: false, message: SYNC_CANCELLED_MESSAGE };
    }
    const failure = `Sync failed: ${msg}`;
    // Surface the real reason: keep it in the stored status (shown by SyncBar)
    // and in the Metro/device console so failures are diagnosable.
    console.log('[SYNC]', failure);
    try {
      await setSyncStatus(failure);
    } catch {
      /* status storage is best-effort */
    }
    return { ok: false, message: failure };
  }
}

export function syncNow(db: SQLiteDatabase, options: SyncOptions = {}): Promise<SyncResult> {
  return withSyncLock(() => performSync(db, options));
}

async function applyServerPushUnlocked(db: SQLiteDatabase, payload: any): Promise<void> {
  if (!autoSyncSchedulingEnabled) return;
  const url = await getServerUrl();
  if (!url) return;
  try {
    const received = await applyPull(db, payload, url, {
      shouldContinue: () => autoSyncSchedulingEnabled,
    });
    if (!autoSyncSchedulingEnabled) return;
    await setSyncStatus(`Live update at ${new Date().toLocaleTimeString()}: received ${received}`);
  } catch {
    if (!autoSyncSchedulingEnabled) return;
    await performSync(db, { shouldContinue: () => autoSyncSchedulingEnabled }).catch(() => {});
  }
}

export function applyServerPush(db: SQLiteDatabase, payload: any): Promise<void> {
  if (!payload || typeof payload !== 'object' || !autoSyncSchedulingEnabled) return Promise.resolve();
  return withSyncLock(() => applyServerPushUnlocked(db, payload));
}

let autoSyncTimer: ReturnType<typeof setTimeout> | null = null;
let autoSyncSchedulingEnabled = false;
let autoSyncGeneration = 0;

export function setAutoSyncEnabled(enabled: boolean): void {
  if (autoSyncSchedulingEnabled === enabled) return;
  autoSyncSchedulingEnabled = enabled;
  autoSyncGeneration++;
  if (!enabled && autoSyncTimer) {
    clearTimeout(autoSyncTimer);
    autoSyncTimer = null;
  }
}

export function isAutoSyncEnabled(): boolean {
  return autoSyncSchedulingEnabled;
}

export function scheduleAutoSync(db: SQLiteDatabase): void {
  if (!autoSyncSchedulingEnabled) return;
  if (autoSyncTimer) {
    clearTimeout(autoSyncTimer);
  }
  const generation = autoSyncGeneration;
  autoSyncTimer = setTimeout(() => {
    autoSyncTimer = null;
    if (autoSyncSchedulingEnabled && generation === autoSyncGeneration) {
      syncNow(db, {
        shouldContinue: () => autoSyncSchedulingEnabled && generation === autoSyncGeneration,
      }).catch(() => {});
    }
  }, 1500);
}
