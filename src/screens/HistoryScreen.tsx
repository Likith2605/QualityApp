import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';
import { getChecks } from '../db/repo';
import type { CheckRecord } from '../db/types';
import type { RootStackParamList } from '../navigation/types';
import { colors } from '../theme';
import { Badge, Card, EmptyState, Loading, Screen, SectionTitle } from '../components/ui';

export default function HistoryScreen() {
  const db = useSQLiteContext();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [checks, setChecks] = useState<CheckRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const list = await getChecks(db);
    setChecks(list);
    setLoading(false);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <Screen>
      <SectionTitle>Inspection History</SectionTitle>

      {loading ? (
        <Loading />
      ) : checks.length === 0 ? (
        <EmptyState message="No inspections recorded yet." />
      ) : (
        checks.map((c) => (
          <Card key={c.id} onPress={() => navigation.navigate('CheckReport', { checkId: c.id })}>
            <View style={styles.row}>
              <Text style={styles.title}>
                {c.drawing_no} · {c.part_name}
              </Text>
              <Badge text={`${c.ok_count ?? 0} OK / ${c.ng_count ?? 0} NG`} tone="neutral" />
            </View>
            <Text style={styles.meta}>Inspector: {c.inspector_name || c.inspector_employee_name}</Text>
            <Text style={styles.meta}>Date & Time: {c.checked_at}</Text>
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
});
