import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';
import { createCheck, getDimensions, getDrawing } from '../db/repo';
import type { Dimension, Drawing, NewMeasurementInput } from '../db/types';
import { MAX_SAMPLES, SAMPLE_COUNT } from '../db/types';
import type { RootStackParamList } from '../navigation/types';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme';
import { fmt, isInTolerance, toleranceText } from '../utils';
import DrawingImage from '../components/DrawingImage';
import { Badge, Button, Card, EmptyState, Field, Loading, Screen, SectionTitle } from '../components/ui';

function parseNum(text: string): number | null {
  if (!text.trim()) {
    return null;
  }
  const n = Number(text.trim());
  return Number.isNaN(n) ? null : n;
}

function sampleTone(value: string, dim: Dimension): 'empty' | 'pass' | 'fail' {
  const n = parseNum(value);
  if (n === null) {
    return 'empty';
  }
  return isInTolerance(n, dim.nominal, dim.tol_upper, dim.tol_lower) ? 'pass' : 'fail';
}

function dimensionTone(samples: string[], dim: Dimension): { tone: 'pending' | 'ok' | 'ng'; count: number; total: number } {
  let fail = false;
  let filled = 0;
  for (const value of samples) {
    const n = parseNum(value);
    if (n !== null) {
      filled++;
      if (!isInTolerance(n, dim.nominal, dim.tol_upper, dim.tol_lower)) {
        fail = true;
      }
    }
  }
  if (fail) {
    return { tone: 'ng', count: filled, total: samples.length };
  }
  if (filled === samples.length && filled > 0) {
    return { tone: 'ok', count: filled, total: samples.length };
  }
  return { tone: 'pending', count: filled, total: samples.length };
}

