import type { CheckReport } from '../db/types';
import { SAMPLE_COUNT } from '../db/types';
import { COMPANY_NAME } from '../config';
import { fmt, isInTolerance, samplesOf, toleranceText } from '../utils';

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function blank(value: string | null | undefined): string {
  return value && value.trim() ? value.trim() : '';
}

export function buildReportHtml(report: CheckReport): string {
  const { check, rows } = report;

  const sampleCount = Math.max(
    SAMPLE_COUNT,
    ...rows.map((r) => samplesOf(r).filter((v) => v !== null && v !== undefined).length)
  );
  const sampleHeaders = Array.from({ length: sampleCount }, (_, i) => `<th>Sample ${i + 1}</th>`).join('\n        ');

  const dimensionRows = rows
    .map((row, index) => {
      const pass = row.pass === 1;
      const samples = samplesOf(row);
      const sampleCells = Array.from({ length: sampleCount }, (_, i) => {
        const v = samples[i];
        const entered = v !== null && v !== undefined;
        if (!entered) {
          return `<td class="num"></td>`;
        }
        const good = isInTolerance(v, row.nominal, row.tol_upper, row.tol_lower);
        return `<td class="num ${good ? 'ok' : 'bad'}">${esc(fmt(v))}</td>`;
      }).join('');
      return `<tr>
        <td>${index + 1}</td>
        <td class="num">${esc(fmt(row.nominal))}</td>
        <td class="num">${esc(toleranceText(row.tol_upper, row.tol_lower))}</td>
        <td>${esc(check.instrument || '-')}</td>
        ${sampleCells}
        <td class="result ${pass ? 'ok' : 'bad'}">${pass ? 'OK' : 'NG'}</td>
      </tr>`;
    })
    .join('\n');

  const passedCount = rows.filter((r) => r.pass === 1).length;
  const failedCount = rows.length - passedCount;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { margin: 12mm; size: A4 landscape; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #111827; font-size: 11px; margin: 0; }
    .title { text-align: center; font-size: 20px; font-weight: 800; letter-spacing: 1px; color: #1e3a8a; border-bottom: 2px solid #1d4ed8; padding-bottom: 6px; margin-bottom: 8px; }
    .company { text-align: center; font-size: 11px; color: #374151; margin-bottom: 4px; }
    table.head { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    table.head td { border: 1px solid #94a3b8; padding: 4px 6px; font-size: 10.5px; }
    table.head td.label { background: #eef2ff; font-weight: 700; color: #1e3a8a; width: 14%; }
    table.results { width: 100%; border-collapse: collapse; }
    table.results th { background: #1d4ed8; color: #fff; padding: 4px 3px; font-size: 9px; border: 1px solid #1e3a8a; }
    table.results td { border: 1px solid #94a3b8; padding: 3px 3px; font-size: 9px; text-align: center; }
    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .result { font-weight: 800; }
    .ok { color: #15803d; }
    .bad { color: #b91c1c; }
    .table-title { text-align: center; font-size: 13px; font-weight: 800; margin: 8px 0 4px; letter-spacing: 1px; }
    .unit-note { text-align: center; font-size: 10.5px; color: #374151; margin-bottom: 4px; }
    .summary { text-align: center; font-size: 11px; color: #374151; margin: 6px 0; }
    .notes { border: 1px solid #94a3b8; padding: 6px 8px; font-size: 10.5px; margin: 6px 0; }
    .notes b { color: #1e3a8a; }
    table.sign { width: 100%; border-collapse: collapse; margin-top: 8px; }
    table.sign td { width: 50%; font-size: 10.5px; color: #374151; }
    table.sign .line { border-top: 1px solid #374151; width: 55%; margin-top: 34px; padding-top: 4px; text-align: center; }
  </style>
</head>
<body>
  <div class="company">${esc(COMPANY_NAME)}</div>
  <div class="title">FINAL INSPECTION REPORT</div>

  <table class="head">
    <tr>
      <td class="label">Report No &amp; Date</td><td>${esc(check.id)} &amp; ${esc(check.checked_at)}</td>
      <td class="label">Customer</td><td>${esc(blank(check.customer) || '-')}</td>
      <td class="label">Part Name</td><td>${esc(blank(check.part_name) || '-')}</td>
    </tr>
    <tr>
      <td class="label">Invoice No &amp; Date</td><td>${esc(blank(check.invoice_no) || '-')} &amp; ${esc(blank(check.invoice_date) || '-')}</td>
      <td class="label">Material</td><td>${esc(blank(check.material) || '-')}</td>
      <td class="label">Drawing Rev No &amp; Date</td><td>${esc(blank(check.revision) || '-')} &amp; ${esc(blank(check.drawing_rev_date) || '-')}</td>
    </tr>
    <tr>
      <td class="label">PART</td><td>${esc(blank(check.drawing_no) || '-')}</td>
      <td class="label">PO NO</td><td>${esc(blank(check.po_no) || '-')}</td>
      <td class="label">QTY</td><td>${esc(blank(check.qty) || '-')}</td>
    </tr>
    <tr>
      <td class="label">Inspector</td><td>${esc(blank(check.inspector_name || check.inspector_employee_name) || '-')} (${esc(blank(check.inspector_employee_id) || '-')})</td>
      <td class="label">Inspection Date &amp; Time</td><td>${esc(check.checked_at)}</td>
      <td class="label">Dimensions</td><td>OK: ${passedCount} | NG: ${failedCount}</td>
    </tr>
  </table>

  <div class="unit-note">All Dimensions in ${esc(blank(check.unit) || 'mm')}</div>
  <div class="table-title">DIMENSIONAL OBSERVATION</div>

  <table class="results">
    <thead>
      <tr>
        <th>Sl.No.</th>
        <th>Dimension</th>
        <th>Tolerance</th>
        <th>Instrument Used to Measure</th>
        ${sampleHeaders}
        <th>Remarks</th>
      </tr>
    </thead>
    <tbody>
      ${dimensionRows}
    </tbody>
  </table>

  <div class="summary">Dimensions checked: ${rows.length} &nbsp;|&nbsp; OK: ${passedCount} &nbsp;|&nbsp; NG: ${failedCount}</div>

  <div class="notes"><b>Inspector Remarks:</b> ${esc(blank(check.inspector_notes) || 'N/A')}</div>

  <table class="sign">
    <tr>
      <td><div class="line">Inspected By (${esc(blank(check.inspector_name || check.inspector_employee_name) || '')})</div></td>
      <td><div class="line">Approved By</div></td>
    </tr>
  </table>
</body>
</html>`;
}
