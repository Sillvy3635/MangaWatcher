# MangaWatcher — เว็บติดตามมังงะส่วนตัว

MangaWatcher รวม metadata ตอนใหม่ของ Manga, Manhwa และ Manhua จากแหล่งที่ผู้ใช้เพิ่มเอง เปรียบเทียบ RAW / ENG / TH และจัดคิวงานแปล UI ภาษาไทยแบบ dark admin dashboard ใช้ React/TypeScript/Vite ส่วน backend local ใช้ Python 3.10+ และ SQLite ในเครื่อง โค้ด production เตรียม GitHub Pages + Netlify Functions + GitHub private JSON และ Actions แล้ว ดูขั้นตอนจริงใน [DEPLOYMENT.md](DEPLOYMENT.md) ไม่มีข้อมูลตัวอย่างปะปนกับข้อมูลจริง

ข้อมูลจาก private `manga-notifier` branch `main` ถูกย้ายรายการติดตามปัจจุบันและประวัติ Asura 6 เรื่องเข้า private `MangaWatcher-Data` โดยปิดการตรวจอัตโนมัติของเว็บต้นทางที่ยังไม่มี Adapter ที่ยืนยันแล้ว รายการ Asura เป็นข้อมูลบันทึกเก่า แสดงใน **มังงะทั้งหมด**; มีหนึ่งเรื่องที่เปิดติดตามผ่าน MangaDex ENG ภายหลัง แต่แหล่ง Asura เดิมยังปิดอยู่ รายละเอียดและวิธีย้อนกลับอยู่ใน [docs/MANGA_NOTIFIER_IMPORT.md](docs/MANGA_NOTIFIER_IMPORT.md)

หน้า **เว็บไซต์ต้นทาง** แยกทะเบียนเว็บไซต์ออกจากแหล่งรายเรื่องแล้ว เพิ่ม/แก้ไข/ลบเว็บไซต์ได้โดยไม่ต้องสร้างเรื่องจำลอง ทะเบียนนี้เป็น metadata เท่านั้น; การเพิ่มเว็บไซต์ไม่เริ่มตรวจอัตโนมัติ Asura Scans ถูกลงทะเบียนใน private JSON เป็นสถานะรอ Adapter และตรวจสิทธิ์ เนื่องจากคำขออัตโนมัติปัจจุบันได้รับ HTTP 403 challenge

แหล่ง metadata ที่ตรวจสอบช่องทางทางการแล้วและข้อจำกัด ดู [docs/ALLOWED_METADATA_SOURCES.md](docs/ALLOWED_METADATA_SOURCES.md) ปัจจุบัน private data เปิด MangaDex ENG 2 แหล่ง, Thunder ENG 12 แหล่ง และ QiManga ENG 1 แหล่ง ตรวจทุก 60 นาทีผ่าน GitHub Actions โดยใช้ API/RSS สาธารณะ รอบแรก MangaDex เก็บตอนล่าสุดเป็นจุดเริ่มต้นโดยไม่แจ้งย้อนหลัง ตอนเดิมของ Thunder/QiManga ยังอยู่และไม่เพิ่มเลขตอนเก่าซ้ำ แหล่ง Asura ยังคงปิดการตรวจ

## เริ่มใช้งานบน Windows

1. ติดตั้ง Python 3.10+ และ Node.js รุ่นที่รองรับ Vite (Node 20.19+ หรือ 22.12+)
2. เปิด Terminal ใน `frontend/` แล้วรัน `npm ci` และ `npm run build`
3. กลับโฟลเดอร์หลัก รัน `python server.py` หรือดับเบิลคลิก `START_WINDOWS.bat`
4. เปิด `http://127.0.0.1:8765` หากเบราว์เซอร์ไม่เปิดเอง

หากยังไม่ได้ build frontend โปรแกรมยังเปิด UI เดิมใน `web/` ได้ ข้อมูล SQLite ชุดเดียวกันถูกใช้ทั้งสอง UI สำหรับแก้หน้า React ระหว่างพัฒนา ให้เปิด Python server ก่อน แล้วรัน `npm run dev` ใน `frontend/` และเข้า URL ของ Vite ที่แสดง (proxy `/api` ไป local server)

