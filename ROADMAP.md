# MangaWatcher — ROADMAP

อัปเดต 20 พฤศจิกายน 2026 เป้าหมายคือระบบ private-first ค่าใช้จ่ายเป้าหมาย 0 บาท/เดือนภายใต้โควตาฟรีที่ตรวจใหม่ก่อนเปิดใช้ ไม่รับประกันว่าบริการจะฟรีตลอด

## Phase 0 — Local MVP เดิม (เสร็จ)

- Python Standard Library + SQLite, MangaDex/RSS/manual, alias mapping แบบยืนยันเอง, release แยกต้นทาง/ภาษา, scheduler local, RAW/ENG/TH และเลขตอนแปลล่าสุด
- คงฐานข้อมูล MangaPulse เดิมเป็น fallback ไม่ย้ายหรือลบข้อมูลผู้ใช้

## Phase 1 — ความเสถียรและงานแปล local (ทำแล้วบางส่วน)

- ทำแล้ว: adapter registry สำหรับ MangaDex/RSS, ปฏิเสธ XML ผิดรูปแบบ, ปิด redirect เมื่อ fetch, ตรวจทุกเรื่องที่ผูกแหล่งหรือเฉพาะที่ติดตาม, backoff แยกแหล่ง, เวลาตรวจถัดไป
- ทำแล้ว: คิวงานแปลราย release ID พร้อมสถานะ RAW, OCR, แปล, ตรวจคำ, ลงคำ, Publisher, เผยแพร่; ตอน RAW ใหม่ของเรื่องที่ติดตามเข้าคิวอัตโนมัติ โดยไม่รวมเรื่อง/ตอนกำกวมข้ามเว็บ
- ทำแล้ว: เปลี่ยนสถานะติดตามหลายเรื่องแบบ atomic, JSON export/import schema 2 พร้อม backup ก่อน restore และ rollback เมื่อ validation/foreign key ผิด, CSV release export ผ่าน UI
- ทำแล้ว: React/TypeScript/Vite + Tailwind + shadcn/ui components + Lucide dashboard ภาษาไทย dark default; fixed/collapsible sidebar, status bar, compact tables, search/sort/filter/pagination/bulk tracking, column visibility/resize และ localStorage preferences; build แล้ว local server เสิร์ฟ UI ใหม่, ไม่มี build จะใช้ UI เดิม
- ยังเหลือ: chapter identity สำหรับ season/part/special, user-confirmed duplicate matching, source rate limit ขั้นสูง, audit log การแก้ข้อมูล, browser QA หลายขนาดและอุปกรณ์จริง, นำเข้า CSV พร้อม preview, Asura adapter หลังได้รับสิทธิ์หรือฟีดทางการ
- ยังเหลือด้าน dependency: `npm audit` รายงาน 5 high จากสาย Vite/picomatch ใน toolchain รุ่นที่ติดตั้ง (registry ยังไม่มี picomatch รุ่นที่พ้น advisory ณ วันที่ตรวจ) จำกัด Vite dev server ไว้ที่ loopback และทบทวนก่อนใช้งาน cloud

## Phase 2 — Cloud แบบ private (เปิดใช้งานบางส่วน)

- ทำแล้ว: GitHub Pages frontend + Netlify Functions, GitHub OAuth state+PKCE, owner ID allowlist, signed app session สำหรับ Pages, CORS เฉพาะ Pages origin, Origin check, rate limit config, schema validation และ audit log การแก้ไข cloud; ยืนยัน Pages/Netlify endpoints แล้ว ยังต้องตรวจบนอุปกรณ์จริง
- ทำแล้วในโค้ด: GitHub private JSON store ผ่าน server-only token, commit ต่อ mutation, SHA conflict, export/import แบบตรวจรุ่น, ใช้ JSON schema 2 ที่ local export ได้; จำกัดไฟล์ 900 KB ตามรูปแบบ Contents API ที่ใช้ และเก็บประวัติ commit ไว้กู้คืน
- ยังเหลือ: ทดสอบจริงบน PC/Android/iPhone, แยกข้อมูลเมื่อโตเกิน 900 KB, ทดสอบ conflict/live recovery, ตรวจโควตาและค่าใช้จ่ายจริง
- ทำแล้ว: `deploy.yml` สำหรับ Pages และ `manga-update.yml` ทุก 60 นาทีสำหรับ MangaDex/RSS ที่ผู้ใช้กำหนด, HTTPS พร้อม DNS pinning/ปฏิเสธ private network และ redirect, GET retry, backoff ตามแหล่ง, dedup release, batch commit หลังตรวจ; ทดสอบ live Actions กับ MangaDex 2 แหล่งและ Thunder/QiManga RSS 13 แหล่งแล้ว ยังไม่มี notification idempotency
- 18 พฤศจิกายน 2026: push โค้ดขึ้น `Sillvy3635/MangaWatcher` แล้ว (`57106da`); GitHub Actions รอบล่าสุด #44303510719 หยุดที่การตรวจ `MW_API_ORIGIN` เพราะยังไม่มี URL Netlify Site ในการตั้งค่า Pages URL ยังตอบ 404 ต้องตั้งค่า Production ก่อนถือว่าออนไลน์
- 18 พฤศจิกายน 2026: เริ่ม private repo `Sillvy3635/MangaWatcher-Data` ด้วย README และ `.gitignore` เท่านั้น (`ba74ec7`); รอนำเข้า JSON schema 2 จากข้อมูลจริงหลัง API พร้อม

