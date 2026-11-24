import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useSQLiteContext } from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { useAuth } from './AuthContext';
import { hasSyncConfigured, isAutoSyncEnabled, setAutoSyncEnabled, syncNow } from '../db/sync';
import { connectRealtime, disconnectRealtime, refreshRealtime } from '../db/realtime';
import { notifySyncComplete } from '../db/syncEvents';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

interface AutoSyncState {
  enabled: boolean;
  status: SyncStatus;
  lastSyncTime: number | null;
  isOnline: boolean;
  toggle: () => void;
}

const AUTO_SYNC_KEY = 'auto_sync_enabled';

const AutoSyncContext = createContext<AutoSyncState>({
  enabled: true,
  status: 'idle',
  lastSyncTime: null,
  isOnline: true,
  toggle: () => {},
});

export function AutoSyncProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(true);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const syncInProgress = useRef(false);
  const mountedRef = useRef(true);
  const preferencesReadyRef = useRef(false);
  const toggleRequestedRef = useRef(false);
  const enabledRef = useRef(true);
  const userRef = useRef(user);
  const syncGenerationRef = useRef(0);
  const syncControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      syncGenerationRef.current++;
      syncControllerRef.current?.abort();
      setAutoSyncEnabled(false);
    };
  }, []);

  useEffect(() => {
    if (enabledRef.current === enabled) return;
    enabledRef.current = enabled;
    syncGenerationRef.current++;
    if (!enabled) syncControllerRef.current?.abort();
  }, [enabled]);

  useEffect(() => {
    if (userRef.current === user) return;
    userRef.current = user;
    syncGenerationRef.current++;
    syncControllerRef.current?.abort();
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    Storage.getItem(AUTO_SYNC_KEY)
      .then((value) => {
        if (cancelled || toggleRequestedRef.current) return;
        if (value === 'true' || value === 'false') {
          setEnabled(value === 'true');
        }
      })
      .catch(() => {})
      .finally(() => {
        if (cancelled) return;
        preferencesReadyRef.current = true;
        setPreferencesReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    Storage.setItem(AUTO_SYNC_KEY, String(enabled)).catch(() => {});
  }, [enabled, preferencesReady]);

  const doSync = useCallback(
    async (showSyncing = true) => {
      if (
        syncInProgress.current ||
        !preferencesReadyRef.current ||
        !userRef.current ||
        !enabledRef.current
      ) {
        return;
      }
      const generation = syncGenerationRef.current;
      const controller = new AbortController();
      syncControllerRef.current = controller;
      syncInProgress.current = true;
      if (showSyncing && mountedRef.current) setStatus('syncing');
      const isCurrent = () =>
        mountedRef.current &&
        syncGenerationRef.current === generation &&
        enabledRef.current &&
        Boolean(userRef.current) &&
        isAutoSyncEnabled();
      try {
        if (!isCurrent()) return;
        const configured = await hasSyncConfigured();
        if (!isCurrent()) return;
        if (!configured) {
          setStatus('idle');
          return;
        }
        const result = await syncNow(db, {
          signal: controller.signal,
          shouldContinue: isCurrent,
        });
        if (!isCurrent()) return;
        if (result.ok) {
          setStatus('synced');
          setLastSyncTime(Date.now());
          notifySyncComplete();
          // The sync engine re-logged-in automatically (expired server
          // session): reconnect the live-update socket with the fresh token.
          if (result.recovered) refreshRealtime();
        } else if (
          result.message.includes('Not logged in') ||
          result.message.includes('No sync server') ||
          result.message === 'Sync cancelled'
        ) {
          // Cancelled syncs are not failures - a newer sync is taking over.
          setStatus('idle');
        } else {
          setStatus('error');
        }
      } catch {
        if (isCurrent()) setStatus('error');
      } finally {
        if (syncControllerRef.current === controller) syncControllerRef.current = null;
        syncInProgress.current = false;
      }
    },
    [db],
  );

  useEffect(() => {
    const active = Boolean(preferencesReady && enabled && user);
    setAutoSyncEnabled(active);
    if (active) {
      connectRealtime(db);
    } else {
      disconnectRealtime();
      if (mountedRef.current) setStatus('idle');
    }
    return () => {
      disconnectRealtime();
      setAutoSyncEnabled(false);
    };
  }, [db, enabled, preferencesReady, user]);

  useEffect(() => {
    if (!preferencesReady || !user || !enabled) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        doSync();
      }
    });
    return () => sub.remove();
  }, [doSync, enabled, preferencesReady, user]);

  useEffect(() => {
    if (!preferencesReady || !user || !enabled) {
      if (!enabled && user) setStatus('idle');
      return;
    }
    const unsub = NetInfo.addEventListener((state) => {
      const online = state.isConnected ?? false;
      setIsOnline(online);
      if (!online) {
        setStatus('offline');
      } else if (online && !syncInProgress.current) {
        doSync(false);
      }
    });
    return unsub;
  }, [doSync, enabled, preferencesReady, user]);

  useEffect(() => {
    if (!preferencesReady || !user || !enabled) return;
    const interval = setInterval(() => {
      doSync(false);
    }, 30_000);
    return () => clearInterval(interval);
  }, [doSync, enabled, preferencesReady, user]);

  useEffect(() => {
    if (preferencesReady && user && enabled) {
      doSync();
    }
  }, [doSync, enabled, preferencesReady, user]);

  const toggle = useCallback(() => {
    toggleRequestedRef.current = true;
    const next = !enabledRef.current;
    enabledRef.current = next;
    syncGenerationRef.current++;
    if (!next) {
      syncControllerRef.current?.abort();
      setAutoSyncEnabled(false);
    }
    setEnabled(next);
  }, []);

  return (
    <AutoSyncContext.Provider value={{ enabled, status, lastSyncTime, isOnline, toggle }}>
      {children}
    </AutoSyncContext.Provider>
  );
}

export function useAutoSync() {
  return useContext(AutoSyncContext);
}
