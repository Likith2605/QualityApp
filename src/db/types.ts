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
  image_uri: string | null;
  created_by: number;
  created_at: string;
  designer_name?: string;
  dim_count?: number;
}

export interface Dimension {
  id: number;
  drawing_id: number;
  dim_no: number;
  description: string;
  nominal: number;
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
  pass: number;
}

export const SAMPLE_COUNT = 5;
export const MAX_SAMPLES = 10;

export interface NewMeasurementInput {
  dimensionId: number;
  nominal: number;
  tol_upper: number;
  tol_lower: number;
  samples: number[];
}

export interface CheckReport {
  check: CheckRecord;
  rows: MeasurementRow[];
}
