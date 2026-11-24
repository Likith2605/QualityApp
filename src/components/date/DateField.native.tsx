import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { colors } from '../../theme';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDateString(value: string): Date | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value.trim());
  if (!m) {
    return null;
  }
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export default function DateField({
  label,
  value,
  onChange,
  placeholder = 'Select date',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  const parsed = parseDateString(value);
  const current = parsed ?? new Date();

  const onPick = (event: DateTimePickerEvent, date?: Date) => {
    setShow(false);
    if (event.type === 'set' && date) {
      onChange(toDateString(date));
    }
  };

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable style={[styles.input, styles.dateInput]} onPress={() => setShow(true)}>
        <Text style={value ? styles.dateValue : styles.datePlaceholder}>
          {value || placeholder}
        </Text>
      </Pressable>
      {show ? (
        <DateTimePicker value={current} mode="date" display="calendar" onChange={onPick} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 5,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  dateInput: {
    justifyContent: 'center',
  },
  dateValue: {
    fontSize: 15,
    color: colors.text,
  },
  datePlaceholder: {
    fontSize: 15,
    color: colors.textMuted,
  },
});