- 18 พฤศจิกายน 2026: สร้าง Netlify Site `https://mangawatcher.netlify.app` ตั้งค่าตัวแปรครบทั้ง 12 ตัว และ deploy รอบ `6afda77b16a0a2d2a2ad2c1e` สำเร็จ ยืนยันผล live แล้วว่า `/api/session` ตอบ HTTP 401, CORS อนุญาต `https://sillvy3635.github.io`, และ `/api/auth/start` ส่ง HTTP 302 ไป GitHub OAuth ได้ถูกต้อง; GitHub Pages เผยแพร่ผ่าน Actions รอบ `#44315180831` สำเร็จและ `https://sillvy3635.github.io/MangaWatcher/` (รวม `?view=queue`, `manifest.webmanifest`, `sw.js`) ตอบ HTTP 200 พร้อมเข้าสู่ระบบและนำเข้าข้อมูล JSON แล้ว

- 18 พฤศจิกายน 2026: ย้ายข้อมูลจาก `manga-notifier` main commit `2f93449` เฉพาะ 17 URL ปัจจุบันเป็น 16 เรื่อง/17 แหล่ง/17 ตอนใน private JSON พร้อม archive ไฟล์ต้นฉบับ 75 tracker keys แยกไว้ แหล่งทั้งหมดเป็น manual/disabled; ยังไม่ตรวจเว็บไซต์สดหรือสิทธิ์ HTML/API และยังต้องยืนยันการอ่านข้อมูลหลังล็อกอินจริง

- 18 พฤศจิกายน 2026: เพิ่มทะเบียนเว็บไซต์ต้นทางใน schema 2 settings และหน้า Admin รองรับเพิ่ม/แก้ไข/ลบโดยไม่ผูกกับเรื่อง บันทึก Asura Scans ใน private JSON เป็น ENG/รอ Adapter หลังตรวจคำขออัตโนมัติได้ HTTP 403 challenge; ไม่เปิด scraping หรือพยายามข้ามการป้องกัน ขั้นต่อไปคือหา API/RSS ที่ได้รับอนุญาตหรืออนุญาตจากเจ้าของเว็บไซต์ก่อนทำ Adapter

- 19 พฤศจิกายน 2026: นำประวัติ Asura จาก tracker เดิม 52 key (URL หลายรุ่น) มาคัดรายการล่าสุดตาม Git commit ของแต่ละชื่อเรื่อง เหลือ 6 เรื่อง/6 แหล่ง/6 ตอนใน private JSON เดิม ไม่ทับข้อมูลเดิม ตั้งเป็น manual/disabled/ไม่ติดตามและติดป้ายยังไม่ตรวจสด; ไม่ใช่แค็ตตาล็อกปัจจุบันของ Asura และยังไม่มี Adapter ที่ได้รับอนุญาต

- 19 พฤศจิกายน 2026: ตรวจช่องทางทางการของ MangaDex API, MangaUpdates API และ RSS ของ WEBTOON EN; บันทึกหลักฐาน/ข้อจำกัดใน `docs/ALLOWED_METADATA_SOURCES.md` ยังไม่ผูก ID เรื่องหรือเปิด source อัตโนมัติ เพราะต้องยืนยันการจับคู่และปรับ parser เฉพาะแหล่งก่อน

- 19 พฤศจิกายน 2026: ตรวจ MangaBaka API และ data license; ใช้เป็น candidate สำหรับค้นหาเรื่อง/alias mapping เท่านั้น ไม่ใช้เลขตอน catalog เป็น release จากเว็บต้นทาง ข้อมูล `source` จากผู้ให้บริการอื่นต้องเคารพสิทธิ์แยก และผลค้นหาชื่อเดียวอาจมีหลายระเบียน

