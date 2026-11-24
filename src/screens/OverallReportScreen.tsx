import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { colors } from '../theme';
import { effectiveNominal, fmt, isInTolerance, isTextSpec, parseStatuses, samplesOf, toleranceText } from '../utils';
import DrawingImage from '../components/DrawingImage';
import { Badge, Button, Card, EmptyState, KeyValue, Loading, Screen, SectionTitle } from '../components/ui';

export default function OverallReportScreen() {
  const db = useSQLiteContext();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'OverallReport'>>();
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

  const { drawing, checks, rows, dims } = report;
  const passedCount = rows.filter((r) => r.pass === 1).length;
  const failedCount = rows.length - passedCount;
  const pending = dims.filter((d) => !d.checked);
  const instruments: string[] = [];
  for (const row of rows) {
    const name = row.instrument?.trim();
    if (name && !instruments.includes(name)) {
      instruments.push(name);
    }
  }

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
        <Card>
          <View style={styles.headRow}>
            <Text style={styles.title}>{drawing.drawing_no}</Text>
            <Badge text={`${passedCount} OK / ${failedCount} FAIL / ${pending.length} Pending`} tone={failedCount === 0 ? 'success' : 'danger'} />
          </View>
          <KeyValue label="Part Name" value={drawing.part_name} />
          <KeyValue label="Customer" value={drawing.customer || '-'} />
          <KeyValue label="Inspections Combined" value={`${checks.length}`} />
          <KeyValue label="Instruments" value={instruments.join(', ') || '-'} />
        </Card>

        <SectionTitle>Combined Dimensional Results</SectionTitle>

        {dims.map((dim, index) => {
          const row = rows.find((r) => r.dimension_id === dim.id);
          if (row) {
            const isSpec = isTextSpec(dim.nominal_text);
            const samples = samplesOf(row);
            const storedStatusCount = (row.sample_status ?? '').split('|').filter((s) => s === 'OK' || s === 'NOT OK').length;
            const sampleStatuses = parseStatuses(row.sample_status, Math.max(5, storedStatusCount));
            const shown = isSpec ? Math.max(5, storedStatusCount) : Math.max(5, samples.filter((s) => s !== null && s !== undefined).length);
            return (
              <Card key={dim.id}>
                <View style={styles.row}>
                  <Text style={styles.dimLabel}>
                    {index + 1}. Dim {dim.dim_no}{dim.description ? ` · ${dim.description}` : ''}
                  </Text>
                  <Badge text={row.pass === 1 ? 'OK' : 'FAIL'} tone={row.pass === 1 ? 'success' : 'danger'} />
                </View>
                <View style={styles.specRow}>
                  <Text style={styles.spec}>
                    {isSpec ? dim.nominal_text : `Nominal ${fmt(effectiveNominal(dim.nominal, dim.nominal_text))} ${drawing.unit}  ${toleranceText(dim.tol_upper, dim.tol_lower)}`}
                  </Text>
                </View>
                <Text style={styles.inspector}>
                  Checked at {row.checked_at}
                  {row.instrument ? `  ·  Instrument: ${row.instrument}` : ''}
                </Text>
                <View style={styles.samplesRow}>
                  {Array.from({ length: shown }, (_, i) => {
                    if (isSpec) {
                      const status = sampleStatuses[i];
                      return (
                        <View
                          key={i}
                          style={[styles.sampleBox, status === 'OK' ? styles.sampleBoxPass : status === 'NOT OK' ? styles.sampleBoxFail : undefined]}
                        >
                          <Text style={styles.sampleLabel}>S{i + 1}</Text>
                          <Text
                            style={[
                              styles.sampleValue,
                              status === 'OK' ? styles.sampleValuePass : status === 'NOT OK' ? styles.sampleValueFail : undefined,
                            ]}
                          >
                            {status || '-'}
                          </Text>
                        </View>
                      );
                    }
                    const s = samples[i];
                    const entered = s !== null && s !== undefined;
                    const good = entered && isInTolerance(s, effectiveNominal(dim.nominal, dim.nominal_text), dim.tol_upper, dim.tol_lower);
                    return (
                      <View
                        key={i}
                        style={[styles.sampleBox, entered && (good ? styles.sampleBoxPass : styles.sampleBoxFail)]}
                      >
                        <Text style={styles.sampleLabel}>S{i + 1}</Text>
                        <Text
                          style={[
                            styles.sampleValue,
                            entered && (good ? styles.sampleValuePass : styles.sampleValueFail),
                          ]}
                        >
                          {entered ? fmt(s) : '-'}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </Card>
            );
          }
          const isSpecDim = isTextSpec(dim.nominal_text);
          return (
            <Card key={dim.id}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dimLabel}>
                    {index + 1}. Dim {dim.dim_no}{dim.description ? ` · ${dim.description}` : ''}
                  </Text>
                  <Text style={styles.spec}>
                    {isSpecDim ? dim.nominal_text : `Nominal ${fmt(effectiveNominal(dim.nominal, dim.nominal_text))} ${drawing.unit}  ${toleranceText(dim.tol_upper, dim.tol_lower)}`}
                  </Text>
                </View>
                <Badge text="PENDING" tone="neutral" />
              </View>
            </Card>
          );
        })}

        <View style={{ paddingHorizontal: 16 }}>
          <Text style={styles.summary}>
            {rows.length} of {dims.length} dimensions checked · {passedCount} passed · {failedCount} failed · {pending.length} remaining · {checks.length} inspections
          </Text>
        </View>

        <View style={{ paddingHorizontal: 16 }}>
          <Button title="View Report" onPress={() => navigation.navigate('OverallReportView', { drawingId })} />
          <Button title="Export PDF" onPress={exportPdf} loading={exporting} variant="success" />
          <Button title="Print" onPress={printPdf} variant="outline" />
          {user?.role === 'admin' ? (
            <Button title="Dispatch" onPress={() => navigation.navigate('Dispatch', { drawingId })} />
          ) : null}
          <Button title="Back to Inspect" onPress={() => navigation.navigate('Tabs')} variant="ghost" />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.primaryDark,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  dimLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  specRow: {
    marginTop: 2,
  },
  spec: {
    fontSize: 12,
    color: colors.textMuted,
  },
  inspector: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
    marginTop: 4,
  },
  samplesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  sampleBox: {
    flex: 1,
    marginHorizontal: 3,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 6,
    alignItems: 'center',
  },
  sampleBoxPass: {
    borderColor: colors.success,
    backgroundColor: colors.successBg,
  },
  sampleBoxFail: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerBg,
  },
  sampleLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textMuted,
  },
  sampleValue: {
    fontSize: 13,
    color: colors.text,
    marginTop: 2,
    fontWeight: '600',
  },
  sampleValuePass: {
    color: colors.success,
    fontWeight: '800',
  },
  sampleValueFail: {
    color: colors.danger,
    fontWeight: '800',
  },
  summary: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    marginTop: 6,
  },
});
