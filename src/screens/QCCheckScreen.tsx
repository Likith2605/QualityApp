import { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';
import { addInstrument, createCheck, deleteInstrument, getCheckedDimensions, getDimensions, getDrawing, getInstruments } from '../db/repo';
import type { CheckedDimensionRow, Dimension, Drawing, Instrument, NewMeasurementInput } from '../db/types';
import { MAX_SAMPLES, SAMPLE_COUNT } from '../db/types';
import type { RootStackParamList } from '../navigation/types';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme';
import { confirmAction, effectiveNominal, fmt, isInTolerance, isTextSpec, parseStatuses, samplesOf, toleranceText } from '../utils';
import DrawingImage from '../components/DrawingImage';
import { scheduleAutoSync } from '../db/sync';
import { Badge, Button, Card, EmptyState, Field, Loading, Screen, SectionTitle, Select } from '../components/ui';

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

function statusTone(statuses: string[]): { tone: 'pending' | 'ok' | 'ng'; count: number; total: number } {
  let fail = false;
  let filled = 0;
  for (const value of statuses) {
    if (value === 'OK' || value === 'NOT OK') {
      filled++;
      if (value === 'NOT OK') {
        fail = true;
      }
    }
  }
  if (fail) {
    return { tone: 'ng', count: filled, total: statuses.length };
  }
  if (filled === statuses.length && filled > 0) {
    return { tone: 'ok', count: filled, total: statuses.length };
  }
  return { tone: 'pending', count: filled, total: statuses.length };
}

function StatusPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.sampleInput,
          value === 'OK' && styles.sampleInputPass,
          value === 'NOT OK' && styles.sampleInputFail,
          pressed && styles.pressed,
        ]}
      >
        <Text
          style={{
            textAlign: 'center',
            fontSize: 13,
            color: value ? colors.text : colors.textMuted,
            fontWeight: value ? '800' : '600',
            paddingVertical: 4,
          }}
        >
          {value || 'Select ▾'}
        </Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.statusModalBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.statusModalSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.statusModalTitle}>Select Status</Text>
            <Pressable
              onPress={() => {
                onChange('OK');
                setOpen(false);
              }}
              style={({ pressed }) => [styles.statusModalOption, pressed && styles.pressed]}
            >
              <Text style={[styles.statusModalOptionText, { color: colors.success }]}>OK</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                onChange('NOT OK');
                setOpen(false);
              }}
              style={({ pressed }) => [styles.statusModalOption, pressed && styles.pressed]}
            >
              <Text style={[styles.statusModalOptionText, { color: colors.danger }]}>NOT OK</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

