import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAutoSync, type SyncStatus } from '../context/AutoSyncContext';
import { colors } from '../theme';

function colorFor(status: SyncStatus, enabled: boolean): string {
  if (!enabled) return colors.textMuted;
  switch (status) {
    case 'syncing':
      return colors.primary;
    case 'synced':
      return colors.success;
    case 'offline':
      return colors.warning;
    case 'error':
      return colors.danger;
    default:
      return colors.textMuted;
  }
}

function labelFor(status: SyncStatus, enabled: boolean, isOnline: boolean): string {
  if (!enabled) return 'Auto Sync: OFF';
  switch (status) {
    case 'syncing':
      return 'Syncing...';
    case 'synced':
      return 'Synced';
    case 'offline':
      return 'Offline';
    case 'error':
      return 'Sync Failed';
    default:
      return isOnline ? 'Auto Sync: ON' : 'Offline';
  }
}

export default function SyncIndicator() {
  const { enabled, status, isOnline, toggle } = useAutoSync();
  const color = colorFor(status, enabled);

  return (
    <Pressable onPress={toggle} style={styles.container}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color }]} numberOfLines={1}>
        {labelFor(status, enabled, isOnline)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 5,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
});
