import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
  TextStyle,
  KeyboardTypeOptions,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { colors } from '../theme';

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

export function Screen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function Card({
  children,
  style,
  onPress,
}: {
  children: ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
}) {
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.cardPressed, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  secureTextEntry = false,
  autoCapitalize = 'sentences',
  multiline = false,
  editable = true,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  multiline?: boolean;
  editable?: boolean;
}) {
  const [showPassword, setShowPassword] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputWrap}>
        <TextInput
          style={[
            styles.input,
            multiline && styles.inputMultiline,
            !editable && styles.inputDisabled,
            secureTextEntry && styles.inputWithToggle,
          ]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry && !showPassword}
          autoCapitalize={autoCapitalize}
          multiline={multiline}
          editable={editable}
        />
        {secureTextEntry ? (
          <Pressable
            onPress={() => setShowPassword((v) => !v)}
            style={({ pressed }) => [styles.eyeBtn, pressed && styles.eyeBtnPressed]}
            hitSlop={8}
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
          >
            <Text style={[styles.eyeBtnText, showPassword && styles.eyeBtnTextActive]}>
              {showPassword ? 'Hide' : 'Show'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function DateField({
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

export function Select({
  label,
  value,
  onChange,
  options,
  placeholder,
  onOptionDelete,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
  placeholder?: string;
  onOptionDelete?: (value: string) => void;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.selectBox, pressed && styles.selectBoxPressed]}
      >
        <Text style={[styles.selectValue, !value && styles.selectPlaceholder]} numberOfLines={1}>
          {value || placeholder || 'Select...'}
        </Text>
        <Text style={styles.selectCaret}>▾</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>{label}</Text>
            <ScrollView style={styles.modalList} keyboardShouldPersistTaps="always">
              {options.map((o) => (
                <View key={o.value} style={styles.optionRow}>
                  <Pressable
                    onPress={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    style={({ pressed }) => [styles.optionMain, pressed && styles.optionRowPressed]}
                  >
                    <Text style={[styles.optionText, o.value === value && styles.optionTextActive]}>
                      {o.label}
                    </Text>
                  </Pressable>
                  {onOptionDelete ? (
                    <Pressable
                      onPress={() => onOptionDelete(o.value)}
                      style={({ pressed }) => [styles.optionDelete, pressed && styles.optionRowPressed]}
                      hitSlop={8}
                      accessibilityLabel={`Delete ${o.label}`}
                    >
                      <Text style={styles.optionDeleteText}>✕</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
              {children}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'success' | 'danger' | 'outline' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const background =
    variant === 'primary'
      ? colors.primary
      : variant === 'success'
        ? colors.success
        : variant === 'danger'
          ? colors.danger
          : variant === 'outline'
            ? colors.surface
            : 'transparent';
  const border = variant === 'outline' ? colors.primary : 'transparent';
  const textColor =
    variant === 'outline' ? colors.primary : variant === 'ghost' ? colors.primary : '#ffffff';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, borderColor: border },
        (disabled || loading) && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text style={[styles.buttonText, { color: textColor }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Badge({ text, tone }: { text: string; tone: 'success' | 'danger' | 'neutral' }) {
  const bg =
    tone === 'success' ? colors.successBg : tone === 'danger' ? colors.dangerBg : colors.warningBg;
  const fg = tone === 'success' ? colors.success : tone === 'danger' ? colors.danger : colors.warning;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{text}</Text>
    </View>
  );
}

export function SectionTitle({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return <Text style={[styles.sectionTitle, style]}>{children}</Text>;
}

export function EmptyState({ message }: { message: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

export function Loading({ text = 'Loading...' }: { text?: string }) {
  return (
    <View style={styles.empty}>
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

export function SearchBar({ value, onChangeText, placeholder = 'Search...' }: { value: string; onChangeText: (t: string) => void; placeholder?: string }) {
  return (
    <View style={styles.searchWrap}>
      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />
      {value.length > 0 ? (
        <Pressable onPress={() => onChangeText('')} style={styles.searchClear} hitSlop={8}>
          <Text style={styles.searchClearText}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={styles.kvValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardPressed: {
    opacity: 0.85,
  },
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
  inputWrap: {
    position: 'relative',
  },
  inputWithToggle: {
    paddingRight: 52,
  },
  eyeBtn: {
    position: 'absolute',
    right: 10,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  eyeBtnPressed: {
    opacity: 0.6,
  },
  eyeBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
  },
  eyeBtnTextActive: {
    color: colors.primary,
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  inputDisabled: {
    backgroundColor: colors.background,
    color: colors.textMuted,
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
  selectBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
  },
  selectBoxPressed: {
    opacity: 0.85,
  },
  selectValue: {
    fontSize: 15,
    color: colors.text,
    flex: 1,
  },
  selectPlaceholder: {
    color: colors.textMuted,
  },
  selectCaret: {
    fontSize: 14,
    color: colors.textMuted,
    marginLeft: 8,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 24,
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 12,
  },
  modalTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textMuted,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  modalList: {
    maxHeight: 300,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  optionMain: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  optionDelete: {
    marginRight: 10,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dangerBg,
  },
  optionDeleteText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.danger,
    lineHeight: 15,
    textAlign: 'center',
  },
  optionRowPressed: {
    backgroundColor: colors.background,
  },
  optionText: {
    fontSize: 15,
    color: colors.text,
  },
  optionTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  button: {
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginVertical: 6,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginHorizontal: 16,
    marginTop: 18,
    marginBottom: 8,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  emptyText: {
    marginTop: 10,
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
  },
  kv: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  kvLabel: {
    color: colors.textMuted,
    fontSize: 13,
  },
  kvValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    maxWidth: '60%',
    textAlign: 'right',
  },
  searchWrap: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    position: 'relative',
  },
  searchInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    paddingRight: 36,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  searchClear: {
    position: 'absolute',
    right: 10,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchClearText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textMuted,
  },
});
