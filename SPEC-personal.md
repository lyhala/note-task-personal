# Spec bản cá nhân: Note, Reminder, Lịch

Cập nhật: 2026-10-23

Bản này dành cho app dùng cá nhân và bạn bè, không có giao việc nhóm. Nó là một bản riêng, không thay thế `SPEC.md` (bản đầy đủ có task nhóm, vai trò, thống kê, server công ty). `SPEC.md` được giữ nguyên để dùng sau nếu cần.

## Tổng quan và mục tiêu

Một app desktop (Windows, Mac) gom note dạng tờ giấy dán màn hình, reminder và lịch vào một nơi, kèm màn My day cho biết hôm nay có gì. Dùng cho cá nhân và bạn bè, không thương mại.

Mục tiêu:

- Nhắc việc đủ nổi bật để không bị bỏ sót: reminder đến giờ thì hiện thành tờ giấy nổi trên màn hình.
- Ghi chú nhanh, đẹp, dễ nhìn, không giống các app sticky note cũ kỹ.
- Một nơi xem lịch và việc cần làm hôm nay.
- Không cần server, không cần tên miền. Dữ liệu nằm trên máy và trên Google Drive của chính người dùng.

## Giả định đã đặt (bạn kiểm tra)

- Bản đầu chỉ có desktop. Không làm web. Mobile làm sau (xem mục Phát hành và giai đoạn sau).
- Mỗi người dùng dữ liệu riêng. Không chia sẻ note giữa người với người.
- Dùng được ngay không cần đăng nhập (chỉ lưu trên máy). Đăng nhập Google để bật đồng bộ Drive và Google Calendar.
- Reminder thay cho Self Task của bản cũ. Không có task giao cho người khác, không nghiệm thu, không thống kê.
- Dùng nhiều máy nên đồng bộ qua Drive được thiết kế từ đầu (làm ở giai đoạn 4).

## Phạm vi

- Nền tảng: app desktop Windows 10 trở lên và macOS.
- Ngôn ngữ giao diện: tiếng Việt, thiết kế sẵn để thêm tiếng Anh sau.
- Quy mô: một người, vài nghìn note và reminder.

## Dữ liệu và đồng bộ

Không có server. Hai nơi lưu dữ liệu:

- **Trên máy:** SQLite, là nơi app đọc ghi hằng ngày. Mất mạng vẫn dùng bình thường.
- **Trên Google Drive của người dùng:** thư mục ẩn của app (`appDataFolder`), chỉ app này thấy, người dùng không thấy trong Drive thường. Bạn (người làm app) không truy cập được dữ liệu của người dùng.

Cách đồng bộ:

- Đăng nhập Google một lần để bật đồng bộ. Chưa đăng nhập thì mọi thứ vẫn chạy local.
- Mỗi note, reminder lưu thành một file JSON riêng trên Drive, có số phiên bản định dạng và thời điểm sửa. Định dạng ghi rõ, không phụ thuộc Electron, để bản mobile sau này đọc được.
- App đồng bộ khi mở, khi có thay đổi, và mỗi vài phút khi đang chạy, dùng cơ chế lấy thay đổi của Drive.
- Xung đột: bản sửa sau cùng thắng với trường đơn giản (hạn, tick xong). Với nội dung note, nếu hai máy cùng sửa thì giữ cả hai bản và báo người dùng chọn.
- Xóa là đánh dấu đã xóa (để máy khác biết), dọn hẳn sau 30 ngày (thùng rác). "Xóa hẳn" trong thùng rác cũng lan sang Drive và các máy khác ở lần đồng bộ kế tiếp.

Chi tiết đồng bộ (đã làm ở giai đoạn 4):

