import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlitePath = path.join(__dirname, '..', 'data', 'quality_check.db');

describe('SQLite Existing Data & Migration Integrity', () => {
  test('SQLite database file exists and is readable', () => {
    assert.ok(fs.existsSync(sqlitePath), `SQLite database file must exist at ${sqlitePath}`);
    const db = new DatabaseSync(sqlitePath);
    assert.ok(db, 'DatabaseSync should successfully open SQLite DB');
  });

  test('SQLite tables contain required columns and valid records', () => {
    const db = new DatabaseSync(sqlitePath);

    // Employees
    const employees = db.prepare('SELECT id, employee_id, name, role FROM employees').all();
    assert.ok(employees.length > 0, 'Employees table should contain seed/migrated users');
    for (const e of employees) {
      assert.ok(e.employee_id, 'Employee must have employee_id');
      assert.ok(e.name, 'Employee must have name');
      assert.ok(['admin', 'designer', 'qc'].includes(e.role), `Valid role expected, got ${e.role}`);
    }

    // Drawings
    const drawings = db.prepare('SELECT id, drawing_no, part_name FROM drawings').all();
    assert.ok(Array.isArray(drawings), 'Drawings query should return array');

    // Dimensions
    const dimensions = db.prepare('SELECT id, drawing_id, dim_no, nominal FROM dimensions').all();
    assert.ok(Array.isArray(dimensions), 'Dimensions query should return array');

    // Dispatches
    const dispatches = db.prepare('SELECT id, dispatch_no, drawing_id FROM dispatches').all();
    assert.ok(Array.isArray(dispatches), 'Dispatches query should return array');

    // Instruments
    const instruments = db.prepare('SELECT id, name FROM instruments').all();
    assert.ok(instruments.length > 0, 'Instruments table should contain records');
  });

  test('Drawing attachments in uploads directory exist and are valid files', () => {
    const uploadsDir = path.join(__dirname, '..', 'data', 'uploads');
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir);
      assert.ok(files.length > 0, 'Uploads folder should contain drawing attachments');
      for (const file of files) {
        const filePath = path.join(uploadsDir, file);
        const stat = fs.statSync(filePath);
        assert.ok(stat.size > 0, `Attachment ${file} should have non-zero size`);
      }
    }
  });
});
