import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import {
  pool,
  query,
  withTransaction,
  initDatabase,
  checkDbHealth,
  hashPassword,
  verifyPassword,
} from './db.js';
import { backupToGoogleDrive, getLastBackupInfo, getAuthUrl, exchangeAuthCode, getOAuthTokens, clearOAuthTokens } from './services/googleDriveBackupService.js';
import { startAutoBackupScheduler } from './services/autoBackupScheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, 'data', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(uploadsDir));

// Logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    const ms = Date.now() - start;
    if (req.path.startsWith('/api/')) {
      const summary = typeof body === 'object' ? JSON.stringify(body).substring(0, 140) : '';
      console.log(`[REQ] ${req.method} ${req.path} ${res.statusCode} ${ms}ms ${summary}`);
    }
    return originalJson(body);
  };
  next();
});

const DEFAULT_PORT = Number(process.env.PORT || 4000);

const httpServer = createServer(app);
export const io = new Server(httpServer, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
});

function now() {
  return new Date().toISOString();
}

function sanitizeFileName(name) {
  const cleaned = String(name || '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[._-]+/, '');
  return cleaned || 'drawing';
}

// ---------------------------------------------------------------------------
// Authentication & Authorization Middleware
// ---------------------------------------------------------------------------
export async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing token' });
  }

  try {
    const sessionRes = await query(
      `SELECT s.token, s.employee_id, e.id, e.name, e.role
       FROM sessions s
       JOIN employees e ON e.id = s.employee_id
       WHERE s.token = $1 AND e.deleted = 0`,
      [token]
    );

    if (sessionRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const row = sessionRes.rows[0];
    req.employeeId = row.employee_id;
    req.user = {
      id: row.id,
      employee_id: row.employee_id,
      name: row.name,
      role: row.role,
    };
    next();
  } catch (err) {
    return res.status(500).json({ error: `Auth error: ${err.message}` });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    auth(req, res, () => {
      if (!req.user || !roles.includes(req.user.role)) {
        return res.status(403).json({ error: `Access denied. Requires role: ${roles.join(' or ')}` });
      }
      next();
    });
  };
}

export const adminAuth = requireRole('admin');

// Socket.IO authentication
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error('Missing token'));
  }
  try {
    const sessionRes = await query(
      `SELECT s.employee_id FROM sessions s
       JOIN employees e ON e.id = s.employee_id
       WHERE s.token = $1 AND e.deleted = 0`,
      [String(token)]
    );
    if (sessionRes.rows.length === 0) {
      return next(new Error('Invalid token'));
    }
    socket.employeeId = sessionRes.rows[0].employee_id;
    next();
  } catch (err) {
    return next(new Error('Socket auth failed'));
  }
});

io.on('connection', async (socket) => {
  try {
    const payload = await buildPullPayload();
    socket.emit('sync:data', payload);
  } catch (err) {
    console.error('[SOCKET] Error emitting initial sync payload:', err.message);
  }
});