- File trên Drive tên `note-<id>.json`, `folder-<id>.json`, `reminder-<id>.json`, mỗi file có số phiên bản định dạng (`format`) và dữ liệu đầy đủ. App gặp file có phiên bản mới hơn chính nó thì bỏ qua, không ghi đè, và báo người dùng cập nhật app.
- Không đồng bộ: cài đặt giao diện, thông báo trong app, vị trí sticky, và mốc nhắc của từng máy (đã nhắc lúc nào, đang hoãn đến khi nào) để mỗi máy tự nhắc và tự hoãn. Reminder mới nhận về máy mới không bị coi là "đã lỡ nhắc".
- Khi đồng bộ: sau khi mở app vài giây, khoảng 8 giây sau mỗi lần có thay đổi (gộp nhiều thay đổi làm một lần), mỗi 3 phút khi app chạy, và khi bấm "Đồng bộ ngay". Chỉ lấy phần thay đổi bằng token của Drive, không liệt kê lại toàn bộ.
- Xung đột: trường đơn giản, folder và reminder thì bản sửa sau cùng thắng. Nếu hai máy cùng sửa nội dung một note (tiêu đề, chữ hoặc nét vẽ), app giữ cả hai: bản từ Drive vào note gốc, bản trên máy này thành một note riêng có tên kết thúc bằng "(bản trên máy này)" và hiện thanh cảnh báo vàng với hai nút "Giữ bản này" (thay vào note gốc, bản kia vào thùng rác) và "Giữ bản gốc" (bản này vào thùng rác).
- Đăng nhập: trình duyệt hệ thống, địa chỉ nhận mã `127.0.0.1` cổng ngẫu nhiên, PKCE. Refresh token lưu mã hóa bằng kho khóa của hệ điều hành. Token hết hạn hoặc bị thu hồi thì app báo "đăng nhập lại", dữ liệu trên máy không mất.
- Khóa Google (client ID, client secret) đọc từ file `.env` lúc build, không commit vào git.
- File đính kèm nhỏ (tối đa khoảng 10 MB) lưu trong thư mục ẩn; file lớn dùng link Google Drive.
- Xuất toàn bộ dữ liệu ra file và nhập lại từ file, để sao lưu và chuyển máy khi không dùng Drive.

## Note

Note là một tờ giấy có tiêu đề; để trống thì lấy dòng đầu của nội dung. Nút + để thêm note mới, phím tắt toàn cục cũng tạo được (xem Tính năng desktop).

| Thuộc tính tờ giấy | Lựa chọn | Mặc định |
| --- | --- | --- |
| Kích thước | Chọn trong menu thả xuống (hiện 3 cỡ có sẵn), hoặc kéo mép tờ để chỉnh tự do (menu hiện "Tùy chỉnh") | Vừa (A6) |
| Màu giấy | Bảng màu | Trắng |
| Hoa văn | Trắng tinh, Chấm bi, Kẻ ngang mờ | Trắng tinh |
| Font chữ | 4 font, chọn cho cả tờ | Be Vietnam Pro |

Ba cỡ giấy có sẵn, giữ đúng tỉ lệ giấy thật:

| Cỡ | Tham chiếu | Kích thước thật | Hiển thị khoảng |
| --- | --- | --- | --- |
| Nhỏ | Giấy note vuông | 76 × 76 mm | 290 × 290 px |
| Vừa | A6 | 105 × 148 mm | 400 × 560 px |
| Lớn | A5 | 148 × 210 mm | 560 × 795 px |

Màn hình thấp hơn 795 px thì tờ cỡ Lớn tự thu nhỏ vừa khung nhìn, vẫn giữ tỉ lệ.

Nội dung văn bản:

- Font: Be Vietnam Pro (không chân), Lora (có chân), Patrick Hand (viết tay), Roboto Mono (đơn cách). Đều miễn phí, hỗ trợ tiếng Việt, đóng gói sẵn trong app. Không thêm font tùy ý, không chỉnh cỡ chữ hay định dạng phức tạp, để note không thành trình soạn thảo văn bản.
- Dán link vào note thì thành chữ bấm được.
- Đính kèm file: gắn vào tờ giấy dưới dạng thẻ nhỏ hiện tên và biểu tượng loại file.

Viết và vẽ:

- Mỗi tờ có chế độ viết hoặc vẽ trực tiếp bằng chuột hoặc bút (pen), bật tắt được.
- Công cụ: bút thường, bút highlight, hình dạng, icon, chèn ảnh, tẩy, chọn vùng, hoàn tác, copy một vùng và paste lại.
- Nét mảnh và nét đậm là hai nút riêng, nút đang chọn được tô sáng (áp dụng cho bút và hình dạng).
- Màu: vài màu cơ bản có sẵn (bút 6 màu, highlight 4 màu) và một nút color wheel để chọn màu bất kỳ.
- Bút highlight có nét to, màu trong, đè lên chữ hoặc nét vẽ mà không che nội dung bên dưới.
- Chọn vùng: khoanh một vùng hoặc bấm vào một hình/ảnh để chọn. Đối tượng đang chọn kéo để di chuyển, kéo ô vuông ở góc dưới để đổi cỡ (giữ tỉ lệ), có thể sao chép hoặc xóa. Sao chép rồi dán vào chỗ khác trên cùng tờ hoặc sang tờ khác (kể cả sang cửa sổ sticky).
- Nét vẽ lưu dạng dữ liệu vector cùng note. Văn bản và nét vẽ cùng nằm trên một tờ giấy.

