import { google } from 'googleapis';
import { createReadStream, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ExcelJS from 'exceljs';
import { pool } from '../db.js';

const execFileAsync = promisify(execFile);
const BACKUP_FOLDER_NAME = 'Backups';
const TOKEN_FILE = path.join(process.cwd(), 'data', 'google_oauth_token.json');

function log(...args) {
    console.log('[BACKUP]', ...args);
}

function config() {
    return {
        enabled: String(process.env.GOOGLE_DRIVE_BACKUP_ENABLED || 'true').toLowerCase() === 'true',
        folderId: (process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim(),
        // OAuth2 (Google Account) credentials
        clientId: (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim(),
        clientSecret: (process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim(),
        redirectUri: (process.env.GOOGLE_OAUTH_REDIRECT_URI || 'http://localhost:4000/api/auth/google/callback').trim(),
        // Service Account credentials (fallback)
        clientEmail: (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim(),
        privateKey: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
        credFile: (process.env.GOOGLE_SERVICE_ACCOUNT_CRED_FILE || '').trim(),
        retentionEnabled: String(process.env.BACKUP_RETENTION_ENABLED || 'false').toLowerCase() === 'true',
        retentionDays: Number(process.env.BACKUP_RETENTION_DAYS || 30),
    };
}

function isCredentialed(cfg) {
    // OAuth2 (Google Account)
    if (cfg.clientId && cfg.clientSecret) return true;
    // Service Account fallback
    if (cfg.credFile) return true;
    return Boolean(cfg.clientEmail && cfg.privateKey);
}

function isOAuthConfigured(cfg) {
    return Boolean(cfg.clientId && cfg.clientSecret);
}

function isServiceAccountConfigured(cfg) {
    if (cfg.credFile) return true;
    return Boolean(cfg.clientEmail && cfg.privateKey);
}

function timestamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

// ---------------------------------------------------------------------------
// OAuth2 Token Management (Google Account)
// ---------------------------------------------------------------------------

function loadOAuthTokens() {
    try {
        if (existsSync(TOKEN_FILE)) {
            return JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
        }
    } catch (e) {
        log('Failed to load OAuth tokens:', e.message);
    }
    return null;
}

function saveOAuthTokens(tokens) {
    const dir = path.dirname(TOKEN_FILE);
    if (!existsSync(dir)) {
        writeFileSync(path.join(dir, '.gitkeep'), '');
    }
    writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), 'utf8');
    log('OAuth tokens saved to', TOKEN_FILE);
}

export function getOAuthTokens() {
    return loadOAuthTokens();
}

export function clearOAuthTokens() {
    try {
        if (existsSync(TOKEN_FILE)) {
            writeFileSync(TOKEN_FILE, '{}', 'utf8');
        }
    } catch { /* ignore */ }
}

export function getAuthUrl() {
    const cfg = config();
    if (!isOAuthConfigured(cfg)) {
        return null;
    }
    const oauth2Client = new google.auth.OAuth2(
        cfg.clientId,
        cfg.clientSecret,
        cfg.redirectUri
    );
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: ['https://www.googleapis.com/auth/drive.file'],
    });
}

export async function exchangeAuthCode(code) {
    const cfg = config();
    if (!isOAuthConfigured(cfg)) {
        throw new Error('OAuth2 not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.');
    }
    const oauth2Client = new google.auth.OAuth2(
        cfg.clientId,
        cfg.clientSecret,
        cfg.redirectUri
    );
    const { tokens } = await oauth2Client.getToken(code);
    saveOAuthTokens(tokens);
    oauth2Client.setCredentials(tokens);
    return tokens;
}

function buildOAuth2Client(cfg) {
    const tokens = loadOAuthTokens();
    if (!tokens || !tokens.refresh_token) {
        return null;
    }
    const oauth2Client = new google.auth.OAuth2(
        cfg.clientId,
        cfg.clientSecret,
        cfg.redirectUri
    );
    oauth2Client.setCredentials(tokens);
    return oauth2Client;
}

// ---------------------------------------------------------------------------
// Excel Snapshot Creation
// ---------------------------------------------------------------------------

async function createExcelSnapshot(destPath) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'QualityApp';
    workbook.created = new Date();

    const tables = [
        { name: 'Employees', query: 'SELECT id, employee_id, name, role, created_at, updated_at FROM employees WHERE deleted = 0 ORDER BY employee_id' },
        { name: 'Drawings', query: 'SELECT id, drawing_no, part_name, customer, revision, material, unit, notes, invoice_no, invoice_date, drawing_rev_date, po_no, qty, treatment, hardness, image_uri, created_at, updated_at FROM drawings WHERE deleted = 0 ORDER BY drawing_no' },
        { name: 'Dimensions', query: 'SELECT id, drawing_id, dim_no, description, nominal, nominal_text, tol_upper, tol_lower, created_at, updated_at FROM dimensions WHERE deleted = 0 ORDER BY drawing_id, dim_no' },
        { name: 'Checks', query: 'SELECT id, client_id, drawing_id, checked_by, checked_at, result, instrument, inspector_notes, inspector_name, created_at, updated_at FROM checks WHERE deleted = 0 ORDER BY checked_at DESC' },
        { name: 'Measurements', query: 'SELECT m.id, m.check_id, m.dimension_id, m.sample1, m.sample2, m.sample3, m.sample4, m.sample5, m.sample6, m.sample7, m.sample8, m.sample9, m.sample10, m.remarks, m.pass, m.instrument, m.sample_status FROM measurements m JOIN checks c ON c.id = m.check_id WHERE c.deleted = 0 ORDER BY m.check_id, m.dimension_id' },
        { name: 'Dispatches', query: 'SELECT id, dispatch_no, drawing_id, drawing_no, part_name, po_no, invoice_no, qty, dispatched_by, dispatched_at, notes, created_at, updated_at FROM dispatches WHERE deleted = 0 ORDER BY dispatched_at DESC' },
        { name: 'Instruments', query: 'SELECT id, name, created_at, updated_at FROM instruments WHERE deleted = 0 ORDER BY name' },
    ];

    for (const table of tables) {
        try {
            const res = await pool.query(table.query);
            const sheet = workbook.addWorksheet(table.name);

            if (res.rows.length > 0) {
                // Add headers
                const headers = Object.keys(res.rows[0]);
                sheet.addRow(headers);

                // Style headers
                const headerRow = sheet.getRow(1);
                headerRow.font = { bold: true };
                headerRow.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FF4472C4' },
                };
                headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };

                // Add data rows
                for (const row of res.rows) {
                    const values = headers.map((h) => {
                        const v = row[h];
                        if (v === null || v === undefined) return '';
                        if (v instanceof Date) return v.toISOString();
                        return v;
                    });
                    sheet.addRow(values);
                }

                // Auto-fit columns
                headers.forEach((header, index) => {
                    const column = sheet.getColumn(index + 1);
                    column.width = Math.max(header.length + 2, 15);
                });
            } else {
                sheet.addRow(['No data']);
            }
        } catch (err) {
            const sheet = workbook.addWorksheet(table.name);
            sheet.addRow([`Error: ${err.message}`]);
        }
    }

    // Add summary sheet
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.addRow(['QualityApp Database Backup']);
    summarySheet.addRow(['Generated At', new Date().toISOString()]);
    summarySheet.addRow([]);
    summarySheet.addRow(['Table', 'Row Count']);

    for (const table of tables) {
        try {
            const countRes = await pool.query(`SELECT COUNT(*)::int as count FROM (${table.query}) sub`);
            summarySheet.addRow([table.name, countRes.rows[0].count]);
        } catch {
            summarySheet.addRow([table.name, 'Error']);
        }
    }

    summarySheet.getRow(1).font = { bold: true, size: 14 };
    summarySheet.getRow(4).font = { bold: true };

    await workbook.xlsx.writeFile(destPath);
}

