import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '..', 'migrations');

describe('Database Schema & Migration Scripts', () => {
  test('migrations directory exists and contains sequential migration files', () => {
    assert.ok(fs.existsSync(migrationsDir), 'Migrations directory should exist');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    assert.ok(files.length >= 3, `Expected at least 3 migration files, found ${files.length}`);
    assert.ok(files.includes('001_initial_schema.sql'), 'Missing 001_initial_schema.sql');
    assert.ok(files.includes('002_create_indexes.sql'), 'Missing 002_create_indexes.sql');
    assert.ok(files.includes('003_attachments_and_tracking.sql'), 'Missing 003_attachments_and_tracking.sql');
  });

  test('001_initial_schema.sql defines all required normalized tables and constraints', () => {
    const sql = fs.readFileSync(path.join(migrationsDir, '001_initial_schema.sql'), 'utf8');

    // Tables
    const requiredTables = [
      'employees',
      'drawings',
      'dimensions',
      'checks',
      'measurements',
      'dispatches',
      'instruments',
      'sessions',
    ];
    for (const table of requiredTables) {
      assert.match(
        sql,
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, 'i'),
        `Schema should define table: ${table}`
      );
    }

    // Role enum check constraint
    assert.match(sql, /role IN \('admin',\s*'designer',\s*'qc'\)/i, 'Role check constraint missing');

    // Quality check result constraint
    assert.match(sql, /result IN \('PASS',\s*'FAIL'\)/i, 'Result check constraint missing');

    // Pass measurement check constraint
    assert.match(sql, /pass IN \(0,\s*1\)/i, 'Pass check constraint missing');

    // Foreign Keys
    assert.match(sql, /REFERENCES employees\(id\)/i, 'Foreign key to employees missing');
    assert.match(sql, /REFERENCES drawings\(id\)/i, 'Foreign key to drawings missing');
    assert.match(sql, /REFERENCES checks\(id\)/i, 'Foreign key to checks missing');
    assert.match(sql, /REFERENCES dimensions\(id\)/i, 'Foreign key to dimensions missing');

    // Unique constraints
    assert.match(sql, /UNIQUE\s*\(drawing_id,\s*dim_no\)/i, 'Unique constraint on drawing_id + dim_no missing');
    assert.match(sql, /employee_id.*UNIQUE/i, 'Unique constraint on employee_id missing');
    assert.match(sql, /drawing_no.*UNIQUE/i, 'Unique constraint on drawing_no missing');
  });

  test('002_create_indexes.sql defines optimal indexes for query performance', () => {
    const sql = fs.readFileSync(path.join(migrationsDir, '002_create_indexes.sql'), 'utf8');

    const expectedIndexes = [
      'idx_drawings_drawing_no',
      'idx_drawings_deleted',
      'idx_drawings_created_by',
      'idx_dimensions_drawing_id',
      'idx_checks_drawing_id',
      'idx_checks_client_id',
      'idx_measurements_check_id',
      'idx_dispatches_drawing_id',
      'idx_employees_employee_id',
    ];

    for (const idx of expectedIndexes) {
      assert.match(sql, new RegExp(idx, 'i'), `Index ${idx} is missing`);
    }
  });

  test('003_attachments_and_tracking.sql creates attachment management table', () => {
    const sql = fs.readFileSync(path.join(migrationsDir, '003_attachments_and_tracking.sql'), 'utf8');
    assert.match(sql, /CREATE TABLE IF NOT EXISTS attachments/i, 'Attachments table missing');
    assert.match(sql, /drawing_id INTEGER REFERENCES drawings/i, 'Drawing reference in attachments missing');
    assert.match(sql, /file_path TEXT NOT NULL/i, 'File path column in attachments missing');
    assert.match(sql, /url_path TEXT NOT NULL/i, 'Url path column in attachments missing');
  });
});
