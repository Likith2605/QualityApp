import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';
import { getDrawings } from '../db/repo';
import type { Drawing } from '../db/types';
import type { RootStackParamList } from '../navigation/types';
import { colors } from '../theme';
import { Badge, Button, Card, EmptyState, Loading, Screen, SectionTitle } from '../components/ui';

export default function QCHomeScreen() {
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
      <SectionTitle>Parts to Inspect</SectionTitle>

      {loading ? (
        <Loading />
      ) : drawings.length === 0 ? (
        <EmptyState message="No drawings available. Ask the designer to add drawings first." />
      ) : (
        drawings.map((d) => (
          <Card key={d.id}>
            <View style={styles.row}>
              <Text style={styles.drawingNo}>{d.drawing_no}</Text>
              {d.dim_count === 0 ? (
                <Badge text="No dims" tone="danger" />
              ) : (
                <Badge text={`${d.dim_count} dims`} tone="neutral" />
              )}
            </View>
            <Text style={styles.partName}>{d.part_name}</Text>
            <Text style={styles.meta}>
              {d.customer ? `${d.customer}  ·  ` : ''}Rev {d.revision}  ·  {d.unit}
            </Text>
            <Button
              title={d.dim_count === 0 ? 'No Dimensions Yet' : 'Start Inspection'}
              onPress={() => navigation.navigate('QCCheck', { drawingId: d.id })}
              variant={d.dim_count === 0 ? 'ghost' : 'success'}
              disabled={d.dim_count === 0}
              style={{ marginTop: 8 }}
            />
          </Card>
        ))
      )}
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
});