Hình dạng, icon và ảnh:

- Hình dạng như trong Paint: chữ nhật/vuông, tròn/elip, tam giác, hình thoi, ngôi sao, đường thẳng, mũi tên. Kéo để vẽ; bấm một lần thì ra hình cỡ mặc định. Tùy chọn tô đặc hoặc chỉ viền, nét mảnh hoặc đậm, chọn màu.
- Icon: một bộ icon cơ bản có sẵn (ví dụ ⭐ ❤️ ✅ ❌ 💡 🔔 📅 🔥), 3 cỡ. Chọn icon rồi bấm vào tờ giấy để đặt.
- Chèn ảnh từ máy bằng nút chèn ảnh hoặc kéo-thả file vào tờ giấy. Ảnh được thu nhỏ (cạnh dài tối đa 900 px) và lưu cùng note để file không phình to.
- Thứ tự lớp: hình dạng, icon và ảnh nằm dưới chữ, nên chữ gõ trên tờ đè lên được hình và ảnh. Bút và highlight nằm trên chữ.

Thu nhỏ, ghim, folder:

- Tờ note thu nhỏ được thành một badge hình chữ nhật nhỏ như mẩu giấy, hiện tiêu đề. Bấm vào badge để mở lại đúng vị trí và kích thước trước đó.
- Note quan trọng được ghim bằng nút ghim trên tờ giấy. Dấu đánh dấu trang màu neon chỉ hiện trên badge khi note được thu nhỏ; tờ note đang mở thì không có dấu này, chỉ đổi biểu tượng nút ghim, để không vướng nội dung. Bấm lại nút ghim để gỡ. Note ghim xếp lên đầu; nhiều note ghim thì ghim sau lên trước.
- Lọc theo từ khóa: ô lọc ở đầu màn hình Note, áp dụng cho mục đang xem (Tất cả hoặc một folder). Khớp theo tiêu đề và nội dung chữ, không phân biệt hoa thường và dấu tiếng Việt (gõ "nguyen" vẫn thấy "Nguyễn"); gõ nhiều từ thì note phải chứa đủ các từ. Hiện số kết quả, nhấn Esc để xóa bộ lọc. Tạo note mới thì bộ lọc tự xóa. Nét vẽ không lọc được.
- Người dùng tự tạo, đổi tên, xóa folder. Chuyển note vào folder bằng kéo thả hoặc menu. Note chưa thuộc folder nào nằm ở mục Tất cả. Xóa folder thì các note bên trong không bị xóa, tự về mục Tất cả.
- Thùng rác giữ note đã xóa 30 ngày.

Nhắc việc từ note:

- Mỗi note có nút Remind. Bấm vào, chọn ngày (và giờ nếu muốn), hệ thống tự tạo một reminder lấy tiêu đề note làm tên, có link về note gốc. Dành cho lúc đang vội ghi note mà chưa kịp tạo reminder.

## Reminder

Reminder là một việc cần nhớ, có hoặc không có thời điểm nhắc. Đây là chỗ thay cho task: chỉ của riêng bạn, không giao cho ai.

| Trường | Mô tả |
| --- | --- |
| Tiêu đề | Bắt buộc |
| Ghi chú | Văn bản; import được nội dung từ một note |
| Thời điểm | Ngày, giờ tùy chọn. Có thể không có thời điểm |
| Lặp lại | Không, hằng ngày, hằng tuần, hằng tháng, tùy chọn |
| Nhắc hàng ngày | Ô tick; nhắc lúc 9:00 sáng mỗi ngày |
| Ngôi sao | Đánh dấu việc quan trọng |
| Note gốc | Link về note nếu tạo từ nút Remind |
| Đính kèm | Link hoặc file |

Hành vi:

- Reminder thường: tick là xong, chuyển sang tab Đã xong. Mở lại được.
- Reminder lặp lại và reminder nhắc hàng ngày: tick thì gạch đi cho hôm đó, không tick thì cứ để đó. Hôm sau hiện lại. Tắt tick Nhắc hàng ngày để dừng.
- Hạn tính đến hết ngày (23:59) nếu chỉ có ngày; có giờ thì theo giờ. Quá hạn thì đổi màu và vẫn hiện trong My day cho đến khi tick.
- Danh sách: Tất cả (mặc định, gồm mọi reminder: quá hạn, hôm nay, sắp tới, không hạn, đã xong ở cuối), Hôm nay, Sắp tới, Không hạn, Quá hạn, Đã xong. Reminder có ngôi sao hiện đầu danh sách.
- Từ một reminder tạo được một note (nút 📝): note lấy tiêu đề và ghi chú của reminder để người dùng thêm nội dung, hai bên gắn với nhau (reminder hiện liên kết "Note gốc"). Trên dòng reminder không có nút mở thành sticky nổi; sticky nổi chỉ dành cho note và cho tờ nhắc tự bật khi đến giờ.
- Hoãn nhắc (snooze): 10 phút, 1 giờ, ngày mai.
- Reminder có giờ cũng hiện trên lịch. Tùy chọn từng reminder: đẩy sang Google Calendar thành sự kiện (khi đã kết nối Google).

