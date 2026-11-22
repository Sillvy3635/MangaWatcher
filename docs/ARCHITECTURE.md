# สถาปัตยกรรม MangaWatcher

## Local

React UI (`frontend/dist`) → Python server ผูก `127.0.0.1:8765` → SQLite ใน `data/` โดยมี MangaDex/RSS/Thunder-QiManga site feed/manual adapters ข้อมูลเดิมและ MangaPulse fallback ยังทำงาน ไม่มี authentication จึงห้ามเปิด local server สู่ Internet

## Production ที่เตรียมไว้

```text
GitHub Pages /MangaWatcher/ (static React + PWA)
     │ HTTPS, signed app session (14 วัน), CORS เฉพาะ Pages origin
     ▼
Netlify Functions /api/* ── GitHub OAuth state + PKCE + numeric owner allowlist
     │ server-only fine-grained token, SHA optimistic concurrency
     ▼
Sillvy3635/MangaWatcher-Data (private) / mangawatcher.json
     ▲
GitHub Actions ทุกชั่วโมง → Python Worker → MangaDex/ฟีด RSS สาธารณะ Thunder และ QiManga
```

OAuth callback อยู่บน Netlify และตรวจ GitHub user ID ก่อนส่ง signed **app session** ผ่าน URL fragment กลับ Pages หน้าเว็บเก็บ session ใน `localStorage` และลบ fragment จาก address bar ทันที หาก persistent storage ใช้ไม่ได้จะใช้ `sessionStorage` จึงต้อง login ใหม่เมื่อปิดแท็บ GitHub access token ใช้ยืนยันตัวตนบน Netlify เท่านั้น ไม่อยู่ใน frontend ฝั่ง API ตรวจ `Authorization` และ `Origin` ทุกคำขอ Pages, CORS อนุญาต origin ที่ตั้งไว้เท่านั้น ไม่มี third-party cookie dependency การออกจากระบบลบ session ใน browser ทั้งสองที่ และ API 401 ก็ลบเช่นกัน; session ที่ถูกคัดลอกไว้ก่อนหน้าอาจยังใช้ได้จนหมดอายุใน 14 วันหรือเพิกถอนทั้งหมดด้วยการหมุน `MW_SESSION_SECRET` การเก็บ bearer ใน localStorage เพิ่มความเสี่ยงหากมีสคริปต์ไม่พึงประสงค์บน origin เดียวกัน จึงใช้บนอุปกรณ์ที่เชื่อถือได้และหลีกเลี่ยงการรันสคริปต์อื่นบน Pages origin ส่วน Netlify same-origin mode เดิมยังใช้ HttpOnly cookie อายุ 24 ชั่วโมงกับ CSRF ได้

GitHub Contents API ใช้ SHA ก่อนเขียนและตอบ 409 เมื่อชนกัน ไฟล์ JSON จำกัด 900 KB เพราะ [Contents API รองรับ base64 ครบเมื่อไฟล์ไม่เกิน 1 MB](https://docs.github.com/en/rest/repos/contents) ใช้ export/import schema 2 ของ local และ commit history สำหรับ rollback หากข้อมูลโตต้องแบ่งไฟล์ก่อน ข้อมูลส่วนตัวไม่เข้า Pages artifact หรือ public repository

Worker ตรึง IP ที่ตรวจว่าเป็น public, ตรวจ TLS ตาม hostname, ไม่ตาม redirect, GET retry/backoff และเขียน batch commit ต่อรอบเมื่อมี source ถึงเวลาตรวจ Thunder/QiManga ใช้แต่ RSS, แชร์ผลฟีดระหว่างเรื่อง และตรวจ URL/ชื่อเรื่องตรงตัว ไม่มีการดึงภาพตอนหรือหลบ paywall/CAPTCHA ไม่มี HTML adapter; Asura ต้องมีสิทธิ์หรือฟีดทางการก่อนเปิด

Discord: Worker บันทึก release ใหม่ของเรื่องที่ติดตามและ `settings.discord_outbox` ใน private JSON commit เดียวกัน แล้วใช้ Webhook จาก GitHub Actions Secret ส่งข้อความหลัง commit สำเร็จ เมื่อ Discord ตอบ `wait=true` พร้อม message ID จึงลบ release ID ออกจาก outbox ใน commit ถัดไป หากส่งไม่สำเร็จคิวคงอยู่สำหรับรอบถัดไป Secret ไม่ผ่าน Netlify/Pages และไม่อยู่ใน private JSON การยืนยันแบบสองระบบไม่มี transaction ร่วมกัน จึงยังมีช่องว่าง duplicate หาก process หยุดหลังส่งแต่ก่อนบันทึก acknowledgment

PWA cache เฉพาะ static assets ตาม build hash ไม่ cache API/JSON ข้อมูลส่วนตัว Offline แสดง shell ได้ แต่การดู/แก้ข้อมูลต้องเชื่อมอินเทอร์เน็ต เอกสารตั้งค่าจริงและตรวจ Production อยู่ใน [DEPLOYMENT.md](../DEPLOYMENT.md) มีผลทดสอบ Pages, OAuth endpoints, Worker และข้อความทดสอบ Discord จริงแล้ว ยังไม่สังเกตการแจ้งเตือนตอนใหม่จริง ยังไม่ทดสอบ Android/iPhone จริง และยังไม่มี Telegram/Push
