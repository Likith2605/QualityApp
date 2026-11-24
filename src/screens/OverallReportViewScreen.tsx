import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';
import { getDrawingReport } from '../db/repo';
import type { DrawingReport } from '../db/types';
import type { RootStackParamList } from '../navigation/types';
import { buildOverallReportHtml } from '../report/pdf';
import { getLogoDataUri } from '../report/logo';
import { exportReportPdf, printReport } from '../report/printReport';
import { useAuth } from '../context/AuthContext';
import { Button, EmptyState, Loading, Screen } from '../components/ui';
import ReportHtmlView from '../components/ReportHtmlView';

export default function OverallReportViewScreen() {
  const db = useSQLiteContext();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'OverallReportView'>>();
  const drawingId = route.params.drawingId;
  const { user } = useAuth();
  const [report, setReport] = useState<DrawingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [html, setHtml] = useState('');

  useEffect(() => {
    (async () => {
      const rep = await getDrawingReport(db, drawingId);
      setReport(rep);
      const logo = await getLogoDataUri().catch(() => '');
      setHtml(rep ? buildOverallReportHtml(rep, logo) : '');
      setLoading(false);
    })();
  }, [db, drawingId]);

  const exportPdf = useCallback(async () => {
    if (!report || !html || exporting) {
      return;
    }
    setExporting(true);
    try {
      await exportReportPdf(html, `Overall Report ${report.drawing.drawing_no}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('Error', msg || 'Could not generate the PDF report.');
    } finally {
      setExporting(false);
    }
  }, [report, html, exporting]);

  const printPdf = useCallback(async () => {
    if (!report || !html) {
      return;
    }
    try {
      await printReport(html);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('Error', msg || 'Could not open the print dialog.');
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
        {user?.role === 'admin' ? (
          <Button title="Dispatch" onPress={() => navigation.navigate('Dispatch', { drawingId })} variant="primary" style={styles.actionBtn} />
        ) : null}
      </View>
      <ReportHtmlView html={html} />
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
});