## Lịch và Google Calendar

Lịch hiển thị sự kiện và reminder có giờ, xem theo Ngày, Tuần, Tháng.

Sự kiện gồm: tiêu đề, giờ bắt đầu và kết thúc (hoặc cả ngày), địa điểm hoặc link họp, mô tả, lặp lại, giờ nhắc.

App làm việc trực tiếp với Google, không qua server. Ba chế độ:

- **Chưa kết nối Google:** lịch trong app, chỉ lưu trên máy và đồng bộ qua Drive.
- **Kết nối Google Calendar (OAuth), đồng bộ hai chiều:** chọn lịch muốn đồng bộ. Sự kiện từ Google hiện trong app; tạo, sửa, xóa trong app thì đẩy lên Google và ngược lại. Phải xử lý sự kiện lặp, múi giờ và sự kiện bị xóa. App đồng bộ khi mở và mỗi vài phút khi đang chạy.
- **Dán link iCal bí mật (đồng bộ một chiều, chỉ đọc):** cho người không muốn cấp quyền OAuth. Không tạo hay sửa được sự kiện trên Google; Google làm mới link chậm (vài giờ hoặc hơn). Link lưu mã hóa trên máy; đổi link trên Google để thu hồi.

Tài khoản (quyết định 2026-10-27):

- Đăng nhập đồng bộ Drive (giai đoạn 4) và kết nối Google Calendar (giai đoạn 5) là hai kết nối độc lập, có thể dùng hai tài khoản Google khác nhau. Kết nối đồng bộ chỉ xin quyền `drive.appdata`; kết nối lịch mới xin quyền `calendar`.
- Người dùng này dùng mail công ty (Google Workspace) cho lịch. Project Google Cloud và client ID do một Gmail cá nhân tạo (loại External, Desktop app) để tránh chính sách tổ chức; mail công ty được thêm vào Test users. Nếu admin công ty chặn app bên thứ ba hoặc quyền `calendar` thì có hai đường lui: nhờ admin cho phép client ID, hoặc dùng link iCal chỉ đọc.
- Cập nhật 2026-10-27: người dùng chọn dùng **mail công ty cho cả đồng bộ Drive và Calendar** (một tài khoản). Dữ liệu đồng bộ nằm trong khu vực ẩn của Drive công ty, chịu chính sách của admin và mất khi tài khoản bị khóa. App vẫn giữ hai kết nối độc lập nên đổi sang tài khoản khác hoặc tách ra dùng Gmail cá nhân cho Drive bất cứ lúc nào bằng Đăng xuất rồi Đăng nhập lại. Nếu admin chặn app bên thứ ba thì đường lui là dùng Gmail cá nhân cho Drive.

Khác:

- Bật hoặc tắt hiển thị từng lịch, mỗi lịch một màu.
- Nhắc lịch: lấy giờ nhắc đã đặt trên sự kiện ở Google nếu có; chưa có thì dùng mặc định trong cài đặt app (ví dụ 15 phút). Nhắc đặt hoặc sửa trong app thì đẩy lên Google.
- Người tham dự lấy từ sự kiện Google, hiện ở My day.

## My day

My day là màn hình gom mọi thứ cần chú ý trong hôm nay, gồm hai nguồn:

- Reminder: quá hạn chưa xong, đến hạn hôm nay, các reminder nhắc hàng ngày (nhắc lúc 9:00 sáng), và reminder của các ngày tới gom theo từng ngày. Số ngày tới mặc định là 3, người dùng chỉnh trong cài đặt (0 đến 30, 0 là chỉ hiện hôm nay). Reminder lặp hiện ở mỗi ngày nó rơi vào; lần kế tiếp tick được, các lần sau chỉ để xem. Tick để xong hoặc gạch đi.
- Lịch hôm nay: có meeting nào, lúc mấy giờ, gặp ai (người tham dự).

Là màn hình đầu tiên sau khi mở app. Khi app desktop khởi động cùng máy, cửa sổ gọn của My day bật lên giữa màn hình; bấm Expand để mở full màn hình.

