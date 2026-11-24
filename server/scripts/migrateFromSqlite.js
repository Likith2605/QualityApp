import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pool, runMigrations } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultSqlitePath = path.join(__dirname, '..', 'data', 'quality_check.db');

export async function migrateSqliteToPostgres(sqlitePath = defaultSqlitePath) {
  console.log('====================================================');
  console.log('QualityApp: SQLite -> PostgreSQL Data Migration Tool');
  console.log('====================================================');

  if (!fs.existsSync(sqlitePath)) {
    console.error(`[ERROR] SQLite database file not found at: ${sqlitePath}`);
    return { ok: false, error: 'SQLite file not found' };
  }

  console.log(`[SOURCE] SQLite DB: ${sqlitePath}`);
  const sqliteDb = new DatabaseSync(sqlitePath);

  // 1. Ensure migrations are applied on PostgreSQL
  console.log('[TARGET] Ensuring PostgreSQL schema migrations are applied...');
  await runMigrations();

  const client = await pool.connect();
  const summary = {
    employees: { sqlite: 0, pg: 0 },
    drawings: { sqlite: 0, pg: 0 },
    dimensions: { sqlite: 0, pg: 0 },
    checks: { sqlite: 0, pg: 0 },
    measurements: { sqlite: 0, pg: 0 },
    dispatches: { sqlite: 0, pg: 0 },
    instruments: { sqlite: 0, pg: 0 },
    attachments: { sqlite: 0, pg: 0 },
  };

  try {
    await client.query('BEGIN');

    // 1. Employees
    const employees = sqliteDb.prepare('SELECT * FROM employees ORDER BY id').all();
    summary.employees.sqlite = employees.length;
    for (const e of employees) {
      await client.query(
        `INSERT INTO employees (id, employee_id, name, password, role, created_at, updated_at, deleted)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           password = EXCLUDED.password,
           role = EXCLUDED.role,
           deleted = EXCLUDED.deleted,
           updated_at = EXCLUDED.updated_at`,
        [
          e.id,
          e.employee_id,
          e.name,
          e.password,
          e.role,
          e.created_at || new Date().toISOString(),
          e.updated_at || new Date().toISOString(),
          e.deleted || 0,
        ]
      );
    }
    await client.query(`SELECT setval('employees_id_seq', COALESCE((SELECT MAX(id) FROM employees), 1))`);

    // 2. Drawings
    const drawings = sqliteDb.prepare('SELECT * FROM drawings ORDER BY id').all();
    summary.drawings.sqlite = drawings.length;
    for (const d of drawings) {
      // Ensure created_by exists
      let createdBy = d.created_by;
      const empCheck = await client.query('SELECT id FROM employees WHERE id = $1', [createdBy]);
      if (empCheck.rows.length === 0) {
        const firstEmp = await client.query('SELECT id FROM employees LIMIT 1');
        createdBy = firstEmp.rows[0]?.id || 1;
      }

      await client.query(
        `INSERT INTO drawings (id, drawing_no, part_name, customer, revision, material, unit,
           notes, invoice_no, invoice_date, drawing_rev_date, po_no, qty, treatment, hardness,
           image_uri, created_by, created_at, updated_at, deleted)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
         ON CONFLICT (id) DO UPDATE SET
           drawing_no = EXCLUDED.drawing_no,
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
           deleted = EXCLUDED.deleted,
           updated_at = EXCLUDED.updated_at`,
        [
          d.id,
          d.drawing_no,
          d.part_name,
          d.customer || '',
          d.revision || 'A',
          d.material || '',
          d.unit || 'mm',
          d.notes || '',
          d.invoice_no || '',
          d.invoice_date || '',
          d.drawing_rev_date || '',
          d.po_no || '',
          d.qty || '',
          d.treatment || '',
          d.hardness || '',
          d.image_uri || null,
          createdBy,
          d.created_at || new Date().toISOString(),
          d.updated_at || new Date().toISOString(),
          d.deleted || 0,
        ]
      );

      // Track attachment if image_uri is present
      if (d.image_uri && d.image_uri.startsWith('/uploads/')) {
        const filename = d.image_uri.replace('/uploads/', '');
        const filePath = path.join(__dirname, '..', 'data', 'uploads', filename);
        let fileSize = 0;
        try {
          if (fs.existsSync(filePath)) {
            fileSize = fs.statSync(filePath).size;
          }
        } catch {
          /* ignore */
        }
        await client.query(
          `INSERT INTO attachments (drawing_id, file_name, original_name, mime_type, file_size, file_path, url_path, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT DO NOTHING`,
          [
            d.id,
            filename,
            filename,
            filename.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
            fileSize,
            filePath,
            d.image_uri,
            createdBy,
          ]
        );
      }
    }
    await client.query(`SELECT setval('drawings_id_seq', COALESCE((SELECT MAX(id) FROM drawings), 1))`);

    // 3. Dimensions
    const dimensions = sqliteDb.prepare('SELECT * FROM dimensions ORDER BY id').all();
    summary.dimensions.sqlite = dimensions.length;
    for (const dm of dimensions) {
      await client.query(
        `INSERT INTO dimensions (id, drawing_id, dim_no, description, nominal, nominal_text,
           tol_upper, tol_lower, updated_at, deleted)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET
           description = EXCLUDED.description,
           nominal = EXCLUDED.nominal,
           nominal_text = EXCLUDED.nominal_text,
           tol_upper = EXCLUDED.tol_upper,
           tol_lower = EXCLUDED.tol_lower,
           deleted = EXCLUDED.deleted,
           updated_at = EXCLUDED.updated_at`,
        [
          dm.id,
          dm.drawing_id,
          dm.dim_no,
          dm.description || '',
          dm.nominal || 0,
          dm.nominal_text || '',
          dm.tol_upper || 0,
          dm.tol_lower || 0,
          dm.updated_at || new Date().toISOString(),
          dm.deleted || 0,
        ]
      );
    }
    await client.query(`SELECT setval('dimensions_id_seq', COALESCE((SELECT MAX(id) FROM dimensions), 1))`);

    // 4. Checks (Inspections)
    const checks = sqliteDb.prepare('SELECT * FROM checks ORDER BY id').all();
    summary.checks.sqlite = checks.length;
    for (const c of checks) {
      let checkedBy = c.checked_by;
      const empCheck = await client.query('SELECT id FROM employees WHERE id = $1', [checkedBy]);
      if (empCheck.rows.length === 0) {
        const firstEmp = await client.query('SELECT id FROM employees LIMIT 1');
        checkedBy = firstEmp.rows[0]?.id || 1;
      }

      await client.query(
        `INSERT INTO checks (id, client_id, drawing_id, checked_by, checked_at, result,
           instrument, inspector_notes, inspector_name, updated_at, deleted)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE SET
           result = EXCLUDED.result,
           instrument = EXCLUDED.instrument,
           inspector_notes = EXCLUDED.inspector_notes,
           inspector_name = EXCLUDED.inspector_name,
           deleted = EXCLUDED.deleted,
           updated_at = EXCLUDED.updated_at`,
        [
          c.id,
          c.client_id || `CHK-${c.id}`,
          c.drawing_id,
          checkedBy,
          c.checked_at || new Date().toISOString(),
          c.result || 'PASS',
          c.instrument || '',
          c.inspector_notes || '',
          c.inspector_name || '',
          c.updated_at || new Date().toISOString(),
          c.deleted || 0,
        ]
      );
    }
    await client.query(`SELECT setval('checks_id_seq', COALESCE((SELECT MAX(id) FROM checks), 1))`);

    // 5. Measurements
    const measurements = sqliteDb.prepare('SELECT * FROM measurements ORDER BY id').all();
    summary.measurements.sqlite = measurements.length;
    for (const m of measurements) {
      await client.query(
        `INSERT INTO measurements (id, check_id, dimension_id, sample1, sample2, sample3,
           sample4, sample5, sample6, sample7, sample8, sample9, sample10, remarks, pass, instrument, sample_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         ON CONFLICT (id) DO NOTHING`,
        [
          m.id,
          m.check_id,
          m.dimension_id,
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
          m.remarks || '',
          m.pass ?? 1,
          m.instrument || '',
          m.sample_status || '',
        ]
      );
    }
    await client.query(`SELECT setval('measurements_id_seq', COALESCE((SELECT MAX(id) FROM measurements), 1))`);

    // 6. Dispatches
    const dispatches = sqliteDb.prepare('SELECT * FROM dispatches ORDER BY id').all();
    summary.dispatches.sqlite = dispatches.length;
    for (const dp of dispatches) {
      let dispatchedBy = dp.dispatched_by;
      const empCheck = await client.query('SELECT id FROM employees WHERE id = $1', [dispatchedBy]);
      if (empCheck.rows.length === 0) {
        const firstEmp = await client.query('SELECT id FROM employees LIMIT 1');
        dispatchedBy = firstEmp.rows[0]?.id || 1;
      }

      await client.query(
        `INSERT INTO dispatches (id, dispatch_no, drawing_id, drawing_no, part_name, po_no,
           invoice_no, qty, dispatched_by, dispatched_at, notes, updated_at, deleted)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (id) DO UPDATE SET
           drawing_id = EXCLUDED.drawing_id,
           drawing_no = EXCLUDED.drawing_no,
           part_name = EXCLUDED.part_name,
           po_no = EXCLUDED.po_no,
           invoice_no = EXCLUDED.invoice_no,
           qty = EXCLUDED.qty,
           dispatched_by = EXCLUDED.dispatched_by,
           dispatched_at = EXCLUDED.dispatched_at,
           notes = EXCLUDED.notes,
           deleted = EXCLUDED.deleted,
           updated_at = EXCLUDED.updated_at`,
        [
          dp.id,
          dp.dispatch_no,
          dp.drawing_id,
          dp.drawing_no || '',
          dp.part_name || '',
          dp.po_no || '',
          dp.invoice_no || '',
          dp.qty || '',
          dispatchedBy,
          dp.dispatched_at || new Date().toISOString(),
          dp.notes || '',
          dp.updated_at || new Date().toISOString(),
          dp.deleted || 0,
        ]
      );
    }
    await client.query(`SELECT setval('dispatches_id_seq', COALESCE((SELECT MAX(id) FROM dispatches), 1))`);

    // 7. Instruments
    const instruments = sqliteDb.prepare('SELECT * FROM instruments ORDER BY id').all();
    summary.instruments.sqlite = instruments.length;
    for (const inst of instruments) {
      await client.query(
        `INSERT INTO instruments (id, name, updated_at, deleted)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (name) DO UPDATE SET
           deleted = EXCLUDED.deleted,
           updated_at = EXCLUDED.updated_at`,
        [
          inst.id,
          inst.name,
          inst.updated_at || new Date().toISOString(),
          inst.deleted || 0,
        ]
      );
    }
    await client.query(`SELECT setval('instruments_id_seq', COALESCE((SELECT MAX(id) FROM instruments), 1))`);

    await client.query('COMMIT');

    // Retrieve verified counts from PostgreSQL
    for (const table of ['employees', 'drawings', 'dimensions', 'checks', 'measurements', 'dispatches', 'instruments', 'attachments']) {
      const res = await pool.query(`SELECT count(*)::int as count FROM ${table}`);
      summary[table].pg = res.rows[0].count;
    }

    console.log('\n[SUCCESS] Migration completed successfully!');
    console.table(summary);
    return { ok: true, summary };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ERROR] Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// If executed directly from command line
if (process.argv[1] && process.argv[1].endsWith('migrateFromSqlite.js')) {
  migrateSqliteToPostgres()
    .then(() => {
      console.log('Migration process finished.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fatal error during migration:', err);
      process.exit(1);
    });
}
