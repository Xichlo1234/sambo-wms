export const fmtNum = (v: unknown, dec = 4) => {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return isNaN(n) ? String(v) : n.toLocaleString('vi-VN', { maximumFractionDigits: dec });
};
export const fmtMoney = (v: unknown) => fmtNum(v, 2);
export const fmtDate = (v: unknown) => {
  if (!v) return '';
  const s = String(v);
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  if (/^\d{4}-\d{2}-\d{2}(T00:00:00(\.000)?Z)?$/.test(s)) return s.slice(0, 10).split('-').reverse().join('/');
  return d.toLocaleDateString('vi-VN');
};
export const fmtDateTime = (v: unknown) => {
  if (!v) return '';
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? String(v) : d.toLocaleString('vi-VN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const firstOfMonthISO = () => todayISO().slice(0, 8) + '01';
export const toISODate = (v: unknown) => (v ? String(v).slice(0, 10) : '');
