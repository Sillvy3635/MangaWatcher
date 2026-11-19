import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Language, Manga, Release, Source, Task } from "./types";

type CalendarKind = "queue" | "RAW" | "ENG" | "TH";
const weekdays = ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."];
const thaiDateParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
});
const two = (value: number) => String(value).padStart(2, "0");
const dateKey = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(thaiDateParts.formatToParts(date).map(({ type, value: part }) => [type, part]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const monthLabel = (year: number, month: number) => new Intl.DateTimeFormat("th-TH", {
  timeZone: "UTC", month: "long", year: "numeric",
}).format(new Date(Date.UTC(year, month - 1, 1)));
const dayLabel = (key: string) => new Intl.DateTimeFormat("th-TH", {
  timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric",
}).format(new Date(`${key}T12:00:00Z`));
const safeUrl = (value: string) => {
  try { const parsed = new URL(value); return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : "#"; }
  catch { return "#"; }
};
const stageNames: Record<Task["stage"], string> = {
  RAW: "รอต้นฉบับ", OCR: "OCR", TRANSLATE: "กำลังแปล", PROOFREAD: "ตรวจคำ",
  LETTERING: "ลงคำ", PUBLISHER: "Publisher", PUBLISHED: "เผยแพร่แล้ว",
};

export function MonthlyCalendar({ releases, manga, sources, tasks, onRefresh }: {
  releases: Release[];
  manga: Manga[];
  sources: Source[];
  tasks: Task[];
  onRefresh: () => Promise<void>;
}) {
  const [today, setToday] = useState(() => dateKey(new Date())!);
  useEffect(() => {
    const timer = window.setInterval(() => setToday(dateKey(new Date())!), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const [monthIndex, setMonthIndex] = useState(() => {
    const [year, month] = today.split("-").map(Number);
    return year * 12 + month - 1;
  });
  const [language, setLanguage] = useState<Language>("ALL");
  const [trackedOnly, setTrackedOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex % 12 + 1;
  const monthPrefix = `${year}-${two(month)}-`;
  const firstWeekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const tracked = useMemo(() => new Set(manga.filter((item) => item.tracked).map((item) => item.id)), [manga]);
  const sourceById = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);
  const taskByRelease = useMemo(() => new Map(tasks.map((task) => [task.release_id, task])), [tasks]);
  const kindOf = (release: Release): CalendarKind => {
    const task = taskByRelease.get(release.id);
    return task && task.stage !== "PUBLISHED" ? "queue" : release.lang === "ALL" ? "RAW" : release.lang;
  };
  const filtered = useMemo(() => releases.filter((release) => {
    const key = dateKey(release.detected);
    return key?.startsWith(monthPrefix) && (language === "ALL" || release.lang === language)
      && (!trackedOnly || tracked.has(release.manga_id))
      && (!query || `${release.manga_title} ${release.chapter} ${release.source_name}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  }), [releases, monthPrefix, language, trackedOnly, tracked, query]);
  const byDay = useMemo(() => {
    const grouped = new Map<string, Release[]>();
    for (const release of filtered) {
      const key = dateKey(release.detected);
      if (key) {
        const items = grouped.get(key);
        if (items) items.push(release);
        else grouped.set(key, [release]);
      }
    }
    return grouped;
  }, [filtered]);
  const selected = selectedDay?.startsWith(monthPrefix) ? byDay.get(selectedDay) || [] : [];
  const changeMonth = (delta: number) => { setMonthIndex(monthIndex + delta); setSelectedDay(null); };
  const refresh = async () => {
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  };

  return (
    <section className="monthly-calendar" aria-label="ปฏิทินอัปเดตรายเดือน">
      <div className="calendar-toolbar">
        <div className="calendar-title"><CalendarDays size={18} /><div><strong>ตารางอัปเดตประจำเดือน</strong><span>{filtered.length} รายการที่ตรวจพบ</span></div></div>
        <div className="calendar-controls">
          <Button variant="outline" size="icon-sm" aria-label="เดือนก่อนหน้า" onClick={() => changeMonth(-1)}><ChevronLeft size={16} /></Button>
          <strong className="calendar-month" aria-live="polite">{monthLabel(year, month)}</strong>
          <Button variant="outline" size="icon-sm" aria-label="เดือนถัดไป" onClick={() => changeMonth(1)}><ChevronRight size={16} /></Button>
          <Button variant="outline" size="sm" onClick={() => { const [y, m] = today.split("-").map(Number); setMonthIndex(y * 12 + m - 1); setSelectedDay(today); }}>วันนี้</Button>
          <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void refresh()}><RefreshCw size={14} /> {refreshing ? "กำลังโหลด" : "รีเฟรช"}</Button>
        </div>
      </div>

      <div className="calendar-filters">
        <div className="calendar-legend" aria-label="กรองตามภาษา">
          {([
            ["ALL", "ทั้งหมด"], ["queue", "คิวงานแปล"], ["RAW", "RAW"], ["ENG", "ENG"], ["TH", "TH"],
          ] as const).map(([kind, label]) => kind === "queue"
            ? <span className="calendar-legend-item" key={kind}><i className="calendar-swatch calendar-swatch-queue" />{label}</span>
            : <button key={kind} type="button" className={`calendar-legend-item ${language === kind ? "is-active" : ""}`} aria-pressed={language === kind} onClick={() => { setLanguage(kind); setSelectedDay(null); }}>
              {kind !== "ALL" && <i className={`calendar-swatch calendar-swatch-${kind.toLowerCase()}`} />}{label}
            </button>)}
        </div>
        <div className="calendar-filter-actions">
          <label className="calendar-tracked"><input type="checkbox" checked={trackedOnly} onChange={(event) => { setTrackedOnly(event.target.checked); setSelectedDay(null); }} />เฉพาะที่ติดตาม</label>
          <div className="calendar-search"><Search size={14} /><Input aria-label="ค้นหาในปฏิทิน" placeholder="ค้นหาเรื่องหรือตอน" value={query} onChange={(event) => { setQuery(event.target.value); setSelectedDay(null); }} /></div>
        </div>
      </div>

      <p className="calendar-swipe-hint">เลื่อนซ้าย–ขวาเพื่อดูครบ 7 วัน</p>
      <div className="calendar-scroll" role="region" aria-label="ตารางปฏิทิน เลื่อนแนวนอนได้บนจอเล็ก" tabIndex={0}>
        <div className="calendar-weekdays">{weekdays.map((name) => <div key={name}>{name}</div>)}</div>
        <div className="calendar-grid">
          {Array.from({ length: cellCount }, (_, index) => {
            const day = index - firstWeekday + 1;
            if (day < 1 || day > daysInMonth) return <div className="calendar-blank" key={`blank-${index}`} aria-hidden="true" />;
            const key = `${monthPrefix}${two(day)}`;
            const items = byDay.get(key) || [];
            return <div key={key} className={`calendar-day ${key === today ? "is-today" : ""} ${key === selectedDay ? "is-selected" : ""}`}>
              <button type="button" className="calendar-day-heading" aria-label={`${dayLabel(key)} ${items.length} รายการ`} onClick={() => setSelectedDay(key)}><span>{day}</span>{key === today && <span className="calendar-today-label">วันนี้</span>}</button>
              <div className="calendar-day-events">
                {items.slice(0, 4).map((release) => <button type="button" className={`calendar-event calendar-event-${kindOf(release).toLowerCase()}`} key={release.id} title={`${release.manga_title} · ตอน ${release.chapter} · ${release.source_name}`} onClick={() => setSelectedDay(key)}>
                  <span>{release.manga_title} · #{release.chapter}</span>
                </button>)}
              </div>
              {items.length > 4 && <button type="button" className="calendar-more" onClick={() => setSelectedDay(key)}>+อีก {items.length - 4} รายการ</button>}
            </div>;
          })}
        </div>
      </div>

      {selectedDay && selectedDay.startsWith(monthPrefix) && <div className="calendar-details">
        <div className="calendar-details-heading"><strong>{dayLabel(selectedDay)}</strong><span>{selected.length} รายการ</span></div>
        {selected.length ? <div className="calendar-details-list">{selected.map((release) => {
          const task = taskByRelease.get(release.id);
          const source = sourceById.get(release.source_id);
          return <div className="calendar-detail" key={release.id}>
            <span className={`calendar-detail-marker calendar-swatch-${kindOf(release).toLowerCase()}`} />
            <div><a href={safeUrl(release.url)} target="_blank" rel="noopener noreferrer">{release.manga_title} · ตอน {release.chapter}</a><small>{release.source_name} · {release.lang}{task ? ` · ${stageNames[task.stage]}` : ""}{source?.status.includes("นำเข้า") ? " · ข้อมูลนำเข้า ยังไม่ตรวจสด" : ""}</small></div>
          </div>;
        })}</div> : <p className="calendar-no-events">ไม่มีรายการในวันที่เลือก</p>}
      </div>}
      <p className="calendar-note">ใช้วันที่ตรวจพบหรือบันทึกในฐานข้อมูล ไม่ใช่กำหนดวันปล่อยตอน · รายการนำเข้าจาก tracker อาจยังไม่ได้ตรวจสด</p>
    </section>
  );
}
