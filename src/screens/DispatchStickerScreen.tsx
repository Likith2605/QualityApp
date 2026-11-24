import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';
import QRCode from 'react-native-qrcode-svg';
import { getDispatch } from '../db/repo';
import type { Dispatch } from '../db/types';
import type { RootStackParamList } from '../navigation/types';
import { buildDispatchQrSvg, buildDispatchQrText, buildStickerHtml } from '../report/sticker';
import { exportReportPdf, printReport } from '../report/printReport';
import { formatDate } from '../utils';
import { colors } from '../theme';
import { Button, Card, EmptyState, KeyValue, Loading, Screen, SectionTitle } from '../components/ui';

export default function DispatchStickerScreen() {
  const db = useSQLiteContext();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'DispatchSticker'>>();
  const dispatchId = route.params.dispatchId;

  const [dispatch, setDispatch] = useState<Dispatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const d = await getDispatch(db, dispatchId);
      setDispatch(d);
      setLoading(false);
    })();
  }, [db, dispatchId]);

  const runWithPdf = useCallback(
    async (action: (html: string) => Promise<void>) => {
      if (!dispatch) {
        return;
      }
      setBusy(true);
      try {
        const qrSvg = await buildDispatchQrSvg(dispatch);
        const html = buildStickerHtml(dispatch, qrSvg);
        await action(html);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('sticker generation failed:', msg);
        Alert.alert('Error', `Could not generate the sticker.\n\n${msg}`);
      } finally {
        setBusy(false);
      }
    },
    [dispatch]
  );

  const exportPdf = useCallback(() => {
    runWithPdf(async (html) => {
      await exportReportPdf(html, `Dispatch Sticker ${dispatch?.dispatch_no ?? ''}`);
    });
  }, [dispatch, runWithPdf]);

  const printPdf = useCallback(() => {
    runWithPdf(printReport);
  }, [runWithPdf]);

  if (loading) {
    return <Loading />;
  }

  if (!dispatch) {
    return <EmptyState message="Dispatch record not found." />;
  }

  const qrText = buildDispatchQrText(dispatch);

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
        <SectionTitle>Dispatch Sticker</SectionTitle>

        <Card>
          <Text style={styles.qrTitle}>{dispatch.dispatch_no}</Text>
          <View style={styles.qrWrap}>
            <QRCode value={qrText} size={200} />
          </View>
          <Text style={styles.qrNote}>Scan the QR to read the dispatch data</Text>
        </Card>

        <Card>
          <KeyValue label="Purchase Order No" value={dispatch.po_no || '-'} />
          <KeyValue label="Serial No" value={dispatch.dispatch_no} />
          <KeyValue label="DWG No" value={dispatch.drawing_no} />
          <KeyValue label="Part Name" value={dispatch.part_name} />
          <KeyValue label="Qty" value={dispatch.qty || '-'} />
          <KeyValue label="Inv No" value={dispatch.invoice_no || '-'} />
          <KeyValue label="Dispatched" value={formatDate(dispatch.dispatched_at)} />
          {dispatch.notes ? <KeyValue label="Notes" value={dispatch.notes} /> : null}
        </Card>

        <View style={{ paddingHorizontal: 16 }}>
          <Button title="Print Sticker" onPress={printPdf} loading={busy} />
          <Button title="Export Sticker PDF" onPress={exportPdf} variant="success" />
          <Button title="Back to Report" onPress={() => navigation.goBack()} variant="ghost" />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  qrTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.primaryDark,
    textAlign: 'center',
    marginBottom: 10,
  },
  qrWrap: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  qrNote: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 10,
  },
});
