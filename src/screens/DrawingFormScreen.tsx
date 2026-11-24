import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { addDrawing, drawingNoExists, getDrawing, importDimensions, updateDrawing } from '../db/repo';
import { scheduleAutoSync } from '../db/sync';
import { importBallooningFile, type ParsedDimension } from '../utils/importBallooning';
import type { RootStackParamList } from '../navigation/types';
import { useAuth } from '../context/AuthContext';
import { DEFAULT_UNIT } from '../config';
import { colors } from '../theme';
import { fmt, toleranceText, limits } from '../utils';
import DrawingImage from '../components/DrawingImage';
import { Button, Card, DateField, Field, Screen } from '../components/ui';

async function persistDrawingFile(uri: string, name?: string, mimeType?: string): Promise<string> {
  const dir = new Directory(Paths.document, 'drawings');
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  let ext = name ? name.split('.').pop() : undefined;
  if (!ext && mimeType) {
    const part = mimeType.split('/');
    ext = part[1];
  }
  if (!ext && uri.includes('.')) {
    ext = uri.split('.').pop();
  }
  const safeExt = (ext || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const dest = new File(dir, `${Date.now()}_${Math.floor(Math.random() * 1e6)}.${safeExt}`);
  const src = new File(uri);
  src.copy(dest);
  return dest.uri;
}

export default function DrawingFormScreen() {
  const db = useSQLiteContext();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'DrawingForm'>>();
  const drawingId = route.params?.drawingId;
  const { user } = useAuth();

  const [drawingNo, setDrawingNo] = useState('');
  const [partName, setPartName] = useState('');
  const [customer, setCustomer] = useState('');
  const [revision, setRevision] = useState('A');
  const [material, setMaterial] = useState('');
  const [unit, setUnit] = useState(DEFAULT_UNIT);
  const [notes, setNotes] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [drawingRevDate, setDrawingRevDate] = useState('');
  const [poNo, setPoNo] = useState('');
  const [qty, setQty] = useState('');
  const [treatment, setTreatment] = useState('');
  const [hardness, setHardness] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importPreview, setImportPreview] = useState<ParsedDimension[]>([]);
  const [importFileName, setImportFileName] = useState('');
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    (async () => {
      if (drawingId) {
        const d = await getDrawing(db, drawingId);
        if (d) {
          setDrawingNo(d.drawing_no);
          setPartName(d.part_name);
          setCustomer(d.customer);
          setRevision(d.revision);
          setMaterial(d.material);
          setUnit(d.unit);
          setNotes(d.notes);
          setInvoiceNo(d.invoice_no);
          setInvoiceDate(d.invoice_date);
          setDrawingRevDate(d.drawing_rev_date);
          setPoNo(d.po_no);
          setQty(d.qty);
          setTreatment(d.treatment);
          setHardness(d.hardness);
          setImageUri(d.image_uri);
        }
      }
    })();
  }, [db, drawingId]);

  const handleSave = async () => {
    if (!drawingNo.trim() || !partName.trim()) {
      Alert.alert('Missing information', 'Drawing No and Part Name are required.');
      return;
    }

    if (await drawingNoExists(db, drawingNo, drawingId)) {
      Alert.alert('Duplicate', 'This Drawing No already exists.');
      return;
    }

    const data = {
      drawing_no: drawingNo,
      part_name: partName,
      customer,
      revision,
      material,
      unit,
      notes,
      invoice_no: invoiceNo,
      invoice_date: invoiceDate,
      drawing_rev_date: drawingRevDate,
      po_no: poNo,
      qty,
      treatment,
      hardness,
      image_uri: imageUri,
    };

    setSaving(true);
    try {
      if (drawingId) {
        await updateDrawing(db, drawingId, data);
      } else {
        await addDrawing(db, { ...data, created_by: user?.id ?? 0 });
      }
      scheduleAutoSync(db);
      navigation.goBack();
    } catch {
      Alert.alert('Error', 'Could not save the drawing.');
    } finally {
      setSaving(false);
    }
  };

  const handleImport = async () => {
    try {
      const result = await importBallooningFile();
      if (!result || result.dims.length === 0) {
        Alert.alert('No dimensions found', 'Could not extract dimensions from the file.');
        return;
      }
      setImportPreview(result.dims);
      setImportFileName(result.fileName);
      setImportModalVisible(true);
    } catch (e) {
      Alert.alert('Import Error', e instanceof Error ? e.message : 'Could not read the selected file.');
    }
  };

  const confirmImport = async () => {
    if (!drawingId) {
      Alert.alert('Save drawing first', 'Please save the drawing before importing dimensions.');
      setImportModalVisible(false);
      return;
    }
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
      const msg = skipped > 0
        ? `${imported} imported, ${skipped} skipped.\n${lastError ? 'Last error: ' + lastError : ''}`
        : `${imported} dimension(s) imported from ${importFileName}.`;
      Alert.alert(skipped > 0 ? 'Partial Import' : 'Imported', msg);
    } catch (e) {
      Alert.alert('Error', `Could not import dimensions: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImporting(false);
    }
  };

  const pickFromGallery = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });
      if (!res.canceled && res.assets[0]) {
        const a = res.assets[0];
        setImageUri(await persistDrawingFile(a.uri, a.fileName ?? undefined, a.mimeType ?? undefined));
      }
    } catch {
      Alert.alert('Error', 'Could not pick the image.');
    }
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Camera permission is required to take a photo.');
      return;
    }
    try {
      const res = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });
      if (!res.canceled && res.assets[0]) {
        const a = res.assets[0];
        setImageUri(await persistDrawingFile(a.uri, a.fileName ?? undefined, a.mimeType ?? undefined));
      }
    } catch {
      Alert.alert('Error', 'Could not take the photo.');
    }
  };

  const pickPdf = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf'],
        copyToCacheDirectory: true,
      });
      if (!res.canceled && res.assets[0]) {
        const a = res.assets[0];
        setImageUri(await persistDrawingFile(a.uri, a.name, a.mimeType));
      }
    } catch {
      Alert.alert('Error', 'Could not pick the PDF file.');
    }
  };

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12 }}>
        <Field label="Drawing No *" value={drawingNo} onChangeText={setDrawingNo} autoCapitalize="characters" />
        <Field label="Part Name *" value={partName} onChangeText={setPartName} />
        <Field label="Customer" value={customer} onChangeText={setCustomer} />
        <Field label="Revision" value={revision} onChangeText={setRevision} autoCapitalize="characters" />
        <DateField label="Drawing Rev Date" value={drawingRevDate} onChange={setDrawingRevDate} placeholder="Select drawing revision date" />
        <Field label="Material" value={material} onChangeText={setMaterial} />
        <Field label="PO No" value={poNo} onChangeText={setPoNo} />
        <Field label="Invoice No" value={invoiceNo} onChangeText={setInvoiceNo} />
        <DateField label="Invoice Date" value={invoiceDate} onChange={setInvoiceDate} placeholder="Select invoice date" />
        <Field label="QTY" value={qty} onChangeText={setQty} keyboardType="numeric" />
        <Field label="Treatment" value={treatment} onChangeText={setTreatment} placeholder="e.g. Zinc Plating, Anodizing" />
        <Field label="Hardness" value={hardness} onChangeText={setHardness} placeholder="e.g. 180-220 HB, HRC 40" />
        <Field label="Unit" value={unit} onChangeText={setUnit} autoCapitalize="none" />
        <Field label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="Optional remarks" />

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Drawing Image / PDF</Text>
          <Text style={styles.sectionHint}>Attach the customer drawing (photo, gallery image or PDF). It will be visible to the inspector.</Text>
          <View style={styles.uploadRow}>
            <Pressable style={[styles.uploadBtn, styles.uploadBtnPrimary]} onPress={takePhoto}>
              <Text style={styles.uploadBtnPrimaryText}>Camera</Text>
            </Pressable>
            <Pressable style={[styles.uploadBtn, styles.uploadBtnOutline]} onPress={pickFromGallery}>
              <Text style={styles.uploadBtnOutlineText}>Gallery</Text>
            </Pressable>
            <Pressable style={[styles.uploadBtn, styles.uploadBtnOutline]} onPress={pickPdf}>
              <Text style={styles.uploadBtnOutlineText}>PDF</Text>
            </Pressable>
          </View>
          {imageUri ? (
            <View>
              <DrawingImage uri={imageUri} style={{ marginHorizontal: 0, marginVertical: 4 }} />
              <Button title="Remove Attachment" onPress={() => setImageUri(null)} variant="ghost" />
            </View>
          ) : null}
        </View>

        {drawingId ? (
          <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
            <Button title="Import from Excel Report" onPress={handleImport} variant="outline" />
          </View>
        ) : null}

        <Button title={drawingId ? 'Update Drawing' : 'Save Drawing'} onPress={handleSave} loading={saving} style={{ marginTop: 8 }} />
      </ScrollView>

      <Modal visible={importModalVisible} animationType="slide" onRequestClose={() => setImportModalVisible(false)}>
        <View style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Import from Excel Report</Text>
            <Text style={styles.modalHint}>{importFileName} — {importPreview.length} dimension(s) found</Text>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
            {importPreview.map((d, i) => (
              <Card key={i}>
                <View style={styles.previewRow}>
                  <Text style={styles.previewDimNo}>Dim {d.dim_no || i + 1}</Text>
                  <Text style={styles.previewDesc}>{d.description || '-'}</Text>
                </View>
                <View style={styles.previewRow}>
                  <Text style={styles.previewValue}>
                    {d.nominal_text && d.nominal_text.trim()
                      ? d.nominal_text
                      : `${fmt(d.nominal)}  ${toleranceText(d.tol_upper, d.tol_lower)}`}
                  </Text>
                  {d.nominal_text && d.nominal_text.trim() ? null : (
                    <Text style={styles.previewRange}>
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
  section: {
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  sectionHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 4,
    marginBottom: 10,
  },
  uploadRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  uploadBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 3,
    borderWidth: 1,
  },
  uploadBtnPrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  uploadBtnOutline: {
    backgroundColor: colors.surface,
    borderColor: colors.primary,
  },
  uploadBtnPrimaryText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  uploadBtnOutlineText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 14,
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
  modalFooter: {
    flexDirection: 'row',
    padding: 16,
    gap: 8,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  previewDimNo: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  previewDesc: {
    fontSize: 13,
    color: colors.textMuted,
    flex: 1,
    textAlign: 'right',
    marginLeft: 8,
  },
  previewValue: {
    fontSize: 13,
    color: colors.text,
    fontWeight: '600',
  },
  previewRange: {
    fontSize: 12,
    color: colors.textMuted,
  },
});

