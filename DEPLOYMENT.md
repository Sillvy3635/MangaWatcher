# เปิด MangaWatcher ออนไลน์

โครงสร้าง Production: [GitHub Pages](https://github.com/Sillvy3635/MangaWatcher) ให้บริการหน้าเว็บ, Netlify Functions ให้บริการ API/OAuth, และ `Sillvy3635/MangaWatcher-Data` แบบ private เก็บ JSON ส่วน GitHub Actions ตรวจตอนทุกชั่วโมง คอมพิวเตอร์ส่วนตัวไม่ต้องเปิดทิ้งไว้ ไม่มี Supabase ข้อมูลจริงไม่อยู่ใน public repository

> สถานะเอกสาร: ไฟล์ build/API/Worker ผ่านการทดสอบด้วย mock ในเครื่อง การ deploy และการทดสอบบัญชีจริงต้องทำตามขั้นตอนนี้หลังตั้งค่า Netlify และ GitHub ที่เจ้าของควบคุม ค่าใช้จ่าย 0 บาท/เดือนเป็นเป้าหมายภายในโควตาฟรีของบัญชีจริง ไม่ใช่คำรับประกัน

โค้ดถูก push ขึ้น public repository แล้ว และ private data repository มี commit เริ่มต้น `ba74ec7` Netlify Site จริงคือ `https://mangawatcher.netlify.app` โดยหน้า API placeholder ตอบ HTTP 200 และ `/api/session` ตอบ HTTP 503 พร้อมข้อความว่า `ยังไม่ตั้งค่า site origin` จนกว่าจะกำหนด environment variables ด้านล่าง Workflow Pages [#44303510719](https://github.com/Sillvy3635/MangaWatcher/actions/runs/44303510719) หยุดที่ขั้นตรวจ `MW_API_ORIGIN` ตามที่ตั้งใจไว้ ขณะตรวจ URL ของ Pages ยังตอบ HTTP 404

## 1. เตรียมข้อมูลเดิม

1. เก็บ `data/mangawatcher.sqlite3` หรือ `data/mangapulse.sqlite3` และไฟล์ `.bak` เดิมไว้นอก public repo
2. เปิด local app ด้วย `python server.py` แล้วใช้หน้า **ฐานข้อมูล → สำรอง JSON ทั้งหมด** เพื่อได้ไฟล์ schema 2 ตรวจว่ามีเรื่อง/แหล่ง/ตอนตามจริง ไฟล์นี้เป็นข้อมูลส่วนตัว **ห้าม commit**
3. Repository `MangaWatcher-Data` มี commit เริ่มต้น `ba74ec7` ที่มีเพียง README และ `.gitignore` แล้ว branch `main` พร้อมสำหรับ GitHub Contents API และยังไม่มี JSON ข้อมูลจริง

## 2. ตรวจ repository สาธารณะที่ส่งขึ้นแล้ว

Repository โค้ดคือ `https://github.com/Sillvy3635/MangaWatcher` และ branch `main` มี commit `57106da` แล้ว โค้ด public มีเฉพาะ source, workflow และตัวอย่างตัวแปรเปล่า ก่อน push ครั้งถัดไป ตรวจว่าไม่มี `data/`, `.env`, `*.sqlite3`, backup หรือ token ในรายการ `git status` และ `git ls-files`

```powershell
python scripts/check_public_repo.py
git status --short
git log -1 --oneline
git ls-remote origin main
```

ถ้าเครื่องใช้ GitHub บัญชีอื่น ให้เข้าสู่ระบบ Git Credential Manager ด้วยบัญชี `Sillvy3635` หรือให้สิทธิ์เขียน repository แก่บัญชีที่ใช้ ห้ามส่ง token ผ่านแชตหรือใส่ token ใน remote URL

## 3. สร้าง Netlify API Site

Netlify Site `mangawatcher` สร้างแล้วจาก **Sillvy3635/MangaWatcher** branch `main` โดยใช้ `netlify.toml` ที่ root (`publish = netlify/public`, `functions = netlify/functions`) และเผยแพร่ที่ `https://mangawatcher.netlify.app/` Site นี้ให้บริการ API เท่านั้น หน้าเว็บหลักอยู่บน Pages

เปิด [Environment variables](https://app.netlify.com/projects/mangawatcher/configuration/env) ของ Netlify Site จริง แล้วตั้งค่า:

| ตัวแปร | ค่า / ตำแหน่งที่ได้ |
| --- | --- |
| `MW_SITE_ORIGIN` | `https://mangawatcher.netlify.app` ไม่มี `/` ท้าย |
| `MW_FRONTEND_ORIGIN` | `https://sillvy3635.github.io` |
| `MW_FRONTEND_BASE_PATH` | `/MangaWatcher/` |
| `MW_GITHUB_CLIENT_ID` | Client ID จาก OAuth App ในขั้น 4 |
| `MW_GITHUB_CLIENT_SECRET` | Client secret จาก OAuth App; ใส่เฉพาะ Netlify |
| `MW_ALLOWED_GITHUB_ID` | `261384208` ซึ่งเป็น numeric ID ของ `Sillvy3635`; ตรวจซ้ำใน GitHub profile ก่อนเปิดใช้ |
| `MW_SESSION_SECRET` | สุ่มใหม่อย่างน้อย 32 ตัวอักษร; ใส่เฉพาะ Netlify |
| `MW_DATA_OWNER` | `Sillvy3635` |
| `MW_DATA_REPO` | `MangaWatcher-Data` |
| `MW_DATA_PATH` | `mangawatcher.json` |
| `MW_DATA_BRANCH` | `main` |
| `MW_DATA_TOKEN` | Fine-grained token สำหรับ private data repo ในขั้น 5; ใส่เฉพาะ Netlify |

สร้าง session secret บนเครื่องของเจ้าของด้วย PowerShell: `[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))` เก็บผลใน Netlify UI เท่านั้น ห้ามบันทึกลง repository การเปลี่ยนค่านี้จะทำให้ session เดิมหมดสิทธิ์ทันที

## 4. ตั้ง GitHub OAuth

ที่ GitHub บัญชี `Sillvy3635` ไป **Settings → Developer settings → OAuth Apps → New OAuth App** ตั้งชื่อ MangaWatcher, Homepage URL เป็น `https://sillvy3635.github.io/MangaWatcher/`, Authorization callback URL เป็น `https://mangawatcher.netlify.app/api/auth/callback` คัดลอก Client ID/secret ไปตั้งใน Netlify ขั้น 3 OAuth ขอ `read:user` เพื่อยืนยัน numeric user ID เท่านั้น GitHub access token ไม่ถูกส่งไป browser

## 5. ให้สิทธิ์ private data repository

ที่ **GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens** สร้าง token ที่จำกัด **Only select repositories → MangaWatcher-Data**, สิทธิ์ **Contents: Read and write**, กำหนดวันหมดอายุและแผนหมุนเวียน token ใส่ค่าเดียวกันใน Netlify `MW_DATA_TOKEN` และใน repository โค้ด **Settings → Secrets and variables → Actions → Secrets → New repository secret** ชื่อ `MW_DATA_TOKEN` อย่าใส่ token ใน Actions variable หรือ `VITE_*`

## 6. เปิด GitHub Pages

ที่ public repository ไป **Settings → Pages → Build and deployment → Source: GitHub Actions** จากนั้นไป **Settings → Secrets and variables → Actions → Variables** เพิ่ม `MW_API_ORIGIN` เป็น `https://mangawatcher.netlify.app` ค่า URL นี้เปิดเผยใน frontend ได้เพราะเป็นเพียง API address แล้วเปิด **Actions → Deploy MangaWatcher Pages → Run workflow** หรือ push commit ใหม่ Workflow `deploy.yml` ติดตั้ง dependencies, lint, build ด้วย `VITE_BASE_PATH=/MangaWatcher/`, สร้าง PWA/404 fallback และเผยแพร่ `frontend/dist` เมื่อผ่านแล้วเปิด `https://sillvy3635.github.io/MangaWatcher/`

Route ของหน้าเว็บใช้ `?view=queue` เป็นต้น จึง refresh แล้วไม่เจอ 404; `404.html` จะส่ง URL แบบ path กลับไป query route หากมี deep link เก่า ตัว service worker cache เฉพาะ static shell/assets ตาม build hash ไม่ cache API หรือ JSON ส่วนตัว

## 7. นำเข้าข้อมูลและเปิด Worker

1. เปิด Pages URL แล้วกด **เข้าสู่ระบบด้วย GitHub** ตรวจว่า callback กลับมาที่ Pages URL เดิมและ fragment `#mw_session=...` ถูกลบจาก address bar หลังโหลด บัญชีอื่นต้องถูกปฏิเสธ
2. ไปหน้า **ฐานข้อมูล → นำเข้า JSON** เลือกไฟล์ที่สำรองจาก local ในขั้น 1 คลัง private จะได้ `mangawatcher.json` schema 2 เก็บ SQLite local เดิมไว้เป็น backup เพิ่มเติม
3. ที่ repository โค้ดไป **Actions → Update manga metadata → Run workflow** เพื่อทดสอบ Worker ครั้งแรก Workflow `manga-update.yml` รันตามเวลา `17 * * * *` (ทุกชั่วโมงโดยประมาณ) และ manual ได้ แหล่ง RSS/MangaDex ต้องเป็น URL ที่เจ้าของได้รับอนุญาต; ไม่มีรายการต้นทางจริงในโค้ด
4. ตรวจ `MangaWatcher-Data/mangawatcher.json` และ commit history เฉพาะใน private repo ถ้าไม่มี source ที่ถึงรอบตรวจ Worker จะไม่เขียน commit ใหม่ หากตรวจแล้วมีการเปลี่ยนแปลงสถานะ/เวลา/ตอน จะเขียนเป็น batch commit พร้อม SHA conflict check

## 8. ตรวจ Production หลัง Deploy

| ตรวจ | ผลที่ต้องเห็น |
| --- | --- |
| Pages URL และ `?view=queue` หลัง refresh | โหลด UI ได้ ไม่ใช่ 404 |
| `/api/session` บน Netlify โดยไม่ login | HTTP 401, ไม่มีข้อมูลส่วนตัว |
| Login owner / บัญชีอื่น | owner เข้าได้, บัญชีอื่น 403 |
| Pages → Netlify API | CORS อนุญาตเฉพาะ `https://sillvy3635.github.io`; browser อื่นไม่ได้รับ `Access-Control-Allow-Origin` |
| นำเข้า/แก้ไข/ส่งออก | ข้อมูลอยู่ private repo, SHA เก่าตอบ 409, JSON backup ดาวน์โหลดได้ |
| Actions Worker | manual run สำเร็จ, source ที่ถึงรอบตรวจมี log และข้อมูลจริงเท่านั้น |
| Android / iPhone / PC | เปิด layout ได้และเพิ่มไปหน้า Home/Install ได้; ตรวจเครื่องจริงก่อนถือว่าผ่าน |
| Public repo/Pages artifact | ไม่มี token, SQLite, JSON ข้อมูลจริง, `.env` หรือ backup |

ยังไม่มีผลทดสอบ live ใน repository นี้ หากขั้นใดไม่ผ่าน ให้แก้และทดสอบใหม่ก่อนใช้ข้อมูลจริง PWA offline แสดงได้เฉพาะ shell; งานมังงะและ API ต้องมีอินเทอร์เน็ต Discord/Telegram/Push ยังไม่พร้อมใช้งาน

## ย้อนกลับและดูแลระบบ

- หน้าเว็บ: GitHub Actions/Pages เลือก deploy จาก commit ที่ผ่านก่อนหน้า หรือ revert commit แล้วรัน `deploy.yml` ใหม่
- API: ใช้ Netlify deploy history/rollback และตรวจ environment variables ไม่คัดลอก secret ลง log
- ข้อมูล: ส่งออก JSON backup ก่อน restore ใช้ GitHub commit history ของ private repo กู้รุ่นที่ต้องการ แล้วนำเข้า JSON ผ่านหน้าเว็บ; หากชน SHA ให้โหลดข้อมูลใหม่ก่อน ไม่ overwrite เงียบ ๆ
- หาก token รั่ว: revoke ที่ GitHub, สร้าง token ใหม่และอัปเดต Netlify/Actions secrets; หาก app session รั่ว ให้หมุน `MW_SESSION_SECRET`
- ตรวจโควตา [GitHub Actions/Pages](https://docs.github.com/en/billing/reference/actions-minute-multipliers) และ [Netlify Functions](https://docs.netlify.com/build/functions/usage-and-billing/) ในบัญชีจริงเป็นระยะ ตารางตรวจทุกชั่วโมงอาจล่าช้า ไม่รับประกันนาทีแน่นอน
