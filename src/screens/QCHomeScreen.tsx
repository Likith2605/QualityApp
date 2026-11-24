import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';
import { deleteDrawing, deleteDrawingWithChecks, drawingCheckCount, getChecks, getDrawings } from '../db/repo';
import { scheduleAutoSync } from '../db/sync';
import { subscribeSync } from '../db/syncEvents';
import type { Drawing } from '../db/types';
import type { RootStackParamList } from '../navigation/types';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme';
import { confirmAction } from '../utils';
import { Badge, Button, Card, EmptyState, Loading, Screen, SearchBar, SectionTitle } from '../components/ui';

export default function QCHomeScreen() {
  const db = useSQLiteContext();
  const { user } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return drawings;
    const q = search.toLowerCase();
    return drawings.filter(
      (d) =>
        d.drawing_no.toLowerCase().includes(q) ||
        d.part_name.toLowerCase().includes(q) ||
        (d.customer ?? '').toLowerCase().includes(q)
    );
  }, [drawings, search]);

  const load = useCallback(async () => {
    setLoading(true);
    const list = await getDrawings(db);
    setDrawings(list);
    setLoading(false);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => subscribeSync(() => load()), [load]);

  const handleDelete = async (d: Drawing) => {
    if (!(await confirmAction('Delete part', `Delete ${d.drawing_no}?`, true))) return;
    try {
      const used = await drawingCheckCount(db, d.id);
      if (used > 0) {
        const confirmed = await confirmAction(
          'Confirm',
          `${d.drawing_no} has ${used} inspection(s). Deleting it will also delete those inspections and their measurements. Continue?`,
          true
        );
        if (!confirmed) return;
        await deleteDrawingWithChecks(db, d.id);
      } else {
        await deleteDrawing(db, d.id);
      }
      scheduleAutoSync(db);
      await load();
    } catch {
      Alert.alert('Error', 'Could not delete the part.');
    }
  };

  const handleOpenInspectionReport = async (d: Drawing) => {
    try {
      const checks = await getChecks(db);
      const check = checks
        .filter((c) => c.drawing_id === d.id)
        .sort((a, b) => Number(new Date(b.checked_at)) - Number(new Date(a.checked_at)))[0];

      if (!check) {
        Alert.alert('No inspection report available', `No inspection report is available for ${d.drawing_no}.`);
        return;
      }

      navigation.navigate('CheckReport', { checkId: check.id });
    } catch {
      Alert.alert('Error', 'Could not open the inspection report.');
    }
  };

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
        <SectionTitle>Parts to Inspect</SectionTitle>

        {loading ? (
          <Loading />
        ) : drawings.length === 0 ? (
          <EmptyState message="No drawings available. Ask the designer to add drawings first." />
        ) : (
        <>
          <SearchBar value={search} onChangeText={setSearch} placeholder="Search drawings..." />
          {filtered.length === 0 ? (
            <EmptyState message="No drawings match your search." />
          ) : (
            filtered.map((d) => {
          const dimCount = d.dim_count ?? 0;
          const checkedCount = d.checked_dim_count ?? 0;
          const allChecked = dimCount > 0 && checkedCount >= dimCount;
          return (
            <Card key={d.id}>
              <View style={styles.row}>
                <Text style={styles.drawingNo}>{d.drawing_no}</Text>
                {dimCount === 0 ? (
                  <Badge text="No dims" tone="danger" />
                ) : allChecked ? (
                  <Badge text={`${checkedCount}/${dimCount} checked`} tone="success" />
                ) : (
                  <Badge text={`${checkedCount}/${dimCount} checked`} tone="neutral" />
                )}
              </View>
              <Text style={styles.partName}>{d.part_name}</Text>
              <Text style={styles.meta}>
                {d.customer ? `${d.customer}  ·  ` : ''}Rev {d.revision}  ·  {d.unit}
              </Text>
              <View style={styles.actions}>
                <Button
                  title={dimCount === 0 ? 'No Dimensions Yet' : allChecked ? 'Check Again' : 'Start Inspection'}
                  onPress={() => navigation.navigate('QCCheck', { drawingId: d.id })}
                  variant={dimCount === 0 ? 'ghost' : allChecked ? 'outline' : 'success'}
                  disabled={dimCount === 0}
                  style={styles.actionBtn}
                />
                {checkedCount > 0 ? (
                  <Button
                    title="Overall Report"
                    onPress={() => navigation.navigate('OverallReport', { drawingId: d.id })}
                    variant="outline"
                    style={styles.actionBtn}
                  />
                ) : null}
                <Button
                  title="Individual Inspection Report"
                  onPress={() => handleOpenInspectionReport(d)}
                  variant="outline"
                  style={styles.actionBtn}
                />
                {user?.role === 'admin' ? (
                  <Button title="Delete Part" onPress={() => handleDelete(d)} variant="danger" style={styles.actionBtn} />
                ) : null}
              </View>
            </Card>
          );
        })
        )}
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
  drawingNo: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.primaryDark,
  },
  partName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginTop: 4,
  },
  meta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  actions: {
    marginTop: 8,
  },
  actionBtn: {
    marginTop: 6,
  },
});