// ---------------------------------------------------------------------------
// Legacy SQL Snapshot (fallback)
// ---------------------------------------------------------------------------

async function createPostgresSnapshot(destPath) {
    const pgDumpPaths = [
        'pg_dump',
        'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe',
        'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe',
        'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe',
    ];

    let dumped = false;
    for (const bin of pgDumpPaths) {
        try {
            const dbUrl = process.env.DATABASE_URL;
            const args = ['--clean', '--if-exists', '--no-owner', '--no-privileges', '-f', destPath];
            if (dbUrl) {
                args.push('-d', dbUrl);
            } else {
                args.push(
                    '-h', process.env.PGHOST || 'localhost',
                    '-p', String(process.env.PGPORT || 5432),
                    '-U', process.env.PGUSER || 'postgres',
                    '-d', process.env.PGDATABASE || 'qualityapp_db'
                );
            }
            await execFileAsync(bin, args, {
                env: {
                    ...process.env,
                    PGPASSWORD: process.env.PGPASSWORD || '',
                },
            });
            dumped = true;
            break;
        } catch {
            // continue checking fallback
        }
    }

    if (!dumped) {
        const tables = [
            'employees', 'drawings', 'dimensions', 'checks',
            'measurements', 'dispatches', 'instruments', 'sessions', 'attachments',
        ];
        let dumpSql = `-- QualityApp Database Dump ${new Date().toISOString()}\n\n`;
        for (const table of tables) {
            try {
                const res = await pool.query(`SELECT * FROM ${table}`);
                if (res.rows.length > 0) {
                    dumpSql += `-- Data for ${table}\n`;
                    for (const row of res.rows) {
                        const cols = Object.keys(row);
                        const vals = Object.values(row).map((v) => {
                            if (v === null || v === undefined) return 'NULL';
                            if (typeof v === 'number') return v;
                            if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
                            if (v instanceof Date) return `'${v.toISOString()}'`;
                            return `'${String(v).replace(/'/g, "''")}'`;
                        });
                        dumpSql += `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${vals.join(', ')}) ON CONFLICT DO NOTHING;\n`;
                    }
                    dumpSql += '\n';
                }
            } catch (err) {
                dumpSql += `-- Error dumping ${table}: ${err.message}\n`;
            }
        }
        writeFileSync(destPath, dumpSql, 'utf8');
    }
}