## ใช้งานหลัก

- ไปที่ **มังงะทั้งหมด → เพิ่มเรื่อง** ใส่ชื่อและ alias คั่นด้วย `|` กำหนดว่าติดตามหรือไม่
- ไปที่ **เว็บไซต์ต้นทาง → เพิ่มเว็บไซต์** เพื่อลงทะเบียนเว็บโดยไม่เริ่มตรวจอัตโนมัติ หรือเลือก **เพิ่มแหล่งรายเรื่อง** เพื่อผูก MangaDex, RSS/Atom, Thunder/QiManga RSS หรือการเพิ่มตอนเองกับเรื่องที่มีอยู่ ใส่ URL ที่ใช้ได้และได้รับอนุญาต พร้อมภาษาและรอบตรวจ 30–1440 นาที
- ไปที่ **ตั้งค่าระบบ** เลือกตรวจทุกเรื่องที่ผูกแหล่งข้อมูล หรือเฉพาะเรื่องที่ติดตาม ปุ่มตรวจรายแหล่งยังใช้ได้เสมอ “ทุกเรื่อง” ไม่ได้หมายถึงค้นหาทั้งเว็บไซต์
- หน้า **อัปเดตล่าสุด** แสดง release แยกตามแหล่งและภาษา หน้า **คิวงานแปล** บันทึก RAW, OCR, แปล, ตรวจคำ, ลงคำ, Publisher, เผยแพร่ แยกตาม release ID ตอน RAW ใหม่ของเรื่องที่ติดตามจะเข้าคิวอัตโนมัติ; ตอนเก่าหรือ ENG เพิ่มเข้าคิวได้จากหน้าอัปเดต ไม่มีการรวมตอนกำกวมข้ามเว็บอัตโนมัติ
- ตารางมีค้นหาทันที จัดเรียง แบ่งหน้า เลือก/ปรับความกว้างคอลัมน์ และเก็บค่าหน้าจอใน localStorage หน้า **มังงะทั้งหมด/รายการติดตาม** เลือกหลายเรื่องเพื่อเปลี่ยนสถานะติดตามแบบธุรกรรมเดียว
- หน้า **ปฏิทินอัปเดต** แสดงตารางรายเดือนภาษาไทย เลื่อนเดือน กรอง RAW/ENG/TH และเฉพาะเรื่องที่ติดตามได้ กดวันที่เพื่อดูรายการเต็ม วันที่อ้างอิงเวลาที่ตรวจพบในเขตเวลาไทย ไม่ใช่วันปล่อยตอนที่คาดการณ์ บนมือถือเลื่อนตารางแนวนอนเพื่อดูครบสัปดาห์
- หน้า **ฐานข้อมูล** ส่งออก JSON ครบทุกตาราง, ส่งออกตอน CSV และนำเข้า JSON schema 2; ก่อนนำเข้าโปรแกรมสำรอง SQLite เดิมเป็น `*.pre-import-*.bak` และใช้ transaction หากไฟล์ผิดรูปแบบข้อมูลเดิมจะไม่ถูกแทนที่

## แหล่งข้อมูลและข้อจำกัด