## Thông báo

| Sự kiện | Trong app | Sticky nổi và thông báo hệ điều hành |
| --- | --- | --- |
| Reminder đến giờ | Có | Có |
| Reminder nhắc hàng ngày, 9:00 sáng | Có | Có |
| Reminder quá hạn | Có | Có |
| Sự kiện lịch sắp bắt đầu | Có | Có |
| Reminder lỡ lúc app đóng | Có (hiện khi mở app) | Có, khi mở app |

Quy ước nhắc (đã chọn khi làm giai đoạn 3):

- Reminder có giờ thì nhắc đúng giờ đó. Reminder chỉ có ngày thì nhắc lúc 9:00 sáng ngày đó.
- Reminder quá hạn mà chưa tick thì nhắc lại lúc 9:00 mỗi ngày sau hạn. Reminder có bật "Nhắc hàng ngày" nhắc lúc 9:00 mỗi ngày cho tới khi tick.
- Hoãn nhắc thì tạm im, hết giờ hoãn sẽ nhắc lại một lần.
- Mốc nhắc trễ quá 2 phút (app đóng lúc đó) được coi là "đã lỡ": chỉ ghi vào trung tâm thông báo, kèm một thông báo hệ điều hành tóm tắt khi mở app, không bật sticky. Mỗi reminder chỉ giữ tối đa 3 mốc lỡ gần nhất.
- Giờ yên lặng (bật tắt trong cài đặt, mặc định tắt, ví dụ 22:00 đến 07:00): vẫn ghi vào trung tâm thông báo nhưng không bật sticky nổi và không gửi thông báo hệ điều hành.
- Bộ lập lịch kiểm tra mỗi 15 giây khi app chạy nền.

- Không có kênh email, vì không có server.
- **Nhắc chạy bằng app trên máy, nên app phải đang chạy nền (ở khay hệ thống).** Máy tắt hoặc app thoát thì không có nhắc; lần mở sau app liệt kê những reminder đã lỡ.
- Hoãn nhắc: 10 phút, 1 giờ, ngày mai.
- Giờ yên lặng: không bật nhắc nổi ngoài giờ đã đặt.
- Trung tâm thông báo trong app, có trạng thái chưa đọc.

## Tìm kiếm

Có hai mức:

- Lọc theo từ khóa ngay trong màn hình Note (xem mục Note), có từ giai đoạn 1.
- Tìm kiếm toàn cục (Ctrl hoặc Cmd + K) quét note, reminder và sự kiện, lọc theo loại. Nét vẽ không tìm được. Tìm trong dữ liệu trên máy. Làm ở giai đoạn 6, dùng lại cách khớp không phân biệt dấu của ô lọc.

## Tính năng riêng của app desktop

- Khởi động cùng máy (mặc định bật): app bật lên giữa màn hình ở cửa sổ gọn hiện My day, bấm Expand để mở full màn hình.
- Sticky nổi: mở bất kỳ note hoặc reminder thành cửa sổ nhỏ riêng, luôn nằm trên cùng (có thể tắt), kéo thả tự do, nhớ vị trí, kích thước và màn hình, thu nhỏ được, mở nhiều tờ cùng lúc.
- Nhắc việc thành sticky: đến giờ nhắc, reminder tự hiện thành tờ note nổi giữa màn hình. Tick xong thì tờ biến mất. Reminder quá hạn đổi màu.
- Phím tắt toàn cục (đổi được): tạo note mới, mở tìm kiếm, hiện hoặc ẩn mọi sticky.
- Chạy nền ở khay hệ thống; đóng cửa sổ chính không thoát app.
- Thông báo của hệ điều hành.
- Tự cập nhật khi có bản mới, báo người dùng trước khi khởi động lại.

## Giao diện

Thanh bên có bốn mục: My day, Note, Reminder, Calendar.

