# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: storefront-ux.spec.js >> intentionally unconfigured API keeps the static catalog without making a request
- Location: tests\e2e\storefront-ux.spec.js:241:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 6

- Array []
+ Array [
+   Object {
+     "method": "GET",
+     "url": "/api/payments/config",
+   },
+ ]
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - link "Bỏ qua đến nội dung chính" [ref=e2] [cursor=pointer]:
    - /url: "#main-content"
  - banner [ref=e3]:
    - link "BookNest trang chủ" [ref=e4] [cursor=pointer]:
      - /url: "#top"
      - generic [aria-hidden] [ref=e5]:
        - generic [ref=e6]: B
        - generic [ref=e7]: "N"
      - generic [ref=e8]: BookNest
    - navigation "Điều hướng chính" [ref=e9]:
      - link "Trang chủ" [ref=e10] [cursor=pointer]:
        - /url: "#top"
      - link "Sách" [ref=e11] [cursor=pointer]:
        - /url: "#books"
      - link "Thể loại" [ref=e12] [cursor=pointer]:
        - /url: "#categories"
      - link "Dịch vụ" [ref=e13] [cursor=pointer]:
        - /url: "#services"
      - link "Quản trị" [ref=e14] [cursor=pointer]:
        - /url: admin.html
    - button "Mở giỏ hàng" [ref=e15] [cursor=pointer]:
      - text: Giỏ hàng
      - generic [ref=e16]: "0"
    - button "Tra cứu đơn" [ref=e17] [cursor=pointer]
    - button "Đăng nhập" [ref=e18] [cursor=pointer]
  - main [ref=e19]:
    - generic [ref=e21]:
      - generic [ref=e22]:
        - paragraph [ref=e23]: Nhà sách bốn mùa
        - heading "Một cuốn sách hay, một ngày đáng nhớ." [level=1] [ref=e24]
        - paragraph [ref=e25]: Mỗi mùa một góc đọc, mỗi cuốn sách một chuyến đi riêng. Khám phá những tựa sách được chọn kỹ cho những giờ đọc thật trọn vẹn.
        - link "Khám phá sách" [ref=e26] [cursor=pointer]:
          - /url: "#books"
      - generic "Những cuốn sách nổi bật" [ref=e27]:
        - generic [ref=e28]: THELONGWAY
        - generic [ref=e31]: MỘTĐỜIĐÁNG SỐNG
        - generic [ref=e34]: READMORE
    - region "Tóm tắt giỏ hàng" [ref=e36]:
      - generic [aria-hidden] [ref=e37]: ▣
      - generic [ref=e38]:
        - strong [ref=e39]: Giỏ hàng nhanh
        - generic [ref=e40]: Chưa có sách được chọn
      - button "Xem giỏ hàng" [ref=e41] [cursor=pointer]
    - region "Góc sách theo mùa" [ref=e42]:
      - generic [ref=e43]:
        - paragraph [ref=e44]: Bốn mùa, bốn nhịp đọc
        - heading "Góc sách theo mùa" [level=2] [ref=e45]
        - paragraph [ref=e46]: Chọn một sắc màu cho tâm trạng hôm nay.
      - generic [ref=e47]:
        - button "Xuân Những trang sách mới" [ref=e48] [cursor=pointer]:
          - generic [aria-hidden] [ref=e49]: ✦
          - generic [ref=e50]:
            - strong [ref=e51]: Xuân
            - generic [ref=e52]: Những trang sách mới
          - generic [aria-hidden] [ref=e53]: ↗
        - button "Hạ Đọc để lớn lên" [ref=e54] [cursor=pointer]:
          - generic [aria-hidden] [ref=e55]: ◌
          - generic [ref=e56]:
            - strong [ref=e57]: Hạ
            - generic [ref=e58]: Đọc để lớn lên
          - generic [aria-hidden] [ref=e59]: ↗
        - button "Thu Những chiều chậm rãi" [ref=e60] [cursor=pointer]:
          - generic [aria-hidden] [ref=e61]: ❧
          - generic [ref=e62]:
            - strong [ref=e63]: Thu
            - generic [ref=e64]: Những chiều chậm rãi
          - generic [aria-hidden] [ref=e65]: ↗
        - button "Đông Ở nhà cùng tri thức" [ref=e66] [cursor=pointer]:
          - generic [aria-hidden] [ref=e67]: ✧
          - generic [ref=e68]:
            - strong [ref=e69]: Đông
            - generic [ref=e70]: Ở nhà cùng tri thức
          - generic [aria-hidden] [ref=e71]: ↗
    - generic [ref=e72]:
      - generic [ref=e73]:
        - generic [ref=e74]:
          - paragraph [ref=e75]: Bộ sưu tập hôm nay
          - heading "Sách được yêu thích" [level=2] [ref=e76]
          - paragraph [ref=e77]: 80 tựa sách được chọn theo nhiều chủ đề
        - generic [ref=e78]:
          - generic [ref=e79]:
            - generic [ref=e80]: Tìm sách
            - searchbox "Tìm sách" [ref=e81]
          - combobox "Lọc theo thể loại" [ref=e82]:
            - option "Tất cả thể loại" [selected]
            - option "Văn học"
            - option "Kỹ năng sống"
            - option "Kinh tế"
            - option "Khoa học"
            - option "Lịch sử"
            - option "Thiếu nhi"
            - option "Trinh thám"
            - option "Tâm lý"
            - option "Công nghệ"
            - option "Ngoại ngữ"
          - combobox "Lọc theo khoảng giá" [ref=e83]:
            - option "Tất cả mức giá" [selected]
            - option "Dưới 100.000 đ"
            - option "100.000 đ - 200.000 đ"
            - option "Trên 200.000 đ"
          - combobox "Lọc theo nhãn" [ref=e84]:
            - option "Tất cả nhãn" [selected]
            - option "Bán chạy"
            - option "Nổi bật"
            - option "Ưu đãi"
            - option "Mới"
          - combobox "Sắp xếp sách" [ref=e85]:
            - option "Sắp xếp nổi bật" [selected]
            - option "Giá thấp đến cao"
            - option "Giá cao đến thấp"
            - option "Tên A-Z"
            - option "Tên Z-A"
            - option "Mới nhất"
            - option "Bán chạy"
          - button "♡ Yêu thích" [ref=e86] [cursor=pointer]
          - button "↻ Đặt lại" [ref=e87] [cursor=pointer]
      - status [ref=e88]:
        - generic [ref=e89]: Đang xem danh mục sách mẫu.
      - generic [ref=e90]:
        - article [ref=e91]:
          - generic [ref=e92]:
            - generic [ref=e93]: Ưu đãi
            - img "Bìa sách Nhà giả kim - Paulo Coelho" [ref=e94]
          - generic [ref=e95]:
            - heading "Nhà giả kim" [level=3] [ref=e96]
            - paragraph [ref=e97]: Paulo Coelho
            - paragraph [ref=e98]: Còn 12 cuốn
            - generic [ref=e99]:
              - generic [ref=e100]: 89.000 đ
              - link "Chi tiết" [ref=e101] [cursor=pointer]:
                - /url: book.html?title=Nh%C3%A0+gi%E1%BA%A3+kim&author=Paulo+Coelho&price=89000&category=van-hoc&image=https%3A%2F%2Fcovers.openlibrary.org%2Fb%2Fid%2F14846382-L.jpg%3Fdefault%3Dfalse
              - button "Thêm yêu thích" [ref=e102] [cursor=pointer]: ♡
              - button "Thêm vào giỏ" [ref=e103] [cursor=pointer]
        - article [ref=e104]:
          - generic [ref=e105]:
            - generic [ref=e106]: Nổi bật
            - img "Bìa sách Đi tìm lẽ sống - Viktor E. Frankl" [ref=e107]
          - generic [ref=e108]:
            - heading "Đi tìm lẽ sống" [level=3] [ref=e109]
            - paragraph [ref=e110]: Viktor E. Frankl
            - paragraph [ref=e111]: Còn 12 cuốn
            - generic [ref=e112]:
              - generic [ref=e113]: 99.000 đ
              - link "Chi tiết" [ref=e114] [cursor=pointer]:
                - /url: book.html?title=%C4%90i+t%C3%ACm+l%E1%BA%BD+s%E1%BB%91ng&author=Viktor+E.+Frankl&price=99000&category=ky-nang&image=https%3A%2F%2Fcovers.openlibrary.org%2Fb%2Ftitle%2F%25C4%2590i%2520t%25C3%25ACm%2520l%25E1%25BA%25BD%2520s%25E1%25BB%2591ng-L.jpg%3Fdefault%3Dfalse
              - button "Thêm yêu thích" [ref=e115] [cursor=pointer]: ♡
              - button "Thêm vào giỏ" [ref=e116] [cursor=pointer]
        - article [ref=e117]:
          - generic [ref=e118]:
            - generic [ref=e119]: Mới
            - img "Bìa sách Tư duy nhanh và chậm - Daniel Kahneman" [ref=e120]
          - generic [ref=e121]:
            - heading "Tư duy nhanh và chậm" [level=3] [ref=e122]
            - paragraph [ref=e123]: Daniel Kahneman
            - paragraph [ref=e124]: Còn 12 cuốn
            - generic [ref=e125]:
              - generic [ref=e126]: 159.000 đ
              - link "Chi tiết" [ref=e127] [cursor=pointer]:
                - /url: book.html?title=T%C6%B0+duy+nhanh+v%C3%A0+ch%E1%BA%ADm&author=Daniel+Kahneman&price=159000&category=kinh-te&image=https%3A%2F%2Fcovers.openlibrary.org%2Fb%2Fid%2F13290711-L.jpg%3Fdefault%3Dfalse
              - button "Thêm yêu thích" [ref=e128] [cursor=pointer]: ♡
              - button "Thêm vào giỏ" [ref=e129] [cursor=pointer]
        - article [ref=e130]:
          - generic [ref=e131]:
            - generic [ref=e132]: Ưu đãi
            - img "Bìa sách Tuổi trẻ đáng giá bao nhiêu? - Rosie Nguyễn" [ref=e133]
          - generic [ref=e134]:
            - heading "Tuổi trẻ đáng giá bao nhiêu?" [level=3] [ref=e135]
            - paragraph [ref=e136]: Rosie Nguyễn
            - paragraph [ref=e137]: Còn 12 cuốn
            - generic [ref=e138]:
              - generic [ref=e139]: 89.000 đ
              - link "Chi tiết" [ref=e140] [cursor=pointer]:
                - /url: book.html?title=Tu%E1%BB%95i+tr%E1%BA%BB+%C4%91%C3%A1ng+gi%C3%A1+bao+nhi%C3%AAu%3F&author=Rosie+Nguy%E1%BB%85n&price=89000&category=ky-nang&image=https%3A%2F%2Fcovers.openlibrary.org%2Fb%2Ftitle%2FTu%25E1%25BB%2595i%2520tr%25E1%25BA%25BB%2520%25C4%2591%25C3%25A1ng%2520gi%25C3%25A1%2520bao%2520nhi%25C3%25AAu%253F-L.jpg%3Fdefault%3Dfalse
              - button "Thêm yêu thích" [ref=e141] [cursor=pointer]: ♡
              - button "Thêm vào giỏ" [ref=e142] [cursor=pointer]
        - article [ref=e143]:
          - generic [ref=e144]:
            - generic [ref=e145]: Nổi bật
            - img "Bìa sách Mắt biếc - Nguyễn Nhật Ánh" [ref=e146]
          - generic [ref=e147]:
            - heading "Mắt biếc" [level=3] [ref=e148]
            - paragraph [ref=e149]: Nguyễn Nhật Ánh
            - paragraph [ref=e150]: Còn 12 cuốn
            - generic [ref=e151]:
              - generic [ref=e152]: 99.000 đ
              - link "Chi tiết" [ref=e153] [cursor=pointer]:
                - /url: book.html?title=M%E1%BA%AFt+bi%E1%BA%BFc&author=Nguy%E1%BB%85n+Nh%E1%BA%ADt+%C3%81nh&price=99000&category=van-hoc&image=https%3A%2F%2Fcovers.openlibrary.org%2Fb%2Fid%2F13258074-L.jpg%3Fdefault%3Dfalse
              - button "Thêm yêu thích" [ref=e154] [cursor=pointer]: ♡
              - button "Thêm vào giỏ" [ref=e155] [cursor=pointer]
        - article [ref=e156]:
          - generic [ref=e157]:
            - generic [ref=e158]: Mới
            - img "Bìa sách Đắc nhân tâm - Dale Carnegie" [ref=e159]
          - generic [ref=e160]:
            - heading "Đắc nhân tâm" [level=3] [ref=e161]
            - paragraph [ref=e162]: Dale Carnegie
            - paragraph [ref=e163]: Còn 12 cuốn
            - generic [ref=e164]:
              - generic [ref=e165]: 98.000 đ
              - link "Chi tiết" [ref=e166] [cursor=pointer]:
                - /url: book.html?title=%C4%90%E1%BA%AFc+nh%C3%A2n+t%C3%A2m&author=Dale+Carnegie&price=98000&category=ky-nang&image=https%3A%2F%2Fcovers.openlibrary.org%2Fb%2Fid%2F13314878-L.jpg%3Fdefault%3Dfalse
              - button "Thêm yêu thích" [ref=e167] [cursor=pointer]: ♡
              - button "Thêm vào giỏ" [ref=e168] [cursor=pointer]
        - article [ref=e169]:
          - generic [ref=e170]:
            - generic [ref=e171]: Bán chạy
            - 'img "Bìa sách Sapiens: Lược sử loài người - Yuval Noah Harari" [ref=e172]'
          - generic [ref=e173]:
            - 'heading "Sapiens: Lược sử loài người" [level=3] [ref=e174]'
            - paragraph [ref=e175]: Yuval Noah Harari
            - paragraph [ref=e176]: Còn 12 cuốn
            - generic [ref=e177]:
              - generic [ref=e178]: 189.000 đ
              - link "Chi tiết" [ref=e179] [cursor=pointer]:
                - /url: book.html?title=Sapiens%3A+L%C6%B0%E1%BB%A3c+s%E1%BB%AD+lo%C3%A0i+ng%C6%B0%E1%BB%9Di&author=Yuval+Noah+Harari&price=189000&category=kinh-te&image=https%3A%2F%2Fcovers.openlibrary.org%2Fb%2Fid%2F8634250-L.jpg%3Fdefault%3Dfalse
              - button "Thêm yêu thích" [ref=e180] [cursor=pointer]: ♡
              - button "Thêm vào giỏ" [ref=e181] [cursor=pointer]
        - article [ref=e182]:
          - generic [ref=e183]:
            - generic [ref=e184]: Nổi bật
            - img "Bìa sách Dám bị ghét - Ichiro Kishimi, Fumitake Koga" [ref=e185]
          - generic [ref=e186]:
            - heading "Dám bị ghét" [level=3] [ref=e187]
            - paragraph [ref=e188]: Ichiro Kishimi, Fumitake Koga
            - paragraph [ref=e189]: Còn 12 cuốn
            - generic [ref=e190]:
              - generic [ref=e191]: 109.000 đ
              - link "Chi tiết" [ref=e192] [cursor=pointer]:
                - /url: book.html?title=D%C3%A1m+b%E1%BB%8B+gh%C3%A9t&author=Ichiro+Kishimi%2C+Fumitake+Koga&price=109000&category=ky-nang&image=https%3A%2F%2Fcovers.openlibrary.org%2Fb%2Ftitle%2FD%25C3%25A1m%2520b%25E1%25BB%258B%2520gh%25C3%25A9t-L.jpg%3Fdefault%3Dfalse
              - button "Thêm yêu thích" [ref=e193] [cursor=pointer]: ♡
              - button "Thêm vào giỏ" [ref=e194] [cursor=pointer]
        - article [ref=e195]:
          - generic [ref=e196]:
            - generic [ref=e197]: Ưu đãi
            - img "Bìa sách Người giàu có nhất thành Babylon - George S. Clason" [ref=e198]
          - generic [ref=e199]:
            - heading "Người giàu có nhất thành Babylon" [level=3] [ref=e200]
            - paragraph [ref=e201]: George S. Clason
            - paragraph [ref=e202]: Còn 12 cuốn
            - generic [ref=e203]:
              - generic [ref=e204]: 89.000 đ
              - link "Chi tiết" [ref=e205] [cursor=pointer]:
                - /url: book.html?title=Ng%C6%B0%E1%BB%9Di+gi%C3%A0u+c%C3%B3+nh%E1%BA%A5t+th%C3%A0nh+Babylon&author=George+S.+Clason&price=89000&category=kinh-te&image=https%3A%2F%2Fcovers.openlibrary.org%2Fb%2Fid%2F10491331-L.jpg%3Fdefault%3Dfalse
              - button "Thêm yêu thích" [ref=e206] [cursor=pointer]: ♡
              - button "Thêm vào giỏ" [ref=e207] [cursor=pointer]
        - article [ref=e208]:
          - generic [ref=e209]:
            - generic [ref=e210]: Bán chạy
            - img "Bìa sách Bố già - Mario Puzo" [ref=e211]
          - generic [ref=e212]:
            - heading "Bố già" [level=3] [ref=e213]
            - paragraph [ref=e214]: Mario Puzo
            - paragraph [ref=e215]: Còn 12 cuốn
            - generic [ref=e216]:
              - generic [ref=e217]: 159.000 đ
              - link "Chi tiết" [ref=e218] [cursor=pointer]:
                - /url: book.html?title=B%E1%BB%91+gi%C3%A0&author=Mario+Puzo&price=159000&category=van-hoc&image=https%3A%2F%2Fcovers.openlibrary.org%2Fb%2Fid%2F6507069-L.jpg%3Fdefault%3Dfalse
              - button "Thêm yêu thích" [ref=e219] [cursor=pointer]: ♡
              - button "Thêm vào giỏ" [ref=e220] [cursor=pointer]
        - article [ref=e221]:
          - generic [ref=e222]:
            - generic [ref=e223]: Ưu đãi
            - img "Bìa sách Cà phê cùng Tony - Tony Buổi Sáng" [ref=e224]
          - generic [ref=e225]:
            - heading "Cà phê cùng Tony" [level=3] [ref=e226]
            - paragraph [ref=e227]: Tony Buổi Sáng
            - paragraph [ref=e228]: Còn 12 cuốn
            - generic [ref=e229]:
              - generic [ref=e230]: 90.000 đ
              - link "Chi tiết" [ref=e231] [cursor=pointer]:
                - /url: book.html?title=C%C3%A0+ph%C3%AA+c%C3%B9ng+Tony&author=Tony+Bu%E1%BB%95i+S%C3%A1ng&price=90000&category=ky-nang&image=https%3A%2F%2Fcovers.openlibrary.org%2Fb%2Fid%2F9175811-L.jpg%3Fdefault%3Dfalse
              - button "Thêm yêu thích" [ref=e232] [cursor=pointer]: ♡
              - button "Thêm vào giỏ" [ref=e233] [cursor=pointer]
        - article [ref=e234]:
          - generic [ref=e235]:
            - generic [ref=e236]: Mới
            - img "Bìa sách Nghĩ giàu và làm giàu - Napoleon Hill" [ref=e237]
          - generic [ref=e238]:
            - heading "Nghĩ giàu và làm giàu" [level=3] [ref=e239]
            - paragraph [ref=e240]: Napoleon Hill
            - paragraph [ref=e241]: Còn 12 cuốn
            - generic [ref=e242]:
              - generic [ref=e243]: 115.000 đ
              - link "Chi tiết" [ref=e244] [cursor=pointer]:
                - /url: book.html?title=Ngh%C4%A9+gi%C3%A0u+v%C3%A0+l%C3%A0m+gi%C3%A0u&author=Napoleon+Hill&price=115000&category=kinh-te&image=https%3A%2F%2Fcovers.openlibrary.org%2Fb%2Fid%2F14542536-L.jpg%3Fdefault%3Dfalse
              - button "Thêm yêu thích" [ref=e245] [cursor=pointer]: ♡
              - button "Thêm vào giỏ" [ref=e246] [cursor=pointer]
      - navigation "Phân trang sách" [ref=e247]:
        - button "Trang trước" [disabled] [ref=e248] [cursor=pointer]
        - text: Trang 1 / 7
        - button "Trang sau" [ref=e249] [cursor=pointer]
    - generic [ref=e250]:
      - generic [ref=e251]:
        - paragraph [ref=e252]: Đọc theo tâm trạng
        - heading "Tìm đúng câu chuyện của bạn" [level=2] [ref=e253]
      - generic [ref=e254]:
        - button "Văn học 8 tựa sách →" [ref=e255] [cursor=pointer]:
          - generic [ref=e256]:
            - text: Văn học
            - generic [ref=e257]: 8 tựa sách
          - generic [ref=e258]: →
        - button "Kỹ năng sống 8 tựa sách →" [ref=e259] [cursor=pointer]:
          - generic [ref=e260]:
            - text: Kỹ năng sống
            - generic [ref=e261]: 8 tựa sách
          - generic [ref=e262]: →
        - button "Kinh tế 8 tựa sách →" [ref=e263] [cursor=pointer]:
          - generic [ref=e264]:
            - text: Kinh tế
            - generic [ref=e265]: 8 tựa sách
          - generic [ref=e266]: →
        - button "Khoa học 8 tựa sách →" [ref=e267] [cursor=pointer]:
          - generic [ref=e268]:
            - text: Khoa học
            - generic [ref=e269]: 8 tựa sách
          - generic [ref=e270]: →
        - button "Lịch sử 8 tựa sách →" [ref=e271] [cursor=pointer]:
          - generic [ref=e272]:
            - text: Lịch sử
            - generic [ref=e273]: 8 tựa sách
          - generic [ref=e274]: →
        - button "Thiếu nhi 8 tựa sách →" [ref=e275] [cursor=pointer]:
          - generic [ref=e276]:
            - text: Thiếu nhi
            - generic [ref=e277]: 8 tựa sách
          - generic [ref=e278]: →
        - button "Trinh thám 8 tựa sách →" [ref=e279] [cursor=pointer]:
          - generic [ref=e280]:
            - text: Trinh thám
            - generic [ref=e281]: 8 tựa sách
          - generic [ref=e282]: →
        - button "Tâm lý 8 tựa sách →" [ref=e283] [cursor=pointer]:
          - generic [ref=e284]:
            - text: Tâm lý
            - generic [ref=e285]: 8 tựa sách
          - generic [ref=e286]: →
        - button "Công nghệ 8 tựa sách →" [ref=e287] [cursor=pointer]:
          - generic [ref=e288]:
            - text: Công nghệ
            - generic [ref=e289]: 8 tựa sách
          - generic [ref=e290]: →
        - button "Ngoại ngữ 8 tựa sách →" [ref=e291] [cursor=pointer]:
          - generic [ref=e292]:
            - text: Ngoại ngữ
            - generic [ref=e293]: 8 tựa sách
          - generic [ref=e294]: →
    - region "Không chỉ mua sách" [ref=e295]:
      - generic [ref=e296]:
        - paragraph [ref=e297]: Đọc xanh, dùng thông minh
        - heading "Không chỉ mua sách" [level=2] [ref=e298]
        - paragraph [ref=e299]: "Đọc theo cách phù hợp với bạn: tiết kiệm chi phí, kéo dài vòng đời sách và kết nối với cộng đồng đọc."
      - generic [ref=e300]:
        - article [ref=e301]:
          - generic [aria-hidden] [ref=e302]: ↻
          - heading "Cho thuê sách" [level=3] [ref=e303]
          - paragraph [ref=e304]: Mượn sách theo tuần hoặc tháng, phù hợp với những cuốn bạn muốn đọc thử.
          - button "Đăng ký thuê" [ref=e305] [cursor=pointer]
        - article [ref=e306]:
          - generic [aria-hidden] [ref=e307]: ↗
          - heading "Thu mua sách" [level=3] [ref=e308]
          - paragraph [ref=e309]: Gửi lại sách đã đọc. BookNest định giá theo tình trạng và hỗ trợ nhận sách.
          - button "Bán sách cho BookNest" [ref=e310] [cursor=pointer]
        - article [ref=e311]:
          - generic [aria-hidden] [ref=e312]: ⇄
          - heading "Trao đổi sách" [level=3] [ref=e313]
          - paragraph [ref=e314]: Đổi sách với độc giả khác để làm mới tủ sách mà không cần mua thêm.
          - button "Đăng sách trao đổi" [ref=e315] [cursor=pointer]
  - dialog [aria-hidden]:
    - generic:
      - heading [level=2]: Giỏ hàng
      - button: ×
    - generic:
      - paragraph: Giỏ hàng đang trống.
    - status: Giỏ hàng đang trống.
    - generic:
      - generic: Mã ưu đãi
      - generic:
        - textbox:
          - /placeholder: "Ví dụ: BOOKNEST10"
        - button: Áp dụng
    - generic:
      - generic:
        - generic: Tạm tính
        - strong: 0 đ
      - generic:
        - generic: Ưu đãi thành viên
        - strong: "-0 đ"
      - generic:
        - generic: Thành tiền
        - strong: 0 đ
      - button [disabled]: Thanh toán
  - button "Mở trợ lý BookNest" [ref=e316] [cursor=pointer]:
    - text: ✦
    - generic [ref=e317]: Hỏi BookNest
  - complementary [aria-hidden]:
    - generic:
      - generic:
        - strong: Trợ lý BookNest
        - generic: Gợi ý sách và giải đáp nhanh
      - button: ×
    - generic: Xin chào! Mình có thể gợi ý sách, giải thích dịch vụ thuê/thu mua/trao đổi hoặc ưu đãi tài khoản. Bạn muốn hỏi gì?
    - generic:
      - button: Sách văn học
      - button: Ưu đãi học sinh
      - button: Thuê sách
    - generic:
      - generic: Câu hỏi cho BookNest
      - textbox:
        - /placeholder: Nhập câu hỏi...
      - button: Gửi
  - contentinfo [ref=e318]:
    - paragraph [ref=e319]: BookNest
    - generic [ref=e320]: Những trang sách mở ra những thế giới mới.
    - navigation "Liên kết pháp lý" [ref=e321]:
      - link "Chính sách bảo mật" [ref=e322] [cursor=pointer]:
        - /url: privacy.html
      - link "Chính sách vận chuyển" [ref=e323] [cursor=pointer]:
        - /url: shipping.html
      - link "Chính sách đổi trả" [ref=e324] [cursor=pointer]:
        - /url: returns.html
      - link "Chính sách hoàn tiền" [ref=e325] [cursor=pointer]:
        - /url: refund.html
      - link "Điều khoản dịch vụ" [ref=e326] [cursor=pointer]:
        - /url: terms.html
      - link "Bảo vệ người tiêu dùng & Hóa đơn" [ref=e327] [cursor=pointer]:
        - /url: consumer-tax.html
      - link "Tuân thủ TMĐT" [ref=e328] [cursor=pointer]:
        - /url: ecommerce-compliance.html
      - link "Bản quyền nội dung" [ref=e329] [cursor=pointer]:
        - /url: content-rights.html
  - region "Thông báo"
