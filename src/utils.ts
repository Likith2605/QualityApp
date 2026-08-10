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
    upper: Math.abs(Number(tolUpper) || 0),
    lower: -Math.abs(Number(tolLower) || 0),
  };
}

export function limits(nominal: number, tolUpper: number, tolLower: number) {
  const { upper, lower } = normalizedTolerances(tolUpper, tolLower);
  return {
    min: nominal + lower,
    max: nominal + upper,
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
  const { upper, lower } = normalizedTolerances(tolUpper, tolLower);
  if (Math.abs(upper + lower) < 1e-9) {
    return `± ${fmt(upper, digits)}`;
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
