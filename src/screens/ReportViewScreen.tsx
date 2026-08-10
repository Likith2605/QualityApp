import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import { useSQLiteContext } from 'expo-sqlite';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { WebView } from 'react-native-webview';
import { getCheckReport } from '../db/repo';
import type { CheckReport } from '../db/types';
import type { RootStackParamList } from '../navigation/types';
import { buildReportHtml } from '../report/pdf';
import { colors } from '../theme';
import { Button, EmptyState, Loading, Screen } from '../components/ui';

export default function ReportViewScreen() {
  const db = useSQLiteContext();
  const route = useRoute<RouteProp<RootStackParamList, 'ReportView'>>();
  const checkId = route.params.checkId;
  const [report, setReport] = useState<CheckReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    (async () => {
      const rep = await getCheckReport(db, checkId);
      setReport(rep);
      setLoading(false);
    })();
  }, [db, checkId]);

  const html = report ? buildReportHtml(report) : '';

  const exportPdf = useCallback(async () => {
    if (!report) {
      return;
    }
    setExporting(true);
    try {
      const { uri } = await Print.printToFileAsync({ html });
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          UTI: 'com.adobe.pdf',
          dialogTitle: `Quality Report QIR-${report.check.id}`,
        });
      } else {
        Alert.alert('Exported', `Report saved to ${uri}`);
      }
    } catch {
      Alert.alert('Error', 'Could not generate the PDF report.');
    } finally {
      setExporting(false);
    }
  }, [report, html]);

  const printPdf = useCallback(async () => {
    if (!report) {
      return;
    }
    try {
      await Print.printAsync({ html });
    } catch {
      Alert.alert('Error', 'Could not open the print dialog.');
    }
  }, [report, html]);

  if (loading) {
    return <Loading />;
  }

  if (!report) {
    return <EmptyState message="Report not found." />;
  }

  return (
    <Screen>
      <View style={styles.actions}>
        <Button title="Export PDF" onPress={exportPdf} loading={exporting} variant="success" style={styles.actionBtn} />
        <Button title="Print" onPress={printPdf} variant="outline" style={styles.actionBtn} />
      </View>
      <WebView
        style={styles.webview}
        originWhitelist={['*']}
        source={{ html }}
        textZoom={80}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  actionBtn: {
    marginVertical: 4,
  },
  webview: {
    flex: 1,
    backgroundColor: colors.background,
    marginTop: 6,
  },
});
