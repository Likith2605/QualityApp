export type Role = 'admin' | 'designer' | 'qc';

export const ROLES: Role[] = ['admin', 'designer', 'qc'];

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  designer: 'Designer',
  qc: 'Quality Check',
};

export interface Employee {
  id: number;
  employee_id: string;
  name: string;
  password: string;
  role: Role;
  created_at: string;
}

export interface Instrument {
  id: number;
  name: string;
}

export interface Drawing {
  id: number;
  drawing_no: string;
  part_name: string;
  customer: string;
  revision: string;
  material: string;
  unit: string;
  notes: string;
  invoice_no: string;
  invoice_date: string;
  drawing_rev_date: string;
  po_no: string;
  qty: string;
  treatment: string;
  hardness: string;
  image_uri: string | null;
  created_by: number;
  created_at: string;
  designer_name?: string;
  dim_count?: number;
  checked_dim_count?: number;
}

export interface Dimension {
  id: number;
  drawing_id: number;
  dim_no: number;
  description: string;
  nominal: number;
  nominal_text: string;
  tol_upper: number;
  tol_lower: number;
}

export interface CheckRecord {
  id: number;
  drawing_id: number;
  checked_by: number;
  checked_at: string;
  result: 'PASS' | 'FAIL';
  instrument: string;
  inspector_notes: string;
  inspector_name?: string;
  inspector_employee_name?: string;
  inspector_employee_id?: string;
  drawing_no?: string;
  part_name?: string;
  customer?: string;
  revision?: string;
  material?: string;
  unit?: string;
  invoice_no?: string;
  invoice_date?: string;
  drawing_rev_date?: string;
  po_no?: string;
  qty?: string;
  treatment?: string;
  hardness?: string;
  image_uri?: string | null;
  ok_count?: number;
  ng_count?: number;
}

export interface MeasurementRow {
  id: number;
  check_id: number;
  dimension_id: number;
  dim_no: number;
  description: string;
  nominal: number;
  nominal_text: string;
  tol_upper: number;
  tol_lower: number;
  sample1: number | null;
  sample2: number | null;
  sample3: number | null;
  sample4: number | null;
  sample5: number | null;
  sample6: number | null;
  sample7: number | null;
  sample8: number | null;
  sample9: number | null;
  sample10: number | null;
  sample_status: string;
  remarks: string;
  pass: number;
  instrument: string;
  checked_at?: string;
  inspector_name?: string;
  inspector_employee_name?: string;
}

export const SAMPLE_COUNT = 5;
export const MAX_SAMPLES = 10;

export interface NewMeasurementInput {
  dimensionId: number;
  nominal: number;
  tol_upper: number;
  tol_lower: number;
  samples: number[];
  statuses?: string[];
  nominal_text?: string;
  remarks?: string;
  instrument?: string;
}

export interface CheckReport {
  check: CheckRecord;
  rows: MeasurementRow[];
  dims: ReportDimension[];
}

export interface ReportDimension {
  id: number;
  dim_no: number;
  description: string;
  nominal: number;
  nominal_text: string;
  tol_upper: number;
  tol_lower: number;
  checked: boolean;
}

export interface CheckedDimensionRow extends MeasurementRow {
  checked_at: string;
  instrument: string;
  inspector_name?: string;
  inspector_employee_name?: string;
  nominal_text: string;
}

export interface DrawingReportRow extends MeasurementRow {
  checked_at: string;
  instrument: string;
  inspector_name?: string;
  inspector_employee_name?: string;
  inspector_employee_id?: string;
  nominal_text: string;
}

export interface DrawingReport {
  drawing: Drawing;
  checks: CheckRecord[];
  rows: DrawingReportRow[];
  dims: ReportDimension[];
}

export interface Dispatch {
  id: number;
  dispatch_no: string;
  drawing_id: number;
  drawing_no: string;
  part_name: string;
  po_no: string;
  invoice_no: string;
  qty: string;
  dispatched_by: number;
  dispatched_at: string;
  notes: string;
  dispatcher_name?: string;
  dispatcher_employee_id?: string;
}
