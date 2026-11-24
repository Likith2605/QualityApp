import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View, Image, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';
import { getDrawing, addDimension, getDimensions } from '../db/repo';
import { scheduleAutoSync } from '../db/sync';
import type { Dimension, Drawing } from '../db/types';
import type { RootStackParamList } from '../navigation/types';
import { colors } from '../theme';
import { fmt, limits, toleranceText } from '../utils';
import DrawingImage from '../components/DrawingImage';
import { MeasurementBalloon, MeasurementPoint } from '../components/MeasurementBalloon';
import { detectMeasurementsFromPDF, DetectedMeasurement } from '../utils/measurementDetection';
import { Button, Card, EmptyState, Loading, Screen, SectionTitle, KeyValue } from '../components/ui';

type BallooningRouteProp = RouteProp<RootStackParamList, 'Ballooning'>;

export default function BallooningScreen() {
  const db = useSQLiteContext();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<BallooningRouteProp>();
  const drawingId = route.params?.drawingId;

  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [dimensions, setDimensions] = useState<Dimension[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [detectedMeasurements, setDetectedMeasurements] = useState<DetectedMeasurement[]>([]);
  const [showTable, setShowTable] = useState(false);
  const [selectedMeasurement, setSelectedMeasurement] = useState<DetectedMeasurement | null>(null);

  const reload = useCallback(async () => {
    if (!drawingId) return;
    const d = await getDrawing(db, drawingId);
    const dims = await getDimensions(db, drawingId);
    setDrawing(d);
    setDimensions(dims);
  }, [db, drawingId]);

  useEffect(() => {
    let cancelled = false;
    // Safety timeout so the loading state can never stay stuck forever
    const safetyTimer = setTimeout(() => {
      if (!cancelled) setLoading(false);
    }, 5000);

    (async () => {
      if (!drawingId) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const d = await getDrawing(db, drawingId);
        const dims = await getDimensions(db, drawingId);
        if (!cancelled) {
          setDrawing(d);
          setDimensions(dims);
        }
      } catch (error) {
        console.error('BallooningScreen load error:', error);
        if (!cancelled) {
          Alert.alert('Error', 'Failed to load drawing data.');
        }
      } finally {
        clearTimeout(safetyTimer);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(safetyTimer);
    };
  }, [db, drawingId]);

  const handleAutoFetch = async () => {
    if (!drawing?.image_uri) {
      Alert.alert('No Drawing', 'Please upload a drawing image or PDF first.');
      return;
    }

    setFetching(true);
    try {
      const measurements = await detectMeasurementsFromPDF(drawing.image_uri, {
        engine: 'placeholder',
        pageNumber: 1,
        scale: 2,
      });

      if (measurements.length === 0) {
        Alert.alert('No Measurements Found', 'Could not detect any measurements from the drawing.');
        return;
      }

      // Convert detected measurements to balloon points
      const points: MeasurementPoint[] = measurements.map((m, i) => ({
        id: i + 1,
        x: m.position.x,
        y: m.position.y,
        label: `B${m.dimNo}`,
        dimNo: m.dimNo,
        description: m.description,
        nominal: m.nominal,
        tolUpper: m.tolUpper,
        tolLower: m.tolLower,
      }));

      setDetectedMeasurements(measurements);
      setShowTable(true);
      
      Alert.alert('Auto Fetch Complete', `Found ${measurements.length} measurements. Balloons added to drawing.`);
    } catch (error) {
      console.error('Auto fetch error:', error);
      Alert.alert('Error', 'Failed to fetch measurements from drawing.');
    } finally {
      setFetching(false);
    }
  };

  const handleSaveDimensions = async () => {
    if (detectedMeasurements.length === 0) {
      Alert.alert('No Measurements', 'Please run Auto Fetch first.');
      return;
    }

    const confirmed = await new Promise<boolean>((resolve) => {
      Alert.alert(
        'Save Dimensions',
        `Save ${detectedMeasurements.length} detected measurements as dimensions?`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Save', onPress: () => resolve(true) },
        ]
      );
    });

    if (!confirmed || !drawingId) return;

    setLoading(true);
    try {
      for (const m of detectedMeasurements) {
        await addDimension(db, {
          drawing_id: drawingId,
          dim_no: m.dimNo,
          description: m.description,
          nominal: m.nominal,
          tol_upper: m.tolUpper,
          tol_lower: m.tolLower,
        });
      }
      scheduleAutoSync(db);
      await reload();
      setShowTable(false);
      setDetectedMeasurements([]);
      Alert.alert('Saved', 'Dimensions saved successfully.');
    } catch (error) {
      console.error('Save error:', error);
      Alert.alert('Error', 'Failed to save dimensions.');
    } finally {
      setLoading(false);
    }
  };

  const handlePressBalloon = (point: MeasurementPoint) => {
    const measurement = detectedMeasurements.find(m => m.dimNo === point.dimNo);
    if (measurement) {
      setSelectedMeasurement(measurement);
    }
  };

  const renderDrawingWithBalloons = () => {
    if (!drawing?.image_uri) {
      return (
        <View style={styles.drawingPlaceholder}>
          <Text style={styles.placeholderText}>No drawing uploaded</Text>
          <Text style={styles.placeholderHint}>Upload a drawing in Drawing Form first</Text>
        </View>
      );
    }

    const drawingUri = drawing.image_uri;
    const isImage = drawingUri.toLowerCase().match(/\.(jpg|jpeg|png|gif|webp|bmp|heic|heif)$/);

    return (
      <View style={styles.drawingContainer}>
        {/* Drawing Image */}
        {isImage ? (
          <Image
            source={{ uri: drawingUri }}
            style={styles.drawingImage}
            resizeMode="contain"
          />
        ) : (
          <DrawingImage uri={drawingUri} style={styles.drawingImage} />
        )}

        {/* Balloon Overlays */}
        {detectedMeasurements.length > 0 && (
          <View style={styles.balloonOverlay} pointerEvents="none">
            {detectedMeasurements.map((m, i) => (
              <View
                key={m.id}
                style={{
                  position: 'absolute',
                  left: m.position.x - 30,
                  top: m.position.y - 40,
                  zIndex: 10,
                }}
                pointerEvents="box-none"
              >
                <TouchableOpacity
                  onPress={() => handlePressBalloon({
                    id: i + 1,
                    x: m.position.x,
                    y: m.position.y,
                    label: `B${m.dimNo}`,
                    dimNo: m.dimNo,
                    description: m.description,
                    nominal: m.nominal,
                    tolUpper: m.tolUpper,
                    tolLower: m.tolLower,
                  })}
                  activeOpacity={0.8}
                >
                  <View style={styles.balloonBadge}>
                    <Text style={styles.balloonBadgeText}>B{m.dimNo}</Text>
                  </View>
                  
                  {/* Arrow pointing to measurement location */}
                  <View style={styles.arrowDown} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Selected measurement detail */}
        {selectedMeasurement && (
          <View style={styles.selectedDetail}>
            <Text style={styles.detailTitle}>Balloon B{selectedMeasurement.dimNo}</Text>
            <KeyValue label="Description" value={selectedMeasurement.description} />
            <KeyValue label="Dimension (mm)" value={fmt(selectedMeasurement.nominal)} />
            <KeyValue label="Upper Tolerance (mm)" value={fmt(selectedMeasurement.tolUpper)} />
            <KeyValue label="Lower Tolerance (mm)" value={fmt(selectedMeasurement.tolLower)} />
            <Button title="Close" variant="ghost" onPress={() => setSelectedMeasurement(null)} style={styles.closeBtn} />
          </View>
        )}
      </View>
    );
  };

  if (loading) {
    return <Loading text="Loading drawing data..." />;
  }

  if (!drawing) {
    return <EmptyState message="Drawing not found." />;
  }

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
        {/* Header */}
        <Card>
          <Text style={styles.drawingNo}>{drawing.drawing_no}</Text>
          <Text style={styles.partName}>{drawing.part_name}</Text>
          <Text style={styles.meta}>
            {drawing.customer ? `${drawing.customer}  ·  ` : ''}Rev {drawing.revision}  ·  {drawing.unit}
          </Text>
        </Card>

        {/* Drawing with Balloons */}
        <SectionTitle>Drawing with Balloons</SectionTitle>
        <View style={styles.drawingWrapper}>
          {renderDrawingWithBalloons()}
        </View>

        {/* Auto Fetch Button */}
        <Card style={styles.actionCard}>
          <Button
            title={fetching ? 'Fetching...' : 'Auto Fetch Measurements'}
            onPress={handleAutoFetch}
            loading={fetching}
            variant="primary"
            disabled={!drawing?.image_uri || fetching}
          />
          <Text style={styles.fetchHint}>
            Analyzes the uploaded drawing (PDF/Image) and detects measurements with tolerances
          </Text>
        </Card>

        {/* Measurement Table */}
        {showTable && detectedMeasurements.length > 0 && (
          <>
            <SectionTitle>Detected Measurements</SectionTitle>
            <Card>
              <View style={styles.tableContainer}>
                {/* Table Header */}
                <View style={styles.tableRowHeader}>
                  <Text style={styles.tableCellHeader}>Bubble No</Text>
                  <Text style={styles.tableCellHeader}>Description</Text>
                  <Text style={styles.tableCellHeader}>Dimension (mm)</Text>
                  <Text style={styles.tableCellHeader}>Upper Tol (mm)</Text>
                  <Text style={styles.tableCellHeader}>Lower Tol (mm)</Text>
                  <Text style={styles.tableCellHeader}>Samples</Text>
                </View>

                {/* Table Rows */}
                {detectedMeasurements.map((m, i) => (
                  <View key={m.id} style={styles.tableRow}>
                    <Text style={styles.tableCell}>B{m.dimNo}</Text>
                    <Text style={styles.tableCell}>{m.description}</Text>
                    <Text style={styles.tableCell}>{fmt(m.nominal)}</Text>
                    <Text style={styles.tableCell}>+{fmt(m.tolUpper)}</Text>
                    <Text style={styles.tableCell}>{fmt(m.tolLower)}</Text>
                    <Text style={styles.tableCell}>
                      {m.samples.map(s => fmt(s)).join(', ')}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Save Button */}
              <Button
                title="Save as Dimensions"
                onPress={handleSaveDimensions}
                loading={loading}
                variant="success"
                style={styles.saveBtn}
              />
            </Card>
          </>
        )}

        {/* Existing Dimensions */}
        <SectionTitle>Saved Dimensions</SectionTitle>
        {dimensions.length === 0 ? (
          <EmptyState message="No dimensions saved yet. Use Auto Fetch to detect and save measurements." />
        ) : (
          dimensions.map((dim) => (
            <Card
              key={dim.id}
              onPress={drawingId ? () => navigation.navigate('DimensionForm', { drawingId, dimensionId: dim.id }) : undefined}
            >
              <View style={styles.dimRow}>
                <Text style={styles.dimNo}>Dim {dim.dim_no}</Text>
                <Text style={styles.dimDesc}>{dim.description || '-'}</Text>
              </View>
              <View style={styles.dimRow}>
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
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  meta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  drawingWrapper: {
    marginHorizontal: 16,
    marginVertical: 8,
  },
  drawingContainer: {
    position: 'relative',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  drawingImage: {
    width: '100%',
    height: 300,
    backgroundColor: colors.background,
  },
  drawingPlaceholder: {
    width: '100%',
    height: 300,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  placeholderHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 4,
  },
  balloonOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  balloonBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: colors.primary,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  balloonBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
  arrowDown: {
    width: 0,
    height: 0,
    borderStyle: 'solid',
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderColor: 'transparent',
    borderTopColor: colors.primary,
    marginTop: 2,
    alignSelf: 'center',
  },
  selectedDetail: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    right: 10,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  detailTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primaryDark,
    marginBottom: 8,
  },
  closeBtn: {
    marginTop: 12,
  },
  actionCard: {
    marginHorizontal: 16,
    marginVertical: 8,
  },
  fetchHint: {
    marginTop: 8,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
  },
  tableContainer: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    overflow: 'hidden',
  },
  tableRowHeader: {
    flexDirection: 'row',
    backgroundColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  tableCellHeader: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 11,
    textAlign: 'center',
  },
  tableCell: {
    fontSize: 12,
    color: colors.text,
    textAlign: 'center',
  },
  saveBtn: {
    marginTop: 12,
    marginHorizontal: 16,
  },
  dimRow: {
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
});