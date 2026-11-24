import type { Dispatch } from '../db/types';
import { COMPANY_NAME } from '../config';
import QRCode from 'qrcode';
import { QUALITY_REPORT_FOOTER } from './footer';

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function blank(value: string | null | undefined): string {
  return value && value.trim() ? value.trim() : '-';
}

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function generateDispatchNo(): string {
  const now = new Date();
  const y = String(now.getFullYear()).slice(2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  let rand = '';
  for (let i = 0; i < 4; i++) {
    rand += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return `STK-${y}${m}${d}-${rand}`;
}

export function buildDispatchQrText(d: Dispatch): string {
  return [
    `SERIAL: ${d.dispatch_no}`,
    `DWG NO: ${d.drawing_no}`,
    `PART: ${d.part_name}`,
    `PO NO: ${d.po_no}`,
    `INV NO: ${d.invoice_no}`,
    `QTY: ${d.qty}`,
  ].join('\n');
}

export async function buildDispatchQrSvg(d: Dispatch): Promise<string> {
  return QRCode.toString(buildDispatchQrText(d), {
    type: 'svg',
    errorCorrectionLevel: 'M',
  });
}

export function buildStickerHtml(d: Dispatch, qrSvg = ''): string {
  const rows = [
    ['Purchase Order No', d.po_no],
    ['Serial No', d.dispatch_no],
    ['DWG No', d.drawing_no],
    ['Part Name', d.part_name],
    ['Qty', d.qty],
    ['Inv No', d.invoice_no],
  ];

  const rowsHtml = rows
    .map(
      ([label, value]) => `
      <div class="row">
        <span class="label">${esc(label)}</span>
        <span class="value">${esc(blank(value))}</span>
      </div>`
    )
    .join('\n');

  const qrHtml = qrSvg
    ? `<div class="qr">${qrSvg}</div>`
    : '';

  const date = new Date(d.dispatched_at).toLocaleDateString('en-IN');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: 6cm 3cm; margin: 0; }
  body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 2mm; justify-content: flex-start; }
  .sticker { width: 6cm; height: 3cm; border: 1px solid #000; box-sizing: border-box; padding: 3px 4px; display: flex; flex-direction: column; overflow: hidden; }
  .top { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #000; padding-bottom: 1px; margin-bottom: 2px; }
  .company { font-size: 7px; font-weight: 800; letter-spacing: 0.5px; white-space: nowrap; }
  .subhead { font-size: 6px; font-weight: 700; color: #333; white-space: nowrap; }
  .main { display: flex; flex: 1; min-height: 0; }
  .info { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .row { display: flex; justify-content: space-between; font-size: 7px; padding: 1px 0; line-height: 1.15; }
  .label { font-weight: 700; color: #333; white-space: nowrap; }
  .value { font-weight: 800; margin-left: 6px; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .date { font-size: 6.5px; color: #555; margin-top: auto; white-space: nowrap; }
  .footer { flex: 0 0 auto; border-top: 1px solid #9ca3af; margin-top: 1px; padding-top: 1px; font-size: 5px; line-height: 1; text-align: center; white-space: nowrap; }
  .qr { display: flex; align-items: flex-end; margin-left: 3px; }
  .qr svg { width: 84px; height: 84px; }
</style>
</head>
<body>
  <div class="sticker">
    <div class="top">
      <span class="company">${esc(COMPANY_NAME)}</span>
    </div>
    <div class="main">
      <div class="info">
        ${rowsHtml}
        <div class="date">Dispatched on ${esc(date)}</div>
      </div>
      ${qrHtml}
    </div>
    <div class="footer">${QUALITY_REPORT_FOOTER}</div>
  </div>
</body>
</html>`;
}
