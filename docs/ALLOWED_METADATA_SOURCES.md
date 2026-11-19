# แหล่งข้อมูลตอนที่ตรวจอัตโนมัติได้

ตรวจเอกสารทางการและทดสอบการตอบกลับแบบอ่านอย่างเดียวเมื่อ 19 พฤศจิกายน 2026 รายการนี้เป็นแหล่ง **metadata** ไม่ใช่สิทธิ์ดาวน์โหลดภาพตอนหรือเข้าถึงตอนที่ต้องชำระเงิน เงื่อนไขของแต่ละบริการอาจเปลี่ยนได้

| แหล่ง | หลักฐานช่องทางที่เผยแพร่ | ใช้กับ MangaWatcher | ข้อจำกัด |
| --- | --- | --- | --- |
| [MangaDex](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/blob/main/index.md) | เอกสารระบุว่า API สาธารณะและใช้ฟรีสำหรับโครงการที่ทำตาม Acceptable Usage Policy; ทดลอง `GET /manga?limit=1` ได้ HTTP 200 | มี `mangadex` adapter แล้ว แต่ยังไม่มี MangaDex ID ที่ผูกกับ 22 เรื่องปัจจุบัน | ต้องให้เครดิต MangaDex, ไม่มีโฆษณาหรือบริการเก็บเงิน, เคารพ [rate limit](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/blob/main/rate-limits.md); การมีตอน RAW/ENG/TH ขึ้นอยู่กับที่มีจริงใน MangaDex และต้องยืนยันการจับคู่เรื่อง |
| [MangaUpdates](https://mangaupdates.apidocumentation.com/) | API ทางการเปิด public functions โดยไม่ต้องมีบัญชี และมี Acceptable Use Policy; `GET /series/{id}/rss` ทดลองได้ HTTP 200 | มีข้อมูล release ต่อเรื่อง แต่ RSS ที่ทดลองมีชื่อบทโดยไม่มี URL ตอน, GUID หรือวันเผยแพร่ จึงต้องทำ adapter เฉพาะก่อนใช้ | ให้เครดิต, เว้นช่วงคำขอและ cache; ข้อมูล release เป็นรายการที่ชุมชนบันทึก ไม่ใช่หลักฐานการเผยแพร่บนเว็บต้นทางหรือภาษา RAW/ENG/TH ที่ยืนยันแล้ว |
| [WEBTOON ภาษาอังกฤษ](https://www.webtoons.com/en/tiptoon/webtoon-now/list?title_no=2025) | หน้ารายเรื่องมีลิงก์ RSS ทางการ; ทดลอง feed ได้ HTTP 200 และมี item URL/วันเผยแพร่ | เป็นตัวเลือกสำหรับเรื่องบน WEBTOON EN แต่ parser ปัจจุบันยังไม่อ่านเลขตอนแบบ `Ep.`/`Episode` ครบ ต้องปรับ adapter และทดสอบก่อนเปิด | ใช้เฉพาะข้อมูลใน feed สาธารณะ ไม่เข้าตอนในแอปหรือผ่าน paywall; [ข้อกำหนด](https://www.webtoons.com/en/terms) ห้ามการรวบรวมข้อมูลอัตโนมัติที่ไม่ได้รับอนุญาต การมีลิงก์ RSS เป็นช่องทางที่เว็บเผยแพร่เอง แต่ไม่ได้ยืนยันสิทธิ์นำข้อมูลไปเผยแพร่ซ้ำในบริการอื่น |

สำหรับ [Asura Scans](https://asurascans.com/terms-of-service) ข้อกำหนดระบุว่าห้าม scrape/copy โดยไม่ได้รับอนุญาต และคำขออัตโนมัติที่ทดสอบก่อนหน้านี้ได้ HTTP 403 จึงไม่เปิด HTML adapter หรือข้ามการป้องกัน ส่วน Thunder Scans, Vortex Scans, QiManga และ Kakao Page ยังไม่มี API/RSS ที่ยืนยันการใช้งานสำหรับโครงการนี้ จึงคงเป็น manual/disabled

**ขั้นตอนก่อนเปิดตรวจ:** ผูก ID เรื่องกับแหล่งใหม่ทีละเรื่องโดยให้ผู้ใช้ยืนยัน, ตรวจว่าข้อมูลภาษาและตอนสอดคล้องกับแหล่งนั้น, เพิ่ม attribution ที่ UI, ทดสอบ adapter ด้วย fixture และคำขอสดที่อนุญาต, จำกัดอัตรา/จัดการ 429, แล้วจึงเปิด source ใน private JSON อย่างชัดเจน ห้ามตีความว่าเลขตอนจาก MangaDex/MangaUpdates/WEBTOON คือเลขตอนล่าสุดของ Asura หรือเว็บต้นทางอื่นโดยอัตโนมัติ
