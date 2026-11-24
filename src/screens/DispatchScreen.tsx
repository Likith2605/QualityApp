import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';
import { addDispatch, getDrawingReport } from '../db/repo';
import { scheduleAutoSync } from '../db/sync';
import type { DrawingReport } from '../db/types';
import type { RootStackParamList } from '../navigation/types';
import { useAuth } from '../context/AuthContext';
import { generateDispatchNo } from '../report/sticker';
import { colors } from '../theme';
import { Button, Card, EmptyState, Field, KeyValue, Loading, Screen, SectionTitle } from '../components/ui';

export default function DispatchScreen() {
  const db = useSQLiteContext();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Dispatch'>>();
  const drawingId = route.params.drawingId;
  const { user } = useAuth();

  const [report, setReport] = useState<DrawingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [serialNo, setSerialNo] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const rep = await getDrawingReport(db, drawingId);
      setReport(rep);
      setSerialNo(generateDispatchNo());
      setLoading(false);
    })();
  }, [db, drawingId]);

  if (loading) {
    return <Loading />;
  }

  if (!report || report.checks.length === 0) {
    return (
      <EmptyState message="No final inspection report found for this drawing. Complete the inspection first." />
    );
  }

  const { drawing, checks, rows, dims } = report;
  const passedCount = rows.filter((r) => r.pass === 1).length;
  const failedCount = rows.length - passedCount;
  const pending = dims.filter((d) => !d.checked);

  const dispatchNow = async () => {
    if (!user) {
      Alert.alert('Error', 'You must be logged in.');
      return;
    }
    setSaving(true);
    try {
      const id = await addDispatch(db, {
        dispatch_no: serialNo,
        drawing_id: drawing.id,
        drawing_no: drawing.drawing_no,
        part_name: drawing.part_name,
        po_no: drawing.po_no,
        invoice_no: drawing.invoice_no,
        qty: drawing.qty,
        dispatched_by: user.id,
        notes,
      });
      scheduleAutoSync(db);
      navigation.replace('DispatchSticker', { dispatchId: id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('addDispatch failed:', msg);
      Alert.alert('Error', `Could not create the dispatch record.\n\n${msg}`);
      setSaving(false);
    }
  };

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
        <SectionTitle>Dispatch {drawing.drawing_no}</SectionTitle>
        <Text style={styles.hint}>
          Data below is fetched automatically from the final inspection report.
        </Text>

        <Card>
          <KeyValue label="From Final Report" value={`${checks.length} inspections · ${passedCount} OK · ${failedCount} FAIL · ${pending.length} Pending`} />
        </Card>

        <Card>
          <KeyValue label="Purchase Order No" value={drawing.po_no || '-'} />
          <KeyValue label="Serial No (auto)" value={serialNo} />
          <KeyValue label="DWG No" value={drawing.drawing_no} />
          <KeyValue label="Part Name" value={drawing.part_name} />
          <KeyValue label="Qty" value={drawing.qty || '-'} />
          <KeyValue label="Inv No" value={drawing.invoice_no || '-'} />
          <KeyValue label="Customer" value={drawing.customer || '-'} />
        </Card>

        <Card>
          <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline placeholder="Any dispatch remarks" />
          <View style={{ paddingHorizontal: 16 }}>
            <Button title="Dispatch & Generate Sticker" onPress={dispatchNow} loading={saving} />
            <Button title="Cancel" onPress={() => navigation.goBack()} variant="ghost" />
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: {
    fontSize: 12,
    color: colors.textMuted,
    marginHorizontal: 16,
    marginBottom: 8,
  },
});