// ---------------------------------------------------------------------------
// Google Drive Operations
// ---------------------------------------------------------------------------

function buildDriveClient(cfg) {
    // Try OAuth2 (Google Account) first
    const oauthClient = buildOAuth2Client(cfg);
    if (oauthClient) {
        log('Using Google Account (OAuth2) authentication');
        return google.drive({ version: 'v3', auth: oauthClient });
    }

    // Fallback to Service Account
    if (isServiceAccountConfigured(cfg)) {
        log('Using Service Account authentication');
        let auth;
        if (cfg.credFile) {
            auth = new google.auth.GoogleAuth({
                keyFile: path.resolve(cfg.credFile),
                scopes: ['https://www.googleapis.com/auth/drive.file'],
            });
        } else {
            auth = new google.auth.JWT(
                cfg.clientEmail,
                null,
                cfg.privateKey,
                ['https://www.googleapis.com/auth/drive.file'],
                null
            );
        }
        return google.drive({ version: 'v3', auth });
    }

    throw new Error('No Google Drive credentials configured');
}

async function resolveFolderId(drive, cfg) {
    if (cfg.folderId) return cfg.folderId;

    const list = await drive.files.list({
        q: `mimeType='application/vnd.google-apps.folder' and name='${BACKUP_FOLDER_NAME}' and trashed=false`,
        fields: 'files(id, name)',
        spaces: 'drive',
    });
    const existing = list.data.files && list.data.files[0];
    if (existing) return existing.id;

    const created = await drive.files.create({
        fields: 'id',
        requestBody: {
            name: BACKUP_FOLDER_NAME,
            mimeType: 'application/vnd.google-apps.folder',
        },
    });
    return created.data.id;
}

