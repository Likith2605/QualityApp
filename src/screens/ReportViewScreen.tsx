import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { useSQLiteContext } from 'expo-sqlite';
import { getCheckReport } from '../db/repo';
import type { CheckReport } from '../db/types';
import type { RootStackParamList } from '../navigation/types';
import { buildReportHtml } from '../report/pdf';
import { getLogoDataUri } from '../report/logo';
import { exportReportPdf, printReport } from '../report/printReport';
import { Button, EmptyState, Loading, Screen } from '../components/ui';
import ReportHtmlView from '../components/ReportHtmlView';

export default function ReportViewScreen() {
  const db = useSQLiteContext();
  const route = useRoute<RouteProp<RootStackParamList, 'ReportView'>>();
  const checkId = route.params.checkId;
  const [report, setReport] = useState<CheckReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [html, setHtml] = useState('');

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const isFirstLoad = !report;
      if (isFirstLoad) setLoading(true);
      (async () => {
        const rep = await getCheckReport(db, checkId);
        if (cancelled) return;
        setReport(rep);
        const logo = await getLogoDataUri().catch(() => '');
        if (cancelled) return;
        setHtml(rep ? buildReportHtml(rep, logo) : '');
        if (isFirstLoad) setLoading(false);
      })();
      return () => { cancelled = true; };
    }, [db, checkId])
  );

  const exportPdf = useCallback(async () => {
    if (!report || !html || exporting) {
      return;
    }
    setExporting(true);
    try {
      await exportReportPdf(html, `Quality Report QIR-${report.check.id}`);
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
