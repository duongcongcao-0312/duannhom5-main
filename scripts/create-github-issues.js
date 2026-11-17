/**
 * Tự động tạo GitHub Issues cho dự án BookNest dựa trên Báo cáo Kiểm định chất lượng.
 *
 * Cách sử dụng:
 *   node scripts/create-github-issues.js <GITHUB_TOKEN>
 * Hoặc:
 *   $env:GITHUB_TOKEN="ghp_xxx"
 *   node scripts/create-github-issues.js
 */

const REPO = process.env.REPO || 'duongcongcao-0312/duannhom5-main';
const TOKEN = process.argv[2] || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

const issues = [
  {
    title: '[P0 - Blocker] Khôi phục mã nguồn server.js và xuất hàm createServer',
    labels: ['bug', 'P0', 'backend', 'blocker'],
    body: `## Mô tả vấn đề
File \`server.js\` trên nhánh \`main\` hiện đang bị rỗng (0 bytes, SHA: \`e69de29bb2d1d6434b8b29ae775ad8c2e48c5391\`) sau commit \`c877459\` (#97).

## Hậu quả nghiêm trọng
1. \`npm start\` chạy file rỗng, không tạo HTTP server, tê liệt toàn bộ API backend.
2. Các test unit/integration gọi \`const { createServer } = require("../server");\` bị lỗi do không tìm thấy hàm xuất.
3. Render không thể deploy do health check endpoint \`/ready\` không phản hồi.

## Nhiệm vụ cần làm
- [ ] Khôi phục nội dung \`server.js\` từ commit trước còn hoạt động (\`08b17d6b183320b2f4835c1ed6c639d55ec2add7\`).
- [ ] Đối chiếu các cập nhật bảo mật/middleware mới để không làm mất bản vá.
- [ ] Đảm bảo module xuất đầy đủ hàm \`createServer\` phục vụ cho test suite.
- [ ] Kiểm tra các endpoint \`/health\` và \`/ready\` hoạt động chính xác khi khởi chạy.`
  },
  {
    title: '[P0 - Blocker] Khắc phục lỗi bảo mật băm Session Token và Password Reset Token',
    labels: ['bug', 'P0', 'security', 'auth'],
    body: `## Mô tả vấn đề
Phát hiện lỗi logic và sai lệch hàm giữa \`backend/auth.js\` và \`backend/security.js\`:
1. \`backend/auth.js\` import và gọi hàm \`secureHashPasswordResetToken(token)\`, nhưng trong \`backend/security.js\` chỉ export \`hashPasswordResetToken\` -> Gây ra runtime error: \`TypeError: secureHashPasswordResetToken is not a function\`.
2. Hàm \`hashPasswordResetToken()\` trong \`security.js\` sinh salt ngẫu nhiên mỗi lần gọi.
3. \`SessionStore\` lại đang sử dụng hàm này để băm session token và tra cứu refresh token. Do salt ngẫu nhiên, cùng 1 token sẽ sinh 2 giá trị hash khác nhau -> Tra cứu session và refresh token luôn thất bại.

## Nhiệm vụ cần làm
- [ ] Tách riêng 2 cơ chế băm rõ rệt:
  - **Password reset token**: Sử dụng hash có salt ngẫu nhiên và kiểm tra bằng hàm verify tương ứng.
  - **Session token & Refresh token**: Sử dụng phép băm xác định có secret key (HMAC-SHA256) để tra cứu ổn định trong database/SessionStore mà không lưu token thô.
- [ ] Đồng bộ lại tên hàm export/import giữa \`backend/security.js\` và \`backend/auth.js\`.
- [ ] Viết test tự động kiểm tra luồng tạo session, tra cứu session bằng token và cấp mới token bằng refresh token.`
  },
  {
    title: '[P0 - Deploy] Cấu hình và đồng bộ môi trường triển khai Render',
    labels: ['bug', 'P0', 'devops', 'deployment'],
    body: `## Mô tả vấn đề
Cấu hình triển khai trên Render (\`render.yaml\`) và file mẫu môi trường (\`.env.example\`) chưa đồng bộ với mã nguồn và tài liệu README.

## Chi tiết thiếu sót
- README có đề cập biến bí mật \`PAYMENT_WEBHOOK_SECRET\` nhưng trong \`.env.example\` và \`render.yaml\` chưa khai báo.
- Kiểm tra tính ổn định của \`healthCheckPath: /ready\`.
- Đảm bảo lệnh khởi chạy \`npm run migrate && npm start\` chạy trơn tru trên môi trường production.

## Nhiệm vụ cần làm
- [ ] Bổ sung \`PAYMENT_WEBHOOK_SECRET\` và các biến môi trường cần thiết vào \`.env.example\` kèm hướng dẫn.
- [ ] Khai báo đầy đủ biến môi trường trong \`render.yaml\`.
- [ ] Kiểm tra kết nối database PostgreSQL trên Render khi khởi động.
- [ ] Xác minh cơ chế khôi phục backend tự động sau khi instance khởi động lại.`
  },
  {
    title: '[P1 - Payment] Hoàn thiện tích hợp cổng thanh toán thực tế và đối soát giao dịch',
    labels: ['enhancement', 'P1', 'payment'],
    body: `## Mô tả vấn đề
Hệ thống hiện tại mới dừng ở mức mô phỏng xử lý webhook sự kiện, chưa kết nối tới cổng thanh toán thực tế nào và chưa có xác minh độc lập từ nhà cung cấp dịch vụ thanh toán (PSP).

## Rủi ro thương mại
Hệ thống không thể tự động xác nhận đơn hàng đã thanh toán nếu chỉ dựa vào webhook mô phỏng mà không có xác minh độc lập từ nhà cung cấp thanh toán.

## Nhiệm vụ cần làm
- [ ] Lựa chọn và tích hợp ít nhất một cổng thanh toán thực tế (VNPAY, MoMo, ZaloPay, hoặc Stripe).
- [ ] Kiểm tra chữ ký số (signature/HMAC) của webhook thanh toán từ nhà cung cấp.
- [ ] Xây dựng API kiểm tra trạng thái giao dịch độc lập (QueryDR / payment verification API) với cổng thanh toán.
- [ ] Xây dựng quy trình xử lý hoàn tiền (Refunds) và đối soát giao dịch (Reconciliation).
- [ ] Kiểm thử các kịch bản ngoại lệ: thanh toán thất bại, thanh toán hủy, webhook gửi trễ hoặc gửi lặp lại (idempotency).`
  },
  {
    title: '[P1 - DevOps] Thiết lập lịch sao lưu tự động sang storage độc lập và diễn tập khôi phục',
    labels: ['enhancement', 'P1', 'database', 'devops'],
    body: `## Mô tả vấn đề
Dự án đã có mã nguồn sao lưu (\`scripts/backup.js\`, \`scripts/postgres-backup.js\`, \`scripts/backup-scheduler.js\`) và runbook, nhưng trên hạ tầng Render hiện chỉ có một web service duy nhất, chưa có background worker/scheduler chạy lịch thực tế.

## Yêu cầu vận hành
- [ ] Thiết lập worker hoặc Cron Job tự động chạy sao lưu database hàng ngày.
- [ ] Chuyển file sao lưu lên dịch vụ lưu trữ độc lập (như AWS S3, Cloudflare R2, GCP Bucket) thay vì lưu trên đĩa tạm của máy chủ web.
- [ ] Bổ sung cơ chế kiểm tra tính toàn vẹn của file backup (checksum SHA-256).
- [ ] Thiết lập thông báo / cảnh báo (Slack/Telegram/Email) khi tiến trình sao lưu thất bại.
- [ ] Thực hiện diễn tập khôi phục database (restore rehearsal) và lưu lại biên bản kết quả.`
  },
  {
    title: '[P1 - Testing] Bổ sung kiểm tra Server Startup trong CI và tăng độ phủ Test Coverage',
    labels: ['enhancement', 'P1', 'testing', 'ci-cd'],
    body: `## Mô tả vấn đề
1. Workflow CI hiện chỉ chạy \`node --check server.js\` để kiểm tra cú pháp. Nếu \`server.js\` rỗng, bước này vẫn trả về exit code 0 mà không phát hiện được lỗi crash.
2. Lệnh \`npm run test:coverage\` hiện bỏ sót nhiều file kiểm thử quan trọng mặc dù chúng có trong \`npm test\`.

## Danh sách test cần đưa vào coverage
- \`tests/api-pagination.test.js\`
- \`tests/predeploy-check.test.js\`
- \`tests/migrations.test.js\`
- \`tests/postgres-migrations.test.js\`

## Nhiệm vụ cần làm
- [ ] Thêm bước test khởi động thực tế server và kiểm tra phản hồi từ \`/health\` trong GitHub Actions CI (\`.github/workflows/ci.yml\`).
- [ ] Cập nhật cấu hình c8/coverage trong \`package.json\` để bao phủ toàn bộ các file test trên.
- [ ] Đảm bảo toàn bộ test pass và duy trì ngưỡng coverage: Lines >= 70%, Branches >= 65%, Functions >= 60%.`
  },
  {
    title: '[P2 - Privacy] Bảo vệ dữ liệu cá nhân khách hàng trên Frontend (localStorage)',
    labels: ['enhancement', 'P2', 'security', 'privacy'],
    body: `## Mô tả vấn đề
Frontend đang tự động lưu các thông tin nhạy cảm của người dùng (Họ và tên, số điện thoại, địa chỉ nhận hàng) vào \`localStorage\` của trình duyệt để hỗ trợ tự động điền form.

## Rủi ro bảo mật
Nếu ứng dụng xuất hiện lỗ hổng XSS hoặc người dùng truy cập từ thiết bị công cộng, thông tin cá nhân của khách hàng sẽ bị đánh cắp dễ dàng.

## Nhiệm vụ cần làm
- [ ] Rà soát toàn bộ các vị trí đọc/ghi dữ liệu cá nhân trong \`localStorage\`.
- [ ] Không lưu trữ mặc định thông tin nhạy cảm ở client; nếu lưu cần có sự đồng ý của người dùng (opt-in checkbox).
- [ ] Thêm nút/chức năng xóa dữ liệu đã lưu trên trình duyệt (Clear personal data).
- [ ] Xây dựng chính sách bảo mật thông tin và thời gian lưu giữ dữ liệu rõ ràng.`
  },
  {
    title: '[P2 - Security] Kiểm định bảo mật chuyên sâu (RBAC, IDOR, CSRF, XSS, Rate Limit & Secret Scanning)',
    labels: ['enhancement', 'P2', 'security'],
    body: `## Mục tiêu
Đảm bảo hệ thống đạt chuẩn an toàn trước khi mở public cho người dùng.

## Các hạng mục cần kiểm định
- [ ] **RBAC API**: Kiểm tra toàn bộ endpoint quản trị (\`/api/admin/*\`), đảm bảo phân quyền nghiêm ngặt giữa \`admin\`, \`sales\`, \`support\` và \`user\`.
- [ ] **Chống IDOR**: Người dùng không thể xem, sửa hoặc hủy đơn hàng của người khác thông qua thay đổi \`orderId\`.
- [ ] **Social Login**: Kiểm tra tính hợp lệ và thời hạn của Firebase ID Token phía server.
- [ ] **Rate Limiting**: Bật giới hạn số lượt request trên các endpoint nhạy cảm (đăng nhập, đăng ký, quên mật khẩu, thanh toán).
- [ ] **CSRF & XSS**: Rà soát các form gửi dữ liệu và các vị trí render HTML trên frontend.
- [ ] **Secret Scanning**: Quét toàn bộ lịch sử Git để đảm bảo không có API key, database credentials hoặc secret token bị commit lọt vào repo.`
  },
  {
    title: '[P2 - Reliability] Kiểm thử xử lý đồng thời đơn hàng, tồn kho và mã giảm giá (Race Condition)',
    labels: ['enhancement', 'P2', 'database', 'testing'],
    body: `## Mục tiêu
Tránh sai lệch số lượng hàng tồn và thất thoát doanh thu khi nhiều khách hàng thao tác cùng lúc.

## Các kịch bản cần kiểm thử
- [ ] **Tồn kho (Inventory Race Condition)**: Nhiều người cùng bấm mua sản phẩm khi số lượng tồn kho còn ít (ví dụ còn 1 cuốn nhưng 2 người thanh toán cùng lúc) -> Đảm bảo database transaction (hoặc khóa bi quan/lạc quan) chỉ cho phép 1 người đặt thành công.
- [ ] **Mã giảm giá (Coupon Concurrency)**: Áp dụng mã giảm giá có giới hạn số lượt sử dụng trong các request đồng thời -> Không vượt quá số lượng phát hành.
- [ ] **Idempotency**: Gửi liên tiếp nhiều request tạo đơn cùng 1 Idempotency-Key -> Chỉ tạo duy nhất 1 đơn hàng.`
  },
  {
    title: '[P2 - Database] Kiểm chứng quy trình chạy Database Migration trên môi trường thực tế',
    labels: ['enhancement', 'P2', 'database'],
    body: `## Mô tả vấn đề
Dự án đã có các file migration, nhưng cần kiểm chứng thực tế việc thực thi trên cơ sở dữ liệu PostgreSQL.

## Nhiệm vụ cần làm
- [ ] Chạy kiểm thử migration tự động trên một database PostgreSQL hoàn toàn mới (fresh database).
- [ ] Chạy kiểm thử migration trên database đã có dữ liệu mẫu (upgrade migration) để đảm bảo không làm mất dữ liệu.
- [ ] Kiểm tra cơ chế rollback migration khi có lỗi xảy ra giữa chừng.`
  },
  {
    title: '[P3 - Release] Kế hoạch kiểm định phát hành tổng thể (Staging, Load Test & E2E Checkout Flow)',
    labels: ['enhancement', 'P3', 'qa', 'release'],
    body: `## Mục tiêu
Hoàn tất các tiêu chí nghiệm thu cuối cùng trước khi chính thức bàn giao hoặc phát hành cho người dùng.

## Danh sách công việc
- [ ] Chạy kiểm thử tải (Load Testing / Stress Testing) cho backend API để xác định ngưỡng chịu tải tối đa.
- [ ] Kiểm thử giao diện hiển thị và tương tác trên đa thiết bị (Desktop, Tablet, Mobile) và các trình duyệt phổ biến (Chrome, Safari, Firefox, Edge).
- [ ] Triển khai trên môi trường Staging và chạy Smoke Test.
- [ ] Thực hiện kiểm thử toàn diện quy trình mua hàng End-to-End (E2E): Đăng ký tài khoản -> Tìm kiếm sách -> Xem chi tiết -> Thêm giỏ hàng -> Áp mã giảm giá -> Thanh toán -> Nhận email/thông báo xác nhận đơn hàng.`
  }
];

