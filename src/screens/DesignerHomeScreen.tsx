import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';
import { getDrawings } from '../db/repo';
import { subscribeSync } from '../db/syncEvents';
import type { Drawing } from '../db/types';
import type { RootStackParamList } from '../navigation/types';
import { colors } from '../theme';
import { Button, Card, EmptyState, Loading, Screen, SearchBar, SectionTitle } from '../components/ui';

export default function DesignerHomeScreen() {
  const db = useSQLiteContext();
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

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={styles.topBar}>
          <Button title="+ New Drawing" onPress={() => navigation.navigate('DrawingForm')} />
        </View>

        <SectionTitle>Drawings</SectionTitle>

      {loading ? (
        <Loading />
      ) : drawings.length === 0 ? (
        <EmptyState message="No drawings yet. Create a new drawing and add its measurements and tolerances." />
      ) : (
        <>
          <SearchBar value={search} onChangeText={setSearch} placeholder="Search drawings..." />
          {filtered.length === 0 ? (
            <EmptyState message="No drawings match your search." />
          ) : (
            filtered.map((d) => (
              <Card key={d.id} onPress={() => navigation.navigate('DrawingDetail', { drawingId: d.id })}>
                <View style={styles.row}>
                  <Text style={styles.drawingNo}>{d.drawing_no}</Text>
                  <Text style={styles.dimCount}>{d.dim_count ?? 0} dims</Text>
                </View>
                <Text style={styles.partName}>{d.part_name}</Text>
                <Text style={styles.meta}>
                  {d.customer ? `${d.customer}  ·  ` : ''}Rev {d.revision}  ·  {d.unit}
                </Text>
                <Text style={styles.meta}>
                  Designed by {d.designer_name ?? '-'} on {d.created_at}
                </Text>
              </Card>
            ))
          )}
        </>
      )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: {
    margin: 16,
    marginBottom: 0,
  },
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
  dimCount: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
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
});
