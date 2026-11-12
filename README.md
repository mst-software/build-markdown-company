# build-markdown-document

Chuyển file Markdown (`.md`) thành PDF đẹp, có trang bìa, logo MST Software, mục lục có số trang, đánh số tiêu đề, hộp lưu ý, chú thích hình/bảng.

## Cấu trúc thư mục

```
build-markdown-document/
├─ md2pdf.bat              Kéo thả file .md lên đây để ra PDF
├─ package.json            Cấu hình npm và các lệnh tắt
├─ README.md               File này
├─ src/
│  ├─ md2pdf.js            Mã nguồn chính (CLI)
│  └─ style.css            Giao diện PDF (màu, font, bảng, hộp lưu ý...)
├─ assets/
│  └─ logo.png             Logo công ty (đổi logo: thay file này)
├─ docs/
│  ├─ AI-MARKDOWN-RULES.md Luật để AI viết Markdown đúng chuẩn tool
│  └─ template.md          File mẫu chuẩn (nằm trong luật ở trên)
└─ examples/
   └─ sample/              Ví dụ thật: sample.md + thư mục images/
```

## Cài đặt (một lần)

```powershell
npm install
```

Cần Node.js 18 trở lên và Chrome hoặc Edge trên máy. Nếu không tìm thấy trình duyệt, đặt biến môi trường `CHROME_PATH` trỏ tới file chạy của trình duyệt.

## Cách dùng

```powershell
# Chuyển một file (PDF sinh ra cùng thư mục với file .md)
node src/md2pdf.js duong-dan/file.md

# Chọn tên file xuất, bật mục lục
node src/md2pdf.js file.md --toc -o ketqua.pdf

# Lệnh tắt
npm run pdf -- file.md        # tương đương node src/md2pdf.js file.md
npm run template              # xuất docs/template.md
npm run example               # xuất examples/sample/sample.md
```

Hoặc kéo thả file `.md` lên `md2pdf.bat`.

### Tuỳ chọn

| Tuỳ chọn | Ý nghĩa |
|---|---|
| `-o, --output <file.pdf>` | Tên file xuất (khi chỉ có 1 file đầu vào) |
| `--toc` | Thêm mục lục có số trang |
| `--no-cover` | Bỏ trang bìa |
| `--no-numbering` | Không đánh số tiêu đề |
| `--author`, `--subtitle`, `--kicker`, `--company` | Thông tin trên trang bìa |
| `--logo <file.png>` | Dùng logo khác |
| `--format <A4\|Letter>` | Khổ giấy |
| `--css <file.css>` | CSS bổ sung |
| `--no-page-numbers` | Không hiện số trang |

Thông tin bìa cũng có thể đặt ngay trong file `.md` bằng front-matter (xem `docs/template.md`). Tham số dòng lệnh luôn ghi đè front-matter.

## Viết Markdown bằng AI

Đưa file `docs/AI-MARKDOWN-RULES.md` cho AI trước khi nhờ viết tài liệu. File này mô tả chính xác cú pháp tool hiểu (front-matter, bảng, hình, sơ đồ mermaid, hộp lưu ý) và những thứ bị cấm.

## Chỉnh giao diện

Sửa `src/style.css`. Bảng màu thương hiệu nằm ở các biến `--blue`, `--cyan`, `--navy` đầu phần "Content" và phần "Cover".
