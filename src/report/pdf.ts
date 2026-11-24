import type { CheckReport, DrawingReport } from '../db/types';
import { SAMPLE_COUNT } from '../db/types';
import { COMPANY_NAME } from '../config';
import { QUALITY_REPORT_FOOTER } from './footer';
import { effectiveNominal, fmt, isInTolerance, isTextSpec, parseStatuses, samplesOf, toleranceText } from '../utils';

function rowSampleCount(row: { sample_status?: string }): number {
  return (row.sample_status ?? '').split('|').filter((s) => s === 'OK' || s === 'NOT OK').length;
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function blank(value: string | null | undefined): string {
  return value && value.trim() ? value.trim() : '';
}

function dateOnly(value: string | null | undefined): string {
  const s = blank(value);
  return s.slice(0, 10);
}

function logoHtml(logoUri: string): string {
  return logoUri
    ? `<div class="logobox"><img class="logo" src="${logoUri}" /></div>`
    : '';
}

export function buildReportHtml(report: CheckReport, logoUri = ''): string {
  const { check, rows, dims } = report;
  const pending = dims.filter((d) => !d.checked);

  const sampleCount = Math.max(
    SAMPLE_COUNT,
    ...rows.map((r) =>
      Math.max(
        samplesOf(r).filter((v) => v !== null && v !== undefined).length,
        rowSampleCount(r)
      )
    )
  );
  const sampleHeaders = Array.from({ length: sampleCount }, (_, i) => `<th>Sample ${i + 1}</th>`).join('\n        ');

  const inspectorName = blank(check.inspector_name || check.inspector_employee_name);
  const remarksHtml = blank(check.inspector_notes)
    ? `<div class="notes"><b>Inspector Remarks:</b> ${esc(blank(check.inspector_notes))}</div>`
    : '';

  const pendingRows = pending
    .map((d) => {
      const sampleCells = Array.from({ length: sampleCount }, () => `<td class="num"></td>`).join('');
      return `<tr class="pend">
        <td>${esc(d.dim_no)}</td>
        <td>${esc(blank(d.description))}</td>
        <td class="num">${isTextSpec(d.nominal_text) ? esc(blank(d.nominal_text)) : esc(fmt(effectiveNominal(d.nominal, d.nominal_text)))}</td>
        <td class="num">${isTextSpec(d.nominal_text) ? '-' : esc(toleranceText(d.tol_upper, d.tol_lower))}</td>
        <td>-</td>
        ${sampleCells}
        <td></td>
        <td></td>
      </tr>`;
    })
    .join('\n');

  const dimensionRows = rows
    .map((row, index) => {
      const isSpec = isTextSpec(row.nominal_text);
      const samples = samplesOf(row);
      const statuses = isSpec ? parseStatuses(row.sample_status, sampleCount) : [];
      const sampleCells = Array.from({ length: sampleCount }, (_, i) => {
        if (isSpec) {
          const status = statuses[i];
          if (!status) {
            return `<td class="num"></td>`;
          }
          return `<td class="num ${status === 'OK' ? 'ok' : 'bad'}">${esc(status)}</td>`;
        }
        const v = samples[i];
        const entered = v !== null && v !== undefined;
        if (!entered) {
          return `<td class="num"></td>`;
        }
        const good = isInTolerance(v, effectiveNominal(row.nominal, row.nominal_text), row.tol_upper, row.tol_lower);
        return `<td class="num ${good ? 'ok' : 'bad'}">${esc(fmt(v))}</td>`;
      }).join('');
      return `<tr>
        <td>${row.dim_no}</td>
        <td>${esc(blank(row.description))}</td>
        <td class="num">${isSpec ? esc(blank(row.nominal_text)) : esc(fmt(effectiveNominal(row.nominal, row.nominal_text)))}</td>
        <td class="num">${isSpec ? '-' : esc(toleranceText(row.tol_upper, row.tol_lower))}</td>
        <td>${esc(blank(row.instrument) || '-')}</td>
        ${sampleCells}
        <td>${esc(blank(row.inspector_name || row.inspector_employee_name) || inspectorName || '-')}</td>
        <td>${esc(blank(row.remarks))}</td>
      </tr>`;
    })
    .join('\n')
    .concat(pendingRows ? `\n${pendingRows}` : '');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { margin: 12mm; size: A4 landscape; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #111827; font-size: 11px; margin: 0; }
    .logobox { text-align: center; margin-bottom: 4px; }
    .logo { height: 42px; width: 68px; object-fit: contain; }
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
    .pending { color: #b45309; }
    tr.pend td { background: #fffbeb; }
    .table-title { text-align: center; font-size: 13px; font-weight: 800; margin: 8px 0 4px; letter-spacing: 1px; }
    .unit-note { text-align: center; font-size: 10.5px; color: #374151; margin-bottom: 4px; }
    .summary { text-align: center; font-size: 11px; color: #374151; margin: 6px 0; }
    .notes { border: 1px solid #94a3b8; padding: 6px 8px; font-size: 10.5px; margin: 6px 0; }
    .notes b { color: #1e3a8a; }
    table.sign { width: 100%; border-collapse: collapse; margin-top: 8px; }
    table.sign td { width: 50%; font-size: 10.5px; color: #374151; }
    table.sign td:last-child { text-align: right; }
    table.sign td:last-child .line { margin-left: auto; }
    table.sign .line { border-top: 1px solid #374151; width: 55%; margin-top: 34px; padding-top: 4px; text-align: center; }
    table.sign .inspector { font-weight: 700; color: #1e3a8a; text-decoration: underline; }
    .footer { text-align: left; font-size: 9px; color: #6b7280; margin-top: 16px; letter-spacing: 0.5px; }
  </style>
</head>
<body>
  ${logoHtml(logoUri)}
  <div class="company">${esc(COMPANY_NAME)}</div>
  <div class="title">INSPECTION REPORT</div>

  <table class="head">
    <tr>
      <td class="label">Customer</td><td>${esc(blank(check.customer) || '-')}</td>
      <td class="label">Part No</td><td>${esc(blank(check.drawing_no) || '-')}</td>
      <td class="label">Part Name</td><td>${esc(blank(check.part_name) || '-')}</td>
    </tr>
    <tr>
      <td class="label">Drawing No / Rev No</td><td>${esc(blank(check.revision) || '-')}</td>
      <td class="label">Date of Inspection</td><td>${esc(dateOnly(check.checked_at))}</td>
      <td class="label">Qty</td><td>${esc(blank(check.qty) || '-')}</td>
    </tr>
    <tr>
      <td class="label">Material</td><td>${esc(blank(check.material) || '-')}</td>
      <td class="label">Invoice No</td><td>${esc(blank(check.invoice_no) || '-')}</td>
      <td class="label">PO No</td><td>${esc(blank(check.po_no) || '-')}</td>
    </tr>
    <tr>
      <td class="label">Report No</td><td>${esc(check.id)}</td>
      <td class="label">Treatment</td><td>${esc(blank(check.treatment)) || '-'}</td>
      <td class="label">Hardness</td><td>${esc(blank(check.hardness)) || '-'}</td>
    </tr>
  </table>

  <div class="unit-note">All Dimensions in ${esc(blank(check.unit) || 'mm')}</div>
  <div class="table-title">DIMENSIONAL OBSERVATION</div>

  <table class="results">
    <thead>
      <tr>
        <th>Sl.No.</th>
        <th>Description</th>
        <th>Dimension</th>
        <th>Tolerance</th>
        <th>Instrument</th>
        ${sampleHeaders}
        <th>Inspector Name</th>
        <th>Remarks</th>
      </tr>
    </thead>
    <tbody>
      ${dimensionRows}
    </tbody>
  </table>


  ${remarksHtml}

  <table class="sign">
    <tr>
      <td><div class="line"><span class="inspector">${inspectorName ? `Inspected By (${esc(inspectorName)})` : 'Inspected By'}</span></div></td>
      <td><div class="line">Approved By</div></td>
    </tr>
  </table>
  <div class="footer">${QUALITY_REPORT_FOOTER}</div>
</body>
</html>`;
}

export function buildOverallReportHtml(report: DrawingReport, logoUri = ''): string {
  const { drawing, checks, rows, dims } = report;
  const pending = dims.filter((d) => !d.checked);
  const sampleCount = Math.max(
    SAMPLE_COUNT,
    ...rows.map((r) =>
      Math.max(
        samplesOf(r).filter((v) => v !== null && v !== undefined).length,
        rowSampleCount(r)
      )
    )
  );
  const sampleHeaders = Array.from({ length: sampleCount }, (_, i) => `<th>Sample ${i + 1}</th>`).join('\n        ');

  const dimensionRows = rows
    .map((row, index) => {
      const isSpec = isTextSpec(row.nominal_text);
      const samples = samplesOf(row);
      const statuses = isSpec ? parseStatuses(row.sample_status, sampleCount) : [];
      const sampleCells = Array.from({ length: sampleCount }, (_, i) => {
        if (isSpec) {
          const status = statuses[i];
          if (!status) {
            return `<td class="num"></td>`;
          }
          return `<td class="num ${status === 'OK' ? 'ok' : 'bad'}">${esc(status)}</td>`;
        }
        const v = samples[i];
        const entered = v !== null && v !== undefined;
        if (!entered) {
          return `<td class="num"></td>`;
        }
        const good = isInTolerance(v, effectiveNominal(row.nominal, row.nominal_text), row.tol_upper, row.tol_lower);
        return `<td class="num ${good ? 'ok' : 'bad'}">${esc(fmt(v))}</td>`;
      }).join('');
      return `<tr>
        <td>${row.dim_no}</td>
        <td>${esc(blank(row.description))}</td>
        <td class="num">${isSpec ? esc(blank(row.nominal_text)) : esc(fmt(effectiveNominal(row.nominal, row.nominal_text)))}</td>
        <td class="num">${isSpec ? '-' : esc(toleranceText(row.tol_upper, row.tol_lower))}</td>
        <td>${esc(blank(row.instrument) || '-')}</td>
        ${sampleCells}
        <td>${esc(blank(row.remarks))}</td>
      </tr>`;
    })
    .join('\n');

  const pendingRows = pending
    .map((d) => {
      const sampleCells = Array.from({ length: sampleCount }, () => `<td class="num"></td>`).join('');
      return `<tr class="pend">
        <td>${esc(d.dim_no)}</td>
        <td>${esc(blank(d.description))}</td>
        <td class="num">${isTextSpec(d.nominal_text) ? esc(blank(d.nominal_text)) : esc(fmt(effectiveNominal(d.nominal, d.nominal_text)))}</td>
        <td class="num">${isTextSpec(d.nominal_text) ? '-' : esc(toleranceText(d.tol_upper, d.tol_lower))}</td>
        <td>-</td>
        ${sampleCells}
        <td></td>
      </tr>`;
    })
    .join('\n');

  const allRows = dimensionRows.concat(pendingRows ? `\n${pendingRows}` : '');

  const lastCheck = checks[checks.length - 1];
  const lastDate = lastCheck ? esc(dateOnly(lastCheck.checked_at)) : '-';

  const inspectorName =
    blank(lastCheck?.inspector_name || lastCheck?.inspector_employee_name) ||
    blank(rows.find((r) => blank(r.inspector_name || r.inspector_employee_name))?.inspector_name) ||
    blank(rows.find((r) => blank(r.inspector_employee_name))?.inspector_employee_name) ||
    '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { margin: 12mm; size: A4 landscape; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #111827; font-size: 11px; margin: 0; }
    .logobox { text-align: center; margin-bottom: 4px; }
    .logo { height: 42px; width: 68px; object-fit: contain; }
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
    .pending { color: #b45309; }
    tr.pend td { background: #fffbeb; }
    .table-title { text-align: center; font-size: 13px; font-weight: 800; margin: 8px 0 4px; letter-spacing: 1px; }
    .unit-note { text-align: center; font-size: 10.5px; color: #374151; margin-bottom: 4px; }
    .summary { text-align: center; font-size: 11px; color: #374151; margin: 6px 0; }
    .notes { border: 1px solid #94a3b8; padding: 6px 8px; font-size: 10.5px; margin: 6px 0; }
    .notes b { color: #1e3a8a; }
    table.sign { width: 100%; border-collapse: collapse; margin-top: 8px; }
    table.sign td { width: 50%; font-size: 10.5px; color: #374151; }
    table.sign td:last-child { text-align: right; }
    table.sign td:last-child .line { margin-left: auto; }
    table.sign .line { border-top: 1px solid #374151; width: 55%; margin-top: 34px; padding-top: 4px; text-align: center; }
    table.sign .inspector { font-weight: 700; color: #1e3a8a; text-decoration: underline; }
    .footer { text-align: left; font-size: 9px; color: #6b7280; margin-top: 16px; letter-spacing: 0.5px; }
  </style>
</head>
<body>
  ${logoHtml(logoUri)}
  <div class="company">${esc(COMPANY_NAME)}</div>
  <div class="title">FINAL INSPECTION REPORT</div>

  <table class="head">
    <tr>
      <td class="label">Customer</td><td>${esc(blank(drawing.customer) || '-')}</td>
      <td class="label">Part No</td><td>${esc(blank(drawing.drawing_no) || '-')}</td>
      <td class="label">Part Name</td><td>${esc(blank(drawing.part_name) || '-')}</td>
    </tr>
    <tr>
      <td class="label">Drawing No / Rev No</td><td>${esc(blank(drawing.revision) || '-')}</td>
      <td class="label">Date of Inspection</td><td>${lastDate}</td>
      <td class="label">Qty</td><td>${esc(blank(drawing.qty) || '-')}</td>
    </tr>
    <tr>
      <td class="label">Material</td><td>${esc(blank(drawing.material) || '-')}</td>
      <td class="label">Invoice No</td><td>${esc(blank(drawing.invoice_no) || '-')}</td>
      <td class="label">PO No</td><td>${esc(blank(drawing.po_no) || '-')}</td>
    </tr>
    <tr>
      <td class="label">Report No</td><td>${esc(blank(drawing.drawing_no) || '-')}</td>
      <td class="label">Treatment</td><td>${esc(blank(drawing.treatment)) || '-'}</td>
      <td class="label">Hardness</td><td>${esc(blank(drawing.hardness)) || '-'}</td>
    </tr>
  </table>

  <div class="unit-note">All Dimensions in ${esc(blank(drawing.unit) || 'mm')}</div>
  <div class="table-title">DIMENSIONAL OBSERVATION (ALL INSPECTIONS COMBINED)</div>

  <table class="results">
    <thead>
      <tr>
        <th>Sl.No.</th>
        <th>Description</th>
        <th>Dimension</th>
        <th>Tolerance</th>
        <th>Instrument</th>
        ${sampleHeaders}
        <th>Remarks</th>
      </tr>
    </thead>
    <tbody>
      ${allRows}
    </tbody>
  </table>


  <table class="sign">
    <tr>
      <td><div class="line"><span class="inspector">${inspectorName ? `Inspected By (${esc(inspectorName)})` : 'Inspected By'}</span></div></td>
      <td><div class="line">Approved By</div></td>
    </tr>
  </table>
  <div class="footer">${QUALITY_REPORT_FOOTER}</div>
</body>
</html>`;
}
