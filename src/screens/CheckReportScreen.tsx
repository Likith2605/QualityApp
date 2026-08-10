import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { getCheckReport } from '../db/repo';
import type { CheckReport } from '../db/types';
import type { RootStackParamList } from '../navigation/types';
import { buildReportHtml } from '../report/pdf';
import { colors } from '../theme';
import { fmt, limits, samplesOf, toleranceText } from '../utils';
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
    } catch (e) {
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

  const { check, rows } = report;
  const passedCount = rows.filter((r) => r.pass === 1).length;

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
        <Card>
          <View style={styles.headRow}>
            <Text style={styles.title}>QIR-{check.id}</Text>
            <Badge text={`${passedCount} OK / ${rows.length - passedCount} NG`} tone="neutral" />
          </View>
          <KeyValue label="Drawing No" value={check.drawing_no ?? '-'} />
          <KeyValue label="Part Name" value={check.part_name ?? '-'} />
          <KeyValue label="Customer" value={check.customer || '-'} />
          <KeyValue label="Inspector" value={check.inspector_name || check.inspector_employee_name || '-'} />
          <KeyValue label="Employee ID" value={check.inspector_employee_id ?? '-'} />
          <KeyValue label="Instrument" value={check.instrument || '-'} />
          <KeyValue label="Date & Time" value={check.checked_at} />
        </Card>

        <DrawingImage uri={check.image_uri} label="Drawing Attachment" />

        <SectionTitle>Measurement Comparison</SectionTitle>

        {rows.map((row, index) => {
          const samples = samplesOf(row);
          const usedCount = samples.filter((s) => s !== null && s !== undefined).length;
          const shown = Math.max(5, usedCount);
          return (
            <Card key={row.id}>
              <View style={styles.row}>
                <Text style={styles.dimLabel}>
                  {index + 1}. Dim {row.dim_no}{row.description ? ` · ${row.description}` : ''}
                </Text>
                <Badge text={row.pass === 1 ? 'OK' : 'NG'} tone={row.pass === 1 ? 'success' : 'danger'} />
              </View>
              <View style={styles.specRow}>
                <Text style={styles.spec}>
                  Nominal {fmt(row.nominal)} {check.unit}  {toleranceText(row.tol_upper, row.tol_lower)}
                </Text>
              </View>
              <View style={styles.samplesRow}>
                {Array.from({ length: shown }, (_, i) => {
                  const { min, max } = limits(row.nominal, row.tol_upper, row.tol_lower);
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

        <View style={{ paddingHorizontal: 16 }}>
          <Text style={styles.summary}>
            {rows.length} dimensions checked · {passedCount} passed · {rows.length - passedCount} failed
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
