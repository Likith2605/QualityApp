import { useCallback, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';
import { deleteDimension, deleteDrawing, dimensionCheckCount, drawingCheckCount, getDimensions, getDrawing, importDimensions } from '../db/repo';
import { scheduleAutoSync } from '../db/sync';
import type { Dimension, Drawing } from '../db/types';
import type { RootStackParamList } from '../navigation/types';
import { colors } from '../theme';
import { confirmAction, fmt, toleranceText, limits } from '../utils';
import { importStrictBallooningFile, type ParsedDimension, type StrictImportRowError } from '../utils/importBallooning';
import DrawingImage from '../components/DrawingImage';
import { Button, Card, EmptyState, KeyValue, Loading, Screen, SectionTitle } from '../components/ui';

export default function DrawingDetailScreen() {
  const db = useSQLiteContext();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'DrawingDetail'>>();
  const drawingId = route.params.drawingId;

  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [dims, setDims] = useState<Dimension[]>([]);
  const [loading, setLoading] = useState(true);
  const [importPreview, setImportPreview] = useState<ParsedDimension[]>([]);
  const [importFileName, setImportFileName] = useState('');
  const [importErrors, setImportErrors] = useState<StrictImportRowError[]>([]);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const d = await getDrawing(db, drawingId);
    const list = await getDimensions(db, drawingId);
    setDrawing(d);
    setDims(list);
    setLoading(false);
  }, [db, drawingId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleDeleteDimension = async (dim: Dimension) => {
    if (!(await confirmAction('Delete dimension', `Delete dimension ${dim.dim_no}?`, true))) return;
    const used = await dimensionCheckCount(db, dim.id);
    if (used > 0) {
      Alert.alert('Cannot delete', 'This dimension is already used in quality checks.');
      return;
    }
    try {
      await deleteDimension(db, dim.id);
      scheduleAutoSync(db);
      await load();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not delete the dimension.');
    }
  };

  const handleDeleteDrawing = async () => {
    if (!(await confirmAction('Delete drawing', `Delete drawing ${drawing?.drawing_no}?`, true))) return;
    const used = await drawingCheckCount(db, drawingId);
    if (used > 0) {
      Alert.alert('Cannot delete', 'This drawing already has quality checks. Delete the checks first.');
      return;
    }
    try {
      await deleteDrawing(db, drawingId);
      scheduleAutoSync(db);
      navigation.goBack();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not delete the drawing.');
    }
  };

  const handleImportFromExcel = async () => {
    try {
      const result = await importStrictBallooningFile();
      if (!result) return;
      if (result.dims.length === 0) {
        const reason = result.errors.length > 0
          ? result.errors.map((e) => `Row ${e.row}: ${e.message}`).join('\n')
          : 'No dimension data found in the file.';
        Alert.alert('No dimensions to import', reason);
        return;
      }
      setImportPreview(result.dims);
      setImportFileName(result.fileName);
      setImportErrors(result.errors);
      setImportModalVisible(true);
    } catch (e) {
      Alert.alert('Import Error', e instanceof Error ? e.message : 'Could not read the selected file.');
    }
  };

  const confirmImport = async () => {
    setImporting(true);
    try {
      const dims = importPreview.map((d, i) => ({
        dim_no: d.dim_no || i + 1,
        description: d.description,
        nominal: d.nominal,
        nominal_text: d.nominal_text || '',
        tol_upper: d.tol_upper,
        tol_lower: d.tol_lower,
      }));
      const { imported, skipped, lastError } = await importDimensions(db, drawingId, dims);
      scheduleAutoSync(db);
      setImportModalVisible(false);
      setImportPreview([]);
      await load();
      const ignored = importErrors.length > 0
        ? `\n\nIgnored rows:\n${importErrors.slice(0, 10).map((e) => `Row ${e.row}: ${e.message}`).join('\n')}${importErrors.length > 10 ? `\n... and ${importErrors.length - 10} more` : ''}`
        : '';
      const dupDetail = skipped > 0 && lastError ? `\n\nReason: ${lastError}` : '';
      Alert.alert(
        'Imported',
        skipped > 0
          ? `${imported} imported, ${skipped} skipped (possible duplicates).${ignored}${dupDetail}`
          : `Successfully imported ${imported} dimension(s) from Excel.${ignored}`
      );
    } catch (e) {
      Alert.alert('Error', `Could not import dimensions: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return <Loading />;
  }

  if (!drawing) {
    return <EmptyState message="Drawing not found." />;
  }

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
        <Card>
          <View style={styles.headRow}>
            <Text style={styles.drawingNo}>{drawing.drawing_no}</Text>
            <Text style={styles.partName}>{drawing.part_name}</Text>
          </View>
          <KeyValue label="Customer" value={drawing.customer || '-'} />
          <KeyValue label="Revision" value={drawing.revision || '-'} />
          <KeyValue label="Drawing Rev Date" value={drawing.drawing_rev_date || '-'} />
          <KeyValue label="Material" value={drawing.material || '-'} />
          <KeyValue label="PO No" value={drawing.po_no || '-'} />
          <KeyValue label="Invoice No" value={drawing.invoice_no || '-'} />
          <KeyValue label="Invoice Date" value={drawing.invoice_date || '-'} />
          <KeyValue label="QTY" value={drawing.qty || '-'} />
          <KeyValue label="Unit" value={drawing.unit || 'mm'} />
          <KeyValue label="Designed by" value={drawing.designer_name ?? '-'} />
          <KeyValue label="Created on" value={drawing.created_at} />
          {drawing.notes ? <KeyValue label="Notes" value={drawing.notes} /> : null}
        </Card>

        <View style={{ paddingHorizontal: 16 }}>
          <Button
            title="Edit Drawing"
            onPress={() => navigation.navigate('DrawingForm', { drawingId })}
            variant="outline"
            style={{ marginTop: 8 }}
          />
        </View>

        <DrawingImage uri={drawing.image_uri} label="Drawing Attachment" />

        <SectionTitle>Measurements &amp; Tolerances</SectionTitle>
        <View style={{ flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 8 }}>
          <Button
            title="+ Dimensions"
            onPress={() => navigation.navigate('DimensionForm', { drawingId })}
            variant="outline"
            style={{ flex: 1 }}
          />
          <Button
            title="Import from Excel"
            onPress={handleImportFromExcel}
            variant="outline"
            style={{ flex: 1 }}
          />
        </View>

        {dims.length === 0 ? (
          <EmptyState message="No dimensions yet. Use Dimensions to add measurements." />
        ) : (
          dims.map((dim) => (
            <Card
              key={dim.id}
              onPress={() =>
                navigation.navigate('DimensionForm', { drawingId, dimensionId: dim.id })
              }
            >
              <View style={styles.row}>
                <Text style={styles.dimNo}>Dim {dim.dim_no}</Text>
                <Text style={styles.dimDesc}>{dim.description || '-'}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.dimValue}>
                  {dim.nominal_text && dim.nominal_text.trim()
                    ? dim.nominal_text
                    : `${fmt(dim.nominal)} ${drawing.unit}  ${toleranceText(dim.tol_upper, dim.tol_lower)}`}
                </Text>
                {dim.nominal_text && dim.nominal_text.trim() ? null : (
                  <Text style={styles.dimRange}>
                    {fmt(limits(dim.nominal, dim.tol_upper, dim.tol_lower).min)} – {fmt(limits(dim.nominal, dim.tol_upper, dim.tol_lower).max)}
                  </Text>
                )}
              </View>
              <Text
                style={styles.deleteText}
                onPress={() => handleDeleteDimension(dim)}
              >
                Delete
              </Text>
            </Card>
          ))
        )}

        <Button title="Delete Drawing" onPress={handleDeleteDrawing} variant="danger" style={{ marginTop: 12 }} />
      </ScrollView>

      <Modal visible={importModalVisible} animationType="slide" onRequestClose={() => setImportModalVisible(false)}>
        <View style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Import from Excel</Text>
            <Text style={styles.modalHint}>{importFileName} — {importPreview.length} dimension(s) found</Text>
            {importErrors.length > 0 ? (
              <Text style={styles.modalError}>
                {importErrors.slice(0, 10).map((e) => `Row ${e.row}: ${e.message}`).join('\n')}
                {importErrors.length > 10 ? `\n... and ${importErrors.length - 10} more` : ''}
              </Text>
            ) : null}
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
            {importPreview.map((d, i) => (
              <Card key={i}>
                <View style={styles.row}>
                  <Text style={styles.dimNo}>Dim {d.dim_no || i + 1}</Text>
                  <Text style={styles.dimDesc}>{d.description || '-'}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.dimValue}>
                    {d.nominal_text && d.nominal_text.trim()
                      ? d.nominal_text
                      : `${fmt(d.nominal)}  ${toleranceText(d.tol_upper, d.tol_lower)}`}
                  </Text>
                  {d.nominal_text && d.nominal_text.trim() ? null : (
                    <Text style={styles.dimRange}>
                      {fmt(limits(d.nominal, d.tol_upper, d.tol_lower).min)} – {fmt(limits(d.nominal, d.tol_upper, d.tol_lower).max)}
                    </Text>
                  )}
                </View>
              </Card>
            ))}
          </ScrollView>
          <View style={styles.modalFooter}>
            <Button title="Cancel" onPress={() => setImportModalVisible(false)} variant="ghost" style={{ flex: 1 }} />
            <Button title={`Import ${importPreview.length} Dimensions`} onPress={confirmImport} loading={importing} style={{ flex: 1 }} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headRow: {
    marginBottom: 8,
  },
  drawingNo: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.primaryDark,
  },
  partName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginTop: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  dimNo: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  dimDesc: {
    fontSize: 13,
    color: colors.textMuted,
    flex: 1,
    textAlign: 'right',
    marginLeft: 8,
  },
  dimValue: {
    fontSize: 13,
    color: colors.text,
    fontWeight: '600',
  },
  dimRange: {
    fontSize: 12,
    color: colors.textMuted,
  },
  deleteText: {
    marginTop: 6,
    color: colors.danger,
    fontSize: 13,
    fontWeight: '700',
    alignSelf: 'flex-end',
  },
  modalRoot: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    padding: 16,
    paddingBottom: 8,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  modalHint: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  modalError: {
    fontSize: 13,
    color: colors.danger,
    marginTop: 6,
  },
  modalFooter: {
    flexDirection: 'row',
    padding: 16,
    gap: 8,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
