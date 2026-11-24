import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';
import { getCheckReport } from '../db/repo';
import type { CheckReport } from '../db/types';
import type { RootStackParamList } from '../navigation/types';
import { buildReportHtml } from '../report/pdf';
import { getLogoDataUri } from '../report/logo';
import { exportReportPdf, printReport } from '../report/printReport';
import { colors } from '../theme';
import { effectiveNominal, fmt, isTextSpec, limits, parseStatuses, samplesOf, toleranceText } from '../utils';
import DrawingImage from '../components/DrawingImage';
import { Badge, Button, Card, EmptyState, KeyValue, Loading, Screen, SectionTitle } from '../components/ui';

export default function CheckReportScreen() {
  const db = useSQLiteContext();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'CheckReport'>>();
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

  const { check, rows, dims } = report;
  const passedCount = rows.filter((r) => r.pass === 1).length;
  const failedCount = rows.length - passedCount;
  const pending = dims.filter((d) => !d.checked);
  const instruments = [...new Set(rows.map((row) => row.instrument?.trim()).filter(Boolean))].join(', ');

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
        <Card>
          <View style={styles.headRow}>
            <Text style={styles.title}>{check.drawing_no ?? 'Inspection Report'}</Text>
            <Badge text={`${passedCount} OK / ${failedCount} FAIL / ${pending.length} Pending`} tone="neutral" />
          </View>
          <KeyValue label="Drawing No" value={check.drawing_no ?? '-'} />
          <KeyValue label="Part Name" value={check.part_name ?? '-'} />
          <KeyValue label="Customer" value={check.customer || '-'} />
          <KeyValue label="Inspector" value={check.inspector_name || check.inspector_employee_name || '-'} />
          <KeyValue label="Instrument" value={instruments || '-'} />
          <KeyValue label="Date & Time" value={check.checked_at} />
        </Card>

        <DrawingImage uri={check.image_uri} label="Drawing Attachment" />

        <SectionTitle>Measurement Comparison</SectionTitle>

        {rows.map((row, index) => {
          const isSpec = isTextSpec(row.nominal_text);
          const samples = samplesOf(row);
          const storedStatusCount = (row.sample_status ?? '').split('|').filter((s) => s === 'OK' || s === 'NOT OK').length;
          const sampleStatuses = parseStatuses(row.sample_status, Math.max(5, storedStatusCount));
          const shown = isSpec ? Math.max(5, storedStatusCount) : Math.max(5, samples.filter((s) => s !== null && s !== undefined).length);
          return (
            <Card key={row.id}>
              <View style={styles.row}>
                <Text style={styles.dimLabel}>
                  {index + 1}. Dim {row.dim_no}{row.description ? ` · ${row.description}` : ''}
                </Text>
                <Badge text={row.pass === 1 ? 'OK' : 'FAIL'} tone={row.pass === 1 ? 'success' : 'danger'} />
              </View>
              <View style={styles.specRow}>
                <Text style={styles.spec}>
                  {isSpec ? row.nominal_text : `Nominal ${fmt(effectiveNominal(row.nominal, row.nominal_text))} ${check.unit}  ${toleranceText(row.tol_upper, row.tol_lower)}`}
                </Text>
                <Text style={styles.spec}>Instrument: {row.instrument || '-'}</Text>
                <Text style={styles.spec}>
                  Checked by: {row.inspector_name || row.inspector_employee_name || check.inspector_name || check.inspector_employee_name || '-'}
                  {row.checked_at ? `  ·  ${row.checked_at}` : ''}
                </Text>
              </View>
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
                  const { min, max } = limits(effectiveNominal(row.nominal, row.nominal_text), row.tol_upper, row.tol_lower);
                  const EPS = 1e-9;
                  const s = samples[i];
                  const entered = s !== null && s !== undefined;
                  const inRange = entered && s >= min - EPS && s <= max + EPS;
                  return (
                    <View
                      key={i}
                      style={[styles.sampleBox, entered && (inRange ? styles.sampleBoxPass : styles.sampleBoxFail)]}
                    >
                      <Text style={styles.sampleLabel}>S{i + 1}</Text>
                      <Text
                        style={[
                          styles.sampleValue,
                          entered && (inRange ? styles.sampleValuePass : styles.sampleValueFail),
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
        })}

        {pending.length > 0 ? (
          <>
            <SectionTitle>Not Yet Checked ({pending.length})</SectionTitle>
            {pending.map((dim) => (
              <Card key={dim.id}>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dimLabel}>
                      Dim {dim.dim_no}{dim.description ? ` · ${dim.description}` : ''}
                    </Text>
                    <Text style={styles.spec}>
                      {isTextSpec(dim.nominal_text)
                        ? dim.nominal_text
                        : `Nominal ${fmt(effectiveNominal(dim.nominal, dim.nominal_text))} ${check.unit}  ${toleranceText(dim.tol_upper, dim.tol_lower)}`}
                    </Text>
                  </View>
                  <Badge text="PENDING" tone="neutral" />
                </View>
              </Card>
            ))}
          </>
        ) : null}

        <View style={{ paddingHorizontal: 16 }}>
          <Text style={styles.summary}>
            {rows.length} of {dims.length} dimensions checked · {passedCount} passed · {failedCount} failed · {pending.length} remaining
          </Text>
          {check.inspector_notes ? (
            <Text style={styles.notes}>Remarks: {check.inspector_notes}</Text>
          ) : null}
        </View>

        <View style={{ paddingHorizontal: 16 }}>
          <Button title="View Report" onPress={() => navigation.navigate('ReportView', { checkId })} />
          <Button title="Export PDF" onPress={exportPdf} loading={exporting} variant="success" />
          <Button title="Print" onPress={printPdf} variant="outline" />
          <Button title="Back to Home" onPress={() => navigation.navigate('Tabs')} variant="ghost" />
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
  notes: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 8,
    textAlign: 'center',
  },
});
