# Quy trình phát hành BookNest

Tài liệu này định nghĩa cách tạo một bản phát hành có thể truy vết từ version
đến commit nguồn và artifact đã kiểm tra. Quy trình không tự triển khai backend
lên Render; việc xuất bản image và triển khai ứng dụng là hai bước riêng.

## Quy ước phiên bản

- Dùng Semantic Versioning `MAJOR.MINOR.PATCH` và Git tag bất biến `vMAJOR.MINOR.PATCH`.
- Phiên bản phát hành trong `package.json` phải khớp chính xác phần số của tag.
- Tăng `PATCH` cho sửa lỗi tương thích ngược, `MINOR` cho tính năng tương thích
  ngược, `MAJOR` khi có thay đổi phá vỡ tương thích. Tiền tố prerelease như
  `-rc.1` chưa được workflow phát hành chấp nhận.
- Mỗi phiên bản chỉ phát hành một lần. Không di chuyển hoặc ghi đè tag đã phát
  hành; tạo version mới nếu cần sửa.

## Phát hành thông thường

1. Tạo PR vào `main`, ghi rõ thay đổi và ảnh hưởng migration/configuration.
   Chờ CI bắt buộc pass và reviewer phê duyệt. Bật branch protection để yêu cầu
   pull request, CI status check và chặn force-push/xóa `main`.
2. Kiểm tra `docs/production-readiness-checklist.md`, đặc biệt backup trước
   migration, staging, smoke test và khả năng rollback. Chỉ promotion commit đã
   qua kiểm tra staging; production không lấy artifact build lại từ một revision
   khác.
3. Cập nhật `package.json` version và release notes (nếu có nội dung cần làm rõ),
   rồi merge commit vào `main`. Ghi version dự kiến vào PR.
4. Tạo annotated tag từ đúng commit đã duyệt, push tag lên GitHub:

   ```sh
   git checkout main
   git pull --ff-only
   git tag -a vX.Y.Z -m "BookNest vX.Y.Z"
   git push origin vX.Y.Z
   ```

   Không tạo tag trên máy khi `main` đã tiến lên commit khác với commit đã được
   staging xác nhận. Workflow từ chối tag không đúng `vMAJOR.MINOR.PATCH`, không
   khớp `package.json`, hoặc không trỏ đến revision đang chạy.
5. Workflow `Create BookNest release` gọi lại toàn bộ CI cho tag, lấy đúng
   artifact site được tạo trong CI run đó, tạo archive cùng SHA-256 checksum và
   `release-manifest.json`, rồi tạo GitHub Release với ghi chú tự sinh. Manifest
   ghi version, repository, commit, đường dẫn artifact, checksum và CI run.
6. Workflow `Publish BookNest container` cũng chạy CI cho tag rồi xuất bản image
   có tag version lên GHCR, kèm SBOM và provenance. Environment `production` có
   thể yêu cầu người phê duyệt trước khi job xuất bản chạy. Pages production
   được triển khai bởi workflow Pages từ `main`; approval của GitHub environment
   `production` là cổng triển khai. Kiểm tra commit, workflow run, release
   manifest/checksum và URL thật sau deploy. Với Render, chọn đúng image/commit
   đã duyệt trong Dashboard; blueprint hiện để `autoDeploy: false`.
7. Lưu URL release, CI run, checksum, commit, deployment ID/thời gian UTC và kết
   quả health/readiness/smoke trong ticket hoặc nhật ký vận hành. Không ghi
   secrets, URL có credential, hay dữ liệu khách hàng.

## Cổng kiểm tra và phê duyệt

- CI tag phải pass các static check, pre-deploy check, migration test, OpenAPI,
  test/coverage, build, E2E và security audit trước khi release/image được tạo.
- Thiết lập repository ruleset/branch protection cho `main`: PR bắt buộc,
  reviewer, status check CI bắt buộc, chặn force-push và xóa nhánh. Thiết lập
  GitHub Environment `production` với required reviewers và ngăn self-review;
  giới hạn deployment branch/tag theo chính sách tổ chức.
- Staging dùng database và secrets độc lập. Chạy migration, readiness và smoke
  trên cùng commit trước production; không dùng dữ liệu/credentials production
  ở staging.
- Người duyệt production xác nhận release/tag, commit, CI kết quả, staging
  evidence, backup ID, migration compatibility, checksum/image version và
  phương án rollback trước khi duyệt deployment.
- Lưu evidence ở GitHub Release, Actions run summary/artifacts và deployment
  history của provider. Artifact build metadata có retention hữu hạn; GitHub
  Release asset/manifest là bản ghi phát hành lâu dài.

## Hotfix

1. Mở nhánh hotfix từ commit đang chạy production; mô tả incident, phạm vi ảnh
   hưởng và cách khôi phục.
2. Sửa lỗi với PR, reviewer và toàn bộ CI. Không sửa trực tiếp trên `main` hoặc
   sửa tag đã phát hành.
3. Tăng version theo SemVer (thường là PATCH), merge hotfix vào `main`, rồi tạo
   tag mới theo quy trình trên. Chạy staging/smoke và lấy phê duyệt production
   tương tự release thường; nếu mức độ khẩn cấp cần rút gọn cổng, ghi người phê
   duyệt và lý do vào incident record.
4. Sau deploy, xác nhận health/readiness, smoke, lỗi và luồng nghiệp vụ bị ảnh
   hưởng. Ghi các mốc thời gian, commit, version và deployment ID vào incident.

## Thu hồi release và rollback

- Khi phát hiện release không an toàn, đánh dấu GitHub Release là **pre-release**
  hoặc thêm cảnh báo thu hồi trong phần đầu release notes; giữ lại release, tag,
  manifest và artifact để điều tra. Không xóa hoặc di chuyển tag và không ghi đè
  asset cùng tên.
- Dừng promotion/deployment tiếp theo. Thông báo version bị thu hồi trong
  incident record và release notes; không coi việc ẩn release là đã rollback.
- Rollback ứng dụng về deployment/image version tốt đã biết qua Render Dashboard
  hoặc lịch sử deploy Pages/provider phù hợp. Ghi version cũ, deployment mới,
  người thực hiện và kết quả smoke.
- Trước rollback backend, xác nhận migration tương thích ngược và backup khả dụng.
  Không tự chạy migration ngược. Nếu schema không tương thích, ưu tiên forward
  fix; khôi phục database theo runbook backup/restore chỉ sau khi đánh giá mất
  dữ liệu và phê duyệt incident.
- Phát hành bản thay thế với version mới, liên kết release bị thu hồi, incident
  và commit sửa lỗi.

## Những thiết lập cần quản trị viên xác nhận

GitHub Actions có thể tạo release và artifact từ repository này. Required
reviewers, branch protection/ruleset, quyền deploy và cấu hình review của
environment là thiết lập cấp GitHub repository/organization; chúng phải được
cấu hình và kiểm tra trong GitHub Settings trước khi coi quy trình phê duyệt là
đang được thực thi. Workflow không thể tự chứng minh các thiết lập tài khoản
này chỉ bằng thay đổi mã nguồn.