export default function QCCheckScreen() {
  const db = useSQLiteContext();
  const { user } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'QCCheck'>>();
  const drawingId = route.params.drawingId;

  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [dims, setDims] = useState<Dimension[]>([]);
  const [checkedRows, setCheckedRows] = useState<CheckedDimensionRow[]>([]);
  const [actuals, setActuals] = useState<Record<number, string[]>>({});
  const [statuses, setStatuses] = useState<Record<number, string[]>>({});
  const [extra, setExtra] = useState<Record<number, number>>({});
  const [remarks, setRemarks] = useState<Record<number, string>>({});
  const [editingDimIds, setEditingDimIds] = useState<Record<number, boolean>>({});
  const [inspectorName, setInspectorName] = useState(user?.name ?? '');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [dimInstruments, setDimInstruments] = useState<Record<number, string>>({});
  const [newInstrumentName, setNewInstrumentName] = useState('');
  const [addingInstrument, setAddingInstrument] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const d = await getDrawing(db, drawingId);
        const list = await getDimensions(db, drawingId);
        const checked = await getCheckedDimensions(db, drawingId);
        const instrumentList = await getInstruments(db);
        setDrawing(d);
        setDims(list);
        setCheckedRows(checked);
        setInstruments(instrumentList);
        const initial: Record<number, string[]> = {};
        const initialStatuses: Record<number, string[]> = {};
        list.forEach((x) => {
          const prev = checked.find((c) => c.dimension_id === x.id);
          if (!prev || prev.pass === 0) {
            if (!isTextSpec(x.nominal_text)) {
              initial[x.id] = Array(SAMPLE_COUNT).fill('');
            } else {
              initial[x.id] = Array(SAMPLE_COUNT).fill('');
              initialStatuses[x.id] = prev ? parseStatuses(prev.sample_status, SAMPLE_COUNT) : Array(SAMPLE_COUNT).fill('');
            }
          }
        });
        setActuals(initial);
        setStatuses(initialStatuses);
      } catch (e) {
        console.error('QCCheckScreen load error:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [db, drawingId]);

  const checkedMap = new Map(checkedRows.map((r) => [r.dimension_id, r]));
  const failedDimIds = new Set(checkedRows.filter((r) => r.pass === 0).map((r) => r.dimension_id));
  const readonlyRows = checkedRows.filter((r) => r.pass === 1 && !editingDimIds[r.dimension_id]);
  const pendingDims = dims.filter(
    (dim) => !checkedMap.has(dim.id) || failedDimIds.has(dim.id) || editingDimIds[dim.id]
  );

  const countFor = (dimId: number) => SAMPLE_COUNT + (extra[dimId] ?? 0);

  const setSample = (dimId: number, index: number, value: string) => {
    setActuals((prev) => {
      const next = [...(prev[dimId] ?? Array(countFor(dimId)).fill(''))];
      next[index] = value;
      return { ...prev, [dimId]: next };
    });
  };

  const setStatusSample = (dimId: number, index: number, value: string) => {
    setStatuses((prev) => {
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
    setStatuses((prev) => {
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
    setStatuses((prev) => {
      const next = (prev[dimId] ?? []).slice(0, SAMPLE_COUNT + newExtra);
      return { ...prev, [dimId]: next };
    });
  };

  const editPassedDimension = (row: CheckedDimensionRow) => {
    const isSpec = isTextSpec(row.nominal_text);
    if (isSpec) {
      const storedCount = (row.sample_status ?? '').split('|').filter((s) => s === 'OK' || s === 'NOT OK').length;
      const count = Math.max(SAMPLE_COUNT, storedCount);
      setActuals((prev) => ({ ...prev, [row.dimension_id]: Array(count).fill('') }));
      const parsed = parseStatuses(row.sample_status, count);
      setExtra((prev) => ({ ...prev, [row.dimension_id]: Math.max(0, count - SAMPLE_COUNT) }));
      setStatuses((prev) => ({ ...prev, [row.dimension_id]: parsed }));
    } else {
      const samples = samplesOf(row).map((sample) => sample === null || sample === undefined ? '' : String(sample));
      setActuals((prev) => ({ ...prev, [row.dimension_id]: samples }));
      setExtra((prev) => ({
        ...prev,
        [row.dimension_id]: Math.max(0, samples.length - SAMPLE_COUNT),
      }));
      setStatuses((prev) => ({ ...prev, [row.dimension_id]: [] }));
    }
    setDimInstruments((prev) => ({ ...prev, [row.dimension_id]: row.instrument ?? '' }));
    setRemarks((prev) => ({ ...prev, [row.dimension_id]: row.remarks ?? '' }));
    setEditingDimIds((prev) => ({ ...prev, [row.dimension_id]: true }));
  };

  const hasAnySample = pendingDims.some((dim) => {
    const isSpec = isTextSpec(dim.nominal_text);
    if (isSpec) {
      return (statuses[dim.id] ?? []).some((s) => s === 'OK' || s === 'NOT OK');
    }
    return (actuals[dim.id] ?? []).some((s) => parseNum(s) !== null);
  });

  const handleAddInstrument = async () => {
    const name = newInstrumentName.trim();
    if (!name) return;
    setAddingInstrument(true);
    try {
      await addInstrument(db, name);
      setNewInstrumentName('');
      setInstruments(await getInstruments(db));
      scheduleAutoSync(db);
    } catch {
      Alert.alert('Error', 'Could not add the instrument.');
    } finally {
      setAddingInstrument(false);
    }
  };

  const handleDeleteInstrument = async (name: string) => {
    if (!(await confirmAction('Delete Instrument', `Delete "${name}" from the instrument list?`, true))) return;
    try {
      await deleteInstrument(db, name);
      setInstruments(await getInstruments(db));
      setDimInstruments((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (next[Number(key)] === name) next[Number(key)] = '';
        }
        return next;
      });
      scheduleAutoSync(db);
    } catch {
      Alert.alert('Error', 'Could not delete the instrument.');
    }
  };

  const handleSubmit = useCallback(async () => {
    if (pendingDims.length === 0) {
      Alert.alert('Nothing to check', 'All dimensions on this drawing have already been checked.');
      return;
    }
    if (!hasAnySample) {
      Alert.alert('No measurements', 'Enter at least one sample measurement before saving.');
      return;
    }

    const measurements: NewMeasurementInput[] = pendingDims
      .filter((dim) => {
        const isSpec = isTextSpec(dim.nominal_text);
        if (isSpec) {
          return (statuses[dim.id] ?? []).some((s) => s === 'OK' || s === 'NOT OK');
        }
        return (actuals[dim.id] ?? []).some((s) => parseNum(s) !== null);
      })
      .map((dim) => {
        const isSpec = isTextSpec(dim.nominal_text);
        const samples = isSpec ? [] : (actuals[dim.id] ?? []).map((s) => parseNum(s) as number);
        return {
          dimensionId: dim.id,
          nominal: effectiveNominal(dim.nominal, dim.nominal_text),
          nominal_text: dim.nominal_text,
          tol_upper: dim.tol_upper,
          tol_lower: dim.tol_lower,
          samples,
          statuses: isSpec ? (statuses[dim.id] ?? []).filter((s) => s === 'OK' || s === 'NOT OK') : undefined,
          remarks: (remarks[dim.id] ?? '').trim(),
          instrument: (dimInstruments[dim.id] ?? '').trim(),
          };
      });

    const confirmed = await confirmAction(
      'Confirm',
      `Save this inspection? ${measurements.length} dimension(s) with measurements will be recorded. Dimensions without entered samples stay pending and can be checked later.`
    );
    if (!confirmed) return;

    setSaving(true);
    try {
      const checkId = await createCheck(db, {
        drawingId,
        checkedBy: user?.id ?? 0,
        inspectorNotes: notes,
        inspectorName,
        measurements,
      });
      scheduleAutoSync(db);
      navigation.replace('CheckReport', { checkId });
    } catch {
      Alert.alert('Error', 'Could not save the inspection.');
    } finally {
      setSaving(false);
    }
  }, [pendingDims, actuals, statuses, remarks, dimInstruments, inspectorName, notes, hasAnySample, db, drawingId, user, navigation]);

  if (loading) {
    return <Loading />;
  }

  if (!drawing) {
    return <EmptyState message="Drawing not found." />;
  }

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="always" style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
        <Card>
          <Text style={styles.title}>{drawing.drawing_no} – {drawing.part_name}</Text>
          <Text style={styles.subtitle}>
            {drawing.customer ? `${drawing.customer}  ·  ` : ''}Rev {drawing.revision}  ·  Unit: {drawing.unit}
          </Text>
          {checkedRows.length > 0 ? (
            <Text style={styles.progress}>
              {checkedRows.length} of {dims.length} dimensions already checked
            </Text>
          ) : null}
        </Card>

        <DrawingImage uri={drawing.image_uri} />

        <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
          <Field
            label="Inspector Name"
            value={inspectorName}
            onChangeText={setInspectorName}
            placeholder="Name of the person inspecting"
          />
        </View>

        <SectionTitle>Instruments</SectionTitle>
        <View style={{ paddingHorizontal: 16 }}>
          {instruments.map((inst) => (
            <View key={inst.id} style={styles.instrumentRow}>
              <Text style={styles.instrumentName}>{inst.name}</Text>
              <Pressable
                onPress={() => handleDeleteInstrument(inst.name)}
                style={({ pressed }) => [styles.instrumentRemove, pressed && styles.pressed]}
              >
                <Text style={styles.instrumentRemoveText}>Remove</Text>
              </Pressable>
            </View>
          ))}
          <View style={styles.addInstrumentRow}>
            <TextInput
              style={styles.addInstrumentInput}
              value={newInstrumentName}
              onChangeText={setNewInstrumentName}
              placeholder="New instrument name"
              placeholderTextColor={colors.textMuted}
            />
            <Button title="Add Instrument" onPress={handleAddInstrument} loading={addingInstrument} style={styles.addInstrumentButton} />
          </View>
        </View>

        {pendingDims.length === 0 ? (
          <EmptyState message="All dimensions on this drawing have already been checked and passed. Use the Overall Report to review the combined result." />
        ) : (
          <>
            <SectionTitle>Dimensions to Check ({pendingDims.length})</SectionTitle>

            {pendingDims.map((dim) => {
              const samples = actuals[dim.id] ?? Array(SAMPLE_COUNT).fill('');
              const statusValues = statuses[dim.id] ?? Array(SAMPLE_COUNT).fill('');
              const isSpec = isTextSpec(dim.nominal_text);
              const isEditing = Boolean(editingDimIds[dim.id]);
              const dimWithNominal = { ...dim, nominal: effectiveNominal(dim.nominal, dim.nominal_text) };
              const { tone, count, total } = isSpec ? statusTone(statusValues) : dimensionTone(samples, dimWithNominal);
              const canAdd = countFor(dim.id) < MAX_SAMPLES;
              const canRemove = countFor(dim.id) > SAMPLE_COUNT;
              const prevPass = checkedMap.get(dim.id)?.pass;
              return (
                <Card key={dim.id}>
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.dimLabel}>
                        Dim {dim.dim_no}{dim.description ? ` · ${dim.description}` : ''}
                      </Text>
                      <Text style={styles.dimSpec}>
                        {isSpec ? dim.nominal_text : `${fmt(dim.nominal)} ${drawing.unit}  ${toleranceText(dim.tol_upper, dim.tol_lower)}`}
                      </Text>
                      {prevPass === 0 ? (
                        <Text style={styles.recheckHint}>Previously FAILED — re-enter samples to re-check.</Text>
                      ) : null}
                    </View>
                    {tone === 'pending' ? (
                      <Badge text={count === 0 ? 'Pending' : `${count}/${total}`} tone="neutral" />
                    ) : tone === 'ok' ? (
                      <Badge text="OK" tone="success" />
                    ) : (
                      <Badge text="FAIL" tone="danger" />
                    )}
                  </View>

                  <View style={{ marginVertical: 10 }}>
                    <Select
                      label="Instrument"
                      value={dimInstruments[dim.id] ?? ''}
                      onChange={(val) => {
                        setDimInstruments((prev) => ({ ...prev, [dim.id]: val }));
                      }}
                      options={instruments.map((i) => ({ label: i.name, value: i.name }))}
                      placeholder="Select an instrument"
                    />
                  </View>

                  <View style={styles.samplesRow}>
                    {(isSpec ? statusValues : samples).map((value, idx) => {
                      const toneNow = isSpec
                        ? value === 'OK' ? 'pass' : value === 'NOT OK' ? 'fail' : 'empty'
                        : sampleTone(value, dimWithNominal);
                      return (
                        <View key={idx} style={styles.sampleBox}>
                          <Text style={styles.sampleLabel}>S{idx + 1}</Text>
                          {isSpec ? (
                            <StatusPicker value={value} onChange={(v) => setStatusSample(dim.id, idx, v)} />
                          ) : (
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
                          )}
                          {!isSpec && (
                            <Text
                              style={[
                                styles.sampleTag,
                                toneNow === 'pass' && styles.sampleTagPass,
                                toneNow === 'fail' && styles.sampleTagFail,
                              ]}
                            >
                              {toneNow === 'pass' ? 'OK' : toneNow === 'fail' ? 'FAIL' : ''}
                            </Text>
                          )}
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

                  <View style={styles.remarksBox}>
                    {isEditing ? (
                      <Text style={styles.lockedDetail}>Remarks: {remarks[dim.id] || '-'}</Text>
                    ) : (
                      <>
                        <Text style={styles.remarksLabel}>Remarks</Text>
                        <TextInput
                          style={styles.remarksInput}
                          value={remarks[dim.id] ?? ''}
                          onChangeText={(t) => setRemarks((prev) => ({ ...prev, [dim.id]: t }))}
                          placeholder="Type remarks for this dimension"
                          placeholderTextColor={colors.textMuted}
                          multiline
                        />
                      </>
                    )}
                  </View>
                </Card>
              );
            })}
          </>
        )}

        {readonlyRows.length > 0 ? (
          <>
            <SectionTitle>Already Passed ({readonlyRows.length})</SectionTitle>
            {readonlyRows.map((row) => {
              const isSpec = isTextSpec(row.nominal_text);
              const rawSamples = samplesOf(row);
              const storedStatusCount = (row.sample_status ?? '').split('|').filter((s) => s === 'OK' || s === 'NOT OK').length;
              const sampleStatuses = parseStatuses(row.sample_status, Math.max(SAMPLE_COUNT, storedStatusCount));
              const shown = isSpec ? Math.max(SAMPLE_COUNT, storedStatusCount) : Math.max(5, rawSamples.filter((s) => s !== null && s !== undefined).length);
              const checkedBy = row.inspector_name || row.inspector_employee_name || 'Unknown';
              return (
                <Card key={row.id}>
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.dimLabel}>
                        Dim {row.dim_no}{row.description ? ` · ${row.description}` : ''}
                      </Text>
                      <Text style={styles.dimSpec}>
                        {isSpec ? row.nominal_text : `${fmt(row.nominal)} ${drawing.unit}  ${toleranceText(row.tol_upper, row.tol_lower)}`}
                      </Text>
                    </View>
                    <Badge text="OK" tone="success" />
                  </View>
                  <Text style={styles.checkedBy}>
                    Checked by {checkedBy} · {row.checked_at}
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
                                styles.readSampleValue,
                                status === 'OK' ? styles.sampleInputPass : status === 'NOT OK' ? styles.sampleInputFail : undefined,
                              ]}
                            >
                              {status || '-'}
                            </Text>
                          </View>
                        );
                      }
                      const s = rawSamples[i];
                      const entered = s !== null && s !== undefined;
                      const good = entered && isInTolerance(s, effectiveNominal(row.nominal, row.nominal_text), row.tol_upper, row.tol_lower);
                      return (
                        <View
                          key={i}
                          style={[styles.sampleBox, entered && (good ? styles.sampleBoxPass : styles.sampleBoxFail)]}
                        >
                          <Text style={styles.sampleLabel}>S{i + 1}</Text>
                          <Text
                            style={[
                              styles.readSampleValue,
                              entered && (good ? styles.sampleInputPass : styles.sampleInputFail),
                            ]}
                          >
                            {entered ? fmt(s) : '-'}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                  <Button
                    title="Edit / Check Again"
                    onPress={() => editPassedDimension(row)}
                    variant="outline"
                    style={styles.editButton}
                  />
                </Card>
              );
            })}
          </>
        ) : null}

        {pendingDims.length > 0 ? (
          <>
            <SectionTitle>Inspector Remarks</SectionTitle>
            <View style={{ paddingHorizontal: 16 }}>
              <Field label="Remarks" value={notes} onChangeText={setNotes} multiline placeholder="Optional remarks" />
            </View>

            <View style={{ paddingHorizontal: 16 }}>
              {checkedRows.length > 0 ? (
                <Button
                  title="View Report"
                  onPress={() => navigation.navigate('OverallReportView', { drawingId })}
                  variant="outline"
                  style={{ marginBottom: 8 }}
                />
              ) : null}
              <Button title="Save & Generate Report" onPress={handleSubmit} loading={saving} variant="success" />
            </View>
          </>
        ) : null}
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
  progress: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
    marginTop: 6,
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
  checkedBy: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
    marginBottom: 8,
  },
  lockedDetail: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },
  recheckHint: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.danger,
    marginTop: 3,
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
  sampleBoxPass: {
    borderWidth: 1,
    borderColor: colors.success,
    borderRadius: 8,
    backgroundColor: colors.successBg,
  },
  sampleBoxFail: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 8,
    backgroundColor: colors.dangerBg,
  },
  readSampleValue: {
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 8,
    fontWeight: '700',
  },
  editButton: {
    marginTop: 10,
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
  remarksBox: {
    marginTop: 10,
  },
  remarksLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    marginBottom: 4,
  },
  remarksInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 13,
    color: colors.text,
    backgroundColor: colors.surface,
    minHeight: 44,
    textAlignVertical: 'top',
  },
  instrumentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  instrumentName: {
    fontSize: 15,
    color: colors.text,
    flex: 1,
  },
  instrumentRemove: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: colors.dangerBg,
  },
  instrumentRemoveText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.danger,
  },
  addInstrumentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  addInstrumentInput: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
    marginRight: 8,
  },
  addInstrumentButton: {
    minWidth: 120,
  },
  statusModalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  statusModalSheet: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    width: 200,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  statusModalTitle: {
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
    fontSize: 14,
    color: colors.text,
  },
  statusModalOption: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#f9fafb',
    marginBottom: 6,
  },
  statusModalOptionText: {
    textAlign: 'center',
    fontWeight: '600',
    fontSize: 15,
  },
});
