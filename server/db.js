import 'dotenv/config';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// PostgreSQL Connection Pool configuration
// Uses DATABASE_URL or discrete PG* environment variables
const connectionConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false,
    }
  : {
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT || 5432),
      database: process.env.PGDATABASE || 'qualityapp_db',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || '',
      ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false,
    };

export const pool = new Pool({
  ...connectionConfig,
  max: Number(process.env.PG_POOL_MAX || 20),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT || 30000),
  connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT || 5000),
});

pool.on('error', (err) => {
  console.error('[POSTGRES] Unexpected error on idle client', err);
});

// Helper for single parameterized query
export async function query(text, params = []) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.DEBUG_SQL === 'true') {
    console.log('[SQL]', { text, params, duration, rows: res.rowCount });
  }
  return res;
}

// Transaction helper
export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Password helpers (Bcrypt with legacy plaintext fallback & transparent upgrade)
export function hashPassword(plainText) {
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(plainText, salt);
}

export function verifyPassword(inputPassword, storedPassword) {
  if (!inputPassword || !storedPassword) return false;
  // If stored password is a bcrypt hash
  if (storedPassword.startsWith('$2a$') || storedPassword.startsWith('$2b$')) {
    try {
      return bcrypt.compareSync(inputPassword, storedPassword);
    } catch {
      return false;
    }
  }
  // Fallback to plain text comparison (for legacy SQLite migrated data)
  return inputPassword === storedPassword;
}

// Automated SQL Migration Runner
export async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) return;

    const files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const existing = await client.query(
        'SELECT id FROM schema_migrations WHERE name = $1',
        [file]
      );
      if (existing.rows.length === 0) {
        console.log(`[MIGRATION] Applying ${file}...`);
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (name) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
        console.log(`[MIGRATION] Successfully applied ${file}`);
      }
    }
  } catch (err) {
    console.error('[MIGRATION] Error executing migrations:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// Seed initial records if tables are empty
export async function seedInitialData() {
  // Check employees
  const empCheck = await query('SELECT count(*)::int as count FROM employees');
  if (empCheck.rows[0].count === 0) {
    console.log('[SEED] Seeding default employees...');
    const seedEmployees = [
      ['ADMIN', 'Administrator', hashPassword('admin123'), 'admin'],
      ['DES001', 'Designer One', hashPassword('1234'), 'designer'],
      ['QC001', 'Quality Inspector One', hashPassword('1234'), 'qc'],
    ];
    for (const [employeeId, name, password, role] of seedEmployees) {
      await query(
        `INSERT INTO employees (employee_id, name, password, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (employee_id) DO NOTHING`,
        [employeeId, name, password, role]
      );
    }
  }

  // Check instruments
  const instCheck = await query('SELECT count(*)::int as count FROM instruments');
  if (instCheck.rows[0].count === 0) {
    console.log('[SEED] Seeding default instruments...');
    const seedInstruments = [
      'Vernier Calliper',
      'Micrometer',
      'Height Gauge',
      'Dial Gauge',
      'Vernier Height Gauge',
      'Surface Plate',
    ];
    for (const name of seedInstruments) {
      await query(
        `INSERT INTO instruments (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
        [name]
      );
    }
  }
}

// Database initialization
export async function initDatabase() {
  await runMigrations();
  await seedInitialData();
}

// Health check helper
export async function checkDbHealth() {
  const start = Date.now();
  const res = await query('SELECT NOW() as now, current_database() as database');
  return {
    ok: true,
    database: res.rows[0]?.database,
    serverTime: res.rows[0]?.now,
    latencyMs: Date.now() - start,
  };
}