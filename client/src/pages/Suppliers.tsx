/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Star, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtDateTime, fmtMoney, todayISO } from '@/lib/format';
import { PURCHASE_STATUS, COOP_STATUS } from '@/lib/constants';
import { Badge, Card, DataTable, Field, Loading, Modal, PageHeader, Tabs, useToast, ReasonDialog, Empty } from '@/components/ui';
import { AttachmentsPanel, TargetPicker, ExportButtons, type PickedItem, type PickedChemical } from '@/components/shared';

const CLS: Record<string, { label: string; cls: string }> = { A: { label: 'A – Tốt', cls: 'bg-emerald-100 text-emerald-800' }, B: { label: 'B – Khá', cls: 'bg-sky-100 text-sky-800' }, C: { label: 'C – Trung bình', cls: 'bg-amber-100 text-amber-800' }, D: { label: 'D – Kém', cls: 'bg-red-100 text-red-700' } };
const pct = (v: number | null) => (v == null ? '–' : `${v}%`);

function EvalModal({ supplierId, onClose }: { supplierId: number; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const from = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
  const [f, setF] = useState({ period_from: from, period_to: todayISO(), quality_score: 4, delivery_score: 4, price_score: 4, service_score: 4, comment: '' });
  const total = ((f.quality_score * 0.35 + f.delivery_score * 0.3 + f.price_score * 0.2 + f.service_score * 0.15) / 5) * 100;
  const m = useMutation({ mutationFn: () => api.post(`/suppliers/${supplierId}/evaluations`, f), onSuccess: () => { toast.success('Đã lưu đánh giá'); qc.invalidateQueries({ queryKey: ['supplier-profile'] }); qc.invalidateQueries({ queryKey: ['need-eval'] }); onClose(); }, onError: toast.error });
  const S = (k: 'quality_score' | 'delivery_score' | 'price_score' | 'service_score', l: string, w: string) => (
    <Field label={`${l} (trọng số ${w})`}><div className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" onClick={() => setF({ ...f, [k]: n })} className={n <= f[k] ? 'text-gold-500' : 'text-slate-300'}><Star size={22} fill="currentColor" /></button>)}</div></Field>
  );
  return (
    <Modal open onClose={onClose} title="Đánh giá nhà cung cấp" size="md" footer={<><button className="btn-outline" onClick={onClose}>Hủy</button><button className="btn-primary" disabled={m.isPending} onClick={() => m.mutate()}>Lưu đánh giá</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kỳ đánh giá từ"><input type="date" className="input" value={f.period_from} onChange={(e) => setF({ ...f, period_from: e.target.value })} /></Field>
        <Field label="đến"><input type="date" className="input" value={f.period_to} onChange={(e) => setF({ ...f, period_to: e.target.value })} /></Field>
        {S('quality_score', 'Chất lượng', '35%')}{S('delivery_score', 'Giao hàng', '30%')}{S('price_score', 'Giá cả', '20%')}{S('service_score', 'Dịch vụ', '15%')}
        <Field label="Nhận xét" className="col-span-2"><textarea className="input" rows={2} value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} /></Field>
      </div>
      <p className="mt-2 text-sm">Tổng điểm dự kiến: <b>{total.toFixed(1)}/100</b> – xếp loại {total >= 85 ? 'A' : total >= 70 ? 'B' : total >= 50 ? 'C' : 'D'}. Số liệu thống kê (đúng hạn, giao thiếu, hàng lỗi) của kỳ được lưu kèm đánh giá. Trọng số mặc định – điều chỉnh khi công ty ban hành tiêu chí chính thức.</p>
    </Modal>
  );
}

export function SupplierProfile() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState('overview');
  const [ev, setEv] = useState(false);
  const [cp, setCp] = useState(false);
  const [resolve, setResolve] = useState<any>(null);
  const [cf, setCf] = useState({ complaint_date: todayISO(), subject: '', description: '', related_doc: '' });
  const { data: s } = useQuery({ queryKey: ['supplier', id], queryFn: () => api.get<any>(`/suppliers/${id}`) });
  const { data: p } = useQuery({ queryKey: ['supplier-profile', id], queryFn: () => api.get<any>(`/suppliers/${id}/profile`) });
  const addCp = useMutation({ mutationFn: () => api.post(`/suppliers/${id}/complaints`, cf), onSuccess: () => { toast.success('Đã ghi nhận khiếu nại'); setCp(false); qc.invalidateQueries({ queryKey: ['supplier-profile'] }); }, onError: toast.error });
  const resCp = useMutation({ mutationFn: (r: string) => api.post(`/suppliers/complaints/${resolve.id}/resolve`, { resolution: r }), onSuccess: () => { setResolve(null); qc.invalidateQueries({ queryKey: ['supplier-profile'] }); }, onError: toast.error });
  if (!s || !p) return <Loading />;
  const st = p.stats;
  return (
    <div>
      <PageHeader back={<Link to="/suppliers" className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500"><ArrowLeft size={12} />Nhà cung cấp</Link>}
        title={<span className="flex items-center gap-2">{s.code} – {s.name} <Badge status={s.status} /><span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{COOP_STATUS[s.cooperation_status]}</span>{p.evaluations[0] && <Badge status={p.evaluations[0].classification} map={CLS} />}</span>}
        subtitle={[s.country, s.tax_code && `MST ${s.tax_code}`, s.contact_person, s.phone, s.email].filter(Boolean).join(' · ')}
        actions={<>{can('suppliers.evaluate') && <button className="btn-gold" onClick={() => setEv(true)}><Star size={15} />Đánh giá</button>}{can('suppliers.evaluate', 'suppliers.manage') && <button className="btn-outline" onClick={() => setCp(true)}><Plus size={15} />Ghi khiếu nại</button>}<Link className="btn-outline" to={`/suppliers?id=${s.id}`}>Sửa hồ sơ</Link></>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-7">
        {[['Số lần mua (PO)', st.po_count], ['Tổng giá trị mua', st.po_value != null ? fmtMoney(st.po_value) : '—'], ['PO đã giao đủ', st.po_completed], ['Giao đúng hạn', pct(st.on_time_rate)], ['Tỷ lệ giao thiếu', pct(st.shortage_rate)], ['Tỷ lệ hàng lỗi', pct(st.defect_rate)], ['Khiếu nại', st.complaints]].map(([k, v]) => <div key={k as string} className="card p-3"><div className="text-xs text-slate-500">{k}</div><div className="text-lg font-semibold">{v}</div></div>)}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'overview', label: 'Hồ sơ' }, { key: 'history', label: 'Lịch sử giao dịch' }, { key: 'eval', label: `Đánh giá (${p.evaluations.length})` }, { key: 'complaints', label: `Khiếu nại (${p.complaints.length})` }, { key: 'docs', label: 'Hợp đồng & chứng nhận' }]} />
      {tab === 'overview' && <Card><dl className="grid grid-cols-1 gap-2 text-sm md:grid-cols-3">{[['Địa chỉ', s.address], ['Quốc gia', s.country], ['Người liên hệ', s.contact_person], ['Điện thoại', s.phone], ['Email', s.email], ['Mã số thuế', s.tax_code], ['Nhóm hàng cung cấp', s.supply_groups], ['Điều khoản thanh toán', s.payment_terms], ['Tài khoản ngân hàng', s.bank_account ? `${s.bank_account} – ${s.bank_name ?? ''}` : ''], ['Ghi chú', s.note]].map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium">{v || '–'}</dd></div>)}</dl></Card>}
      {tab === 'history' && <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Đơn đặt hàng"><DataTable rows={p.orders} empty="Chưa có đơn hàng" columns={[{ key: 'c', header: 'PO', render: (r: any) => <Link className="text-navy-700 underline" to={`/purchase-orders/${r.id}`}>{r.code}</Link> }, { key: 'd', header: 'Ngày', render: (r: any) => fmtDate(r.order_date) }, { key: 'e', header: 'Giao dự kiến / hoàn tất', render: (r: any) => <span className="text-xs">{fmtDate(r.expected_date)} / {fmtDate(r.completed_at)}</span> }, { key: 't', header: 'Giá trị', align: 'right', render: (r: any) => r.total_amount != null ? `${fmtMoney(r.total_amount)} ${r.currency ?? ''}` : '' }, { key: 's', header: 'TT', render: (r: any) => <Badge status={r.status} map={PURCHASE_STATUS} /> }]} /></Card>
        <Card title="Phiếu nhập kho"><DataTable rows={[...p.receipts.map((r: any) => ({ ...r, link: `/receipts/${r.id}`, k: 'Kho mỏ' })), ...p.chem_receipts.map((r: any) => ({ ...r, link: `/chem-receipts/${r.id}`, k: 'Hóa chất' }))]} rowKey={(r: any) => r.link} empty="Chưa có" columns={[{ key: 'c', header: 'Phiếu', render: (r: any) => <Link className="text-navy-700 underline" to={r.link}>{r.code}</Link> }, { key: 'k', header: 'Kho', render: (r: any) => r.k }, { key: 'd', header: 'Ghi sổ', render: (r: any) => fmtDateTime(r.posted_at) }]} /></Card>
      </div>}
      {tab === 'eval' && <Card>{p.evaluations.length === 0 ? <Empty text="Chưa có đánh giá" /> : <DataTable rows={p.evaluations} columns={[{ key: 'p', header: 'Kỳ', render: (r: any) => `${fmtDate(r.period_from)} – ${fmtDate(r.period_to)}` }, { key: 'q', header: 'CL / GH / Giá / DV', render: (r: any) => `${r.quality_score} / ${r.delivery_score} / ${r.price_score} / ${r.service_score}` }, { key: 't', header: 'Tổng điểm', render: (r: any) => <b>{Number(r.total_score).toFixed(1)}</b> }, { key: 'c', header: 'Xếp loại', render: (r: any) => <Badge status={r.classification} map={CLS} /> }, { key: 'm', header: 'Số liệu kỳ', render: (r: any) => <span className="text-xs">Đúng hạn {pct(r.metrics?.on_time_rate)} · Thiếu {pct(r.metrics?.shortage_rate)} · Lỗi {pct(r.metrics?.defect_rate)}</span> }, { key: 'e', header: 'Người đánh giá', render: (r: any) => `${r.evaluator} (${fmtDate(r.created_at)})` }, { key: 'cm', header: 'Nhận xét', render: (r: any) => <span className="text-xs">{r.comment}</span> }]} />}</Card>}
      {tab === 'complaints' && <Card>{p.complaints.length === 0 ? <Empty text="Không có khiếu nại" /> : <DataTable rows={p.complaints} columns={[{ key: 'c', header: 'Số', render: (r: any) => r.code }, { key: 'd', header: 'Ngày', render: (r: any) => fmtDate(r.complaint_date) }, { key: 's', header: 'Nội dung', render: (r: any) => <div><b>{r.subject}</b><div className="text-xs">{r.description}</div>{r.related_doc && <div className="text-xs text-slate-500">CT liên quan: {r.related_doc}</div>}</div> }, { key: 'st', header: 'Xử lý', render: (r: any) => r.status === 'CLOSED' ? <div className="text-xs text-emerald-700">✔ {r.resolution} ({fmtDate(r.resolved_at)})</div> : can('suppliers.evaluate', 'suppliers.manage') ? <button className="btn-outline btn-sm" onClick={() => setResolve(r)}>Ghi kết quả</button> : 'Đang xử lý' }]} />}</Card>}
      {tab === 'docs' && <AttachmentsPanel entityType="supplier" entityId={s.id} />}
      {ev && <EvalModal supplierId={s.id} onClose={() => setEv(false)} />}
      <Modal open={cp} onClose={() => setCp(false)} title="Ghi nhận khiếu nại nhà cung cấp" size="md" footer={<><button className="btn-outline" onClick={() => setCp(false)}>Hủy</button><button className="btn-primary" disabled={cf.subject.length < 3 || cf.description.length < 5} onClick={() => addCp.mutate()}>Lưu</button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ngày"><input type="date" className="input" value={cf.complaint_date} onChange={(e) => setCf({ ...cf, complaint_date: e.target.value })} /></Field>
          <Field label="Chứng từ liên quan"><input className="input" value={cf.related_doc} onChange={(e) => setCf({ ...cf, related_doc: e.target.value })} placeholder="Số PO / phiếu nhập" /></Field>
          <Field label="Tiêu đề" required className="col-span-2"><input className="input" value={cf.subject} onChange={(e) => setCf({ ...cf, subject: e.target.value })} /></Field>
          <Field label="Nội dung" required className="col-span-2"><textarea className="input" rows={3} value={cf.description} onChange={(e) => setCf({ ...cf, description: e.target.value })} /></Field>
        </div>
      </Modal>
      <ReasonDialog open={!!resolve} title="Kết quả xử lý khiếu nại" label="Kết quả" confirmText="Lưu" onClose={() => setResolve(null)} onConfirm={(r) => resCp.mutate(r)} />
    </div>
  );
}

export function SupplierEvaluations() {
  const [kind, setKind] = useState<'item' | 'chemical'>('item');
  const [item, setItem] = useState<PickedItem | null>(null);
  const [chem, setChem] = useState<PickedChemical | null>(null);
  const { data: need } = useQuery({ queryKey: ['need-eval'], queryFn: () => api.get<any[]>('/suppliers/need-evaluation') });
  const target = kind === 'item' ? item : chem;
  const { data: cmp, isFetching } = useQuery({ queryKey: ['supplier-compare', kind, target?.id], enabled: !!target, queryFn: () => api.get<any[]>('/suppliers/compare', kind === 'item' ? { item_id: item!.id } : { chemical_id: chem!.id }) });
  return (
    <div>
      <PageHeader title="Đánh giá & so sánh nhà cung cấp" subtitle="So sánh theo mặt hàng: giá, chất lượng (tỷ lệ lỗi), thời gian giao hàng, tỷ lệ đúng hạn, điểm đánh giá" actions={<ExportButtons reportKey="purchase-by-supplier" params={{ from: '2020-01-01' }} />} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Nhà cung cấp cần đánh giá" className="lg:col-span-1">
          <p className="mb-2 text-xs text-slate-500">Có đơn hàng trong 180 ngày nhưng chưa được đánh giá trong 180 ngày.</p>
          {!need?.length ? <div className="text-sm text-slate-400">Không có</div> : <ul className="space-y-1 text-sm">{need.map((s) => <li key={s.id}><Link className="text-navy-700 hover:underline" to={`/suppliers/${s.id}`}>{s.code} – {s.name}</Link></li>)}</ul>}
        </Card>
        <Card title="So sánh nhà cung cấp theo mặt hàng" className="lg:col-span-2">
          <div className="mb-3 w-full max-w-xl"><TargetPicker kind={kind} onKind={setKind} item={item} chemical={chem} onItem={setItem} onChemical={setChem} /></div>
          {!target ? <Empty text="Chọn vật tư hoặc hóa chất để so sánh" /> : isFetching ? <Loading /> : (
            <DataTable rows={cmp} empty="Chưa có lịch sử đặt hàng / báo giá cho mặt hàng này" rowKey={(r: any) => r.supplier_id} columns={[
              { key: 's', header: 'Nhà cung cấp', render: (r: any) => <Link className="text-navy-700 hover:underline" to={`/suppliers/${r.supplier_id}`}>{r.code} – {r.name}</Link> },
              { key: 'o', header: 'Số PO / BG', align: 'right', render: (r: any) => `${r.orders} / ${r.quotes}` },
              { key: 'lp', header: 'Giá gần nhất', align: 'right', render: (r: any) => r.last_price != null ? `${fmtMoney(r.last_price)} ${r.currency ?? ''}` : '–' },
              { key: 'ap', header: 'Giá TB / thấp nhất', align: 'right', render: (r: any) => r.avg_price != null ? `${fmtMoney(r.avg_price)} / ${fmtMoney(r.min_price)}` : '–' },
              { key: 'qp', header: 'Báo giá gần nhất', align: 'right', render: (r: any) => r.last_quote_price != null ? fmtMoney(r.last_quote_price) : '–' },
              { key: 'lt', header: 'TG giao TB (ngày)', align: 'right', render: (r: any) => r.avg_lead_days ?? '–' },
              { key: 'ot', header: 'Đúng hạn', align: 'right', render: (r: any) => pct(r.on_time_rate) },
              { key: 'df', header: 'Hàng lỗi', align: 'right', render: (r: any) => pct(r.defect_rate) },
              { key: 'sc', header: 'Điểm / xếp loại', render: (r: any) => r.last_score != null ? <span>{r.last_score.toFixed(1)} <Badge status={r.classification} map={CLS} /></span> : '–' },
            ]} />
          )}
        </Card>
      </div>
    </div>
  );
}
