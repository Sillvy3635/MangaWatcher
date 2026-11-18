# MangaWatcher — ROADMAP

อัปเดต 18 พฤศจิกายน 2026 เป้าหมายคือระบบ private-first ค่าใช้จ่ายเป้าหมาย 0 บาท/เดือนภายใต้โควตาฟรีที่ตรวจใหม่ก่อนเปิดใช้ ไม่รับประกันว่าบริการจะฟรีตลอด

## Phase 0 — Local MVP เดิม (เสร็จ)

- Python Standard Library + SQLite, MangaDex/RSS/manual, alias mapping แบบยืนยันเอง, release แยกต้นทาง/ภาษา, scheduler local, RAW/ENG/TH และเลขตอนแปลล่าสุด
- คงฐานข้อมูล MangaPulse เดิมเป็น fallback ไม่ย้ายหรือลบข้อมูลผู้ใช้

## Phase 1 — ความเสถียรและงานแปล local (ทำแล้วบางส่วน)

- ทำแล้ว: adapter registry สำหรับ MangaDex/RSS, ปฏิเสธ XML ผิดรูปแบบ, ปิด redirect เมื่อ fetch, ตรวจทุกเรื่องที่ผูกแหล่งหรือเฉพาะที่ติดตาม, backoff แยกแหล่ง, เวลาตรวจถัดไป
- ทำแล้ว: คิวงานแปลราย release ID พร้อมสถานะ RAW, OCR, แปล, ตรวจคำ, ลงคำ, Publisher, เผยแพร่; ตอน RAW ใหม่ของเรื่องที่ติดตามเข้าคิวอัตโนมัติ โดยไม่รวมเรื่อง/ตอนกำกวมข้ามเว็บ
- ทำแล้ว: เปลี่ยนสถานะติดตามหลายเรื่องแบบ atomic, JSON export/import schema 2 พร้อม backup ก่อน restore และ rollback เมื่อ validation/foreign key ผิด, CSV release export ผ่าน UI
- ทำแล้ว: React/TypeScript/Vite + Tailwind + shadcn/ui components + Lucide dashboard ภาษาไทย dark default; fixed/collapsible sidebar, status bar, compact tables, search/sort/filter/pagination/bulk tracking, column visibility/resize และ localStorage preferences; build แล้ว local server เสิร์ฟ UI ใหม่, ไม่มี build จะใช้ UI เดิม
- ยังเหลือ: chapter identity สำหรับ season/part/special, user-confirmed duplicate matching, source rate limit ขั้นสูง, audit log การแก้ข้อมูล, browser QA หลายขนาดและอุปกรณ์จริง, นำเข้า CSV พร้อม preview, source adapter เฉพาะเว็บหลังเจ้าของให้ URL/สิทธิ์จริง
- ยังเหลือด้าน dependency: `npm audit` รายงาน 5 high จากสาย Vite/picomatch ใน toolchain รุ่นที่ติดตั้ง (registry ยังไม่มี picomatch รุ่นที่พ้น advisory ณ วันที่ตรวจ) จำกัด Vite dev server ไว้ที่ loopback และทบทวนก่อนใช้งาน cloud

## Phase 2 — Cloud แบบ private (โค้ดเตรียม Production แล้ว รอการตั้งค่า/ยืนยัน live)

- ทำแล้วในโค้ด: GitHub Pages frontend + Netlify Functions, GitHub OAuth state+PKCE, owner ID allowlist, signed app session สำหรับ Pages, CORS เฉพาะ Pages origin, Origin check, rate limit config, schema validation และ audit log การแก้ไข cloud; ยังไม่ผ่าน deployment/live verification
- ทำแล้วในโค้ด: GitHub private JSON store ผ่าน server-only token, commit ต่อ mutation, SHA conflict, export/import แบบตรวจรุ่น, ใช้ JSON schema 2 ที่ local export ได้; จำกัดไฟล์ 900 KB ตามรูปแบบ Contents API ที่ใช้ และเก็บประวัติ commit ไว้กู้คืน
- ยังเหลือ: ตั้งค่า Netlify site/OAuth/private repo/secret ในบัญชีเจ้าของ, deploy และทดสอบจริงบน PC/Android/iPhone, แยกข้อมูลเมื่อโตเกิน 900 KB, ทดสอบ conflict/live recovery, ตรวจโควตาและค่าใช้จ่ายจริง
- ทำแล้วในโค้ด: `deploy.yml` สำหรับ Pages และ `manga-update.yml` ทุก 60 นาทีสำหรับ MangaDex/RSS ที่ผู้ใช้กำหนด, HTTPS พร้อม DNS pinning/ปฏิเสธ private network และ redirect, GET retry, backoff ตามแหล่ง, dedup release, batch commit หลังตรวจ; ยังไม่ทดสอบ live/Actions จริง และยังไม่มี notification idempotency
- 18 พฤศจิกายน 2026: push โค้ดชุดแรกขึ้น `Sillvy3635/MangaWatcher` แล้ว (`c7933a2`); GitHub Actions รอบแรกหยุดที่การตรวจ `MW_API_ORIGIN` เพราะยังไม่มี URL Netlify Site ตั้งค่า Production ยังต้องทำต่อก่อนถือว่าออนไลน์
- 18 พฤศจิกายน 2026: เริ่ม private repo `Sillvy3635/MangaWatcher-Data` ด้วย README และ `.gitignore` เท่านั้น (`ba74ec7`); รอนำเข้า JSON schema 2 จากข้อมูลจริงหลัง API พร้อม
- Discord/Telegram แจ้งเตือนด้วย idempotency; Push ภายหลังเมื่อ auth, browser support และ device QA ผ่าน ไม่ใส่ secret ใน frontend

## Phase 3 — ประสบการณ์ผู้ใช้และข้อมูลขั้นสูง (ทำบางส่วน)

- ค้นหาเรื่องใหม่จาก feed/API ที่ได้รับอนุญาต, ปฏิทินแบบมีตัวกรอง, เปรียบเทียบตอนขาดจริง, สถานะ hiatus และประวัติการแก้ไข
- ทำแล้วในโค้ด: PWA manifest, PNG/SVG icons, service worker cache เฉพาะ static assets พร้อมเปลี่ยน cache ตาม build, Pages query route/404 fallback; ยังเหลือ IndexedDB cache/sync หลัง auth และทดสอบติดตั้ง/ออฟไลน์บนอุปกรณ์จริง
- ปรับ UI/table ด้วยข้อมูลจำนวนมากและ accessibility review; bulk editing ชนิดอื่นพร้อม audit/undo

## เกณฑ์ก่อนเผยแพร่

ต้องมี backend auth/authorization, secret separation, SSRF protection, private data isolation, conflict tests และทดสอบ deployment/security ครบก่อนเปิด public หน้า Pages หรือ Functions ห้าม deploy, สร้างทรัพยากรมีค่าใช้จ่าย หรือเผยแพร่ repository โดยไม่ได้รับอนุมัติจากเจ้าของ ผลทดสอบ live ต้องแยกจาก fixture เสมอ
