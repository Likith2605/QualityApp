import { createElement, type CSSProperties } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme';

const inputStyle: CSSProperties = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: 8,
  paddingLeft: 12,
  paddingRight: 12,
  paddingTop: 9,
  paddingBottom: 9,
  fontSize: 15,
  color: colors.text,
  backgroundColor: colors.surface,
  width: '100%',
  boxSizing: 'border-box',
};

export default function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {createElement('input', {
        type: 'date',
        value,
        style: inputStyle,
        onChange: (event: { target: { value: string } }) => onChange(event.target.value),
      })}
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
});