- Phong cách chung: pastel mềm, thẻ bo tròn, bóng nhẹ, thanh bên tím nhạt nổi lên như một tấm riêng. My day là màn dashboard chính. Không làm thẻ thống kê hay biểu đồ năng suất.
- Chế độ Sáng, Tối hoặc theo hệ thống, chọn độc lập với tông màu.
- Tông màu gợi ý (Tím, Bạc hà, Hồng đào, Xanh trời), mỗi tông có bản sáng và bản tối riêng; chế độ Sáng/Tối quyết định dùng bản nào. Ngoài ra người dùng tự chọn màu nền và màu nút (mục "Tự chọn màu"); đổi chế độ hoặc tông thì bỏ màu tự chọn để thay đổi có tác dụng ngay.
- Giao diện và cài đặt mở thành một hộp thoại giữa màn hình, không mở lấn trong thanh bên.
- Nút bấm có độ nổi nhẹ (viền đáy mỏng, bóng mềm, ấn xuống thì lún), nút chính tô màu nhấn. Nút nhỏ nằm trong thẻ hoặc trên tờ note giữ phẳng cho đỡ rối.
- Mọi hộp và thẻ trong app (thanh bên, thẻ My day, lịch, thẻ con mèo, dòng reminder, hộp cài đặt, hộp thoại, bảng hồ sơ) dùng chung một kiểu nổi nhẹ: vệt sáng mỏng ở mép trên, viền đáy mỏng và bóng mềm theo màu nhấn, để các thành phần đồng bộ ở cả chế độ sáng và tối.
- Bố cục thanh bên từ trên xuống: hồ sơ, rồi menu (My day, Note, Reminder, Calendar, Thông báo, Giao diện & cài đặt). Notification (thông báo) và Setting (giao diện và cài đặt) là hai trang riêng như các mục khác, tên mục để tiếng Anh: bấm vào thì mục bên trái chuyển màu đậm và trang hiện ở giữa.
- My day bố cục 3 phần như ảnh minh họa: lời chào ở trên; ở giữa là các thẻ task (Quá hạn, Hôm nay, các ngày tới); cột bên phải phía trên là lịch tháng nhỏ (đánh dấu hôm nay, chấm những ngày có reminder chưa xong, chuyển tháng bằng mũi tên; thẻ lịch tự giãn cao để lấp chỗ trống giữa lịch và thẻ động viên), phía dưới cùng là thẻ động viên: hình con mèo xám đất sét ôm trái tim kèm dòng chữ "You're doing amazing! Keep up the good work" (một ảnh có sẵn chữ, cố định, không đổi theo tình hình). Cửa sổ gọn khi khởi động cùng máy chỉ hiện phần task. Thẻ chỉ nằm ở My day, không có ở thanh bên. Khi bấm vào Note, danh sách folder (Tất cả, các folder, Thùng rác) xổ ra thành một nhánh ngay dưới mục Note.
- Thanh bên có hồ sơ ở đầu: avatar tròn và lời chào theo tên. Avatar hiển thị lớn (136 px). Avatar mặc định là ảnh cô bé đất sét (áo len tím, vẫy tay); không có avatar vẽ sẵn nào khác. Bấm vào avatar mở bảng hồ sơ: đặt tên hiển thị, chọn ảnh mặc định hoặc tải ảnh của mình qua ô "Tải ảnh lên", rồi bấm Lưu mới áp dụng (Hủy hoặc đóng thì bỏ thay đổi) (ảnh được cắt vuông và thu về 256 px). Tên hiển thị cũng xuất hiện ở lời chào của My day.
- Icon của các mục menu là bộ icon riêng (ô vuông bo tròn tô màu nhạt, hình bên trong tô gradient), vẽ bằng SVG.
- Chỉ dùng màu trơn, không có ảnh nền hay họa tiết, để giao diện không rối mắt (avatar và mascot là hình minh họa nhỏ, không phải nền).
- Màu giấy của note độc lập với màu nền app.
- Dùng biến CSS cho màu để đổi theme dễ.
- Giao diện responsive ngay từ đầu, để bản mobile về sau dùng lại được.

## Công nghệ

| Phần | Công nghệ | Ghi chú |
| --- | --- | --- |
| App desktop | Electron (electron-builder, electron-updater), React với TypeScript, Vite | Build .exe cho Windows và .dmg cho Mac |
| Dữ liệu trên máy | SQLite | Nguồn đọc ghi hằng ngày; hoạt động offline |
| Đồng bộ | Google Drive API, thư mục ẩn `appDataFolder` | Mỗi note, reminder một file JSON có phiên bản định dạng |
| Đăng nhập | Google OAuth cho ứng dụng cài trên máy (PKCE, trình duyệt hệ thống) | Token lưu bằng kho khóa của hệ điều hành |
| Lịch | Google Calendar API, đồng bộ hai chiều bằng sync token; link iCal một chiều | App làm việc trực tiếp với Google, không qua server |
| File đính kèm | Link Google Drive, hộp chọn file của Google (quyền `drive.file`) | File nhỏ lưu trong thư mục ẩn |
| Vẽ trên note | Canvas, Pointer Events (chuột và bút) | Nét vẽ lưu dạng vector |
| Font | Be Vietnam Pro, Lora, Patrick Hand, Roboto Mono | Đóng gói sẵn trong app |
| Cập nhật app | electron-updater qua GitHub Releases | Repo private; tắt trong bản Store |
| Bản Mac | Build bằng GitHub Actions, không ký | Mở lần đầu bằng chuột phải, chọn Open |

