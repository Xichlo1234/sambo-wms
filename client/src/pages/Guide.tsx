import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Search } from 'lucide-react';
import { normalize } from '@/lib/text';
import { PageHeader } from '@/components/ui';

interface Sop { id: string; title: string; roles: string; link?: string; steps: string[]; rules?: string[] }

/** Quy trình vận hành chuẩn (SOP) – dùng để đào tạo & tra cứu nhanh */
const SOPS: Sop[] = [
  { id: 'login', title: 'Đăng nhập, đổi mật khẩu, tìm kiếm nhanh', roles: 'Tất cả', steps: [
    'Đăng nhập bằng tài khoản do Quản trị cấp. Lần đầu bắt buộc đổi mật khẩu (≥ 8 ký tự, có chữ và số).',
    'Sai mật khẩu 5 lần – tài khoản tạm khóa 15 phút. Quên mật khẩu: liên hệ Quản trị để đặt lại.',
    'Ô tìm kiếm trên cùng (Ctrl+K) tìm toàn hệ thống: mã/tên vật tư (gõ không dấu được), mã vạch, số phiếu, số PO, nhà cung cấp, bộ phận.',
    'Chuông thông báo hiển thị việc cần xử lý: phiếu chờ duyệt, phiếu chờ xuất, chờ xác nhận...',
  ] },
  { id: 'item', title: 'Tạo và quản lý danh mục vật tư / thiết bị', roles: 'Warehouse Officer, Warehouse Manager', link: '/items', steps: [
    'Vào Kho mỏ → Danh mục vật tư (hoặc Danh mục thiết bị) → Thêm mới.',
    'Nhập Mã (duy nhất), Tên, Nhóm, ĐVT (bắt buộc); quy cách, model, hãng, xuất xứ, vị trí mặc định; mức tồn tối thiểu/an toàn/tối đa; định mức xuất mỗi phiếu.',
    'Nếu hệ thống cảnh báo "mặt hàng tương tự", kiểm tra danh sách. Chỉ bấm "vẫn lưu" khi chắc chắn là mặt hàng khác.',
    'Mặt hàng ngừng dùng: bấm Khóa (không xóa để giữ lịch sử). Mã đã phát sinh giao dịch không được đổi mã.',
    'Đính kèm hình ảnh, tài liệu kỹ thuật tại màn hình chi tiết vật tư.',
  ], rules: ['Không tạo hai mã cho cùng một vật tư.', 'Danh mục nhiều dòng: dùng Import Excel.'] },
  { id: 'receipt', title: 'Nhập kho (5.1.2)', roles: 'Warehouse Officer lập – Warehouse Manager duyệt', link: '/receipts', steps: [
    'Nhận hàng & chứng từ (hóa đơn, phiếu giao hàng, PO) từ nhà cung cấp.',
    'Kiểm tra chứng từ → kiểm đếm số lượng thực tế → kiểm tra quy cách, tình trạng.',
    'Nhập kho → Lập phiếu nhập: chọn NCC, số PO, người giao; mỗi dòng nhập SL chứng từ, SL thực nhận, SL chờ kiểm tra, SL không đạt, vị trí lưu kho.',
    'Nhập thiếu/thừa (SL thực nhận ≠ SL chứng từ): bắt buộc ghi lý do. Hàng không đạt: bắt buộc ghi tình trạng.',
    'Lưu nháp → đính kèm hóa đơn/phiếu giao hàng/hình ảnh → đánh dấu 3 bước kiểm tra → Gửi duyệt.',
    'Quản lý kho kiểm tra và Phê duyệt & ghi sổ (hoặc Từ chối kèm lý do để sửa).',
    'Hàng chờ kiểm tra nằm ở tồn cách ly; khi có kết quả QC bấm "Kiểm tra" trên dòng để chuyển SL đạt sang khả dụng, SL không đạt sang tồn hư hỏng.',
  ], rules: ['Tồn kho CHỈ tăng khi phiếu được duyệt.', 'Người lập không được tự duyệt.', 'Phiếu đã ghi sổ không được hủy/xóa – sai sót xử lý bằng phiếu điều chỉnh.'] },
  { id: 'issue', title: 'Yêu cầu cấp vật tư & xuất kho (5.1.3)', roles: 'Department User yêu cầu – Manager duyệt – Thủ kho xuất – Người nhận xác nhận', link: '/issues', steps: [
    'Bộ phận: Xuất kho → Lập yêu cầu cấp vật tư; ghi rõ mục đích sử dụng, khu vực/công trình, danh sách vật tư & SL. Vượt định mức phải ghi lý do.',
    'Gửi duyệt → Quản lý có thẩm quyền phê duyệt (có thể giảm SL duyệt). Khi duyệt, hệ thống GIỮ CHỖ số lượng, không cho phiếu khác dùng.',
    'Thủ kho: mở phiếu "Đã duyệt – chờ xuất" → Xuất kho → chọn vị trí lấy hàng (hệ thống gợi ý), nhập SL thực xuất, chọn người nhận.',
    'Người nhận đăng nhập → mở phiếu → "Xác nhận đã nhận" → gõ lại đúng họ tên (xác nhận điện tử).',
    'In phiếu xuất (PDF) để ký tay nếu cần lưu hồ sơ giấy.',
  ], rules: ['Không xuất vượt tồn khả dụng – hệ thống chặn.', 'Không xuất phiếu chưa duyệt.', 'Người xuất kho không được xác nhận thay người nhận.', 'Hủy phiếu đã duyệt sẽ giải phóng giữ chỗ.'] },
  { id: 'stock', title: 'Xem tồn kho, tồn tại thời điểm quá khứ, thẻ kho', roles: 'Kho, Kế toán, Ban giám đốc', link: '/stock', steps: [
    'Tồn kho → "Tồn hiện tại": khả dụng, giữ chỗ, có thể xuất, chờ kiểm tra, hư hỏng, trạng thái (còn hàng / sắp hết / dưới tối thiểu / hết / vượt tối đa).',
    '"Nhập – xuất – tồn theo kỳ": tồn đầu kỳ, tổng nhập, tổng xuất, tồn cuối kỳ (theo ngày ghi sổ).',
    '"Tồn tại thời điểm quá khứ": chọn ngày để xem tồn cuối ngày đó.',
    'Bấm mã vật tư để mở Thẻ kho: từng giao dịch, tồn sau giao dịch, người thực hiện; xuất Excel / PDF / In.',
  ] },
  { id: 'stocktake', title: 'Kiểm kê (5.1.5)', roles: 'Officer tạo & đếm – Manager duyệt', link: '/stocktakes', steps: [
    'Kiểm kê → Tạo đợt kiểm kê: phạm vi toàn kho / theo nhóm / theo vị trí / danh sách mặt hàng.',
    'Bấm "Chốt tồn sổ" tại thời điểm bắt đầu đếm (nên tạm dừng nhập xuất khu vực kiểm kê).',
    'In biên bản (PDF) để đếm; nhập số thực tế vào bảng, lưu nhiều lần được. Mặt hàng có thực tế nhưng sổ không có: dùng "Thêm mặt hàng".',
    'Dòng có chênh lệch (Thực tế – Sổ sách) bắt buộc giải trình nguyên nhân.',
    'Gửi duyệt → hệ thống lập phiếu điều chỉnh (chưa ghi sổ). Quản lý phê duyệt → ghi sổ điều chỉnh; hoặc Trả về để đếm lại.',
  ], rules: ['Nhập số kiểm kê KHÔNG tự thay đổi tồn kho.', 'Chỉ ghi sổ khi được phê duyệt.'] },
  { id: 'transfer', title: 'Điều chuyển vị trí / kho', roles: 'Officer lập – Manager duyệt', link: '/transfers', steps: [
    'Điều chuyển → Lập phiếu: kho đi, kho đến, người giao, người nhận, lý do; từng dòng vị trí đi → vị trí đến, SL.',
    'Gửi duyệt → Manager phê duyệt xác nhận bàn giao, hệ thống ghi sổ đồng thời xuất vị trí đi và nhập vị trí đến.',
  ] },
  { id: 'return', title: 'Hàng trả lại', roles: 'Bộ phận lập – Kho kiểm tra – Manager duyệt', link: '/returns', steps: [
    'Bộ phận: Hàng trả lại → Lập phiếu trả, ghi lý do và SL từng vật tư.',
    'Kho kiểm tra chất lượng, phân loại: dùng được / hư hỏng / chờ xử lý (bắt buộc nhận xét khi có hàng hỏng).',
    'Manager phê duyệt → chỉ SL dùng được tăng tồn khả dụng; hư hỏng vào tồn hư hỏng; chờ xử lý vào tồn chờ kiểm tra.',
  ] },
  { id: 'adjust', title: 'Điều chỉnh tồn kho & khóa kỳ', roles: 'Officer lập – Manager duyệt – Người có quyền khóa kỳ', link: '/adjustments', steps: [
    'Điều chỉnh tồn kho → Lập phiếu: lý do bắt buộc, từng dòng SL +/− theo loại tồn (khả dụng / chờ kiểm tra / hư hỏng). Ví dụ: tiêu hủy hàng hư hỏng = −SL ở loại "Hư hỏng".',
    'Người khác phê duyệt mới ghi sổ. Hệ thống chặn điều chỉnh làm âm kho hoặc lấn vào SL đã giữ chỗ.',
    'Cuối kỳ: Cấu hình hệ thống → Khóa kỳ kho đến ngày chốt. Chứng từ có ngày ≤ ngày khóa không được ghi sổ.',
  ] },
  { id: 'import', title: 'Nhập dữ liệu ban đầu từ Excel', roles: 'Officer / Manager / Procurement', link: '/import', steps: [
    'Thứ tự khuyến nghị: Bộ phận → Nhà cung cấp → Nhóm vật tư, ĐVT, vị trí (Cấu hình) → Danh mục vật tư → Tồn kho ban đầu.',
    'Nhập dữ liệu từ Excel → chọn loại → Tải file mẫu (có sheet hướng dẫn và danh mục tham chiếu).',
    'Điền dữ liệu → chọn file → "Kiểm tra & xem trước": xem dòng Mới / Trùng / Lỗi; tải báo cáo dòng lỗi để sửa.',
    'Xác nhận nhập. Dòng trùng mã luôn bị bỏ qua (không ghi đè). Tồn đầu kỳ tạo phiếu điều chỉnh chờ Manager duyệt.',
  ] },
  { id: 'report', title: 'Báo cáo, xuất Excel/PDF, in', roles: 'Theo phân quyền', link: '/reports', steps: [
    'Báo cáo và thống kê → chọn báo cáo → đặt bộ lọc → Xem báo cáo.',
    'Excel: tải file có định dạng, tổng cộng, lọc sẵn. PDF: bản in tiếng Việt có tiêu đề công ty. In: mở PDF trong tab mới để in.',
    'Mẫu biểu phiếu nhập, phiếu xuất, biên bản kiểm kê, điều chuyển, trả lại, điều chỉnh: nút "In phiếu (PDF)" tại từng chứng từ.',
  ] },
  { id: 'admin', title: 'Quản trị: người dùng, phân quyền, nhật ký, sao lưu', roles: 'Super Admin', steps: [
    'Người dùng: tạo tài khoản, gán bộ phận và vai trò; khóa tài khoản khi nghỉ việc (không xóa).',
    'Phân quyền: chỉnh quyền từng vai trò theo nhóm chức năng; thay đổi áp dụng ngay.',
    'Nhật ký hoạt động: tra cứu ai làm gì, lúc nào, từ IP nào, dữ liệu trước/sau.',
    'Sao lưu: kiểm tra bản sao lưu tự động hằng ngày; định kỳ "Kiểm tra toàn vẹn" và sao chép bản sao lưu ra nơi lưu trữ khác.',
    'Cấu hình → "Chạy đối chiếu" để xác nhận số dư tồn kho khớp sổ cái.',
  ] },
];

