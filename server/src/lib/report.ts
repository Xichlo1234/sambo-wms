/**
 * Xuất báo cáo Excel (ExcelJS) và PDF (pdfmake – font Roboto hỗ trợ đầy đủ tiếng Việt).
 * Cùng một định nghĩa cột dùng cho JSON (màn hình), Excel, PDF và In.
 */
import ExcelJS from 'exceljs';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PdfPrinter = require('pdfmake');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const vfs: Record<string, string> = require('pdfmake/build/vfs_fonts.js');

export type ColType = 'text' | 'number' | 'date' | 'datetime' | 'money';
export interface ReportColumn {
  key: string;
  header: string;
  type?: ColType;
  width?: number; // Excel width (ký tự)
  total?: boolean;
}
export interface ReportResult {
  title: string;
  subtitle?: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  totals?: Record<string, number>;
  summary?: { label: string; value: string | number }[];
  signatures?: string[]; // các ô ký tên cuối biểu mẫu
  landscape?: boolean;
}

export function computeTotals(cols: ReportColumn[], rows: Record<string, unknown>[]) {
  const t: Record<string, number> = {};
  for (const c of cols.filter((c) => c.total)) {
    t[c.key] = Math.round(rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0) * 10000) / 10000;
  }
  return t;
}

const fmtDate = (v: unknown) => {
  if (!v) return '';
  const d = new Date(v as string);
  if (isNaN(d.getTime())) return String(v);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
};
const fmtDateTime = (v: unknown) => {
  if (!v) return '';
  const d = new Date(v as string);
  if (isNaN(d.getTime())) return String(v);
  // Hiển thị theo giờ Việt Nam (UTC+7)
  const t = new Date(d.getTime() + 7 * 3600_000);
  return `${fmtDate(t)} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
};
const fmtNum = (v: unknown, dec = 4) => {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (isNaN(n)) return String(v);
  return n.toLocaleString('vi-VN', { maximumFractionDigits: dec });
};

export function formatCell(v: unknown, type?: ColType) {
  switch (type) {
    case 'date': return fmtDate(v);
    case 'datetime': return fmtDateTime(v);
    case 'number': return fmtNum(v);
    case 'money': return fmtNum(v, 2);
    default: return v === null || v === undefined ? '' : String(v);
  }
}

export async function toExcel(r: ReportResult, companyName = 'SAMBO GOLD'): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SAMBO GOLD WMS';
  wb.created = new Date();
  const ws = wb.addWorksheet('Báo cáo', { pageSetup: { orientation: r.landscape ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const n = r.columns.length;
  ws.mergeCells(1, 1, 1, n);
  ws.getCell(1, 1).value = companyName.toUpperCase() + ' – WAREHOUSE MANAGEMENT SYSTEM';
  ws.getCell(1, 1).font = { bold: true, size: 10, color: { argb: 'FF0B2545' } };
  ws.mergeCells(2, 1, 2, n);
  ws.getCell(2, 1).value = r.title.toUpperCase();
  ws.getCell(2, 1).font = { bold: true, size: 14, color: { argb: 'FF0B2545' } };
  ws.getCell(2, 1).alignment = { horizontal: 'center' };
  ws.mergeCells(3, 1, 3, n);
  ws.getCell(3, 1).value = r.subtitle ?? '';
  ws.getCell(3, 1).alignment = { horizontal: 'center' };
  ws.getCell(3, 1).font = { italic: true, size: 10 };
  let rowIdx = 4;
  for (const s of r.summary ?? []) {
    ws.getCell(rowIdx, 1).value = s.label;
    ws.getCell(rowIdx, 1).font = { bold: true };
    ws.getCell(rowIdx, 2).value = s.value;
    rowIdx++;
  }
  rowIdx++;
  const headerRow = ws.getRow(rowIdx);
  r.columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2545' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    ws.getColumn(i + 1).width = c.width ?? (c.type === 'number' || c.type === 'money' ? 14 : c.type?.startsWith('date') ? 13 : 22);
  });
  headerRow.height = 30;
  const headerAt = rowIdx;
  for (const row of r.rows) {
    rowIdx++;
    const xr = ws.getRow(rowIdx);
    r.columns.forEach((c, i) => {
      const v = row[c.key];
      const cell = xr.getCell(i + 1);
      if (c.type === 'number' || c.type === 'money') {
        cell.value = v === null || v === undefined || v === '' ? null : Number(v);
        cell.numFmt = c.type === 'money' ? '#,##0.00' : '#,##0.####';
      } else if (c.type === 'date' || c.type === 'datetime') {
        cell.value = c.type === 'date' ? fmtDate(v) : fmtDateTime(v);
      } else {
        cell.value = v === null || v === undefined ? '' : String(v);
      }
      cell.border = { top: { style: 'hair' }, bottom: { style: 'hair' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });
  }
  const totals = r.totals ?? computeTotals(r.columns, r.rows);
  if (Object.keys(totals).length) {
    rowIdx++;
    const tr = ws.getRow(rowIdx);
    tr.getCell(1).value = 'TỔNG CỘNG';
    r.columns.forEach((c, i) => {
      if (c.key in totals) {
        tr.getCell(i + 1).value = totals[c.key];
        tr.getCell(i + 1).numFmt = '#,##0.####';
      }
      tr.getCell(i + 1).font = { bold: true };
      tr.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4D6' } };
    });
  }
  ws.views = [{ state: 'frozen', ySplit: headerAt }];
  ws.autoFilter = { from: { row: headerAt, column: 1 }, to: { row: headerAt, column: n } };
  rowIdx += 2;
  ws.getCell(rowIdx, 1).value = `Xuất lúc: ${fmtDateTime(new Date())}`;
  ws.getCell(rowIdx, 1).font = { italic: true, size: 9 };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

let printer: { createPdfKitDocument: (d: unknown) => NodeJS.ReadableStream & { end: () => void } } | null = null;
function getPrinter() {
  if (!printer) {
    const buf = (n: string) => Buffer.from(vfs[n], 'base64');
    printer = new PdfPrinter({
      Roboto: { normal: buf('Roboto-Regular.ttf'), bold: buf('Roboto-Medium.ttf'), italics: buf('Roboto-Italic.ttf'), bolditalics: buf('Roboto-MediumItalic.ttf') },
    });
  }
  return printer!;
}

export async function toPdf(r: ReportResult, companyName = 'SAMBO GOLD'): Promise<Buffer> {
  const totals = r.totals ?? computeTotals(r.columns, r.rows);
  const isNum = (c: ReportColumn) => c.type === 'number' || c.type === 'money';
  const body: unknown[][] = [
    r.columns.map((c) => ({ text: c.header, style: 'th' })),
    ...r.rows.map((row) => r.columns.map((c) => ({ text: formatCell(row[c.key], c.type), alignment: isNum(c) ? 'right' : 'left' }))),
  ];
  if (Object.keys(totals).length) {
    body.push(r.columns.map((c, i) => ({ text: i === 0 ? 'TỔNG CỘNG' : c.key in totals ? formatCell(totals[c.key], 'number') : '', bold: true, alignment: isNum(c) ? 'right' : 'left', fillColor: '#FFF4D6' })));
  }
  const landscape = r.landscape ?? r.columns.length > 7;
  const def = {
    pageSize: 'A4',
    pageOrientation: landscape ? 'landscape' : 'portrait',
    pageMargins: [24, 50, 24, 40],
    defaultStyle: { font: 'Roboto', fontSize: r.columns.length > 10 ? 7 : 8 },
    header: { text: `${companyName.toUpperCase()} – WAREHOUSE MANAGEMENT SYSTEM`, margin: [24, 18, 24, 0], fontSize: 8, color: '#0B2545', bold: true },
    footer: (cur: number, count: number) => ({ columns: [{ text: `Xuất lúc ${fmtDateTime(new Date())}`, fontSize: 7, color: '#666' }, { text: `Trang ${cur}/${count}`, alignment: 'right', fontSize: 7 }], margin: [24, 10, 24, 0] }),
    content: [
      { text: r.title.toUpperCase(), style: 'title' },
      ...(r.subtitle ? [{ text: r.subtitle, alignment: 'center', italics: true, margin: [0, 0, 0, 8] }] : []),
      ...(r.summary?.length ? [{ columns: [{ width: '*', stack: r.summary.map((s) => ({ text: [{ text: s.label + ': ', bold: true }, String(s.value)] })) }], margin: [0, 0, 0, 8] }] : []),
      {
        table: { headerRows: 1, widths: r.columns.map((c) => (isNum(c) || c.type?.startsWith('date') ? 'auto' : '*')), body },
        layout: { fillColor: (i: number) => (i === 0 ? '#0B2545' : i % 2 === 0 ? '#F5F7FA' : null), hLineWidth: () => 0.4, vLineWidth: () => 0.4, hLineColor: () => '#B0B7C3', vLineColor: () => '#B0B7C3' },
      },
      ...(r.signatures?.length
        ? [{ columns: r.signatures.map((s) => ({ stack: [{ text: s, bold: true, alignment: 'center' }, { text: '(Ký, ghi rõ họ tên)', italics: true, alignment: 'center', fontSize: 7 }] })), margin: [0, 24, 0, 60] }]
        : []),
    ],
    styles: {
      title: { fontSize: 14, bold: true, alignment: 'center', color: '#0B2545', margin: [0, 0, 0, 4] },
      th: { bold: true, color: '#FFFFFF', alignment: 'center' },
    },
  };
  const doc = getPrinter().createPdfKitDocument(def);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

export function sendFile(res: import('express').Response, buf: Buffer, filename: string, mime: string, inline = false) {
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(buf);
}
