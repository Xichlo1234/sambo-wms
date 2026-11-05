import type { Tx } from '../db';

export const DOC_PREFIX = {
  RECEIPT: 'PN',
  ISSUE: 'PX',
  TRANSFER: 'DC',
  RETURN: 'TL',
  ADJUSTMENT: 'DCT',
  STOCKTAKE: 'KK',
  CHEM_RECEIPT: 'NHC',
  CHEM_ISSUE: 'XHC',
  CHEM_STOCKTAKE: 'KKHC',
  CHEM_ADJUST: 'DCHC',
  CHEM_INSPECTION: 'KTHC',
  CHEM_INCIDENT: 'SCHC',
  PURCHASE_REQUEST: 'DNM',
  QUOTE: 'BG',
  PURCHASE_ORDER: 'PO',
  COMPLAINT: 'KN',
} as const;

/** Sinh số chứng từ tuần tự theo năm, an toàn đồng thời (UPSERT ... RETURNING trong transaction). */
export async function nextDocNo(tx: Tx, prefix: string, date = new Date()): Promise<string> {
  const period = String(date.getFullYear());
  const rows = await tx.$queryRaw<{ last_no: number }[]>`
    INSERT INTO doc_sequences (doc_type, period, last_no, created_at, updated_at)
    VALUES (${prefix}, ${period}, 1, now(), now())
    ON CONFLICT (doc_type, period) DO UPDATE SET last_no = doc_sequences.last_no + 1, updated_at = now()
    RETURNING last_no`;
  return `${prefix}${period}-${String(rows[0].last_no).padStart(5, '0')}`;
}
