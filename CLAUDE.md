# CLAUDE.md (bản cá nhân)

Đây là app desktop cá nhân gom Note (dạng tờ giấy dán màn hình), Reminder và Lịch, kèm màn My day. Spec đầy đủ nằm ở `SPEC-personal.md`: đọc nó trước khi làm bất cứ việc gì, và coi nó là nguồn sự thật. Nếu spec mâu thuẫn hoặc thiếu, hỏi tôi thay vì tự đoán.

## Công nghệ đã chốt (không tự đổi)

- App desktop: Electron, React, TypeScript, Vite. Build .exe cho Windows và .dmg cho Mac.
- Không có server, không có tên miền. Dữ liệu nằm ở SQLite trên máy và đồng bộ lên thư mục ẩn `appDataFolder` trên Google Drive của chính người dùng.
- Đăng nhập Google (OAuth cho ứng dụng cài trên máy, PKCE, mở trình duyệt hệ thống). Token lưu bằng kho khóa của hệ điều hành. Chưa đăng nhập vẫn dùng được, chỉ lưu local.
- Lịch: Google Calendar API gọi trực tiếp từ app, đồng bộ hai chiều. Có chế độ dán link iCal bí mật (một chiều, chỉ đọc) cho người không cấp quyền OAuth.
- File lớn: link Google Drive (quyền `drive.file`). File nhỏ lưu trong thư mục ẩn.
- Nhắc việc chạy bằng app trên máy (app chạy nền ở khay hệ thống). Không có email hay thông báo đẩy từ server.

## Nguyên tắc làm việc

- Làm theo thứ tự lộ trình trong `SPEC-personal.md` (mục "Ngoài phạm vi và lộ trình"). Xong từng giai đoạn thì dừng để tôi chạy thử.
- Tách gói dữ liệu và đồng bộ (mô hình note, reminder, định dạng file trên Drive, logic xung đột) khỏi giao diện và khỏi Electron, để sau này làm mobile dùng lại được. Phần lưu trữ đi qua một lớp trung gian. Định dạng file trên Drive có số phiên bản.
- Phần chỉ có desktop (sticky nổi, khay hệ thống, phím tắt toàn cục, khởi động cùng máy) tách riêng khỏi phần giao diện dùng chung.
- Tiếng Việt cho giao diện. Font Be Vietnam Pro, Lora, Patrick Hand, Roboto Mono, đóng gói sẵn trong app. Kiểm tra hiển thị câu nhiều dấu chồng (ví dụ "Nguyễn Thị Quyền chuyển về Việt Nam").
- Giao diện: nền màu trơn, không ảnh nền hay họa tiết. Người dùng đổi được màu nền và màu nút, có sẵn vài cặp màu gợi ý. Dùng biến CSS cho màu để đổi theme dễ. Màu giấy của note độc lập với màu nền app.
- Không thêm tính năng ngoài spec (giao task cho người khác, thống kê, bản web, chia sẻ note, Kanban, chat, soạn tài liệu kiểu Notion). Muốn thêm thì hỏi trước.
- Trước khi coi một việc là xong, chạy thử bằng cách thực tế (mở app, thao tác) chứ không chỉ build qua.
- Không bao giờ commit khóa bí mật (Google OAuth client secret nếu có, token). Dùng file `.env` và thêm vào `.gitignore`.

## Những chỗ còn mở

Xem mục "Còn cần chốt" trong `SPEC-personal.md`: dùng không đăng nhập, Google OAuth chế độ External cho Calendar (token hết hạn 7 ngày khi đang thử nghiệm), tên app, giữ reminder đã xong bao lâu.
