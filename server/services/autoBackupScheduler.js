import { backupToGoogleDrive } from './googleDriveBackupService.js';

const SCHEDULED_KEY = Symbol('qc_backup_scheduler_started');

const RETRY_MAX = 3;
const RETRY_BASE_DELAY_MS = 30 * 1000;
const RETRY_MAX_DELAY_MS = 10 * 60 * 1000;

let timer = null;
let retryCount = 0;
let shuttingDown = false;

function parseHours(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
}

function delayToScheduleMs() {
    const hours = parseHours(process.env.BACKUP_INTERVAL_HOURS);
    if (hours == null) return 6 * 60 * 60 * 1000;
    return hours * 60 * 60 * 1000;
}

function retryDelay() {
    const exponent = Math.min(retryCount - 1, 5);
    return Math.min(RETRY_BASE_DELAY_MS * Math.pow(2, exponent), RETRY_MAX_DELAY_MS);
}

function scheduleNext(ms) {
    if (shuttingDown) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
        timer = null;
        void runScheduledBackup();
    }, ms);
}

async function runScheduledBackup() {
    if (shuttingDown) return;
    if (retryCount >= RETRY_MAX) {
        // Give up until the next normal schedule.
        retryCount = 0;
        scheduleNext(delayToScheduleMs());
        return;
    }
    const result = await backupToGoogleDrive();
    if (result.ok) {
        retryCount = 0;
        scheduleNext(delayToScheduleMs());
    } else {
        retryCount++;
        scheduleNext(retryDelay());
    }
}

export function startAutoBackupScheduler(db) {
    if (global[SCHEDULED_KEY]) return global[SCHEDULED_KEY];
    const handle = { stop: stopAutoBackupScheduler };
    global[SCHEDULED_KEY] = handle;
    _start(db);
    return handle;
}

function _start(db) {
    const enabled = String(process.env.GOOGLE_DRIVE_BACKUP_ENABLED || 'true').toLowerCase() === 'true';
    if (!enabled) {
        console.log('[BACKUP] Auto backup disabled (GOOGLE_DRIVE_BACKUP_ENABLED=false)');
        return;
    }
    const intervalMs = delayToScheduleMs();
    const intervalLabel = intervalMs >= 3600000 ? `${intervalMs / 3600000} hours` : `${intervalMs / 60000} minutes`;
    console.log(`[BACKUP] Auto backup scheduler started (every ${intervalLabel})`);
    scheduleNext(intervalMs);
}

export function stopAutoBackupScheduler() {
    shuttingDown = true;
    if (timer) clearTimeout(timer);
    timer = null;
}