async function createIssue(issue, index) {
  const url = `https://api.github.com/repos/${REPO}/issues`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'BookNest-Issue-Creator',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(issue)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`[${index + 1}/${issues.length}] Thất bại khi tạo "${issue.title}": ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  console.log(`[${index + 1}/${issues.length}] Đã tạo thành công: #${data.number} - ${data.title}`);
  console.log(`   Link: ${data.html_url}`);
}

async function main() {
  if (!TOKEN) {
    console.error('LỖI: Chưa cung cấp GitHub Token!');
    console.log('\nHướng dẫn cách lấy Personal Access Token:');
    console.log('1. Truy cập https://github.com/settings/tokens/new');
    console.log('2. Đặt tên token và tích chọn quyền: repo (toàn quyền trên repository)');
    console.log('3. Copy token và chạy lệnh sau:\n');
    console.log('   node scripts/create-github-issues.js <YOUR_GITHUB_TOKEN>\n');
    process.exit(1);
  }

  console.log(`Bắt đầu tạo ${issues.length} issues cho repository: ${REPO}...\n`);

  for (let i = 0; i < issues.length; i++) {
    try {
      await createIssue(issues[i], i);
      // Chờ 1 giây giữa các request để tránh rate limit của GitHub API
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(err.message);
    }
  }

  console.log('\nHoàn tất quá trình tạo issues!');
}

main();