Nguyên tắc dựng để sau này làm mobile dễ:

- Tách phần dữ liệu và đồng bộ (mô hình note, reminder, định dạng file trên Drive, logic xung đột) thành một gói riêng bằng TypeScript, không phụ thuộc Electron hay giao diện. Phần lưu trữ đi qua một lớp trung gian để desktop dùng SQLite, mobile dùng cách khác.
- Phần giao diện React tách khỏi phần chỉ có desktop (sticky nổi, khay hệ thống, phím tắt toàn cục).
- Định dạng dữ liệu trên Drive có số phiên bản, đọc được bởi mọi bản.

## Phát hành

- Bản đầu: file .exe và .dmg phát bằng GitHub Releases, tự cập nhật bằng electron-updater.
- Windows không ký thì người dùng thấy cảnh báo SmartScreen (More info, Run anyway). Mac không ký thì mở lần đầu bằng chuột phải, chọn Open.
- Chi phí bản đầu: gần như 0.

Giai đoạn sau, chưa làm:

- **Microsoft Store:** đóng gói MSIX bằng electron-builder, Store tự ký nên không còn cảnh báo SmartScreen. Bản Store phải tắt electron-updater. Không cài cả bản Store và bản exe trên cùng một máy.
- **Mobile (App Store, Google Play):** app riêng, nên bọc phần giao diện React bằng Capacitor và dùng lại gói dữ liệu và đồng bộ. Mobile đọc ghi cùng thư mục ẩn trên Drive nên note và reminder giống nhau trên mọi máy. Nhắc việc dùng thông báo cục bộ của điện thoại. Bản mobile không có sticky nổi, khay hệ thống, phím tắt toàn cục.
- Chi phí và thủ tục (kiểm tra lại khi làm): Apple Developer khoảng 99 USD/năm, build iOS cần Mac hoặc dịch vụ build đám mây, phải qua kiểm duyệt, có quy định về đăng nhập bên thứ ba. Google Play khoảng 25 USD trả một lần, tài khoản cá nhân mới thường phải chạy thử với nhóm người test trước khi phát hành chính thức. Cả hai cần trang chính sách quyền riêng tư (đăng trên GitHub Pages miễn phí được).
- **Phát hành công khai thì Google Calendar phải qua xác minh.** Lên Store là ai cũng tải được, vượt giới hạn 100 người của app chưa xác minh. Cách làm: phát hành bản đầu chỉ có Note và Reminder, thêm Calendar sau khi xác minh xong, hoặc cho người dùng dùng link iCal.

## Ngoài phạm vi và lộ trình

Chưa làm:

- Giao việc cho người khác, nghiệm thu, thống kê, nhóm, vai trò, phân quyền.
- Bản web.
- Chia sẻ note giữa người với người, nhiều người cùng gõ một trang.
- Soạn tài liệu kiểu Notion, Kanban, chat.
- Nhắc việc bằng email hoặc thông báo đẩy khi máy tắt (cần server).

Lộ trình theo giai đoạn (xong từng giai đoạn thì dừng để chạy thử):

1. Nền tảng desktop: Electron, React, SQLite; Note (tờ giấy, văn bản, màu, hoa văn, font, kích thước, folder, ghim, badge, thùng rác, lọc theo từ khóa); theme Sáng, Tối và màu tùy chỉnh.
2. Vẽ và đặc trưng desktop: vẽ và highlight, hình dạng, icon, chèn ảnh, chọn/di chuyển/đổi cỡ, copy vùng; sticky nổi, khay hệ thống, phím tắt toàn cục, khởi động cùng máy.
3. Reminder, thông báo và My day cơ bản: reminder, lặp lại, nhắc hàng ngày 9:00, hoãn nhắc, nút Remind trên note, thông báo, My day.
4. Đăng nhập Google và đồng bộ Drive.
5. Lịch: lịch trong app, Google Calendar hai chiều, link iCal, My day đầy đủ (có lịch hôm nay và người tham dự).
6. Hoàn thiện: tìm kiếm toàn cục, xuất và nhập dữ liệu, tự cập nhật app, đính kèm file và chọn file từ Drive.
7. Sau này: Microsoft Store, mobile.

## Trạng thái triển khai (cập nhật 2026-10-27)

