import { Alert, Platform } from 'react-native';

/**
 * True when the value is a bcrypt hash (e.g. `$2b$10$...`), which is how the
 * sync server stores seeded accounts such as ADMIN. The app itself keeps
 * plain-text passwords in SQLite and compares them directly, so callers use
 * this to tell "password this device can verify" apart from "server hash".
 */
export function isBcryptHash(value: string | null | undefined): boolean {
  return /^\$2[aby]\$\d{2}\$/.test(String(value ?? ''));
}

export function confirmAction(title: string, message: string, destructive = false): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(globalThis.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: destructive ? 'Delete' : 'OK', style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

export function fmt(value: number, digits = 3): string {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return '-';
  }
  let s = n.toFixed(digits).replace(/\.?0+$/, '');
  if (n === 0) {
    s = s.replace('-0', '0');
  }
  return s;
}

export function fmtSigned(value: number, digits = 3): string {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return '-';
  }
  return (n < 0 ? '' : '+') + fmt(n, digits);
}

export function normalizedTolerances(tolUpper: number, tolLower: number) {
  return {
    upper: Number(tolUpper) || 0,
    lower: Number(tolLower) || 0,
  };
}

export function limits(nominal: number, tolUpper: number, tolLower: number) {
  const n = Number(nominal) || 0;
  const upperValue = Number(tolUpper) || 0;
  const lowerValue = Number(tolLower) || 0;
  if (upperValue > 0 && lowerValue > 0) {
    return {
      min: n,
      max: n + Math.max(upperValue, lowerValue),
    };
  }
  if (upperValue < 0 && lowerValue < 0) {
    return {
      min: n + Math.min(upperValue, lowerValue),
      max: n,
    };
  }
  return {
    min: n + Math.min(upperValue, lowerValue),
    max: n + Math.max(upperValue, lowerValue),
  };
}

export function isInTolerance(
  actual: number,
  nominal: number,
  tolUpper: number,
  tolLower: number
): boolean {
  const { min, max } = limits(nominal, tolUpper, tolLower);
  const EPS = 1e-9;
  return actual >= min - EPS && actual <= max + EPS;
}

export function toleranceText(tolUpper: number, tolLower: number, digits = 3): string {
  const upper = Number(tolUpper) || 0;
  const lower = Number(tolLower) || 0;
  if (upper === -lower) {
    return `± ${fmt(Math.abs(upper), digits)}`;
  }
  return `${fmtSigned(upper, digits)} / ${fmtSigned(lower, digits)}`;
}

export function formatDate(iso: string): string {
  return iso.replace('T', ' ');
}

export function samplesOf(row: { sample1: number | null; sample2: number | null; sample3: number | null; sample4: number | null; sample5: number | null; sample6: number | null; sample7: number | null; sample8: number | null; sample9: number | null; sample10: number | null }): (number | null)[] {
  return [row.sample1, row.sample2, row.sample3, row.sample4, row.sample5, row.sample6, row.sample7, row.sample8, row.sample9, row.sample10];
}

export function isSampleSet(value: number | null): boolean {
  return value !== null && Number.isFinite(value);
}

export function isNumericSpec(text: string): boolean {
  const t = text.trim();
  if (t === '') return false;
  const n = Number(t);
  return Number.isFinite(n);
}

// A dimension is a "text spec" (OK/NOT OK only) only when its nominal_text is
// non-empty AND not a plain number. Numeric values stored in nominal_text
// (e.g. from synced/imported data) must still accept a measured value.
export function isTextSpec(nominalText: string | null | undefined): boolean {
  const t = (nominalText ?? '').trim();
  return t !== '' && !isNumericSpec(t);
}

// The nominal used for tolerance checks. If nominal_text holds a number but
// the nominal column is empty/zero, use that number.
export function effectiveNominal(nominal: number, nominalText: string | null | undefined): number {
  const t = (nominalText ?? '').trim();
  if (t !== '' && isNumericSpec(t)) {
    return Number(t);
  }
  const n = Number(nominal);
  return Number.isFinite(n) ? n : 0;
}

export function parseStatuses(raw: string, count: number): string[] {
  const parts = raw ? raw.split('|') : [];
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    const val = (parts[i] ?? '').trim();
    result.push(val === 'OK' || val === 'NOT OK' ? val : '');
  }
  return result;
}

export function statusesPass(statuses: string[]): boolean {
  const filled = statuses.filter((s) => s === 'OK' || s === 'NOT OK');
  return filled.length > 0 && filled.every((s) => s === 'OK');
}
