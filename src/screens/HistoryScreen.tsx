import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';
import { deleteCheck, getChecks, getDispatches } from '../db/repo';
import { scheduleAutoSync } from '../db/sync';
import { subscribeSync } from '../db/syncEvents';
import type { CheckRecord, Dispatch } from '../db/types';
import type { RootStackParamList } from '../navigation/types';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme';
import { confirmAction } from '../utils';
import { Badge, Card, EmptyState, Loading, Screen, SearchBar, SectionTitle } from '../components/ui';

export default function HistoryScreen() {
  const db = useSQLiteContext();
  const { user } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [checks, setChecks] = useState<CheckRecord[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const isAdmin = user?.role === 'admin';

  const filteredChecks = useMemo(() => {
    if (!search.trim()) return checks;
    const q = search.toLowerCase();
    return checks.filter(
      (c) =>
        (c.drawing_no ?? '').toLowerCase().includes(q) ||
        (c.part_name ?? '').toLowerCase().includes(q) ||
        (c.inspector_name ?? '').toLowerCase().includes(q) ||
        (c.inspector_employee_name ?? '').toLowerCase().includes(q)
    );
  }, [checks, search]);

  const filteredDispatches = useMemo(() => {
    if (!search.trim()) return dispatches;
    const q = search.toLowerCase();
    return dispatches.filter(
      (d) =>
        d.dispatch_no.toLowerCase().includes(q) ||
        d.drawing_no.toLowerCase().includes(q) ||
        (d.part_name ?? '').toLowerCase().includes(q) ||
        (d.po_no ?? '').toLowerCase().includes(q)
    );
  }, [dispatches, search]);

  const load = useCallback(async () => {
    setLoading(true);
    const list = await getChecks(db);
    setChecks(list);
    if (isAdmin) {
      setDispatches(await getDispatches(db));
    }
    setLoading(false);
  }, [db, isAdmin]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => subscribeSync(() => load()), [load]);

  const handleDelete = async (c: CheckRecord) => {
    if (!(await confirmAction('Delete inspection', `Delete QIR-${c.id} (${c.drawing_no})? This removes the recorded measurements.`, true))) return;
    try {
      await deleteCheck(db, c.id);
      scheduleAutoSync(db);
      await load();
    } catch {
      Alert.alert('Error', 'Could not delete the inspection.');
    }
  };

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
        <SectionTitle>Inspection History</SectionTitle>

      {loading ? (
        <Loading />
      ) : checks.length === 0 ? (
        <EmptyState message="No inspections recorded yet." />
      ) : (
        <>
          <SearchBar value={search} onChangeText={setSearch} placeholder="Search inspections, dispatches..." />
          {filteredChecks.length === 0 ? (
            search.trim() ? null : <EmptyState message="No inspections recorded yet." />
          ) : (
            filteredChecks.map((c) => (
              <Card key={c.id} onPress={() => navigation.navigate('CheckReport', { checkId: c.id })}>
                <View style={styles.row}>
                  <Text style={styles.title}>
                    {c.drawing_no} · {c.part_name}
                  </Text>
                  <Badge text={`${c.ok_count ?? 0} OK / ${c.ng_count ?? 0} FAIL`} tone="neutral" />
                  {user?.role === 'admin' ? (
                    <Pressable
                      onPress={() => handleDelete(c)}
                      style={({ pressed }) => [styles.deleteBtn, pressed && styles.pressed]}
                      hitSlop={8}
                      accessibilityLabel={`Delete inspection QIR-${c.id}`}
                    >
                      <Text style={styles.deleteBtnText}>✕</Text>
                    </Pressable>
                  ) : null}
                </View>
                <Text style={styles.meta}>Inspector: {c.inspector_name || c.inspector_employee_name}</Text>
                <Text style={styles.meta}>Date & Time: {c.checked_at}</Text>
              </Card>
            ))
          )}

        {isAdmin ? (
          <>
            <SectionTitle>Dispatch History</SectionTitle>
            {filteredDispatches.length === 0 ? (
              search.trim() ? null : <EmptyState message="No dispatches recorded yet." />
            ) : (
              filteredDispatches.map((d) => (
                <Card
                  key={d.id}
                  onPress={() => navigation.navigate('DispatchSticker', { dispatchId: d.id })}
                >
                  <View style={styles.row}>
                    <Text style={styles.title}>
                      {d.dispatch_no} · {d.drawing_no}
                    </Text>
                    <Badge text="Dispatched" tone="success" />
                  </View>
                  <Text style={styles.meta}>Part: {d.part_name}</Text>
                  <Text style={styles.meta}>PO: {d.po_no || '-'} · INV: {d.invoice_no || '-'} · Qty: {d.qty || '-'}</Text>
                  <Text style={styles.meta}>Dispatched on {d.dispatched_at}</Text>
                  <Text style={styles.meta}>By: {d.dispatcher_name || d.dispatcher_employee_id}</Text>
                  <Text style={styles.openSticker}>Tap to view / reprint the sticker</Text>
                </Card>
              ))
            )}
          </>
        ) : null}
        </>
      )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
    marginRight: 8,
  },
  meta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 3,
  },
  deleteBtn: {
    marginLeft: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dangerBg,
  },
  deleteBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.danger,
    lineHeight: 16,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  openSticker: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
});
