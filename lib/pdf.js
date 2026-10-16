import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { formatMoney, invoiceTotals } from './util.js';

const W = 595.28;
const H = 841.89;
const M = 50;
const BLUE = rgb(0.11, 0.11, 0.12);
const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.28, 0.33, 0.41);
const RULE = rgb(0.89, 0.91, 0.94);
const HEAD_BG = rgb(0.95, 0.96, 0.98);

// Standard PDF fonts only cover Latin-1 (WinAnsi); swap or drop anything else.
function clean(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
    .replace(/[^\n\x20-\x7E\xA0-\xFF€]/g, '?');
}

function wrap(text, font, size, maxW) {
  const lines = [];
  for (const para of clean(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxW) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > maxW) {
        let i = rest.length;
        while (i > 1 && font.widthOfTextAtSize(rest.slice(0, i), size) > maxW) i--;
        lines.push(rest.slice(0, i));
        rest = rest.slice(i);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

export async function buildInvoicePdf(inv, client, settings) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle('Invoice ' + clean(inv.number));
  doc.setAuthor(clean(settings.agencyName));

  let page = doc.addPage([W, H]);
  let y = H - M;

  const text = (s, x, yy, size, f, color) => {
    page.drawText(clean(s), { x, y: yy, size, font: f || font, color: color || INK });
  };
  const right = (s, xr, yy, size, f, color) => {
    const c = clean(s);
    const ff = f || font;
    page.drawText(c, { x: xr - ff.widthOfTextAtSize(c, size), y: yy, size, font: ff, color: color || INK });
  };
  const newPage = () => {
    page = doc.addPage([W, H]);
    y = H - M;
  };

  const cur = inv.currency;
  const t = invoiceTotals(inv);

  // Header: agency on the left, invoice number on the right
  let ly = y - 20;
  for (const l of wrap(settings.agencyName || '', bold, 20, 300)) {
    text(l, M, ly, 20, bold, BLUE);
    ly -= 24;
  }
  if (settings.agencyEmail) {
    text(settings.agencyEmail, M, ly + 6, 10, font, MUTED);
    ly -= 12;
  }
  right('INVOICE ' + inv.number, W - M, y - 18, 16, bold);
  right('Status: ' + inv.status, W - M, y - 36, 10, font, MUTED);
  y = Math.min(ly, y - 46);
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 2.5, color: BLUE });
  y -= 28;

  // Bill to + dates
  text('Bill To:', M, y, 10, bold);
  right('Issue Date: ' + inv.issue_date, W - M, y, 10);
  y -= 16;
  text(wrap(client ? client.name : 'Client', font, 13, 300)[0], M, y, 13);
  right('Due Date: ' + inv.due_date, W - M, y, 10);
  y -= 15;
  if (client && client.notify_email) text(client.notify_email, M, y, 10, font, MUTED);
  right('Currency: ' + cur, W - M, y, 10);
  y -= 34;

  // Line items
  const QTY_R = 370;
  const RATE_R = 465;
  const AMT_R = W - M - 8;
  const tableHeader = () => {
    page.drawRectangle({ x: M, y: y - 7, width: W - 2 * M, height: 22, color: HEAD_BG });
    text('Description', M + 8, y, 10, bold);
    right('Qty', QTY_R, y, 10, bold);
    right('Rate', RATE_R, y, 10, bold);
    right('Amount', AMT_R, y, 10, bold);
    y -= 26;
  };
  tableHeader();

  for (const it of t.items) {
    const qty = Number(it.qty || 0);
    const rate = Number(it.rate || 0);
    const lines = wrap(it.description || '', font, 10, 230);
    if (y - (lines.length * 13 + 22) < M) {
      newPage();
      tableHeader();
    }
    lines.forEach((l, i) => text(l, M + 8, y - i * 13, 10));
    right(String(qty), QTY_R, y, 10);
    right(formatMoney(rate, cur), RATE_R, y, 10);
    right(formatMoney(qty * rate, cur), AMT_R, y, 10, bold);
    const bottom = y - (lines.length - 1) * 13 - 8;
    page.drawLine({ start: { x: M, y: bottom }, end: { x: W - M, y: bottom }, thickness: 0.75, color: RULE });
    y = bottom - 16;
  }

  // Totals
  if (y - 110 < M) newPage();
  y -= 8;
  const TL = 330;
  const totalRow = (label, value, strong, size) => {
    text(label, TL, y, size, strong ? bold : font, strong ? INK : MUTED);
    right(value, AMT_R, y, size, strong ? bold : font);
    y -= size + 9;
  };
  totalRow('Subtotal', formatMoney(t.subtotal, cur), false, 10);
  if (t.discount > 0) totalRow('Discount', '- ' + formatMoney(t.discount, cur), false, 10);
  if (t.taxPct > 0) totalRow('Tax (' + t.taxPct + '%)', formatMoney(t.tax, cur), false, 10);
  page.drawLine({ start: { x: TL, y: y + 8 }, end: { x: W - M, y: y + 8 }, thickness: 1.5, color: INK });
  y -= 10;
  totalRow('Total Due', formatMoney(t.total, cur), true, 13);

  // Notes
  if (inv.notes) {
    y -= 18;
    if (y - 40 < M) newPage();
    text('Notes:', M, y, 10, bold);
    y -= 15;
    for (const l of wrap(inv.notes, font, 10, W - 2 * M)) {
      if (y < M) newPage();
      text(l, M, y, 10, font, MUTED);
      y -= 13;
    }
  }

  return doc.save();
}