async function uploadSnapshot(drive, filePath, fileName, folderId, mimeType) {
    const res = await drive.files.create({
        requestBody: {
            name: fileName,
            parents: [folderId],
        },
        media: {
            mimeType: mimeType || 'application/octet-stream',
            body: createReadStream(filePath),
        },
        fields: 'id, name',
    });
    return res.data;
}

async function cleanupOldBackups(drive, cfg, folderId) {
    if (!cfg.retentionEnabled) return 0;
    const days = Math.max(1, cfg.retentionDays);
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    log(`Cleaning up backups older than ${days} days...`);

    let pageToken = null;
    let deleted = 0;
    do {
        const res = await drive.files.list({
            q: `'${folderId}' in parents and trashed=false`,
            fields: 'nextPageToken, files(id, name, createdTime)',
            spaces: 'drive',
            pageToken,
        });
        for (const f of res.data.files || []) {
            const created = f.createdTime ? new Date(f.createdTime).getTime() : 0;
            if (created && created < cutoff) {
                await drive.files.delete({ fileId: f.id });
                deleted++;
                log('Deleted old backup', f.name);
            }
        }
        pageToken = res.data.nextPageToken;
    } while (pageToken);
    return deleted;
}

let lastBackupInfo = null;

export function getLastBackupInfo() {
    return lastBackupInfo;
}

// ---------------------------------------------------------------------------
// Main Backup Function
// ---------------------------------------------------------------------------

export async function backupToGoogleDrive() {
    const cfg = config();
    let snapshotPath = null;
    let tmpDir = null;

    try {
        if (!cfg.enabled) {
            return { ok: false, message: 'Google Drive backup is disabled', filename: null };
        }
        if (!isCredentialed(cfg)) {
            return { ok: false, message: 'Google Drive credentials not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET for Google Account, or service account credentials.', filename: null };
        }

        // Check if OAuth tokens exist when using Google Account
        if (isOAuthConfigured(cfg) && !isServiceAccountConfigured(cfg)) {
            const tokens = loadOAuthTokens();
            if (!tokens || !tokens.refresh_token) {
                return { ok: false, message: 'Google Account not authorized. Please authorize first via the login page.', filename: null };
            }
        }

        log('Starting database backup...');

        tmpDir = mkdtempSync(path.join(tmpdir(), 'qc-backup-'));
        const fileName = `quality_${timestamp()}.xlsx`;
        snapshotPath = path.join(tmpDir, fileName);

        // Create Excel snapshot
        await createExcelSnapshot(snapshotPath);
        log('Excel snapshot created at', snapshotPath);

        const drive = buildDriveClient(cfg);
        log('Uploading to Google Drive...');
        const folderId = await resolveFolderId(drive, cfg);
        const uploaded = await uploadSnapshot(
            drive, snapshotPath, fileName, folderId,
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        log('Upload successful. File:', uploaded.name);

        let retentionNote = '';
        try {
            const deleted = await cleanupOldBackups(drive, cfg, folderId);
            if (deleted > 0) retentionNote = `, ${deleted} old backup(s) removed`;
        } catch (e) {
            log('Retention cleanup failed (non-fatal):', e.message);
        }

        lastBackupInfo = {
            timestamp: new Date().toISOString(),
            filename: uploaded.name,
            status: 'successful',
        };
        log('Backup completed');

        return { ok: true, message: 'Database backup uploaded successfully', filename: uploaded.name + retentionNote };
    } catch (e) {
        log('Backup failed:', e.message);
        lastBackupInfo = {
            timestamp: new Date().toISOString(),
            filename: snapshotPath ? path.basename(snapshotPath) : null,
            status: 'failed',
        };
        return { ok: false, message: `Google Drive backup failed: ${e.message}`, filename: null };
    } finally {
        if (tmpDir) {
            try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    }
}
