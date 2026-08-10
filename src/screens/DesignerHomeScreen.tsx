import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';
import { getDrawings } from '../db/repo';
import type { Drawing } from '../db/types';
import type { RootStackParamList } from '../navigation/types';
import { colors } from '../theme';
import { Button, Card, EmptyState, Loading, Screen, SectionTitle } from '../components/ui';

export default function DesignerHomeScreen() {
  const db = useSQLiteContext();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <Screen>
      <View style={styles.topBar}>
        <Button title="+ New Drawing" onPress={() => navigation.navigate('DrawingForm')} />
      </View>

      <SectionTitle>Drawings</SectionTitle>

      {loading ? (
        <Loading />
      ) : drawings.length === 0 ? (
        <EmptyState message="No drawings yet. Create a new drawing and add its measurements and tolerances." />
      ) : (
        drawings.map((d) => (
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