```

# Test source

```ts
  148 |   await page.goto(`http://booknest.test/book.html?title=${encodeURIComponent(title)}`);
  149 |   await page.addStyleTag({ content: storefrontCss });
  150 |   await page.addStyleTag({ content: toastCss });
  151 |   await page.exposeFunction("__bookDetailApiRequest", apiHandler);
  152 |   await page.addScriptTag({
  153 |     content: `
  154 |       window.BOOKNEST_API_BASE_URL = "http://localhost:8000";
  155 |       window.booknestAuth = { getToken: () => null };
  156 |       window.booknestApiFetch = async (url, options = {}) => {
  157 |         const result = await window.__bookDetailApiRequest(url, options);
  158 |         if (result.throw === "offline") throw new TypeError("Failed to fetch");
  159 |         if (result.throw === "timeout") throw new DOMException("Request timed out", "AbortError");
  160 |         return new Response(JSON.stringify(result.body), {
  161 |           status: result.status || 200,
  162 |           headers: { "Content-Type": "application/json", ...(result.headers || {}) }
  163 |         });
  164 |       };
  165 |     `,
  166 |   });
  167 |   await page.addScriptTag({ content: toastScript });
  168 |   await page.addScriptTag({ content: bookDataScript });
  169 |   await page.addScriptTag({ content: bookDetailScript });
  170 | }
  171 | 
  172 | test("catalog announces loading while configured API data is pending", async ({ page }) => {
  173 |   let releaseCatalog;
  174 |   let markCatalogRequested;
  175 |   const catalogGate = new Promise((resolve) => { releaseCatalog = resolve; });
  176 |   const catalogRequested = new Promise((resolve) => { markCatalogRequested = resolve; });
  177 |   const apiHandler = async (url) => {
  178 |     if (url.startsWith("/api/books")) {
  179 |       markCatalogRequested();
  180 |       await catalogGate;
  181 |       return { body: [apiBooks[0]] };
  182 |     }
  183 |     return defaultApiHandler(url);
  184 |   };
  185 | 
  186 |   await openStorefront(page, apiHandler);
  187 |   await catalogRequested;
  188 |   await expect(page.locator("#catalogStatus")).toHaveAttribute("data-state", "loading");
  189 |   await expect(page.locator("#catalogStatus")).toContainText(/đang tải/i);
  190 |   await expect(page.locator("#bookGrid .book-card")).not.toHaveCount(0);
  191 | 
  192 |   releaseCatalog();
  193 |   await expect(page.locator("#catalogStatus")).toHaveAttribute("data-state", "ready");
  194 |   await expect(page.locator("#bookGrid")).toContainText("Orange Book");
  195 | });
  196 | 
  197 | test("catalog distinguishes a successful empty API response from static fallback", async ({ page }) => {
  198 |   const apiHandler = async (url) => {
  199 |     if (url.startsWith("/api/books")) return { body: [] };
  200 |     if (url === "/api/categories") return { body: [] };
  201 |     return defaultApiHandler(url);
  202 |   };
  203 | 
  204 |   await openStorefront(page, apiHandler);
  205 |   await expect(page.locator("#catalogStatus")).toHaveAttribute("data-state", "empty");
  206 |   await expect(page.locator("#catalogStatus")).toContainText(/chưa có sách/i);
  207 |   await expect(page.locator("#bookGrid .book-card")).toHaveCount(0);
  208 | });
  209 | 
  210 | for (const failure of [
  211 |   { name: "offline", result: { throw: "offline" }, message: /kết nối|mạng/i },
  212 |   { name: "timeout", result: { throw: "timeout" }, message: /quá thời gian|phản hồi|thử lại/i },
  213 |   { name: "server", result: { status: 503, body: {} }, message: /máy chủ|thử lại/i },
  214 |   { name: "permission", result: { status: 403, body: {} }, message: /quyền|đăng nhập/i },
  215 | ]) {
  216 |   test(`catalog labels its static fallback and retries after ${failure.name}`, async ({ page }) => {
  217 |     let attempts = 0;
  218 |     const apiHandler = async (url) => {
  219 |       if (url.startsWith("/api/books")) {
  220 |         attempts += 1;
  221 |         if (attempts === 1) return failure.result;
  222 |         return { body: [apiBooks[0]] };
  223 |       }
  224 |       return defaultApiHandler(url);
  225 |     };
  226 | 
  227 |     await openStorefront(page, apiHandler);
  228 |     const status = page.locator("#catalogStatus");
  229 |     await expect(status).toHaveAttribute("data-state", "error");
  230 |     await expect(status).toContainText(failure.message);
  231 |     await expect(page.locator("#bookGrid .book-card")).not.toHaveCount(0);
  232 |     await expect(status.getByRole("button", { name: /thử lại/i })).toBeVisible();
  233 | 
  234 |     await status.getByRole("button", { name: /thử lại/i }).click();
  235 |     await expect(status).toHaveAttribute("data-state", "ready");
  236 |     await expect(page.locator("#bookGrid")).toContainText("Orange Book");
  237 |     expect(attempts).toBe(2);
  238 |   });
  239 | }
  240 | 
  241 | test("intentionally unconfigured API keeps the static catalog without making a request", async ({ page }) => {
  242 |   await openStorefront(page, defaultApiHandler, "");
  243 | 
  244 |   await expect(page.locator("#catalogStatus")).toHaveAttribute("data-state", "static");
  245 |   await expect(page.locator("#catalogStatus")).toContainText(/mẫu|tĩnh/i);
  246 |   await expect(page.locator("#bookGrid .book-card")).not.toHaveCount(0);
  247 |   await expect(page.locator("#bookCount")).toHaveText("80");
> 248 |   expect(await page.evaluate(() => window.__storefrontApiCalls)).toEqual([]);
      |                                                                  ^ Error: expect(received).toEqual(expected) // deep equality
  249 | });
  250 | 
  251 | test("catalog search, category selection, and product detail links stay connected", async ({ page }) => {
  252 |   await openStorefront(page);
  253 |   await expect(page.locator("#catalogStatus")).toHaveAttribute("data-state", "ready");
  254 | 
  255 |   const mobileNavToggle = page.locator("#mobileNavToggle");
  256 |   if (await mobileNavToggle.isVisible()) await mobileNavToggle.click();
  257 |   await expect(page.locator('.main-nav a[href="#books"]')).toBeVisible();
  258 |   await expect(page.locator('.main-nav a[href="#categories"]')).toBeVisible();
  259 |   await expect(page.locator("#bookGrid .details-link").first()).toHaveAttribute("href", /book\.html\?/);
  260 | 
  261 |   await page.locator("#searchInput").fill("Orange Book");
  262 |   await expect(page.locator("#bookGrid .book-card")).toHaveCount(1);
  263 |   await expect(page.locator("#bookGrid")).toContainText("Orange Book");
  264 | 
  265 |   await page.locator("#searchInput").fill("");
  266 |   await page.locator("#categoryFilter").selectOption("kinh-te");
  267 |   await expect(page.locator("#bookGrid .book-card")).toHaveCount(1);
  268 |   await expect(page.locator("#bookGrid")).toContainText("Green Book");
  269 | });
  270 | 
  271 | test("mobile navigation opens from the keyboard and Escape returns focus", async ({ page }, testInfo) => {
  272 |   test.skip(testInfo.project.name === "mobile-safari", "iPhone viewport emulation does not provide hardware-keyboard Tab traversal");
  273 |   await page.setViewportSize({ width: 390, height: 844 });
  274 |   await openStorefront(page, defaultApiHandler, "");
  275 | 
  276 |   const toggle = page.locator("#mobileNavToggle");
  277 |   const navigation = page.locator("#mainNavigation");
  278 |   await expect(toggle).toBeVisible();
  279 |   await toggle.focus();
  280 |   await page.keyboard.press("Enter");
  281 |   await expect(toggle).toHaveAttribute("aria-expanded", "true");
  282 |   await expect(navigation).toBeVisible();
  283 | 
  284 |   await page.keyboard.press("Escape");
  285 |   await expect(toggle).toHaveAttribute("aria-expanded", "false");
  286 |   await expect(navigation).toBeHidden();
  287 |   await expect(toggle).toBeFocused();
  288 | });
  289 | 
  290 | test("mobile navigation remains operable by touch in the iPhone profile", async ({ page }, testInfo) => {
  291 |   test.skip(testInfo.project.name !== "mobile-safari", "Touch navigation is exercised in the iPhone profile");
  292 |   await page.setViewportSize({ width: 390, height: 844 });
  293 |   await openStorefront(page, defaultApiHandler, "");
  294 | 
  295 |   const toggle = page.locator("#mobileNavToggle");
  296 |   const navigation = page.locator("#mainNavigation");
  297 |   await toggle.click();
  298 |   await expect(navigation).toBeVisible();
  299 |   await navigation.locator('a[href="#books"]').click();
  300 |   await expect(page).toHaveURL(/#books$/);
  301 |   await expect(toggle).toHaveAttribute("aria-expanded", "false");
  302 | });
  303 | 
  304 | test("catalog no-match results can reset the filters", async ({ page }) => {
  305 |   await openStorefront(page, defaultApiHandler, "");
  306 |   const search = page.locator("#searchInput");
  307 |   await search.fill("No such book");
  308 |   await expect(page.locator("#emptyState")).toBeVisible();
  309 |   await page.locator("#emptyState").getByRole("button", { name: /đặt lại bộ lọc/i }).click();
  310 |   await expect(search).toHaveValue("");
  311 |   await expect(page.locator("#bookGrid .book-card")).not.toHaveCount(0);
  312 | });
  313 | 
  314 | test("empty favorite results can clear the favorites filter", async ({ page }) => {
  315 |   await openStorefront(page, defaultApiHandler, "");
  316 |   await page.locator("#favoritesFilter").click();
  317 |   await expect(page.locator("#emptyState")).toBeVisible();
  318 |   await page.locator("#emptyState").getByRole("button", { name: /bỏ lọc yêu thích/i }).click();
  319 |   await expect(page.locator("#favoritesFilter")).toHaveAttribute("aria-pressed", "false");
  320 |   await expect(page.locator("#bookGrid .book-card")).not.toHaveCount(0);
  321 | });
  322 | 
  323 | test("book details expose API metadata and disable purchases for out-of-stock books", async ({ page }) => {
  324 |   const apiHandler = async (url) => {
  325 |     if (url.startsWith("/api/books?search=")) return { body: [remoteBook] };
  326 |     if (url.endsWith("/reviews")) return { body: { averageRating: 0, reviewCount: 0, reviews: [] } };
  327 |     if (url.endsWith("/related")) return { body: [] };
  328 |     return { body: {} };
  329 |   };
  330 |   await openBookDetail(page, apiHandler);
  331 | 
  332 |   const detail = page.locator("#bookDetail");
  333 |   await expect(detail.getByRole("heading", { name: "Remote Book" })).toBeVisible();
  334 |   await expect(detail.locator(".detail-author")).toContainText("Api Writer");
  335 |   await expect(detail.locator(".detail-publisher")).toContainText("BookNest Press");
  336 |   await expect(detail.locator(".detail-price")).toContainText("135.000");
  337 |   await expect(detail.locator(".detail-description")).toHaveText(remoteBook.description);
  338 |   await expect(detail.locator(".detail-isbn")).toContainText(remoteBook.isbn);
  339 |   await expect(detail.locator(".detail-stock")).toContainText(/hết hàng/i);
  340 |   await expect(detail.locator("#buyBook")).toBeDisabled();
  341 | });
  342 | 
  343 | test("API metadata replaces static book details without losing inventory or publisher", async ({ page }) => {
  344 |   const updatedBook = {
  345 |     ...remoteBook,
  346 |     title: "Nhà giả kim",
  347 |     author: "Updated Writer",
  348 |     publisher: "Updated Press",
```