- 20 พฤศจิกายน 2026: เปิด MangaDex ENG 2 แหล่งใน private data หลังยืนยันชื่อเกาหลีและเรื่องย่อกับเว็บต้นทางเดิม; ตั้งให้ติดตามเรื่องที่เกี่ยวข้อง, รอบแรกเก็บเฉพาะตอนล่าสุดเป็น baseline โดยไม่เพิ่มตอนเก่าเป็นอัปเดตใหม่, รอบถัดไปกรองตามเวลาที่เผยแพร่ GitHub Actions manual run `#44663225830` สำเร็จและ private JSON มี `checked`/สถานะปกติทั้งคู่ พร้อมตอนจริง 2 ตอน (รวม 22 เรื่อง/25 แหล่ง/25 ตอน) ยังไม่ตรวจ Android/iPhone จริงและยังไม่มีแจ้งเตือน cloud

- 20 พฤศจิกายน 2026: เพิ่ม `site_feed` อ่าน RSS ที่เว็บเผยแพร่เอง แยก Thunder 6 หน้าฟีดและ QiManga 1 ฟีด กรองชื่อเรื่องและ URL รายเรื่องตรงตัว, cache ฟีดที่ใช้ร่วมกัน, ไม่เพิ่มตอนเก่าซ้ำ เปิด source เดิม 12+1 แหล่งใน private JSON โดยคงตอน/URL ที่นำเข้า GitHub Actions run `#44664817174` ตรวจครบ 13 แหล่ง ไม่มี error แต่เรื่องที่ติดตามยังไม่อยู่ในช่วง RSS ล่าสุด จึงแสดง `รอตอนใหม่ใน RSS` และยังไม่ยืนยันการตรวจพบตอนใหม่ของเรื่องเหล่านี้ Asura ยัง manual/disabled เพราะข้อกำหนดต้องมีสิทธิ์ก่อน scrape
- 20 พฤศจิกายน 2026: เพิ่ม Discord Webhook ใน Worker พร้อม private outbox ของ release ID, ส่งหลัง commit ข้อมูลสำเร็จ, ยืนยันด้วย `wait=true`, retry เมื่อ 429/5xx, ปิดการ mention, และ manual `test_discord` ที่แยกจากตอนจริง รอเจ้าของตั้ง GitHub Secret และทดสอบข้อความถึงช่องจริง การรันซ้ำปกติไม่ส่งซ้ำ แต่หาก Worker หยุดหลัง Discord รับข้อความก่อนบันทึก receipt อาจส่งซ้ำหนึ่งชุดได้
- 20 พฤศจิกายน 2026: Secret ถูกตั้งแล้วแต่รอบทดสอบและรอบตามเวลาแรกพบรูปแบบ Discord Webhook URL ไม่ถูกต้อง กำลังให้เจ้าของแก้ค่า Secret; ปรับ Worker ให้รอบตรวจมังงะดำเนินต่อและคิวแจ้งเตือนคงอยู่แม้ Secret ผิด ต้องทดสอบข้อความจริงซ้ำก่อนถือว่าเชื่อมสำเร็จ
- ยังเหลือ: ทดสอบ Discord live หลังตั้ง secret, Telegram, Push, และการลดช่องว่าง duplicate กรณี Worker หยุดกลางขั้นตอนยืนยัน

## Phase 3 — ประสบการณ์ผู้ใช้และข้อมูลขั้นสูง (ทำบางส่วน)

- ทำแล้ว: ปฏิทินอัปเดตรายเดือนแบบ 7 วันเริ่มจันทร์ ใช้เวลา `detected` ตาม Asia/Bangkok, เลื่อนเดือน/กลับวันนี้, ค้นหาและกรองภาษา/รายการติดตาม, สีแยก RAW/ENG/TH และคิวงานแปลจริง, ดูรายการเต็มของวันที่เลือก; รองรับจอเล็กด้วยการเลื่อนแนวนอน ยังต้องตรวจบน Android/iPhone จริง
- ยังเหลือ: ค้นหาเรื่องใหม่จาก feed/API ที่ได้รับอนุญาต, เปรียบเทียบตอนขาดจริง, สถานะ hiatus และประวัติการแก้ไข
- ทำแล้วในโค้ด: PWA manifest, PNG/SVG icons, service worker cache เฉพาะ static assets พร้อมเปลี่ยน cache ตาม build, Pages query route/404 fallback; ยังเหลือ IndexedDB cache/sync หลัง auth และทดสอบติดตั้ง/ออฟไลน์บนอุปกรณ์จริง
- ปรับ UI/table ด้วยข้อมูลจำนวนมากและ accessibility review; bulk editing ชนิดอื่นพร้อม audit/undo

## เกณฑ์ก่อนเผยแพร่

ต้องมี backend auth/authorization, secret separation, SSRF protection, private data isolation, conflict tests และทดสอบ deployment/security ครบก่อนเปิด public หน้า Pages หรือ Functions ห้าม deploy, สร้างทรัพยากรมีค่าใช้จ่าย หรือเผยแพร่ repository โดยไม่ได้รับอนุมัติจากเจ้าของ ผลทดสอบ live ต้องแยกจาก fixture เสมอ
