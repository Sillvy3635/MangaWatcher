# ย้ายข้อมูลจาก manga-notifier

ดึงข้อมูลจาก private repository `Sillvy3635/manga-notifier` branch `main` commit `2f934492c95338413a9644f44709ba27699c33d8` โดยอ่านไฟล์ `manga_list.json` และ `manga_tracker.json` ในเครื่อง ไม่เรียกเว็บไซต์ต้นทางและไม่ใช้ webhook

ผลการย้ายรายการติดตาม: 17 URL ที่ติดตามอยู่ → 16 เรื่อง, 17 แหล่ง และ 17 ตอนล่าสุด ชื่อเรื่องกับ slug ที่ตรงกันทั้งคู่หนึ่งคู่ถูกผูกเป็นเรื่องเดียวกัน

ต่อมาเพิ่ม **ประวัติ Asura** จาก tracker เดิม 52 key ที่มี URL เปลี่ยนหลายรุ่น คัดบันทึกล่าสุดตามเวลา Git commit ต่อชื่อเรื่องที่ตรงกันทุกตัวอักษร จึงได้ 6 เรื่อง, 6 แหล่ง และ 6 ตอน เป็น 22 เรื่อง/23 แหล่ง/23 ตอนรวมกับข้อมูลเดิม ไม่รวมเรื่องที่ชื่อคล้ายกันโดยอัตโนมัติ และไม่ถือเป็นแค็ตตาล็อกสดหรือรายการติดตามปัจจุบัน ข้อมูล tracker ทั้ง 52 key และ key แบบข้อความยังอยู่ครบใน private archive

ตอนที่นำเข้ามี `published: null` เพราะ tracker ไม่มีวันเผยแพร่จริง ส่วน `detected` ใช้เวลา Git commit ของบรรทัด `chapter_url` นั้น แหล่งข้อมูลเป็น `manual`, `enabled: 0`, สถานะ "ยังไม่ตรวจสด" จนกว่าจะตรวจสิทธิ์และสร้าง Adapter ที่ปลอดภัยสำหรับแต่ละเว็บ ไม่มีการเริ่ม scrape อัตโนมัติจากข้อมูลที่นำเข้า

ประวัติ Asura แสดงในหน้า **มังงะทั้งหมด** โดยตอนนำเข้าตั้ง `tracked: 0` และปิด source (`enabled: 0`) ต่อมามีหนึ่งเรื่องที่เปิดติดตามผ่าน MangaDex ENG ที่ยืนยันการจับคู่แล้ว แหล่ง Asura ต้นฉบับยังปิดอยู่ การติดตามอย่างเดียวไม่เปิดตรวจ Asura อัตโนมัติ URL ที่เก็บอาจเปลี่ยนหรือเข้าไม่ได้แล้ว เพราะยังไม่ได้ตรวจเว็บไซต์สด

คำสั่งสำหรับสร้างไฟล์ใหม่ใน private checkout (หากมี `mangawatcher.json` อยู่แล้ว ให้เพิ่ม `--base` เพื่อคงข้อมูลเดิม):

```powershell
python scripts/import_manga_notifier.py --repo I:\GitProject\manga-notifier --output I:\GitProject\MangaWatcher-Data\mangawatcher.json
python scripts/import_historical_asura.py --repo I:\GitProject\manga-notifier --base I:\GitProject\MangaWatcher-Data\mangawatcher.json --output I:\GitProject\MangaWatcher-Data\mangawatcher.json
```

ก่อนรันซ้ำให้สำรอง private JSON และ `git fetch` ตรวจ commit ล่าสุดก่อนเสมอ ตัวแปลงรายการปัจจุบันข้าม source URL ที่มีอยู่แล้ว และหยุดโดยไม่เขียนไฟล์หาก config URL ไม่มี tracker ที่จับคู่ได้เพียงหนึ่งรายการ ตัวแปลงประวัติ Asura ข้ามชื่อเรื่องที่มี Asura source อยู่แล้วและเขียนไฟล์ด้วยการแทนที่แบบ atomic ห้าม commit ไฟล์จาก private repo ลง repository โค้ดสาธารณะ

การตรวจ: `python -m unittest discover -s tests -v` และ `node --input-type=module` เรียก `validateSnapshot` กับไฟล์ output การตรวจตอนสดและเงื่อนไขการเข้าถึงแต่ละเว็บไซต์ยังไม่ผ่าน