- **Giai đoạn 5 (Lịch):** đã làm lịch trong app (ngày/tuần/tháng), sự kiện lặp, nhắc sự kiện (trong app, sticky, thông báo hệ điều hành), My day có "Lịch hôm nay", Google Calendar và link iCal. Google Calendar làm theo kiểu ghi thẳng: app lấy sự kiện trong khoảng khoảng 45 ngày trước đến 180 ngày sau về lưu đệm (làm mới mỗi 3 phút), tạo/sửa/xóa gọi thẳng API nên cần có mạng; sự kiện lặp của Google hiện từng lần, sửa hoặc xóa chỉ tác động đúng lần đó. Reminder có thể tick "Hiện cả trên Google Calendar" để tạo sự kiện ở lịch chính. Link iCal bí mật chỉ đọc, lưu mã hóa bằng kho khóa hệ điều hành (không vào SQLite hay Drive), tải lại mỗi 3 phút. Lịch Google/iCal chỉ là bản đệm, không đồng bộ qua Drive.
- **Giai đoạn 6:** tìm kiếm toàn cục Ctrl/Cmd+K (note, reminder, sự kiện, lọc theo loại, không phân biệt dấu; chưa có phím tắt toàn cục), xuất/nhập JSON (nhập là gộp, mục mới hơn thắng, không xóa gì, không gồm lịch Google/iCal), đóng gói `.exe` (NSIS) và `.dmg` bằng electron-builder, tự cập nhật qua GitHub Releases (tắt khi chạy bản dev hoặc bản Store), logo đất sét tím do người dùng cung cấp (`build/icon.png` 1024x1024, `resources/icon.png`, `resources/tray.png`). **Đính kèm file cho reminder:** file đến 10 MB được chép vào thư mục dữ liệu của app và (nếu đã đăng nhập Google) đẩy lên thư mục ẩn trên Drive, máy khác mở lần đầu thì tải về; file lớn hơn thì dán link Google Drive (hoặc link bất kỳ) vào mục "Thêm link". **Chưa làm: hộp chọn file Google Drive (Picker, quyền `drive.file`)**, vì cần thêm API key và trang web phụ; dán link đủ dùng. Xóa reminder không xóa file đính kèm đã đẩy lên Drive.
- **Lặp lại của reminder (sửa 2026-10-28):** Không lặp thì chỉ có ngày và giờ tùy chọn, kèm tùy chọn "nếu chưa tick, nhắc thêm mỗi sáng 9:00" (chỉ hiện ở Không lặp). Hằng ngày: chọn giờ. Hằng tuần: chọn một hoặc nhiều thứ và giờ. Hằng tháng: chọn một ngày cố định (31 thì tháng ngắn lấy ngày cuối) hoặc thứ n của tháng (ví dụ thứ Hai đầu tiên, thứ Sáu cuối cùng), và giờ. Tùy chọn: mỗi n ngày/tuần/tháng. Khi bật "Hiện cả trên Google Calendar", bản reminder được ẩn khỏi lưới lịch để không hiện trùng với sự kiện Google tương ứng.
- **Giai đoạn 7:** đã cấu hình target `appx` (MSIX) cho Microsoft Store, cần điền `identityName`, `publisher`, `publisherDisplayName` lấy từ Partner Center rồi chạy `npm run dist:store`; chưa kiểm chứng vì cần Windows SDK và tài khoản Store. Mobile (Capacitor) chưa làm: cần Android Studio/Xcode và tài khoản nhà phát triển; gói `src/core` đã tách khỏi Electron để dùng lại.
- **Phát hành cần điền:** trong `package.json` mục `build.publish` đã điền `lyhala/note-task-personal`. Bản `.dmg` phải build trên máy Mac hoặc GitHub Actions (chưa ký, người dùng phải bấm "Mở" lần đầu); bản `.exe` chưa ký nên SmartScreen sẽ cảnh báo.

## Còn cần chốt

- Cho dùng không đăng nhập (chỉ lưu trên máy) có ổn không. Hiện đang giả định là có.
- Google OAuth: app ở chế độ External. Khi còn ở trạng thái Testing, refresh token hết hạn sau 7 ngày (đã đối chiếu với tài liệu Google ngày 2026-10-27), phải đăng nhập lại mỗi tuần; chuyển sang In production thì hết giới hạn này nhưng quyền `calendar` sẽ hiện cảnh báo "chưa xác minh". Người dùng chọn cách nào thì ghi lại ở đây.
- Tên app.
- Reminder đã tick có xóa hẳn sau một thời gian không, hay giữ mãi ở tab Đã xong.