export async function pushData() {
  try {
    const payload = await buildPullPayload();
    io.emit('sync:data', payload);
  } catch (err) {
    console.error('[PUSH] Error broadcasting sync data:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Health & Diagnostics
// ---------------------------------------------------------------------------
app.get('/api/health', async (req, res) => {
  try {
    const dbHealth = await checkDbHealth();
    res.json({
      ok: true,
      time: now(),
      database: dbHealth,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: `Database unavailable: ${err.message}`,
      time: now(),
    });
  }
});

// ---------------------------------------------------------------------------
// Authentication Endpoints
// ---------------------------------------------------------------------------
app.post('/api/login', async (req, res) => {
  const { employee_id, password } = req.body || {};
  if (!employee_id || !password) {
    return res.status(400).json({ error: 'employee_id and password are required' });
  }

  try {
    const empRes = await query(
      `SELECT * FROM employees WHERE UPPER(employee_id) = UPPER($1) AND deleted = 0`,
      [String(employee_id).trim()]
    );

    if (empRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const emp = empRes.rows[0];
    const passwordMatch = verifyPassword(String(password), emp.password);

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Transparent upgrade: if password was stored in plain text, hash it now with bcrypt
    if (!emp.password.startsWith('$2a$') && !emp.password.startsWith('$2b$')) {
      const secureHash = hashPassword(String(password));
      await query('UPDATE employees SET password = $1 WHERE id = $2', [secureHash, emp.id]);
    }

    const token = crypto.randomBytes(32).toString('hex');
    await query('INSERT INTO sessions (token, employee_id) VALUES ($1, $2)', [token, emp.id]);

    res.json({
      token,
      employee: {
        id: emp.id,
        employee_id: emp.employee_id,
        name: emp.name,
        role: emp.role,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/register', async (req, res) => {
  const { employee_id, name, password, role } = req.body || {};
  if (!employee_id || !name) {
    return res.status(400).json({ error: 'employee_id and name are required' });
  }
  const empRole = ['admin', 'designer', 'qc'].includes(role) ? role : 'designer';
  const hashedPassword = password ? hashPassword(String(password)) : hashPassword('1234');

  try {
    await query(
      `INSERT INTO employees (employee_id, name, password, role, deleted, updated_at)
       VALUES ($1, $2, $3, $4, 0, CURRENT_TIMESTAMP)
       ON CONFLICT (employee_id) DO UPDATE SET
         name = EXCLUDED.name,
         password = EXCLUDED.password,
         role = EXCLUDED.role,
         deleted = 0,
         updated_at = CURRENT_TIMESTAMP`,
      [String(employee_id).trim().toUpperCase(), String(name).trim(), hashedPassword, empRole]
    );

    await pushData();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/logout', auth, async (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  try {
    await query('DELETE FROM sessions WHERE token = $1', [token]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/me', auth, (req, res) => {
  res.json({ employee: req.user });
});

// ---------------------------------------------------------------------------
// Drawings Endpoints (REST CRUD)
// ---------------------------------------------------------------------------
app.get('/api/drawings', auth, async (req, res) => {
  try {
    const { search } = req.query;
    let sql = `
      SELECT d.*, e.name AS designer_name,
        (SELECT COUNT(*)::int FROM dimensions x WHERE x.drawing_id = d.id AND x.deleted = 0) AS dim_count,
        (SELECT COUNT(DISTINCT m.dimension_id)::int
           FROM measurements m
           JOIN checks c ON c.id = m.check_id
          WHERE c.drawing_id = d.id AND c.deleted = 0) AS checked_dim_count
      FROM drawings d
      LEFT JOIN employees e ON e.id = d.created_by
      WHERE d.deleted = 0
    `;
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (d.drawing_no ILIKE $1 OR d.part_name ILIKE $1 OR d.customer ILIKE $1)`;
    }
    sql += ` ORDER BY d.created_at DESC`;

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drawings/:id', auth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid drawing ID' });

  try {
    const dwRes = await query(
      `SELECT d.*, e.name AS designer_name,
        (SELECT COUNT(*)::int FROM dimensions x WHERE x.drawing_id = d.id AND x.deleted = 0) AS dim_count
       FROM drawings d
       LEFT JOIN employees e ON e.id = d.created_by
       WHERE d.id = $1 AND d.deleted = 0`,
      [id]
    );

    if (dwRes.rows.length === 0) {
      return res.status(404).json({ error: 'Drawing not found' });
    }

    const dimsRes = await query(
      `SELECT * FROM dimensions WHERE drawing_id = $1 AND deleted = 0 ORDER BY dim_no ASC`,
      [id]
    );

    res.json({
      ...dwRes.rows[0],
      dimensions: dimsRes.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/drawings', auth, async (req, res) => {
  const {
    drawing_no,
    part_name,
    customer = '',
    revision = 'A',
    material = '',
    unit = 'mm',
    notes = '',
    invoice_no = '',
    invoice_date = '',
    drawing_rev_date = '',
    po_no = '',
    qty = '',
    treatment = '',
    hardness = '',
    image_uri = null,
  } = req.body || {};

  if (!drawing_no || !part_name) {
    return res.status(400).json({ error: 'drawing_no and part_name are required' });
  }

  try {
    const insertRes = await query(
      `INSERT INTO drawings (
         drawing_no, part_name, customer, revision, material, unit, notes,
         invoice_no, invoice_date, drawing_rev_date, po_no, qty, treatment, hardness,
         image_uri, created_by, created_at, updated_at, deleted
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0)
       RETURNING *`,
      [
        String(drawing_no).trim(),
        String(part_name).trim(),
        String(customer),
        String(revision),
        String(material),
        String(unit),
        String(notes),
        String(invoice_no),
        String(invoice_date),
        String(drawing_rev_date),
        String(po_no),
        String(qty),
        String(treatment),
        String(hardness),
        image_uri,
        req.user.id,
      ]
    );

    await pushData();
    res.status(201).json(insertRes.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: `Drawing number "${drawing_no}" already exists` });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/drawings/:id', auth, async (req, res) => {
  const id = Number(req.params.id);
  const {
    part_name,
    customer,
    revision,
    material,
    unit,
    notes,
    invoice_no,
    invoice_date,
    drawing_rev_date,
    po_no,
    qty,
    treatment,
    hardness,
    image_uri,
  } = req.body || {};

  try {
    const updateRes = await query(
      `UPDATE drawings SET
         part_name = COALESCE($1, part_name),
         customer = COALESCE($2, customer),
         revision = COALESCE($3, revision),
         material = COALESCE($4, material),
         unit = COALESCE($5, unit),
         notes = COALESCE($6, notes),
         invoice_no = COALESCE($7, invoice_no),
         invoice_date = COALESCE($8, invoice_date),
         drawing_rev_date = COALESCE($9, drawing_rev_date),
         po_no = COALESCE($10, po_no),
         qty = COALESCE($11, qty),
         treatment = COALESCE($12, treatment),
         hardness = COALESCE($13, hardness),
         image_uri = COALESCE($14, image_uri),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $15 AND deleted = 0
       RETURNING *`,
      [
        part_name, customer, revision, material, unit, notes,
        invoice_no, invoice_date, drawing_rev_date, po_no, qty, treatment, hardness,
        image_uri, id
      ]
    );

    if (updateRes.rows.length === 0) {
      return res.status(404).json({ error: 'Drawing not found' });
    }

    await pushData();
    res.json(updateRes.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/drawings/:id', auth, async (req, res) => {
  const id = Number(req.params.id);
  try {
    await withTransaction(async (client) => {
      await client.query('UPDATE drawings SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
      await client.query('UPDATE dimensions SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE drawing_id = $1', [id]);
      await client.query('UPDATE checks SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE drawing_id = $1', [id]);
      await client.query('UPDATE dispatches SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE drawing_id = $1', [id]);
    });

    await pushData();
    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Dimensions Endpoints (REST CRUD)
// ---------------------------------------------------------------------------
app.get('/api/drawings/:id/dimensions', auth, async (req, res) => {
  const drawingId = Number(req.params.id);
  try {
    const result = await query(
      `SELECT * FROM dimensions WHERE drawing_id = $1 AND deleted = 0 ORDER BY dim_no ASC`,
      [drawingId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/drawings/:id/dimensions', auth, async (req, res) => {
  const drawingId = Number(req.params.id);
  const { dim_no, description = '', nominal, nominal_text = '', tol_upper = 0, tol_lower = 0 } = req.body || {};

  if (dim_no == null || nominal == null) {
    return res.status(400).json({ error: 'dim_no and nominal are required' });
  }

  try {
    const insertRes = await query(
      `INSERT INTO dimensions (drawing_id, dim_no, description, nominal, nominal_text, tol_upper, tol_lower, deleted, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0, CURRENT_TIMESTAMP)
       ON CONFLICT (drawing_id, dim_no) DO UPDATE SET
         description = EXCLUDED.description,
         nominal = EXCLUDED.nominal,
         nominal_text = EXCLUDED.nominal_text,
         tol_upper = EXCLUDED.tol_upper,
         tol_lower = EXCLUDED.tol_lower,
         deleted = 0,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [drawingId, Number(dim_no), String(description), Number(nominal), String(nominal_text), Number(tol_upper), Number(tol_lower)]
    );

    await pushData();
    res.status(201).json(insertRes.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/dimensions/:id', auth, async (req, res) => {
  const id = Number(req.params.id);
  try {
    await query('UPDATE dimensions SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
    await pushData();
    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Quality Checks & Inspections Endpoints (REST CRUD)
// ---------------------------------------------------------------------------
app.get('/api/checks', auth, async (req, res) => {
  const { drawing_id } = req.query;
  try {
    let sql = `
      SELECT c.*, d.drawing_no, d.part_name, e.name AS inspector_user
      FROM checks c
      JOIN drawings d ON d.id = c.drawing_id
      LEFT JOIN employees e ON e.id = c.checked_by
      WHERE c.deleted = 0
    `;
    const params = [];
    if (drawing_id) {
      params.push(Number(drawing_id));
      sql += ` AND c.drawing_id = $1`;
    }
    sql += ` ORDER BY c.checked_at DESC`;

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/checks/:id', auth, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const checkRes = await query(
      `SELECT c.*, d.drawing_no, d.part_name, e.name AS inspector_user
       FROM checks c
       JOIN drawings d ON d.id = c.drawing_id
       LEFT JOIN employees e ON e.id = c.checked_by
       WHERE c.id = $1 AND c.deleted = 0`,
      [id]
    );

    if (checkRes.rows.length === 0) {
      return res.status(404).json({ error: 'Inspection check not found' });
    }

    const measurementsRes = await query(
      `SELECT m.*, dm.dim_no, dm.description, dm.nominal, dm.nominal_text, dm.tol_upper, dm.tol_lower
       FROM measurements m
       JOIN dimensions dm ON dm.id = m.dimension_id
       WHERE m.check_id = $1
       ORDER BY dm.dim_no ASC`,
      [id]
    );

    res.json({
      ...checkRes.rows[0],
      measurements: measurementsRes.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/checks', auth, async (req, res) => {
  const {
    client_id,
    drawing_id,
    result = 'PASS',
    instrument = '',
    inspector_notes = '',
    inspector_name = '',
    measurements = [],
  } = req.body || {};

  if (!drawing_id) {
    return res.status(400).json({ error: 'drawing_id is required' });
  }

  const clientId = client_id || `CHK-${Date.now()}-${Math.floor(Math.random() * 0xffff).toString(16)}`;

  try {
    const check = await withTransaction(async (client) => {
      const checkRes = await client.query(
        `INSERT INTO checks (
           client_id, drawing_id, checked_by, checked_at, result,
           instrument, inspector_notes, inspector_name, deleted, updated_at
         ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, $5, $6, $7, 0, CURRENT_TIMESTAMP)
         ON CONFLICT (client_id) DO UPDATE SET
           result = EXCLUDED.result,
           instrument = EXCLUDED.instrument,
           inspector_notes = EXCLUDED.inspector_notes,
           inspector_name = EXCLUDED.inspector_name,
           deleted = 0,
           updated_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [clientId, Number(drawing_id), req.user.id, result, instrument, inspector_notes, inspector_name]
      );

      const checkId = checkRes.rows[0].id;
      await client.query('DELETE FROM measurements WHERE check_id = $1', [checkId]);

      for (const m of measurements) {
        if (!m.dimension_id) continue;
        await client.query(
          `INSERT INTO measurements (
             check_id, dimension_id, sample1, sample2, sample3, sample4, sample5,
             sample6, sample7, sample8, sample9, sample10, remarks, pass, instrument, sample_status
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [
            checkId,
            Number(m.dimension_id),
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
            String(m.remarks || ''),
            m.pass ? 1 : 0,
            String(m.instrument || ''),
            String(m.sample_status || ''),
          ]
        );
      }

      return checkRes.rows[0];
    });

    await pushData();
    res.status(201).json(check);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/checks/:id', auth, async (req, res) => {
  const id = Number(req.params.id);
  try {
    await query('UPDATE checks SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
    await pushData();
    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Dispatches Endpoints (REST CRUD)
// ---------------------------------------------------------------------------
app.get('/api/dispatches', auth, async (req, res) => {
  try {
    const result = await query(
      `SELECT dp.*, e.name AS dispatcher_name
       FROM dispatches dp
       LEFT JOIN employees e ON e.id = dp.dispatched_by
       WHERE dp.deleted = 0
       ORDER BY dp.dispatched_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/dispatches', auth, async (req, res) => {
  const {
    dispatch_no,
    drawing_id,
    drawing_no = '',
    part_name = '',
    po_no = '',
    invoice_no = '',
    qty = '',
    notes = '',
  } = req.body || {};

  if (!dispatch_no || !drawing_id) {
    return res.status(400).json({ error: 'dispatch_no and drawing_id are required' });
  }

  try {
    const insertRes = await query(
      `INSERT INTO dispatches (
         dispatch_no, drawing_id, drawing_no, part_name, po_no,
         invoice_no, qty, dispatched_by, dispatched_at, notes, deleted, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, $9, 0, CURRENT_TIMESTAMP)
       ON CONFLICT (dispatch_no) DO UPDATE SET
         drawing_id = EXCLUDED.drawing_id,
         drawing_no = EXCLUDED.drawing_no,
         part_name = EXCLUDED.part_name,
         po_no = EXCLUDED.po_no,
         invoice_no = EXCLUDED.invoice_no,
         qty = EXCLUDED.qty,
         notes = EXCLUDED.notes,
         deleted = 0,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        String(dispatch_no).trim(),
        Number(drawing_id),
        String(drawing_no),
        String(part_name),
        String(po_no),
        String(invoice_no),
        String(qty),
        req.user.id,
        String(notes),
      ]
    );

    await pushData();
    res.status(201).json(insertRes.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/dispatches/:id', auth, async (req, res) => {
  const id = Number(req.params.id);
  try {
    await query('UPDATE dispatches SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
    await pushData();
    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Instruments Endpoints (REST CRUD)
// ---------------------------------------------------------------------------
app.get('/api/instruments', auth, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, name FROM instruments WHERE deleted = 0 ORDER BY name ASC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/instruments', auth, async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Instrument name is required' });
  }
  try {
    const result = await query(
      `INSERT INTO instruments (name, deleted, updated_at)
       VALUES ($1, 0, CURRENT_TIMESTAMP)
       ON CONFLICT (name) DO UPDATE SET deleted = 0, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [name.trim()]
    );
    await pushData();
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/instruments/:id', auth, async (req, res) => {
  const id = Number(req.params.id);
  try {
    await query('UPDATE instruments SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
    await pushData();
    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Employees Endpoints (Admin only)
// ---------------------------------------------------------------------------
app.get('/api/employees', adminAuth, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, employee_id, name, role, created_at, updated_at
       FROM employees
       WHERE deleted = 0
       ORDER BY name ASC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/employees', adminAuth, async (req, res) => {
  const { employee_id, name, password, role } = req.body || {};
  if (!employee_id || !name || !password) {
    return res.status(400).json({ error: 'employee_id, name, and password are required' });
  }
  const empRole = ['admin', 'designer', 'qc'].includes(role) ? role : 'designer';
  try {
    const hashed = hashPassword(String(password));
    const result = await query(
      `INSERT INTO employees (employee_id, name, password, role, deleted, updated_at)
       VALUES ($1, $2, $3, $4, 0, CURRENT_TIMESTAMP)
       RETURNING id, employee_id, name, role, created_at`,
      [employee_id.trim().toUpperCase(), name.trim(), hashed, empRole]
    );
    await pushData();
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Employee ID already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/employees/:id', adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { name, password, role } = req.body || {};
  try {
    let sql = 'UPDATE employees SET updated_at = CURRENT_TIMESTAMP';
    const params = [];
    let idx = 1;

    if (name) {
      sql += `, name = $${idx++}`;
      params.push(name.trim());
    }
    if (role && ['admin', 'designer', 'qc'].includes(role)) {
      sql += `, role = $${idx++}`;
      params.push(role);
    }
    if (password) {
      sql += `, password = $${idx++}`;
      params.push(hashPassword(String(password)));
    }

    sql += ` WHERE id = $${idx} AND deleted = 0 RETURNING id, employee_id, name, role`;
    params.push(id);

    const result = await query(sql, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    await pushData();
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/employees/:id', adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  try {
    // Prevent deleting the last remaining admin
    const adminCheck = await query(
      `SELECT count(*)::int as count FROM employees WHERE role = 'admin' AND deleted = 0 AND id != $1`,
      [id]
    );
    if (adminCheck.rows[0].count === 0) {
      return res.status(400).json({ error: 'Cannot delete the only remaining admin' });
    }

    await query('UPDATE employees SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
    await pushData();
    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// File Uploads & Attachments
// ---------------------------------------------------------------------------
app.post('/api/upload', auth, async (req, res) => {
  const { drawing_no, filename, data } = req.body || {};
  if (!drawing_no || !filename || !data) {
    return res.status(400).json({ error: 'drawing_no, filename, and data are required' });
  }

  try {
    const drawingRes = await query(
      'SELECT id FROM drawings WHERE drawing_no = $1 AND deleted = 0',
      [String(drawing_no).trim()]
    );

    if (drawingRes.rows.length === 0) {
      return res.status(404).json({ error: 'Drawing not found on server' });
    }

    const drawingId = drawingRes.rows[0].id;
    const safeName = sanitizeFileName(filename);
    const dest = path.join(uploadsDir, safeName);
    const buffer = Buffer.from(String(data), 'base64');
    fs.writeFileSync(dest, buffer);

    const urlPath = `/uploads/${safeName}`;
    const mimeType = safeName.endsWith('.pdf')
      ? 'application/pdf'
      : safeName.endsWith('.png')
      ? 'image/png'
      : 'image/jpeg';

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE drawings SET image_uri = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [urlPath, drawingId]
      );

      await client.query(
        `INSERT INTO attachments (drawing_id, file_name, original_name, mime_type, file_size, file_path, url_path, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [drawingId, safeName, filename, mimeType, buffer.length, dest, urlPath, req.user.id]
      );
    });

    await pushData();
    res.json({ ok: true, url: urlPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/attachments', auth, async (req, res) => {
  try {
    const result = await query(
      `SELECT a.*, d.drawing_no, e.name AS uploader_name
       FROM attachments a
       LEFT JOIN drawings d ON d.id = a.drawing_id
       LEFT JOIN employees e ON e.id = a.uploaded_by
       ORDER BY a.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Google Drive Backup
// ---------------------------------------------------------------------------
app.post('/api/admin/backup/google-drive', adminAuth, async (req, res) => {
  const result = await backupToGoogleDrive();
  if (result.ok) {
    res.json({ success: true, message: result.message, filename: result.filename });
  } else {
    res.status(500).json({ success: false, message: result.message });
  }
});

app.get('/api/admin/backup/status', adminAuth, (req, res) => {
  res.json({ backup: getLastBackupInfo() });
});

// ---------------------------------------------------------------------------
// Google Account OAuth2 (for Drive Backup)
// ---------------------------------------------------------------------------
app.get('/api/auth/google/url', adminAuth, (req, res) => {
  const url = getAuthUrl();
  if (!url) {
    return res.status(400).json({ error: 'OAuth2 not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env' });
  }
  res.json({ url });
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    return res.status(400).send(`<html><body><h2>Authorization failed</h2><p>${error}</p><p>You can close this window.</p></body></html>`);
  }
  if (!code) {
    return res.status(400).send('<html><body><h2>No authorization code received</h2></body></html>');
  }
  try {
    await exchangeAuthCode(String(code));
    res.send('<html><body><h2>Google Account authorized successfully!</h2><p>You can close this window and return to the app.</p></body></html>');
  } catch (e) {
    res.status(500).send(`<html><body><h2>Authorization failed</h2><p>${e.message}</p></body></html>`);
  }
});

app.get('/api/auth/google/status', adminAuth, (req, res) => {
  const tokens = getOAuthTokens();
  const authorized = Boolean(tokens && tokens.refresh_token);
  res.json({ authorized });
});

app.delete('/api/auth/google', adminAuth, (req, res) => {
  clearOAuthTokens();
  res.json({ ok: true, message: 'Google Account disconnected' });
});

// ---------------------------------------------------------------------------
// Sync Endpoints (Preserves 100% Mobile Offline-First Compatibility)
// ---------------------------------------------------------------------------
async function buildPullPayload() {
  const [
    employeesRes,
    drawingsRes,
    dimensionsRes,
    checksRes,
    measurementsRes,
    dispatchesRes,
    instrumentsRes,
    delEmployeesRes,
    delDrawingsRes,
    delDimensionsRes,
    delChecksRes,
    delDispatchesRes,
    delInstrumentsRes,
  ] = await Promise.all([
    query(`SELECT id, employee_id, name, password, role, created_at FROM employees WHERE deleted = 0 ORDER BY employee_id`),
    query(`SELECT id, drawing_no, part_name, customer, revision, material, unit, notes, invoice_no, invoice_date, drawing_rev_date, po_no, qty, treatment, hardness, image_uri, created_at FROM drawings WHERE deleted = 0 ORDER BY drawing_no`),
    query(`SELECT id, drawing_id, dim_no, description, nominal, nominal_text, tol_upper, tol_lower FROM dimensions WHERE deleted = 0 ORDER BY drawing_id, dim_no`),
    query(`SELECT id, client_id, drawing_id, checked_by, checked_at, result, instrument, inspector_notes, inspector_name FROM checks WHERE deleted = 0 ORDER BY checked_at`),
    query(`SELECT m.id, m.check_id, m.dimension_id, m.sample1, m.sample2, m.sample3, m.sample4, m.sample5, m.sample6, m.sample7, m.sample8, m.sample9, m.sample10, m.remarks, m.pass, m.instrument, m.sample_status FROM measurements m JOIN checks c ON c.id = m.check_id WHERE c.deleted = 0`),
    query(`SELECT id, dispatch_no, drawing_id, drawing_no, part_name, po_no, invoice_no, qty, dispatched_by, dispatched_at, notes FROM dispatches WHERE deleted = 0 ORDER BY dispatched_at`),
    query(`SELECT id, name FROM instruments WHERE deleted = 0 ORDER BY name`),
    query(`SELECT employee_id FROM employees WHERE deleted = 1`),
    query(`SELECT drawing_no FROM drawings WHERE deleted = 1`),
    query(`SELECT dw.drawing_no, d.dim_no FROM dimensions d JOIN drawings dw ON dw.id = d.drawing_id WHERE d.deleted = 1`),
    query(`SELECT client_id FROM checks WHERE deleted = 1 AND client_id IS NOT NULL`),
    query(`SELECT dispatch_no FROM dispatches WHERE deleted = 1`),
    query(`SELECT name FROM instruments WHERE deleted = 1`),
  ]);

  return {
    server_time: now(),
    employees: employeesRes.rows,
    drawings: drawingsRes.rows,
    dimensions: dimensionsRes.rows,
    checks: checksRes.rows,
    measurements: measurementsRes.rows,
    dispatches: dispatchesRes.rows,
    instruments: instrumentsRes.rows,
    deleted_employees: delEmployeesRes.rows.map((r) => r.employee_id),
    deleted_drawings: delDrawingsRes.rows.map((r) => r.drawing_no),
    deleted_dimensions: delDimensionsRes.rows,
    deleted_checks: delChecksRes.rows.map((r) => r.client_id),
    deleted_dispatches: delDispatchesRes.rows.map((r) => r.dispatch_no),
    deleted_instruments: delInstrumentsRes.rows.map((r) => r.name),
  };
}

app.get('/api/sync/pull', auth, async (req, res) => {
  try {
    const payload = await buildPullPayload();
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sync/push', auth, async (req, res) => {
  const body = req.body || {};

  try {
    await withTransaction(async (client) => {
      // 1. Upsert Employees
      for (const e of body.employees || []) {
        if (!e?.employee_id || !e?.name) continue;
        const hashed = e.password ? (e.password.startsWith('$2') ? e.password : hashPassword(e.password)) : hashPassword('1234');
        await client.query(
          `INSERT INTO employees (employee_id, name, password, role, deleted, updated_at)
           VALUES ($1, $2, $3, $4, 0, CURRENT_TIMESTAMP)
           ON CONFLICT (employee_id) DO UPDATE SET
             name = EXCLUDED.name,
             password = EXCLUDED.password,
             role = EXCLUDED.role,
             deleted = 0,
             updated_at = CURRENT_TIMESTAMP`,
          [String(e.employee_id).trim().toUpperCase(), String(e.name), hashed, String(e.role || 'designer')]
        );
      }

      // 2. Upsert Drawings
      for (const dw of body.drawings || []) {
        if (!dw?.drawing_no || !dw?.part_name) continue;
        let createdBy = req.user.id;
        if (dw.created_by) {
          const emp = await client.query('SELECT id FROM employees WHERE employee_id = $1 AND deleted = 0', [String(dw.created_by)]);
          if (emp.rows.length > 0) createdBy = emp.rows[0].id;
        }

        await client.query(
          `INSERT INTO drawings (
             drawing_no, part_name, customer, revision, material, unit, notes,
             invoice_no, invoice_date, drawing_rev_date, po_no, qty, treatment, hardness,
             image_uri, created_by, created_at, deleted, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, CURRENT_TIMESTAMP, 0, CURRENT_TIMESTAMP)
           ON CONFLICT (drawing_no) DO UPDATE SET
             part_name = EXCLUDED.part_name,
             customer = EXCLUDED.customer,
             revision = EXCLUDED.revision,
             material = EXCLUDED.material,
             unit = EXCLUDED.unit,
             notes = EXCLUDED.notes,
             invoice_no = EXCLUDED.invoice_no,
             invoice_date = EXCLUDED.invoice_date,
             drawing_rev_date = EXCLUDED.drawing_rev_date,
             po_no = EXCLUDED.po_no,
             qty = EXCLUDED.qty,
             treatment = EXCLUDED.treatment,
             hardness = EXCLUDED.hardness,
             image_uri = COALESCE(EXCLUDED.image_uri, drawings.image_uri),
             created_by = EXCLUDED.created_by,
             deleted = 0,
             updated_at = CURRENT_TIMESTAMP`,
          [
            String(dw.drawing_no).trim(),
            String(dw.part_name),
            String(dw.customer || ''),
            String(dw.revision || 'A'),
            String(dw.material || ''),
            String(dw.unit || 'mm'),
            String(dw.notes || ''),
            String(dw.invoice_no || ''),
            String(dw.invoice_date || ''),
            String(dw.drawing_rev_date || ''),
            String(dw.po_no || ''),
            String(dw.qty || ''),
            String(dw.treatment || ''),
            String(dw.hardness || ''),
            dw.image_uri || null,
            createdBy,
          ]
        );
      }

      // 3. Upsert Dimensions
      for (const dim of body.dimensions || []) {
        if (!dim?.drawing_no || dim.dim_no == null) continue;
        const dw = await client.query('SELECT id FROM drawings WHERE drawing_no = $1 AND deleted = 0', [String(dim.drawing_no)]);
        if (dw.rows.length === 0) continue;

        // dim_no is an integer column. Clients (forms, Excel imports, OCR)
        // can produce fractional balloon numbers like 10.1, which would make
        // Postgres throw and roll back the WHOLE push transaction - leaving
        // the phone stuck on "Sync Failed" forever. Round to a whole number
        // instead so one odd value can never block every other record.
        const dimNoRaw = Number(dim.dim_no);
        if (!Number.isFinite(dimNoRaw)) continue;
        const dimNo = Math.round(dimNoRaw);

        await client.query(
          `INSERT INTO dimensions (drawing_id, dim_no, description, nominal, nominal_text, tol_upper, tol_lower, deleted, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 0, CURRENT_TIMESTAMP)
           ON CONFLICT (drawing_id, dim_no) DO UPDATE SET
             description = EXCLUDED.description,
             nominal = EXCLUDED.nominal,
             nominal_text = EXCLUDED.nominal_text,
             tol_upper = EXCLUDED.tol_upper,
             tol_lower = EXCLUDED.tol_lower,
             deleted = 0,
             updated_at = CURRENT_TIMESTAMP`,
          [
            dw.rows[0].id,
            dimNo,
            String(dim.description || ''),
            Number(dim.nominal || 0),
            String(dim.nominal_text || ''),
            Number(dim.tol_upper || 0),
            Number(dim.tol_lower || 0),
          ]
        );
      }

      // 4. Upsert Checks & Measurements
      for (const ch of body.checks || []) {
        if (!ch?.client_id || !ch?.drawing_no) continue;
        const dw = await client.query('SELECT id FROM drawings WHERE drawing_no = $1 AND deleted = 0', [String(ch.drawing_no)]);
        if (dw.rows.length === 0) continue;

        let checkedBy = req.user.id;
        if (ch.checked_by) {
          const emp = await client.query('SELECT id FROM employees WHERE employee_id = $1 AND deleted = 0', [String(ch.checked_by)]);
          if (emp.rows.length > 0) checkedBy = emp.rows[0].id;
        }

        const checkRes = await client.query(
          `INSERT INTO checks (
             client_id, drawing_id, checked_by, checked_at, result,
             instrument, inspector_notes, inspector_name, deleted, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, CURRENT_TIMESTAMP)
           ON CONFLICT (client_id) DO UPDATE SET
             drawing_id = EXCLUDED.drawing_id,
             checked_by = EXCLUDED.checked_by,
             checked_at = EXCLUDED.checked_at,
             result = EXCLUDED.result,
             instrument = EXCLUDED.instrument,
             inspector_notes = EXCLUDED.inspector_notes,
             inspector_name = EXCLUDED.inspector_name,
             deleted = 0,
             updated_at = CURRENT_TIMESTAMP
           RETURNING id`,
          [
            String(ch.client_id),
            dw.rows[0].id,
            checkedBy,
            ch.checked_at ? new Date(ch.checked_at) : new Date(),
            ch.result === 'FAIL' ? 'FAIL' : 'PASS',
            String(ch.instrument || ''),
            String(ch.inspector_notes || ''),
            String(ch.inspector_name || ''),
          ]
        );

        const checkId = checkRes.rows[0].id;
        await client.query('DELETE FROM measurements WHERE check_id = $1', [checkId]);

        for (const m of ch.measurements || []) {
          if (!m || m.dim_no == null) continue;
          const mDimNoRaw = Number(m.dim_no);
          if (!Number.isFinite(mDimNoRaw)) continue;
          // Match the rounded dim_no used when upserting dimensions above.
          const dimRes = await client.query(
            `SELECT id FROM dimensions WHERE drawing_id = $1 AND dim_no = $2 AND deleted = 0`,
            [dw.rows[0].id, Math.round(mDimNoRaw)]
          );
          if (dimRes.rows.length === 0) continue;

          await client.query(
            `INSERT INTO measurements (
               check_id, dimension_id, sample1, sample2, sample3, sample4, sample5,
               sample6, sample7, sample8, sample9, sample10, remarks, pass, instrument, sample_status
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
            [
              checkId,
              dimRes.rows[0].id,
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
              String(m.remarks || ''),
              m.pass ? 1 : 0,
              String(m.instrument || ''),
              String(m.sample_status || ''),
            ]
          );
        }
      }

      // 5. Upsert Dispatches
      for (const dp of body.dispatches || []) {
        if (!dp?.dispatch_no || !dp?.drawing_no) continue;
        const dw = await client.query('SELECT id FROM drawings WHERE drawing_no = $1 AND deleted = 0', [String(dp.drawing_no)]);
        if (dw.rows.length === 0) continue;

        let dispatchedBy = req.user.id;
        if (dp.dispatched_by) {
          const emp = await client.query('SELECT id FROM employees WHERE employee_id = $1 AND deleted = 0', [String(dp.dispatched_by)]);
          if (emp.rows.length > 0) dispatchedBy = emp.rows[0].id;
        }

        await client.query(
          `INSERT INTO dispatches (
             dispatch_no, drawing_id, drawing_no, part_name, po_no,
             invoice_no, qty, dispatched_by, dispatched_at, notes, deleted, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, CURRENT_TIMESTAMP)
           ON CONFLICT (dispatch_no) DO UPDATE SET
             drawing_id = EXCLUDED.drawing_id,
             drawing_no = EXCLUDED.drawing_no,
             part_name = EXCLUDED.part_name,
             po_no = EXCLUDED.po_no,
             invoice_no = EXCLUDED.invoice_no,
             qty = EXCLUDED.qty,
             dispatched_by = EXCLUDED.dispatched_by,
             dispatched_at = EXCLUDED.dispatched_at,
             notes = EXCLUDED.notes,
             deleted = 0,
             updated_at = CURRENT_TIMESTAMP`,
          [
            String(dp.dispatch_no).trim(),
            dw.rows[0].id,
            String(dp.drawing_no),
            String(dp.part_name || ''),
            String(dp.po_no || ''),
            String(dp.invoice_no || ''),
            String(dp.qty || ''),
            dispatchedBy,
            dp.dispatched_at ? new Date(dp.dispatched_at) : new Date(),
            String(dp.notes || ''),
          ]
        );
      }

      // 6. Upsert Instruments
      for (const inst of body.instruments || []) {
        if (!inst?.name) continue;
        await client.query(
          `INSERT INTO instruments (name, deleted, updated_at)
           VALUES ($1, 0, CURRENT_TIMESTAMP)
           ON CONFLICT (name) DO UPDATE SET deleted = 0, updated_at = CURRENT_TIMESTAMP`,
          [String(inst.name).trim()]
        );
      }

      // 7. Process Deletions / Tombstones
      for (const name of body.deleted_instruments || []) {
        await client.query('UPDATE instruments SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE name = $1', [String(name)]);
      }

      for (const empId of body.deleted_employees || []) {
        await client.query('UPDATE employees SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE employee_id = $1', [String(empId)]);
      }

      for (const drawingNo of body.deleted_drawings || []) {
        const dw = await client.query('SELECT id FROM drawings WHERE drawing_no = $1', [String(drawingNo)]);
        if (dw.rows.length > 0) {
          const dwId = dw.rows[0].id;
          await client.query('UPDATE checks SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE drawing_id = $1', [dwId]);
          await client.query('UPDATE dimensions SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE drawing_id = $1', [dwId]);
          await client.query('UPDATE dispatches SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE drawing_id = $1', [dwId]);
          await client.query('UPDATE drawings SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [dwId]);
        }
      }

      for (const dimKey of body.deleted_dimensions || []) {
        if (!dimKey?.drawing_no || dimKey.dim_no == null) continue;
        const dw = await client.query('SELECT id FROM drawings WHERE drawing_no = $1', [String(dimKey.drawing_no)]);
        if (dw.rows.length > 0) {
          await client.query(
            'UPDATE dimensions SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE drawing_id = $1 AND dim_no = $2',
            [dw.rows[0].id, Number(dimKey.dim_no)]
          );
        }
      }

      for (const clientId of body.deleted_checks || []) {
        await client.query('UPDATE checks SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE client_id = $1', [String(clientId)]);
      }

      for (const dispatchNo of body.deleted_dispatches || []) {
        await client.query('UPDATE dispatches SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE dispatch_no = $1', [String(dispatchNo)]);
      }
    });

    await pushData();
    res.json({ ok: true, time: now() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[ERROR]', req.method, req.path, err instanceof Error ? err.message : err);
  res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Server Startup with Port Fallback
// ---------------------------------------------------------------------------
export async function startServerWithFallback(startPort = DEFAULT_PORT) {
  try {
    console.log('[STARTUP] Initializing PostgreSQL database...');
    await initDatabase();
    console.log('[STARTUP] Database initialized successfully.');
  } catch (err) {
    console.error('[STARTUP] Warning: PostgreSQL initialization encountered an issue:', err.message);
    console.error('[STARTUP] Ensure PostgreSQL is running and credentials in .env are correct.');
  }

  const tryPort = (port) => {
    const listener = httpServer.listen(port, '0.0.0.0', () => {
      const actualPort = listener.address()?.port ?? port;
      console.log(`QC sync server listening on port ${actualPort}`);
      startAutoBackupScheduler();
    });

    listener.once('error', (error) => {
      if (error && error.code === 'EADDRINUSE') {
        // Never silently fall back to port+1: the mobile app is pointed at a
        // fixed address (e.g. http://192.168.1.7:4000), so a second copy would
        // be unreachable and "sync" would keep failing. Exit instead - the
        // keep-alive launcher (start-server.bat) will notice the port is
        // already served and switch to watch-only mode.
        console.error(
          `Port ${port} is already in use - another QC sync server is already running. Exiting.`
        );
        process.exit(1);
      }
      console.error('Failed to start QC sync server:', error);
      process.exit(1);
    });
  };

  tryPort(startPort);
}

// Start if executed directly
if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  startServerWithFallback();
}