export default function Guide() {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const n = normalize(q);
    return n ? SOPS.filter((s) => normalize([s.title, s.roles, ...s.steps, ...(s.rules ?? [])].join(' ')).includes(n)) : SOPS;
  }, [q]);
  return (
    <div className="max-w-5xl">
      <PageHeader title="Hướng dẫn vận hành & đào tạo" subtitle="Quy trình chuẩn cho từng nghiệp vụ – dùng để đào tạo người dùng mới và tra cứu khi vận hành" />
      <div className="relative mb-4 max-w-md"><Search className="absolute left-2.5 top-2 text-slate-400" size={16} /><input className="input pl-8" placeholder="Tìm trong hướng dẫn (vd: xuất kho, kiểm kê, import)..." value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="mb-4 flex flex-wrap gap-2">{list.map((s) => <a key={s.id} href={`#${s.id}`} className="rounded-full bg-navy-50 px-3 py-1 text-xs text-navy-700 hover:bg-navy-100">{s.title}</a>)}</div>
      <div className="space-y-4">
        {list.map((s) => (
          <div key={s.id} id={s.id} className="card p-5">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-base font-semibold text-navy-900"><BookOpen size={17} className="text-gold-600" />{s.title}</h2>
              {s.link && <Link to={s.link} className="btn-outline btn-sm">Mở chức năng</Link>}
            </div>
            <div className="mb-3 text-xs text-slate-500">Vai trò: {s.roles}</div>
            <ol className="ml-5 list-decimal space-y-1 text-sm">{s.steps.map((x, i) => <li key={i}>{x}</li>)}</ol>
            {s.rules && <div className="mt-3 rounded-md bg-gold-50 p-3 text-sm"><b>Nguyên tắc kiểm soát:</b><ul className="ml-5 list-disc">{s.rules.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
          </div>
        ))}
      </div>
    </div>
  );
}
