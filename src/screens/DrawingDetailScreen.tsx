import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';
import { deleteDimension, deleteDrawing, dimensionCheckCount, drawingCheckCount, getDimensions, getDrawing } from '../db/repo';
import type { Dimension, Drawing } from '../db/types';
import type { RootStackParamList } from '../navigation/types';
import { colors } from '../theme';
import { fmt, toleranceText, limits } from '../utils';
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

  const handleDeleteDimension = (dim: Dimension) => {
    Alert.alert('Delete dimension', `Delete dimension ${dim.dim_no}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const used = await dimensionCheckCount(db, dim.id);
          if (used > 0) {
            Alert.alert('Cannot delete', 'This dimension is already used in quality checks.');
            return;
          }
          await deleteDimension(db, dim.id);
          load();
        },
      },
    ]);
  };

  const handleDeleteDrawing = () => {
    Alert.alert('Delete drawing', `Delete drawing ${drawing?.drawing_no}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const used = await drawingCheckCount(db, drawingId);
          if (used > 0) {
            Alert.alert('Cannot delete', 'This drawing already has quality checks. Delete the checks first.');
            return;
          }
          await deleteDrawing(db, drawingId);
          navigation.goBack();
        },
      },
    ]);
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

        <DrawingImage uri={drawing.image_uri} label="Drawing Attachment" />

        <SectionTitle>Measurements &amp; Tolerances</SectionTitle>
        <Button
          title="+ Add Dimension"
          onPress={() => navigation.navigate('DimensionForm', { drawingId })}
          variant="outline"
        />

        {dims.length === 0 ? (
          <EmptyState message="No dimensions yet. Add the measurements and tolerances from the customer drawing." />
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
                  {fmt(dim.nominal)} {drawing.unit}  {toleranceText(dim.tol_upper, dim.tol_lower)}
                </Text>
                <Text style={styles.dimRange}>
                  {fmt(limits(dim.nominal, dim.tol_upper, dim.tol_lower).min)} – {fmt(limits(dim.nominal, dim.tol_upper, dim.tol_lower).max)}
                </Text>
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
});