- MangaDex: ใช้ URL `https://mangadex.org/title/<UUID>` ตัว adapter เรียก feed API สูงสุด 100 รายการล่าสุดต่อครั้ง ไม่มีการดาวน์โหลดภาพ
- RSS/Atom: ใช้ feed ที่เผยแพร่และอนุญาต รายการต้องมีชื่อเรื่องหรือ alias กับเลขตอนหลัง `Chapter`, `Ch`, `ตอน` หรือ `第` รูปแบบอื่นต้องมี adapter เฉพาะ
- Thunder/QiManga RSS: ใช้ URL หน้าเรื่อง `https://en-thunderscans.com/comics/<slug>` หรือ `https://qimanga.com/series/<slug>` พร้อมภาษา ENG ตัว `site_feed` เรียกฟีดสาธารณะของเว็บและรับเฉพาะชื่อเรื่อง/ลิงก์ตอนที่ตรงกัน Thunder อ่านสูงสุด 6 หน้าฟีดต่อรอบ; ถ้าเรื่องยังไม่อยู่ในช่วงฟีด จะแสดง “รอตอนใหม่ใน RSS” ไม่ได้ยืนยันเลขตอนล่าสุด ณ เวลานั้น
- Manual: เพิ่ม URL ตอนเอง ไม่มีการดึงเว็บไซต์อัตโนมัติ
- scheduler local ทำงานขณะเปิดโปรแกรม ตรวจแหล่งทีละรายการ หากผิดพลาดจะหน่วงรอบอัตโนมัติแบบ exponential backoff สูงสุด 1,440 นาที; ไม่รับประกันเวลาตรวจแน่นอน
- Asura ไม่มี RSS ที่ยืนยันได้ และข้อกำหนดห้าม scrape โดยไม่ได้รับอนุญาต จึงยังไม่มี Adapter อัตโนมัติของเว็บนี้ ไม่หลบ paywall, CAPTCHA หรือ access control
- หน้า “ค้นหาเรื่องใหม่”, “การแจ้งเตือน” และสถานะ Actions แสดงข้อจำกัดตามจริง โค้ด GitHub Pages, OAuth, Netlify Functions, private JSON backend, PWA และ Actions/Python worker มีแล้วแต่ยังต้องยืนยัน deployment/บัญชี/อุปกรณ์จริง; Discord, Telegram, Push, IndexedDB sync และ offline data cache ยังไม่มี
- Python local server ผูก `127.0.0.1` เท่านั้นและ **ไม่มี auth** ห้ามเปิดสู่ LAN/Internet ตรง ๆ; รายละเอียดเป้าหมาย cloud และข้อจำกัด GitHub Pages อยู่ใน [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) Supabase ไม่ใช่ข้อกำหนดหลัก
- วิธีเปิดเว็บแบบ private ตั้งแต่ต้นจนจบอยู่ใน [DEPLOYMENT.md](DEPLOYMENT.md) Pages แสดง UI, Netlify ให้ API, private repo เก็บ JSON, Worker ตรวจ MangaDex และฟีด Thunder/QiManga ทุกชั่วโมงโดยประมาณ ปุ่มตรวจทันทีใน UI cloud ยังปิดอยู่
- `npm audit` ยังรายงาน advisory ระดับ high ใน Vite/picomatch toolchain ที่ใช้ build/dev (ยังไม่มี picomatch รุ่นแก้ใน registry ณ วันที่ตรวจ) เปิด Vite dev server เฉพาะ loopback และตรวจอัปเดต dependency ก่อนเปิด cloud

## ข้อมูลเดิมและการย้อนกลับ

โปรแกรมใช้ `data/mangawatcher.sqlite3` หรือ `data/mangapulse.sqlite3` เดิมหากยังไม่มีชื่อใหม่ ก่อน migration ตาราง `settings` หรือ `translation_tasks` จะสร้างไฟล์ `*.pre-settings-*.bak` หรือ `*.pre-tasks-*.bak` ใน `data/` หากต้องย้อนกลับ ให้ปิดโปรแกรม คัดลอกไฟล์สำรองที่ต้องการทับฐานข้อมูลที่ใช้งาน แล้วเปิดใหม่ เก็บ SQLite, JSON export และ `.bak` เป็นส่วนตัว อย่านำเข้าคอมมิตหรืออัปโหลดสาธารณะ

## ทดสอบ

```text
python -m unittest discover -s tests -v
node --check web/app.js
node --test cloud/cloud.test.mjs
cd frontend
npm ci
npm run build
npm run lint
```

ตรวจ HTTP แบบ local ได้ด้วย `python server.py --no-browser --no-scheduler` แล้วเปิด `/api/state` หรือ `/api/export` เทสต์อัตโนมัติ mock เครือข่าย; รอบ GitHub Actions วันที่ 20 พฤศจิกายน 2026 ยืนยันการอ่าน RSS Thunder/QiManga จริงแต่ยังไม่พบรายการของเรื่องส่วนตัวในช่วงฟีดล่าสุด อุปกรณ์ Android/iPhone จริงและการติดตั้ง PWA/offline ยังไม่ได้ยืนยัน PWA เก็บเฉพาะไฟล์หน้าเว็บ ไม่เก็บข้อมูลมังงะ/API ส่วนตัว
