import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSQLiteContext } from 'expo-sqlite';
import { getServerUrl, getSyncStatus, syncNow, hasSyncConfigured } from '../db/sync';
import { colors } from '../theme';
import { Button } from './ui';

export default function SyncBar() {
  const db = useSQLiteContext();
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState('');
  const [configured, setConfigured] = useState(false);

  const load = useCallback(async () => {
    const [serverUrl, lastStatus, isConfigured] = await Promise.all([
      getServerUrl(),
      getSyncStatus(),
      hasSyncConfigured(),
    ]);
    setConfigured(isConfigured);
    setStatus(lastStatus || (isConfigured ? `Server: ${serverUrl}` : ''));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await syncNow(db);
      setStatus(result.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <View style={styles.container}>
      {configured ? (
        <>
          <Text style={[styles.status, !status.includes('failed') && styles.statusOk]} numberOfLines={2}>
            {status || 'Ready to sync'}
          </Text>
          <Button title={syncing ? 'Syncing...' : 'Sync Now'} onPress={handleSync} variant="outline" style={styles.btn} loading={syncing} />
        </>
      ) : (
        <Text style={styles.status}>No sync server configured. Set it on the login screen.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  status: {
    fontSize: 12,
    color: colors.textMuted,
  },
  statusOk: {
    color: colors.text,
  },
  btn: {
    marginTop: 8,
    paddingVertical: 8,
  },
});
