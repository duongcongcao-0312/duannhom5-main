# Bảo vệ nhánh `main`

Tài liệu này ghi lại cấu hình bắt buộc để ngăn thay đổi chưa được review hoặc
CI chưa đạt được merge vào `main`. Cấu hình này nằm trong GitHub repository
settings; các file trong repository không thể tự bật branch protection.

## Quy tắc cần cấu hình

Trong repository `duongcongcao-0312/duannhom5-main`, mở **Settings → Rules →
Rulesets** (hoặc **Settings → Branches → Branch protection rules**) và áp dụng
cho nhánh `main`:

- Enforcement status: **Active**.
- Require a pull request before merging.
- Require **1 approval** trước khi merge; dismiss stale approvals khi có commit
  mới và yêu cầu approval mới sau khi push.
- Require conversation resolution trước khi merge.
- Require status checks to pass: chọn check có tên **`ci-gate`** từ workflow
  **BookNest CI**. Không chọn tên workflow chung hoặc các check không ổn định.
- Require branches to be up to date before merging (strict checks).
- Block force pushes và block deletions.
- Không cho phép bypass mặc định. Nếu tổ chức bắt buộc emergency bypass, chỉ
  cấp cho một team/repository role vận hành được chỉ định; ghi rõ owner, lý do,
  thời hạn rà soát và audit từng lần bypass. Không cấp bypass cho mọi write
  collaborator.
- Không bật yêu cầu signed commits hoặc merge queue nếu chưa có quyết định riêng
  và quy trình tương ứng.

Nếu dùng classic branch protection, bật **Do not allow bypassing the above
settings** để admin cũng phải tuân thủ rule. Với ruleset, để bypass list rỗng
trừ khi có ngoại lệ được phê duyệt như phần trên. Không tạo đồng thời hai rule
mâu thuẫn cho `main`.

## Xác minh sau khi lưu

1. Mở Settings và xác nhận rule đang Active, target đúng `main`, danh sách bypass
   đúng chính sách, cùng các điều kiện PR/check ở trên.
2. Mở pull request thử vào `main`. Xác nhận GitHub hiển thị `ci-gate` pending
   rồi pass sau khi workflow **BookNest CI** thành công; merge bị khóa khi check
   pending/fail, chưa đủ approval hoặc còn conversation chưa resolve.
3. Xác nhận GitHub từ chối force push và xóa `main`. Thực hiện kiểm tra bằng
   thao tác được kiểm soát trên môi trường/repository thử nghiệm hoặc bằng API
   kiểm tra rule; không thử force push/xóa trên `main` thật.
4. Lưu URL ruleset/settings, người xác minh, ngày xác minh, PR thử và workflow
   run trong issue/PR vận hành. Xóa PR thử sau khi thu thập bằng chứng.
5. Khi đổi tên job CI hoặc workflow, cập nhật required check tại GitHub cùng
   thời điểm; sau đó xác minh lại bằng một PR.

## Phạm vi CI

Workflow `.github/workflows/ci.yml` chạy `ci-gate` cho pull request vào `main`.
Job này gồm kiểm tra cú pháp, pre-deploy checks, API contract, unit/integration
tests cùng coverage, build và audit dependency. GitHub required check phải là
job `ci-gate`, vì đó là check tổng hợp duy nhất bảo đảm toàn bộ gate đã xong.

Việc merge chỉ hoàn tất khi GitHub settings đã được cấu hình và xác minh theo
các bước trên. Thay đổi tài liệu hoặc workflow trong git không phải bằng chứng
rằng nhánh đã được bảo vệ trên GitHub.
