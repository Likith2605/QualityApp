import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';
import { addDimension, getDimensions, getDrawing, updateDimension } from '../db/repo';
import type { RootStackParamList } from '../navigation/types';
import { colors } from '../theme';
import { fmt, limits, toleranceText } from '../utils';
import { Button, Field, Screen } from '../components/ui';

export default function DimensionFormScreen() {
  const db = useSQLiteContext();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'DimensionForm'>>();
  const drawingId = route.params?.drawingId as number;
  const dimensionId = route.params?.dimensionId;

  const [unit, setUnit] = useState('mm');
  const [dimNo, setDimNo] = useState('');
  const [description, setDescription] = useState('');
  const [nominal, setNominal] = useState('');
  const [tolUpper, setTolUpper] = useState('0');
  const [tolLower, setTolLower] = useState('0');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const d = await getDrawing(db, drawingId);
      if (d) {
        setUnit(d.unit);
      }
      const list = await getDimensions(db, drawingId);
      if (dimensionId) {
        const existing = list.find((x) => x.id === dimensionId);
        if (existing) {
          setDimNo(String(existing.dim_no));
          setDescription(existing.description);
          setNominal(String(existing.nominal));
          setTolUpper(String(existing.tol_upper));
          setTolLower(String(existing.tol_lower));
        }
      } else {
        const nextNo = list.length === 0 ? 1 : Math.max(...list.map((x) => x.dim_no)) + 1;
        setDimNo(String(nextNo));
      }
    })();
  }, [db, drawingId, dimensionId]);

  const toNum = (s: string): number | null => {
    const n = Number(s.trim());
    return s.trim() === '' || Number.isNaN(n) ? null : n;
  };

  const handleSave = async () => {
    const dimNoNum = toNum(dimNo);
    const nominalNum = toNum(nominal);
    const tolUpperNum = toNum(tolUpper);
    const tolLowerNum = toNum(tolLower);

    if (dimNoNum === null || nominalNum === null) {
      Alert.alert('Missing information', 'Dimension No and Nominal are required.');
      return;
    }
    if (tolUpperNum === null || tolLowerNum === null) {
      Alert.alert('Missing information', 'Tolerances are required. Use 0 if none.');
      return;
    }

    const existing = await getDimensions(db, drawingId);
    const dup = existing.find((x) => x.dim_no === dimNoNum && x.id !== dimensionId);
    if (dup) {
      Alert.alert('Duplicate', `Dimension No ${dimNoNum} already exists.`);
      return;
    }

    setSaving(true);
    try {
      if (dimensionId) {
        await updateDimension(db, dimensionId, {
          dim_no: dimNoNum,
          description,
          nominal: nominalNum,
          tol_upper: tolUpperNum,
          tol_lower: tolLowerNum,
        });
      } else {
        await addDimension(db, {
          drawing_id: drawingId,
          dim_no: dimNoNum,
          description,
          nominal: nominalNum,
          tol_upper: tolUpperNum,
          tol_lower: tolLowerNum,
        });
      }
      navigation.goBack();
    } catch {
      Alert.alert('Error', 'Could not save the dimension.');
    } finally {
      setSaving(false);
    }
  };

  const nominalNum = toNum(nominal);
  const tolUpperNum = toNum(tolUpper);
  const tolLowerNum = toNum(tolLower);
  const showPreview = nominalNum !== null && tolUpperNum !== null && tolLowerNum !== null;

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12 }}>
        <Field label="Dimension No *" value={dimNo} onChangeText={setDimNo} keyboardType="numeric" />
        <Field label="Description" value={description} onChangeText={setDescription} placeholder="e.g. Outer diameter" />
        <Field label={`Nominal (${unit}) *`} value={nominal} onChangeText={setNominal} keyboardType="decimal-pad" />
        <Field label={`Upper Tolerance (+) ${unit}`} value={tolUpper} onChangeText={setTolUpper} keyboardType="decimal-pad" />
        <Field label={`Lower Tolerance (-) ${unit}`} value={tolLower} onChangeText={setTolLower} keyboardType="decimal-pad" />

        {showPreview && (
          <View style={styles.preview}>
            <Text style={styles.previewText}>
              Nominal {fmt(nominalNum)} {unit}  ·  {toleranceText(tolUpperNum, tolLowerNum)}
            </Text>
            <Text style={styles.previewText}>
              Accepted range: {fmt(limits(nominalNum, tolUpperNum, tolLowerNum).min)} to{' '}
              {fmt(limits(nominalNum, tolUpperNum, tolLowerNum).max)} {unit}
            </Text>
          </View>
        )}

        <Button title={dimensionId ? 'Update Dimension' : 'Save Dimension'} onPress={handleSave} loading={saving} style={{ marginTop: 8 }} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  previewText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    marginVertical: 2,
  },
});
