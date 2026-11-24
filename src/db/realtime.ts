import type { SQLiteDatabase } from 'expo-sqlite';
import { io, type Socket } from 'socket.io-client';
import {
  applyServerPush,
  ensureServerSession,
  getServerUrl,
  getSyncToken,
  isAutoSyncEnabled,
} from './sync';
import { notifySyncComplete } from './syncEvents';

let socket: Socket | null = null;
let dbRef: SQLiteDatabase | null = null;
let connectionGeneration = 0;
let active = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
// Backoff for auth-failure reconnects (socket.io's own reconnection only helps
// with network drops, not with an invalidated session token).
let authRetryDelay = 2000;

function clearReconnectTimer(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(generation: number, delay: number): void {
  if (!active || generation !== connectionGeneration) return;
  clearReconnectTimer();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void tryConnect(connectionGeneration);
  }, delay);
}

async function tryConnect(generation: number): Promise<void> {
  const url = await getServerUrl();
  if (generation !== connectionGeneration || !active || !dbRef) return;
  if (!url) return;
  let token = await getSyncToken();
  if (generation !== connectionGeneration || !active || !dbRef) return;
  if (!token) {
    // Fresh install / expired storage: recover the session silently.
    if (!(await ensureServerSession())) return;
    token = await getSyncToken();
    if (!token || generation !== connectionGeneration || !active) return;
  }
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  const s = io(url, {
    // websocket first for speed, polling as fallback when a proxy blocks WS.
    transports: ['websocket', 'polling'],
    auth: { token },
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
    timeout: 10000,
  });
  if (generation !== connectionGeneration || !active || !dbRef) {
    s.disconnect();
    return;
  }
  socket = s;
  s.on('connect', () => {
    authRetryDelay = 2000;
  });
  s.on('connect_error', (err: Error) => {
    if (generation !== connectionGeneration || s !== socket || !active) return;
    const msg = String(err?.message ?? '');
    // Auth failures mean the server session died (server restart, session
    // cleanup). Re-login and reconnect with a fresh token instead of failing
    // silently forever.
    if (msg.toLowerCase().includes('token') || msg.toLowerCase().includes('auth')) {
      clearReconnectTimer();
      void (async () => {
        if (!(await ensureServerSession())) return;
        if (generation !== connectionGeneration || !active) return;
        scheduleReconnect(generation, authRetryDelay);
        authRetryDelay = Math.min(authRetryDelay * 2, 60_000);
      })();
    }
    // For network-level errors socket.io keeps retrying on its own.
  });
  s.on('disconnect', (reason: string) => {
    if (generation !== connectionGeneration || s !== socket || !active) return;
    // "io server disconnect" means the server stopped us (e.g. token revoked
    // mid-session); socket.io will NOT retry on its own in that case.
    if (reason === 'io server disconnect') {
      clearReconnectTimer();
      void (async () => {
        if (!(await ensureServerSession())) return;
        if (generation !== connectionGeneration || !active) return;
        scheduleReconnect(generation, authRetryDelay);
        authRetryDelay = Math.min(authRetryDelay * 2, 60_000);
      })();
    }
  });
  s.on('sync:data', (payload) => {
    if (generation !== connectionGeneration || s !== socket || !dbRef) return;
    const currentDb = dbRef;
    void applyServerPush(currentDb, payload)
      .then(() => {
        if (isAutoSyncEnabled()) notifySyncComplete();
      })
      .catch(() => {});
  });
}

export function connectRealtime(db: SQLiteDatabase): void {
  connectionGeneration++;
  dbRef = db;
  active = true;
  authRetryDelay = 2000;
  clearReconnectTimer();
  void tryConnect(connectionGeneration);
}

export function refreshRealtime(): void {
  if (!active) return;
  connectionGeneration++;
  authRetryDelay = 2000;
  clearReconnectTimer();
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  void tryConnect(connectionGeneration);
}

export function disconnectRealtime(): void {
  connectionGeneration++;
  active = false;
  authRetryDelay = 2000;
  clearReconnectTimer();
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  dbRef = null;
}
