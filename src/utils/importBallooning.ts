import * as DocumentPicker from 'expo-document-picker';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { Directory, File, Paths } from 'expo-file-system';
import * as XLSX from 'xlsx';

export interface ParsedDimension {
  dim_no: number;
  description: string;
  nominal: number;
  nominal_text: string;
  tol_upper: number;
  tol_lower: number;
}

export interface StrictImportRowError {
  row: number;
  message: string;
}

export interface StrictImportResult {
  dims: ParsedDimension[];
  fileName: string;
  errors: StrictImportRowError[];
}

const REQUIRED_COLUMN_LABELS = {
  dimNo: 'Balloon No',
  desc: 'Description',
  nominal: 'Dimensions No (mm)',
  tolUpper: 'Upper Tolerance (mm)',
  tolLower: 'Lower Tolerance (mm)',
} as const;

type RequiredKey = keyof typeof REQUIRED_COLUMN_LABELS;

function normalise(s: unknown): string {
  return String(s ?? '').trim().toLowerCase().replace(/[\s_\-./#]+/g, ' ');
}

function toNum(v: unknown): number {
  const text = String(v).trim().replace(/,/g, '');
  const unwrapped = text.replace(/^\((.*)\)$/, '$1').trim();
  const n = Number(unwrapped);
  return Number.isFinite(n) ? n : 0;
}

function hasWord(s: string, word: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${word}($|[^a-z0-9])`).test(s);
}

async function readFileBase64(file: { uri: string; name: string }): Promise<string> {
  const uri = file.uri;

  if (typeof document !== 'undefined') {
    if (uri.startsWith('blob:') || uri.startsWith('data:') || /^https?:$/.test(uri.split(':')[0])) {
      const res = await fetch(uri);
      if (!res.ok) {
        throw new Error(`Could not read the selected file: ${file.name} (${res.status} ${res.statusText})`);
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      let binary = '';
      for (let i = 0; i < buf.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + 0x8000)));
      }
      return btoa(binary);
    }
  }

  console.log('readFileBase64 chain-v3 invoked for', file.name);

  const cacheDir = new Directory(Paths.cache, 'imports');
  if (!cacheDir.exists) {
    await cacheDir.create({ intermediates: true, idempotent: true });
  }

  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_') || 'import';
  const dest = new File(cacheDir, `${Date.now()}_${safeName}`);

  const errors: string[] = [];
  const run = async (fn: () => Promise<string>): Promise<string | null> => {
    try {
      return await fn();
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  if (uri.startsWith('content://')) {
    const copied = await run(async () => {
      await LegacyFileSystem.copyAsync({ from: uri, to: dest.uri });
      return await LegacyFileSystem.readAsStringAsync(dest.uri, {
        encoding: LegacyFileSystem.EncodingType.Base64,
      });
    });
    if (copied) return copied;
  } else {
    const direct = await run(() => new File(uri).base64());
    if (direct) return direct;
    const directLegacy = await run(() =>
      LegacyFileSystem.readAsStringAsync(uri, {
        encoding: LegacyFileSystem.EncodingType.Base64,
      })
    );
    if (directLegacy) return directLegacy;
  }

  const copied = await run(async () => {
    await LegacyFileSystem.copyAsync({ from: uri, to: dest.uri });
    return await LegacyFileSystem.readAsStringAsync(dest.uri, {
      encoding: LegacyFileSystem.EncodingType.Base64,
    });
  });
  if (copied) return copied;

  const copiedNew = await run(async () => {
    const source = new File(uri);
    await source.copy(dest);
    return await dest.base64();
  });
  if (copiedNew) return copiedNew;

  console.error('readFileBase64 failed for', uri, errors);
  throw new Error(
    `The selected file could not be found or copied: ${file.name} (${errors[0] ?? 'unknown error'})`
  );
}

function parseNumericCell(text: string): number | null {
  const t = text.trim().replace(/^\((.*)\)$/, '$1').trim().replace(/,/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseToleranceCell(text: string): { values: number[]; invalid: boolean } {
  const t = text.trim();
  if (!t) return { values: [], invalid: false };
  const single = t.replace(/^\((.*)\)$/, '$1').trim();
  if (Number.isFinite(Number(single))) {
    return { values: [Number(single)], invalid: false };
  }
  const parts = single.split(/[\s,;\/]+/).map((p) => p.trim()).filter((p) => p !== '');
  const values: number[] = [];
  for (const part of parts) {
    const clean = part.replace(/^\((.*)\)$/, '$1').trim();
    const n = Number(clean);
    if (!Number.isFinite(n)) return { values: [], invalid: true };
    values.push(n);
  }
  return { values, invalid: false };
}

function combineUpperBand(values: number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function combineLowerBand(values: number[]): number {
  return values.length === 0 ? 0 : Math.min(...values);
}

function pickFile(): Promise<{ uri: string; name: string } | null> {
  return DocumentPicker.getDocumentAsync({
    type: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'application/csv',
      'application/octet-stream',
    ],
    copyToCacheDirectory: false,
    multiple: false,
  }).then((res) => {
    if (res.canceled || !res.assets[0]) return null;
    const a = res.assets[0];
    return { uri: a.uri, name: a.name };
  });
}

function isDimNoHeader(h: string): boolean {
  const n = normalise(h);
  return (
    n.includes('balloon') ||
    n.includes('balo') ||
    n.includes('dim no') ||
    n.includes('dimension no') ||
    n.includes('dimension number') ||
    n === 'no' ||
    n === 'no.' ||
    hasWord(n, 'number') ||
    n.includes('sl no') ||
    n.includes('sr no') ||
    n.includes('s no') ||
    /^#\d*$/.test(n) ||
    /^\d+$/.test(n)
  );
}

function isDescHeader(h: string): boolean {
  const n = normalise(h);
  return (
    n.includes('description') ||
    n.includes('desc') ||
    n.includes('feature') ||
    n.includes('characteristic') ||
    n.includes('detail') ||
    n.includes('parameter') ||
    n.includes('inspection') ||
    n.includes('check point') ||
    n.includes('checkpoint') ||
    n.includes('observation') ||
    n.includes('remark') ||
    n.includes('label') ||
    hasWord(n, 'item')
  );
}

function isNominalHeader(h: string): boolean {
  const n = normalise(h);
  return (
    n.includes('nominal') ||
    n.includes('nom') ||
    n.includes('basic') ||
    n.includes('target') ||
    n.includes('size') ||
    n.includes('value') ||
    n.includes('dimension') ||
    n.includes('diameter') ||
    n.includes('dia') ||
    n.includes('specification') ||
    n.includes('spec') ||
    n.includes('drawing') ||
    n.includes('std') ||
    n.includes('standard') ||
    n.includes('design')
  );
}

function isTolUpperHeader(h: string): boolean {
  const n = normalise(h);
  return (
    n.includes('upper tolerance') ||
    n.includes('tol+') ||
    n.includes('tol +') ||
    n.includes('tol upper') ||
    n.includes('upper tol') ||
    hasWord(n, 'upper') ||
    n.includes('tolerance+') ||
    n.includes('tolerance +') ||
    n.includes('tolerance upper') ||
    n.includes('+tol') ||
    n.includes('+ tol') ||
    n.includes('plus') ||
    n.includes('positive') ||
    n.includes('usl') ||
    hasWord(n, 'max') ||
    n.includes('maximum') ||
    n.includes('upper deviation') ||
    n.includes('deviation up') ||
    n.includes('max limit') ||
    n.includes('maxlimit') ||
    /\btol\b\s*\+|\+\s*\btol\b/i.test(h) ||
    /\btolerance\b\s*\+|\+\s*\btolerance\b/i.test(h)
  );
}

function isTolLowerHeader(h: string): boolean {
  const n = normalise(h);
  return (
    n.includes('lower tolerance') ||
    n.includes('tol-') ||
    n.includes('tol -') ||
    n.includes('tol lower') ||
    n.includes('lower tol') ||
    hasWord(n, 'lower') ||
    n.includes('tolerance-') ||
    n.includes('tolerance -') ||
    n.includes('tolerance lower') ||
    n.includes('-tol') ||
    n.includes('- tol') ||
    n.includes('minus') ||
    n.includes('negative') ||
    n.includes('lsl') ||
    hasWord(n, 'min') ||
    n.includes('minimum') ||
    n.includes('lower deviation') ||
    n.includes('deviation lo') ||
    n.includes('deviation down') ||
    n.includes('min limit') ||
    n.includes('minlimit') ||
    /\btol\b\s*\-|\-\s*\btol\b/i.test(h) ||
    /\btolerance\b\s*\-|\-\s*\btolerance\b/i.test(h)
  );
}

function parseSheet(ws: XLSX.WorkSheet): { dims: ParsedDimension[]; debug: string } {
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  if (raw.length === 0) return { dims: [], debug: 'Sheet is empty' };

  const headers = Object.keys(raw[0]);
  const headerInfo = headers.map((h, i) => `[${i}]"${h}"`).join(', ');
  const debug = `Headers: ${headerInfo} | Rows: ${raw.length}`;

  const dimNoCol = headers.find(isDimNoHeader);
  const descCol = headers.find(isDescHeader);
  const nomCol = headers.find(isNominalHeader);
  const tolUpCol = headers.find(isTolUpperHeader);
  const tolLoCol = headers.find(isTolLowerHeader);

  if (!nomCol) {
    return {
      dims: [],
      debug: `${debug} | No nominal column matched. Tried: ${headers.map((h) => `"${h}"`).join(', ')}`,
    };
  }

  const dims = raw
    .map((row, i) => {
      // Balloon numbers must be whole numbers - round decimals like "10.1"
      // so they can never fail the integer dim_no column on the sync server.
      const rawDimNo = dimNoCol ? toNum(row[dimNoCol]) : i + 1;
      const dimNo = rawDimNo ? Math.max(1, Math.round(rawDimNo)) : 0;
      const desc = descCol ? String(row[descCol] ?? '').trim() : '';
      const nominalText = String(row[nomCol] ?? '').trim();
      const nominalNum = parseNumericCell(nominalText);
      const tolUpper = tolUpCol ? toNum(row[tolUpCol]) : 0;
      const tolLower = tolLoCol ? toNum(row[tolLoCol]) : 0;
      if (nominalNum === null && !nominalText && !desc && dimNo === 0) return null;
      return {
        dim_no: dimNo || i + 1,
        description: desc,
        nominal: nominalNum ?? 0,
        nominal_text: nominalNum === null ? nominalText : '',
        tol_upper: tolUpper,
        tol_lower: tolLower,
      };
    })
    .filter((d): d is ParsedDimension => d !== null);

  return { dims, debug };
}

export async function importBallooningFile(): Promise<{ dims: ParsedDimension[]; fileName: string; debug: string } | null> {
  const file = await pickFile();
  if (!file) return null;

  const b64 = await readFileBase64(file);

  if (!b64 || b64.length < 100) {
    throw new Error(`File "${file.name}" appears to be empty or too small to contain data.`);
  }

  const wb = XLSX.read(b64, { type: 'base64' });
  const allDebug: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const { dims, debug } = parseSheet(ws);
    allDebug.push(`Sheet "${sheetName}": ${debug}`);
    if (dims.length > 0) {
      return { dims, fileName: file.name, debug: allDebug.join('\n') };
    }
  }

  throw new Error(
    `Could not find dimension data in "${file.name}".\n\nDetected columns:\n${allDebug.join('\n\n')}\n\n` +
    `Please ensure your Excel has columns for at least: nominal/value/size and optionally balloon no, description, tol+, tol-`
  );
}

function parseStrictSheet(ws: XLSX.WorkSheet): { dims: ParsedDimension[]; errors: StrictImportRowError[] } {
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  if (raw.length === 0) {
    return { dims: [], errors: [{ row: 1, message: 'The worksheet is empty.' }] };
  }

  const headers = Object.keys(raw[0]);
  const col: Record<RequiredKey, string | undefined> = {
    dimNo: headers.find(isDimNoHeader),
    desc: headers.find(isDescHeader),
    nominal: headers.find(isNominalHeader),
    tolUpper: headers.find(isTolUpperHeader),
    tolLower: headers.find(isTolLowerHeader),
  };

  const missing = (Object.keys(REQUIRED_COLUMN_LABELS) as RequiredKey[]).filter((k) => !col[k]);
  if (missing.length > 0) {
    throw new Error(
      `The Excel file is missing required columns: ${missing.map((k) => REQUIRED_COLUMN_LABELS[k]).join(', ')}.\n\n` +
      `Found columns: ${headers.map((h) => `"${h}"`).join(', ') || '(none)'}`
    );
  }

  const dims: ParsedDimension[] = [];
  const errors: StrictImportRowError[] = [];

  const dimNoCol = col.dimNo;
  const descCol = col.desc;
  const nominalCol = col.nominal;
  const tolUpperCol = col.tolUpper;
  const tolLowerCol = col.tolLower;

  raw.forEach((row, i) => {
    const excelRow = i + 2; // row 1 is the header row
    const dimNoText = String(row[dimNoCol!] ?? '').trim();
    const desc = String(row[descCol!] ?? '').trim();
    const nominalText = String(row[nominalCol!] ?? '').trim();
    const upperText = String(row[tolUpperCol!] ?? '').trim();
    const lowerText = String(row[tolLowerCol!] ?? '').trim();

    if (!dimNoText && !desc && !nominalText && !upperText && !lowerText) return;

    // Raw value kept for validation below; rounded when pushed into dims.
    const dimNo = dimNoText ? Number(dimNoText.replace(/,/g, '')) : i + 1;
    const nominal = parseNumericCell(nominalText);
    const upper = parseToleranceCell(upperText);
    const lower = parseToleranceCell(lowerText);

    const problems: string[] = [];
    if (dimNoText && !Number.isFinite(dimNo)) {
      problems.push(`"Balloon No" is not a number (got "${dimNoText}")`);
    }
    if (nominal === null && !nominalText) {
      problems.push(`"Dimensions No (mm)" is empty`);
    }
    if (upper.invalid) {
      problems.push(`"Upper Tolerance (mm)" contains a non-numeric value (got "${upperText}")`);
    }
    if (lower.invalid) {
      problems.push(`"Lower Tolerance (mm)" contains a non-numeric value (got "${lowerText}")`);
    }

    if (problems.length > 0) {
      errors.push({ row: excelRow, message: problems.join('; ') });
      return;
    }

    dims.push({
      // Whole numbers only: the sync server's dim_no column is an integer,
      // and a decimal balloon number used to fail the entire sync push.
      dim_no: Number.isFinite(dimNo) && dimNo > 0 ? Math.round(dimNo) : i + 1,
      description: desc,
      nominal: nominal ?? 0,
      nominal_text: nominal === null && nominalText ? nominalText : '',
      tol_upper: combineUpperBand(upper.values),
      tol_lower: combineLowerBand(lower.values),
    });
  });

  return { dims, errors };
}

export async function importStrictBallooningFile(): Promise<StrictImportResult | null> {
  const file = await pickFile();
  if (!file) return null;

  const b64 = await readFileBase64(file);
  if (!b64 || b64.length < 100) {
    throw new Error(`File "${file.name}" appears to be empty or too small to contain data.`);
  }

  const wb = XLSX.read(b64, { type: 'base64' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    throw new Error(`No worksheet found in "${file.name}".`);
  }
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    throw new Error(`Worksheet "${sheetName}" could not be read from "${file.name}".`);
  }

  const { dims, errors } = parseStrictSheet(ws);
  return { dims, fileName: file.name, errors };
}