export default function QCCheckScreen() {
  const db = useSQLiteContext();
  const { user } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'QCCheck'>>();
  const drawingId = route.params.drawingId;

  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [dims, setDims] = useState<Dimension[]>([]);
  const [actuals, setActuals] = useState<Record<number, string[]>>({});
  const [extra, setExtra] = useState<Record<number, number>>({});
  const [instrument, setInstrument] = useState('');
  const [inspectorName, setInspectorName] = useState(user?.name ?? '');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const d = await getDrawing(db, drawingId);
      const list = await getDimensions(db, drawingId);
      setDrawing(d);
      setDims(list);
      const initial: Record<number, string[]> = {};
      list.forEach((x) => {
        initial[x.id] = Array(SAMPLE_COUNT).fill('');
      });
      setActuals(initial);
      setLoading(false);
    })();
  }, [db, drawingId]);

  const countFor = (dimId: number) => SAMPLE_COUNT + (extra[dimId] ?? 0);

  const setSample = (dimId: number, index: number, value: string) => {
    setActuals((prev) => {
      const next = [...(prev[dimId] ?? Array(countFor(dimId)).fill(''))];
      next[index] = value;
      return { ...prev, [dimId]: next };
    });
  };

  const addSample = (dimId: number) => {
    const newExtra = Math.min(MAX_SAMPLES - SAMPLE_COUNT, (extra[dimId] ?? 0) + 1);
    setExtra((prev) => ({ ...prev, [dimId]: newExtra }));
    setActuals((prev) => {
      const next = Array.from({ length: SAMPLE_COUNT + newExtra }, (_, i) => (prev[dimId] ?? [])[i] ?? '');
      return { ...prev, [dimId]: next };
    });
  };

  const removeSample = (dimId: number) => {
    const newExtra = Math.max(0, (extra[dimId] ?? 0) - 1);
    setExtra((prev) => ({ ...prev, [dimId]: newExtra }));
    setActuals((prev) => {
      const next = (prev[dimId] ?? []).slice(0, SAMPLE_COUNT + newExtra);
      return { ...prev, [dimId]: next };
    });
  };

  const hasAnySample = dims.some((dim) => (actuals[dim.id] ?? []).some((s) => parseNum(s) !== null));

  const handleSubmit = useCallback(async () => {
    if (dims.length === 0) {
      Alert.alert('Nothing to check', 'This drawing has no dimensions.');
      return;
    }
    if (!hasAnySample) {
      Alert.alert('No measurements', 'Enter at least one sample measurement before saving.');
      return;
    }

    const measurements: NewMeasurementInput[] = dims.map((dim) => {
      const samples = (actuals[dim.id] ?? []).map((s) => parseNum(s) as number);
      return {
        dimensionId: dim.id,
        nominal: dim.nominal,
        tol_upper: dim.tol_upper,
        tol_lower: dim.tol_lower,
        samples,
      };
    });

    Alert.alert(
      'Confirm',
      'Save this inspection? Empty samples are skipped; each dimension is judged only on the samples you entered.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: async () => {
            setSaving(true);
            try {
              const checkId = await createCheck(db, {
                drawingId,
                checkedBy: user?.id ?? 0,
                instrument,
                inspectorNotes: notes,
                inspectorName,
                measurements,
              });
              navigation.replace('CheckReport', { checkId });
            } catch {
              Alert.alert('Error', 'Could not save the inspection.');
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  }, [dims, actuals, instrument, inspectorName, notes, hasAnySample, db, drawingId, user, navigation]);

  if (loading) {
    return <Loading />;
  }

  if (!drawing) {
    return <EmptyState message="Drawing not found." />;
  }

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
        <Card>
          <Text style={styles.title}>{drawing.drawing_no} – {drawing.part_name}</Text>
          <Text style={styles.subtitle}>
            {drawing.customer ? `${drawing.customer}  ·  ` : ''}Rev {drawing.revision}  ·  Unit: {drawing.unit}
          </Text>
          
        </Card>

        <DrawingImage uri={drawing.image_uri} />

        <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
          <Field
            label="Inspector Name"
            value={inspectorName}
            onChangeText={setInspectorName}
            placeholder="Name of the person inspecting"
          />
          <Field
            label="Instrument Used to Measure"
            value={instrument}
            onChangeText={setInstrument}
            placeholder="e.g. Vernier Calliper, Micrometer"
          />
        </View>

        <SectionTitle>Actual Measurements</SectionTitle>

        {dims.map((dim) => {
          const samples = actuals[dim.id] ?? Array(SAMPLE_COUNT).fill('');
          const { tone, count, total } = dimensionTone(samples, dim);
          const canAdd = countFor(dim.id) < MAX_SAMPLES;
          const canRemove = countFor(dim.id) > SAMPLE_COUNT;
          return (
            <Card key={dim.id}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dimLabel}>
                    Dim {dim.dim_no}{dim.description ? ` · ${dim.description}` : ''}
                  </Text>
                  <Text style={styles.dimSpec}>
                    {fmt(dim.nominal)} {drawing.unit}  {toleranceText(dim.tol_upper, dim.tol_lower)}
                  </Text>
                </View>
                {tone === 'pending' ? (
                  <Badge text={count === 0 ? 'Pending' : `${count}/${total}`} tone="neutral" />
                ) : tone === 'ok' ? (
                  <Badge text="OK" tone="success" />
                ) : (
                  <Badge text="NG" tone="danger" />
                )}
              </View>

              <View style={styles.samplesRow}>
                {samples.map((value, idx) => {
                  const toneNow = sampleTone(value, dim);
                  return (
                    <View key={idx} style={styles.sampleBox}>
                      <Text style={styles.sampleLabel}>S{idx + 1}</Text>
                      <TextInput
                        style={[
                          styles.sampleInput,
                          toneNow === 'pass' && styles.sampleInputPass,
                          toneNow === 'fail' && styles.sampleInputFail,
                        ]}
                        value={value}
                        onChangeText={(t) => setSample(dim.id, idx, t)}
                        keyboardType="decimal-pad"
                        placeholder="-"
                        placeholderTextColor={colors.textMuted}
                      />
                      <Text
                        style={[
                          styles.sampleTag,
                          toneNow === 'pass' && styles.sampleTagPass,
                          toneNow === 'fail' && styles.sampleTagFail,
                        ]}
                      >
                        {toneNow === 'pass' ? 'OK' : toneNow === 'fail' ? 'FAIL' : ''}
                      </Text>
                    </View>
                  );
                })}
              </View>

              <View style={styles.sampleControls}>
                <Text style={styles.sampleControlHint}>Default 5 samples per dimension.</Text>
                <View style={styles.sampleControlBtns}>
                  {canRemove ? (
                    <Pressable
                      style={({ pressed }) => [styles.sampleControlBtn, pressed && styles.pressed]}
                      onPress={() => removeSample(dim.id)}
                    >
                      <Text style={styles.sampleControlBtnText}>− Sample</Text>
                    </Pressable>
                  ) : null}
                  {canAdd ? (
                    <Pressable
                      style={({ pressed }) => [styles.sampleControlBtn, styles.sampleControlBtnAdd, pressed && styles.pressed]}
                      onPress={() => addSample(dim.id)}
                    >
                      <Text style={styles.sampleControlBtnAddText}>+ Add Sample</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </Card>
          );
        })}

        <SectionTitle>Inspector Remarks</SectionTitle>
        <View style={{ paddingHorizontal: 16 }}>
          <Field label="Remarks" value={notes} onChangeText={setNotes} multiline placeholder="Optional remarks" />
        </View>

        <View style={{ paddingHorizontal: 16 }}>
          <Button title="Save & Generate Report" onPress={handleSubmit} loading={saving} variant="success" />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.primaryDark,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 3,
  },
  hint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  dimLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  dimSpec: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  samplesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sampleBox: {
    flex: 1,
    marginHorizontal: 3,
  },
  sampleLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 4,
  },
  sampleInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 2,
    fontSize: 14,
    textAlign: 'center',
    color: colors.text,
    backgroundColor: colors.surface,
  },
  sampleInputPass: {
    borderColor: colors.success,
    backgroundColor: colors.successBg,
    color: colors.success,
    fontWeight: '700',
  },
  sampleInputFail: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerBg,
    color: colors.danger,
    fontWeight: '800',
  },
  sampleTag: {
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 3,
    minHeight: 12,
  },
  sampleTagPass: {
    color: colors.success,
  },
  sampleTagFail: {
    color: colors.danger,
  },
  sampleControls: {
    marginTop: 8,
  },
  sampleControlHint: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: 6,
  },
  sampleControlBtns: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  sampleControlBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
    marginLeft: 8,
    backgroundColor: colors.surface,
  },
  sampleControlBtnAdd: {
    borderColor: colors.primary,
  },
  sampleControlBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
  },
  sampleControlBtnAddText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  pressed: {
    opacity: 0.7,
  },
});
