import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CloudOff,
  Database,
  Download,
  ExternalLink,
  FileClock,
  Filter,
  Languages,
  GitBranch,
  LayoutDashboard,
  ListFilter,
  LogOut,
  Menu,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { MonthlyCalendar } from "./MonthlyCalendar";
import { api, ApiError, clearSession, cloudMode, getState, importSnapshot, loginUrl } from "./api";
import {
  emptyState,
  type AppState,
  type Language,
  type Manga,
  type Release,
  type Source,
  type Task,
  type Website,
} from "./types";

type Page =
  | "dashboard"
  | "updates"
  | "raw"
  | "library"
  | "watchlist"
  | "discover"
  | "queue"
  | "calendar"
  | "sources"
  | "notifications"
  | "logs"
  | "database"
  | "settings";
type Icon = typeof LayoutDashboard;
const navigation: { id: Page; label: string; icon: Icon; group: string }[] = [
  { id: "dashboard", label: "ภาพรวม", icon: LayoutDashboard, group: "ข้อมูล" },
  { id: "updates", label: "อัปเดตล่าสุด", icon: Radio, group: "ข้อมูล" },
  { id: "raw", label: "ติดตามต้นฉบับ", icon: Languages, group: "ข้อมูล" },
  { id: "library", label: "มังงะทั้งหมด", icon: BookOpen, group: "คลังและงานแปล" },
  {
    id: "watchlist",
    label: "รายการติดตาม",
    icon: ListFilter,
    group: "คลังและงานแปล",
  },
  { id: "discover", label: "ค้นหาเรื่องใหม่", icon: Search, group: "คลังและงานแปล" },
  { id: "queue", label: "คิวงานแปล", icon: Workflow, group: "คลังและงานแปล" },
  {
    id: "calendar",
    label: "ปฏิทินอัปเดต",
    icon: CalendarDays,
    group: "คลังและงานแปล",
  },
  { id: "sources", label: "เว็บไซต์ต้นทาง", icon: Filter, group: "ระบบ" },
  { id: "notifications", label: "การแจ้งเตือน", icon: Bell, group: "ระบบ" },
  { id: "logs", label: "ประวัติระบบ", icon: FileClock, group: "ระบบ" },
  { id: "database", label: "ฐานข้อมูล", icon: Database, group: "ระบบ" },
  { id: "settings", label: "ตั้งค่าระบบ", icon: Settings, group: "ระบบ" },
];
const pageTitle = (page: Page) =>
  navigation.find((item) => item.id === page)?.label || "ภาพรวม";
const pageFromUrl = (): Page => {
  const value = new URLSearchParams(window.location.search).get("view");
  return navigation.find((item) => item.id === value)?.id || "dashboard";
};
const thaiDate = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString("th-TH", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";
const safeUrl = (value: string) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "#";
  } catch {
    return "#";
  }
};
const csvCell = (value: unknown) =>
  `"${String(value ?? "").replaceAll('"', '""')}"`;

function useStored<T>(key: string, initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const save = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* private browsing */
    }
  };
  return [value, save];
}

type Column<T> = {
  key: string;
  label: string;
  value: (row: T) => string | number;
  cell?: (row: T) => ReactNode;
  width?: number;
};
function DenseTable<T extends { id: number }>({
  id,
  rows,
  columns,
  search,
  bulk,
}: {
  id: string;
  rows: T[];
  columns: Column<T>[];
  search?: string;
  bulk?: { label: string; run: (ids: number[]) => Promise<void> };
}) {
  const [sort, setSort] = useStored<{ key: string; desc: boolean }>(
    `mw.table.${id}.sort`,
    { key: columns[0].key, desc: false },
  );
  const [visible, setVisible] = useStored<string[]>(
    `mw.table.${id}.columns`,
    columns.map((c) => c.key),
  );
  const [widths, setWidths] = useStored<Record<string, number>>(
    `mw.table.${id}.widths`,
    {},
  );
  const [pageSize, setPageSize] = useStored<number>(
    `mw.table.${id}.pageSize`,
    25,
  );
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number[]>([]);
  const filtered = useMemo(
    () =>
      rows.filter(
        (row) =>
          !search ||
          columns.some((c) =>
            String(c.value(row))
              .toLocaleLowerCase()
              .includes(search.toLocaleLowerCase()),
          ),
      ),
    [rows, columns, search],
  );
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return filtered;
    return [...filtered].sort((a, b) => {
      const av = col.value(a),
        bv = col.value(b);
      const comparison =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv), "th", { numeric: true });
      return sort.desc ? -comparison : comparison;
    });
  }, [filtered, columns, sort]);
  const maxPage = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, maxPage);
  const shown = sorted.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const shownColumns = columns.filter((c) => visible.includes(c.key));
  const allChecked =
    shown.length > 0 && shown.every((row) => selected.includes(row.id));
  const resize = (event: React.PointerEvent, key: string) => {
    event.preventDefault();
    const start = event.clientX,
      initial = widths[key] || columns.find((c) => c.key === key)?.width || 140;
    const move = (e: PointerEvent) =>
      setWidths({
        ...widths,
        [key]: Math.max(90, initial + e.clientX - start),
      });
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };
  return (
    <div className="table-shell">
      <div className="table-tools">
        <span>{filtered.length.toLocaleString("th-TH")} รายการ</span>
        {bulk && selected.length > 0 && (
          <Button
            size="sm"
            onClick={async () => {
              await bulk.run(selected);
              setSelected([]);
            }}
          >
            {bulk.label} ({selected.length})
          </Button>
        )}
        <div className="table-tools-right">
          <details className="column-menu">
            <summary>คอลัมน์</summary>
            <div className="column-popover">
              {columns.map((c) => (
                <label key={c.key}>
                  <input
                    type="checkbox"
                    checked={visible.includes(c.key)}
                    onChange={() =>
                      setVisible(
                        visible.includes(c.key)
                          ? visible.filter((v) => v !== c.key)
                          : [...visible, c.key],
                      )
                    }
                  />{" "}
                  {c.label}
                </label>
              ))}
            </div>
          </details>
          <label className="page-size">
            แถว{" "}
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </label>
        </div>
      </div>
      <div className="table-scroll">
        <table className="dense-table">
          <thead>
            <tr>
              {bulk && (
                <th className="check-col">
                  <input
                    aria-label="เลือกทั้งหมดในหน้า"
                    type="checkbox"
                    checked={allChecked}
                    onChange={() =>
                      setSelected(
                        allChecked
                          ? selected.filter(
                              (id) => !shown.some((row) => row.id === id),
                            )
                          : [
                              ...new Set([
                                ...selected,
                                ...shown.map((row) => row.id),
                              ]),
                            ],
                      )
                    }
                  />
                </th>
              )}
              {shownColumns.map((c) => (
                <th key={c.key} style={{ width: widths[c.key] || c.width }}>
                  <button
                    className="sort-button"
                    onClick={() =>
                      setSort({
                        key: c.key,
                        desc: sort.key === c.key ? !sort.desc : false,
                      })
                    }
                  >
                    {c.label}{" "}
                    {sort.key === c.key ? (sort.desc ? "↓" : "↑") : ""}
                  </button>
                  <span
                    role="separator"
                    aria-label={`ปรับความกว้าง ${c.label}`}
                    className="resize-handle"
                    onPointerDown={(event) => resize(event, c.key)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.id}>
                {bulk && (
                  <td className="check-col">
                    <input
                      aria-label={`เลือกแถว ${row.id}`}
                      type="checkbox"
                      checked={selected.includes(row.id)}
                      onChange={() =>
                        setSelected(
                          selected.includes(row.id)
                            ? selected.filter((v) => v !== row.id)
                            : [...selected, row.id],
                        )
                      }
                    />
                  </td>
                )}
                {shownColumns.map((c) => (
                  <td key={c.key}>{c.cell ? c.cell(row) : c.value(row)}</td>
                ))}
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td
                  className="table-empty"
                  colSpan={shownColumns.length + (bulk ? 1 : 0)}
                >
                  ไม่มีรายการที่ตรงกับเงื่อนไข
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <span>
          หน้า {currentPage} / {maxPage}
        </span>
        <div>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="หน้าก่อน"
            disabled={currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
          >
            <ChevronLeft size={16} />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="หน้าถัดไป"
            disabled={currentPage >= maxPage}
            onClick={() => setPage(currentPage + 1)}
          >
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [data, setData] = useState<AppState>(emptyState);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState(0);
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState<Page>(pageFromUrl);
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState<Language>("ALL");
  const [collapsed, setCollapsed] = useStored("mw.sidebar.collapsed", false);
  const [mobileNav, setMobileNav] = useState(false);
  const [form, setForm] = useState<"manga" | "source" | "website" | "release" | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [mangaId, setMangaId] = useState<number | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await getState());
      setConnected(true);
      setError("");
      setErrorStatus(0);
    } catch (e) {
      setConnected(false);
      setError((e as Error).message);
      setErrorStatus(e instanceof ApiError ? e.status : 0);
    }
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 10000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [load]);
  useEffect(() => {
    const onBack = () => setPage(pageFromUrl());
    window.addEventListener("popstate", onBack);
    return () => window.removeEventListener("popstate", onBack);
  }, []);
  const mutate = async (path: string, payload: unknown) => {
    await api(path, payload);
    await load();
    setNotice("บันทึกข้อมูลแล้ว");
  };
  const action = (path: string, payload: unknown) => {
    void mutate(path, payload).catch((e) => setNotice((e as Error).message));
  };
  const open = (
    kind: "manga" | "source" | "website" | "release",
    id?: number,
    parent?: number,
  ) => {
    setForm(kind);
    setEditingId(id || null);
    setMangaId(parent || null);
  };
  const close = () => {
    setForm(null);
    setEditingId(null);
    setMangaId(null);
  };
  const refresh = async (id?: number) => {
    try {
      await api("refresh", id ? { id } : {});
      setNotice("เริ่มตรวจสอบแล้ว ดูผลในประวัติระบบ");
      await load();
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  const remove = async (type: "manga" | "source" | "website", id: number) => {
    if (window.confirm(type === "website" ? "ลบเว็บไซต์นี้จากทะเบียนหรือไม่?" : "ลบรายการนี้และข้อมูลตอนที่เกี่ยวข้องหรือไม่?")) {
      try {
        await mutate("delete", { type, id });
      } catch (e) {
        setNotice((e as Error).message);
      }
    }
  };
  const navigate = (next: Page) => {
    setPage(next);
    const url = new URL(window.location.href);
    if (next === "dashboard") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    window.history.pushState(null, "", url);
    setSearch("");
    setLanguage("ALL");
    setMobileNav(false);
  };
  const mangaName = (id: number) =>
    data.manga.find((m) => m.id === id)?.title || "ไม่พบเรื่อง";
  const latest = (id: number, lang: Language) =>
    data.releases
      .filter(
        (r) =>
          r.manga_id === id &&
          r.lang === lang &&
          /^\d+(?:\.\d+)?$/.test(r.chapter),
      )
      .sort((a, b) => Number(b.chapter) - Number(a.chapter))[0]?.chapter || "—";
  const languageBadge = (lang: Language) => (
    <Badge className={`language-badge language-${lang.toLowerCase()}`}>
      {lang}
    </Badge>
  );
  const sourceBadge = (source: Source) => (
    <Badge
      className={
        source.enabled
          ? source.status === "ผิดพลาด"
            ? "badge-error"
            : source.status === "ปกติ"
              ? "badge-success"
              : "badge-muted"
          : "badge-muted"
      }
    >
      {source.enabled ? source.status : "ปิดอยู่"}
    </Badge>
  );
  const releaseColumns: Column<Release>[] = [
    {
      key: "detected",
      label: "ตรวจพบ",
      width: 150,
      value: (r) => r.detected,
      cell: (r) => <span className="muted">{thaiDate(r.detected)}</span>,
    },
    {
      key: "manga",
      label: "เรื่อง / ตอน",
      width: 310,
      value: (r) => `${r.manga_title} ${r.chapter}`,
      cell: (r) => (
        <div className="row-title">
          <strong>{r.manga_title}</strong>
          <small>
            ตอน {r.chapter}
            {r.title ? ` · ${r.title}` : ""}
          </small>
        </div>
      ),
    },
    {
      key: "lang",
      label: "ภาษา",
      width: 85,
      value: (r) => r.lang,
      cell: (r) => languageBadge(r.lang),
    },
    { key: "source", label: "ต้นทาง", width: 170, value: (r) => r.source_name },
    {
      key: "published",
      label: "เผยแพร่",
      width: 150,
      value: (r) => r.published || "",
      cell: (r) => <span className="muted">{thaiDate(r.published)}</span>,
    },
    {
      key: "url",
      label: "ลิงก์",
      width: 90,
      value: (r) => r.url,
      cell: (r) => (
        <a
          className="link"
          href={safeUrl(r.url)}
          target="_blank"
          rel="noopener noreferrer"
        >
          เปิด <ExternalLink size={13} />
        </a>
      ),
    },
    {
      key: "queue",
      label: "คิวงานแปล",
      width: 110,
      value: (r) => r.id,
      cell: (r) =>
        r.lang === "TH" ? (
          "—"
        ) : data.tasks.some((t) => t.release_id === r.id) ? (
          <Badge className="badge-success">อยู่ในคิว</Badge>
        ) : (
          <Button
            size="xs"
            variant="outline"
            onClick={() => action("task", { release_id: r.id, stage: "RAW" })}
          >
            <Plus size={13} /> เข้าคิว
          </Button>
        ),
    },
  ];
  const taskColumns: Column<Task>[] = [
    {
      key: "manga",
      label: "เรื่อง / ตอน",
      width: 310,
      value: (t) => `${t.manga_title} ${t.chapter}`,
      cell: (t) => (
        <div className="row-title">
          <strong>{t.manga_title}</strong>
          <small>
            ตอน {t.chapter} · {t.source_name}
          </small>
        </div>
      ),
    },
    {
      key: "lang",
      label: "ภาษา",
      width: 90,
      value: (t) => t.lang,
      cell: (t) => languageBadge(t.lang),
    },
    {
      key: "stage",
      label: "ขั้นตอนงานแปล",
      width: 190,
      value: (t) => t.stage,
      cell: (t) => (
        <select
          aria-label={`ขั้นตอน ${t.manga_title} ตอน ${t.chapter}`}
          className="field-select stage-select"
          value={t.stage}
          onChange={(e) =>
            action("task", { release_id: t.release_id, stage: e.target.value })
          }
        >
          {[
            ["RAW", "RAW"],
            ["OCR", "OCR"],
            ["TRANSLATE", "แปล"],
            ["PROOFREAD", "ตรวจคำ"],
            ["LETTERING", "ลงคำ"],
            ["PUBLISHER", "Publisher"],
            ["PUBLISHED", "เผยแพร่"],
          ].map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: "updated",
      label: "แก้ไขล่าสุด",
      width: 150,
      value: (t) => t.updated,
      cell: (t) => thaiDate(t.updated),
    },
    {
      key: "url",
      label: "ต้นทาง",
      width: 90,
      value: (t) => t.url,
      cell: (t) => (
        <a
          className="link"
          href={safeUrl(t.url)}
          target="_blank"
          rel="noopener noreferrer"
        >
          เปิด <ExternalLink size={13} />
        </a>
      ),
    },
  ];
  const mangaColumns: Column<Manga>[] = [
    {
      key: "title",
      label: "ชื่อเรื่อง / Alias",
      width: 310,
      value: (m) => `${m.title} ${m.aliases}`,
      cell: (m) => (
        <div className="row-title">
          <strong>{m.title}</strong>
          <small>{m.aliases || "ไม่มีชื่ออื่น"}</small>
        </div>
      ),
    },
    { key: "raw", label: "RAW", width: 95, value: (m) => latest(m.id, "RAW") },
    { key: "eng", label: "ENG", width: 95, value: (m) => latest(m.id, "ENG") },
    { key: "th", label: "TH", width: 95, value: (m) => latest(m.id, "TH") },
    {
      key: "translated",
      label: "แปลเอง",
      width: 100,
      value: (m) => m.translated || "—",
    },
    {
      key: "sources",
      label: "แหล่ง",
      width: 85,
      value: (m) => data.sources.filter((s) => s.manga_id === m.id).length,
    },
    {
      key: "tracked",
      label: "ติดตาม",
      width: 95,
      value: (m) => m.tracked,
      cell: (m) => (
        <Badge className={m.tracked ? "badge-success" : "badge-muted"}>
          {m.tracked ? "ติดตาม" : "ไม่ติดตาม"}
        </Badge>
      ),
    },
    {
      key: "actions",
      label: "จัดการ",
      width: 165,
      value: (m) => m.id,
      cell: (m) => (
        <div className="row-actions">
          <Button
            size="icon-sm"
            variant="outline"
            aria-label={`แก้ไข ${m.title}`}
            onClick={() => open("manga", m.id)}
          >
            <Pencil size={14} />
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label={`เพิ่มเว็บไซต์ให้ ${m.title}`}
            onClick={() => open("source", undefined, m.id)}
          >
            <Plus size={14} />
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label={`ลบ ${m.title}`}
            onClick={() => void remove("manga", m.id)}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ),
    },
  ];
  const sourceColumns: Column<Source>[] = [
    {
      key: "name",
      label: "เว็บไซต์ / เรื่อง",
      width: 280,
      value: (s) => `${s.name} ${mangaName(s.manga_id)}`,
      cell: (s) => (
        <div className="row-title">
          <strong>{s.name}</strong>
          <small>{mangaName(s.manga_id)}</small>
        </div>
      ),
    },
    {
      key: "kind",
      label: "Adapter",
      width: 120,
      value: (s) => s.kind.toUpperCase(),
    },
    {
      key: "lang",
      label: "ภาษา",
      width: 90,
      value: (s) => s.lang,
      cell: (s) => languageBadge(s.lang),
    },
    {
      key: "interval",
      label: "รอบ",
      width: 90,
      value: (s) => s.interval,
      cell: (s) => `${s.interval} นาที`,
    },
    {
      key: "status",
      label: "สถานะ",
      width: 125,
      value: (s) => s.status,
      cell: (s) => sourceBadge(s),
    },
    {
      key: "checked",
      label: "ตรวจล่าสุด",
      width: 145,
      value: (s) => s.checked || "",
      cell: (s) => thaiDate(s.checked),
    },
    {
      key: "next_due",
      label: "รอบถัดไป",
      width: 145,
      value: (s) => s.next_due || "",
      cell: (s) =>
        s.enabled && s.kind !== "manual"
          ? s.next_due
            ? thaiDate(s.next_due)
            : "ยังไม่ตรวจ"
          : "—",
    },
    {
      key: "actions",
      label: "จัดการ",
      width: 165,
      value: (s) => s.id,
      cell: (s) => (
        <div className="row-actions">
          <Button
            size="icon-sm"
            variant="outline"
            aria-label={`ตรวจ ${s.name}`}
            disabled={cloudMode || !s.enabled || s.kind === "manual" || data.busy}
            onClick={() => void refresh(s.id)}
          >
            <RefreshCw size={14} />
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label={`แก้ไข ${s.name}`}
            onClick={() => open("source", s.id)}
          >
            <Pencil size={14} />
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label={`ลบ ${s.name}`}
            onClick={() => void remove("source", s.id)}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ),
    },
  ];
  const websiteColumns: Column<Website>[] = [
    { key: "name", label: "เว็บไซต์", width: 210, value: (site) => site.name },
    { key: "url", label: "URL", width: 360, value: (site) => site.url,
      cell: (site) => <a href={site.url} target="_blank" rel="noopener noreferrer">{site.url}</a> },
    { key: "lang", label: "ภาษา", width: 90, value: (site) => site.lang,
      cell: (site) => languageBadge(site.lang) },
    { key: "status", label: "สถานะ", width: 220, value: (site) => site.status },
    { key: "actions", label: "จัดการ", width: 105, value: (site) => site.id,
      cell: (site) => <div className="row-actions">
        <Button size="icon-sm" variant="outline" aria-label={`แก้ไข ${site.name}`} onClick={() => open("website", site.id)}><Pencil size={14} /></Button>
        <Button size="icon-sm" variant="outline" aria-label={`ลบ ${site.name}`} onClick={() => void remove("website", site.id)}><Trash2 size={14} /></Button>
      </div> },
  ];
  const filteredReleases = data.releases.filter(
    (r) => language === "ALL" || r.lang === language,
  );
  const headingActions =
    page === "library" || page === "watchlist" ? (
      <Button onClick={() => open("manga")}>
        <Plus size={15} /> เพิ่มเรื่อง
      </Button>
    ) : page === "sources" ? (
      <div className="row-actions">
        <Button onClick={() => open("website")}><Plus size={15} /> เพิ่มเว็บไซต์</Button>
        <Button variant="outline" onClick={() => open("source")}><Plus size={15} /> เพิ่มแหล่งรายเรื่อง</Button>
      </div>
    ) : page === "updates" ? (
      <Button onClick={() => open("release")}>
        <Plus size={15} /> เพิ่มตอนเอง
      </Button>
    ) : null;
  const searchBar = (
    <div className="filter-bar">
      <div className="search-wrap">
        <Search size={16} />
        <Input
          placeholder="ค้นหาทันที..."
          aria-label="ค้นหา"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {["updates", "raw"].includes(page) && (
        <select
          className="field-select"
          value={language}
          onChange={(e) => setLanguage(e.target.value as Language)}
        >
          <option value="ALL">ทุกภาษา</option>
          <option value="RAW">RAW</option>
          <option value="ENG">ENG</option>
          <option value="TH">TH</option>
        </select>
      )}
    </div>
  );
  const section = (title: string, children: ReactNode, action?: ReactNode) => (
    <section className="section">
      <div className="section-heading">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
  const empty = (title: string, detail: string) => (
    <div className="empty-state">
      <CircleHelp size={22} />
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
  const exportFile = (filename: string, content: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };
  const exportCsv = () =>
    exportFile(
      "mangawatcher-releases.csv",
      "\uFEFF" +
        [
          ["เรื่อง", "ตอน", "ภาษา", "ต้นทาง", "URL", "เผยแพร่", "ตรวจพบ"]
            .map(csvCell)
            .join(","),
          ...data.releases.map((r) =>
            [
              r.manga_title,
              r.chapter,
              r.lang,
              r.source_name,
              r.url,
              r.published,
              r.detected,
            ]
              .map(csvCell)
              .join(","),
          ),
        ].join("\r\n"),
      "text/csv;charset=utf-8",
    );
  const exportBackup = async () => {
    try {
      const snapshot = await api<unknown>("export");
      exportFile(
        `mangawatcher-backup-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(snapshot, null, 2),
        "application/json",
      );
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  const importBackup = async (file?: File) => {
    if (!file) return;
    try {
      const snapshot: unknown = JSON.parse(await file.text());
      if (
        !window.confirm(
          cloudMode
            ? "นำเข้าไฟล์นี้แทนข้อมูลปัจจุบันทั้งหมด? กรุณาส่งออก JSON เก็บไว้ก่อน ระบบจะตรวจรุ่นข้อมูลและบันทึกใน GitHub history"
            : "นำเข้าไฟล์นี้แทนข้อมูลปัจจุบันทั้งหมด? ระบบจะสำรองฐานข้อมูลเดิมก่อนเปลี่ยนข้อมูล",
        )
      )
        return;
      const result = await importSnapshot(snapshot);
      await load();
      setNotice(`นำเข้าสำเร็จ · สำรองเดิมไว้ที่ ${result.backup}`);
    } catch (e) {
      setNotice(`นำเข้าไม่สำเร็จ: ${(e as Error).message}`);
    }
  };

  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">
            <BookOpen size={20} />
          </span>
          <div className="brand-copy">
            <strong>MangaWatcher</strong>
            <small>ระบบติดตามส่วนตัว</small>
          </div>
          <Button
            className="sidebar-toggle"
            variant="ghost"
            size="icon-sm"
            aria-label="ย่อหรือขยายเมนู"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </Button>
        </div>
        <nav aria-label="เมนูหลัก">
          {navigation.map((item, index) => (
            <div key={item.id}>
              {index === 0 || navigation[index - 1].group !== item.group ? (
                <span className="nav-group">{item.group}</span>
              ) : null}
              <button
                title={item.label}
                className={`nav-item ${page === item.id ? "active" : ""}`}
                onClick={() => navigate(item.id)}
              >
                <item.icon size={17} />
                <span>{item.label}</span>
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="status-dot" /> Local MVP{" "}
          <small>ข้อมูลอยู่ในเครื่องของคุณ</small>
        </div>
      </aside>
      {mobileNav && (
        <button
          className="mobile-scrim"
          aria-label="ปิดเมนู"
          onClick={() => setMobileNav(false)}
        />
      )}
      <div className="main-column">
        <header className="topbar">
          <div className="topbar-left">
            <Button
              className="mobile-menu"
              variant="ghost"
              size="icon-sm"
              aria-label="เปิดเมนู"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={19} />
            </Button>
            <span className="breadcrumb">
              MangaWatcher <ChevronRight size={14} /> {pageTitle(page)}
            </span>
          </div>
          <div className="top-status">
            <Badge className={connected ? "badge-success" : "badge-error"}>
              <span className="status-dot" />{" "}
              {connected ? (cloudMode ? "Cloud API เชื่อมต่อ" : "Local API เชื่อมต่อ") : "ไม่เชื่อมต่อ"}
            </Badge>
            <Badge className="badge-muted">
              <Database size={13} /> {cloudMode ? "GitHub Private JSON" : "SQLite ในเครื่อง"}
            </Badge>
            <Badge className="badge-muted">
              <GitBranch size={13} /> {cloudMode && connected ? "GitHub เชื่อมต่อ" : "GitHub ยังไม่เชื่อม"}
            </Badge>
            <Badge className="badge-muted">
              <CloudOff size={13} /> Actions ยังไม่เชื่อม
            </Badge>
            {cloudMode && connected && <Button variant="outline" size="sm" onClick={() => {
              void api("logout", {}).then(() => { clearSession(); window.location.reload(); }).catch((e) => setNotice((e as Error).message));
            }}><LogOut size={14} /> ออกจากระบบ</Button>}
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">MANGAWATCHER / {pageTitle(page)}</p>
              <h1>{pageTitle(page)}</h1>
              <p>จัดการข้อมูลมังงะและงานแปลจากแหล่งที่คุณเพิ่มไว้</p>
            </div>
            <div className="heading-actions">
              {headingActions}
              {!cloudMode && <Button
                variant="outline"
                disabled={!connected || data.busy}
                onClick={() => void refresh()}
              >
                <RefreshCw size={15} className={data.busy ? "spin" : ""} />{" "}
                {data.busy ? "กำลังตรวจ..." : "ตรวจตอนใหม่"}
              </Button>}
            </div>
          </div>
          {error && (
            <div role="alert" className="alert-error">
              {cloudMode ? error : `เชื่อมต่อ API ไม่ได้: ${error} · เปิด python server.py ก่อนใช้งาน`}
              {cloudMode && errorStatus === 401 && <a href={loginUrl()} className="ml-3 underline">เข้าสู่ระบบด้วย GitHub</a>}
            </div>
          )}
          {notice && (
            <div role="status" className="notice">
              <span>{notice}</span>
              <button aria-label="ปิดข้อความ" onClick={() => setNotice("")}>
                <X size={15} />
              </button>
            </div>
          )}
          {page === "dashboard" && (
            <>
              <div className="stats-grid">
                {[
                  {
                    label: "เรื่องทั้งหมด",
                    value: data.manga.length,
                    icon: BookOpen,
                  },
                  {
                    label: "รายการติดตาม",
                    value: data.manga.filter((m) => m.tracked).length,
                    icon: Check,
                  },
                  {
                    label: "ตอนที่ตรวจพบ",
                    value: data.releases.length,
                    icon: Radio,
                  },
                  {
                    label: "แหล่งผิดพลาด",
                    value: data.sources.filter((s) => s.status === "ผิดพลาด")
                      .length,
                    icon: Activity,
                  },
                ].map((stat) => (
                  <div className="stat-tile" key={stat.label}>
                    <div>
                      <small>{stat.label}</small>
                      <strong>{stat.value.toLocaleString("th-TH")}</strong>
                    </div>
                    <stat.icon size={18} />
                  </div>
                ))}
              </div>
              {section(
                "อัปเดตล่าสุด",
                <DenseTable
                  id="dashboard-releases"
                  rows={data.releases.slice(0, 20)}
                  columns={releaseColumns}
                />,
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate("updates")}
                >
                  ดูทั้งหมด <ChevronRight size={15} />
                </Button>,
              )}
              {section(
                "สถานะแหล่งข้อมูล",
                <div className="source-strip">
                  <span>
                    ใช้งาน {data.sources.filter((s) => s.enabled).length} แหล่ง
                  </span>
                  <span>
                    ปกติ {data.sources.filter((s) => s.status === "ปกติ").length}
                  </span>
                  <span>
                    ผิดพลาด{" "}
                    {data.sources.filter((s) => s.status === "ผิดพลาด").length}
                  </span>
                  <span>
                    โหมด:{" "}
                    {data.refresh_mode === "tracked"
                      ? "เฉพาะติดตาม"
                      : "ทุกเรื่องที่ผูกแหล่ง"}
                  </span>
                </div>,
              )}
            </>
          )}
          {(page === "updates" || page === "raw") &&
            section(
              page === "raw" ? "ตอนต้นฉบับที่ตรวจพบ" : "ตอนจากทุกแหล่ง",
              <>
                {searchBar}
                <DenseTable
                  id={page}
                  rows={
                    page === "raw"
                      ? filteredReleases.filter((r) => r.lang === "RAW")
                      : filteredReleases
                  }
                  columns={releaseColumns}
                  search={search}
                />
              </>,
            )}
          {(page === "library" || page === "watchlist") &&
            section(
              page === "watchlist" ? "เรื่องที่ติดตาม" : "คลังมังงะ",
              <>
                {searchBar}
                <DenseTable
                  id={page}
                  rows={
                    page === "watchlist"
                      ? data.manga.filter((m) => m.tracked)
                      : data.manga
                  }
                  columns={mangaColumns}
                  search={search}
                  bulk={{
                    label: page === "watchlist" ? "เลิกติดตาม" : "ติดตาม",
                    run: async (ids) => {
                      try {
                        await mutate("bulk-track", {
                          ids,
                          tracked: page === "library",
                        });
                      } catch (e) {
                        setNotice((e as Error).message);
                      }
                    },
                  }}
                />
              </>,
            )}
          {page === "discover" &&
            section(
              "ค้นหาเรื่องใหม่",
              empty(
                "ยังไม่มีแหล่งค้นหาทั้งเว็บไซต์",
                "ระบบตรวจเฉพาะเรื่องและฟีดที่เพิ่มไว้ การค้นหาข้ามเว็บไซต์ต้องมี API หรือฟีดที่ได้รับอนุญาตจากเจ้าของเว็บ",
              ),
            )}
          {page === "queue" &&
            section(
              "คิวงานแปลรายตอน",
              <>
                {searchBar}
                <DenseTable
                  id="translation"
                  rows={data.tasks}
                  columns={taskColumns}
                  search={search}
                />
                <p className="section-note">
                  ตอน RAW ใหม่ของเรื่องที่ติดตามจะเข้าคิวตาม release ID
                  ของต้นทางโดยอัตโนมัติ ตอนเดิมหรือ ENG เพิ่มเข้าคิวได้จากหน้าอัปเดตล่าสุด
                  ไม่มีการรวมตอนที่กำกวมข้ามเว็บไซต์อัตโนมัติ
                </p>
              </>,
            )}
          {page === "calendar" && <MonthlyCalendar
            releases={data.releases}
            manga={data.manga}
            sources={data.sources}
            tasks={data.tasks}
            onRefresh={load}
          />}
          {page === "sources" && (
            <>
              {section(
                "ทะเบียนเว็บไซต์ต้นทาง",
                <>
                  {searchBar}
                  <DenseTable id="websites" rows={data.websites} columns={websiteColumns} search={search} />
                  <p className="form-help">เว็บไซต์ในทะเบียนยังไม่ถูกตรวจอัตโนมัติ ต้องมี Adapter และสิทธิ์เข้าถึงก่อน</p>
                </>,
              )}
              {section(
                "แหล่งรายเรื่องที่เพิ่มไว้",
                <>
                  {searchBar}
                  <DenseTable
                    id="sources"
                    rows={data.sources}
                    columns={sourceColumns}
                    search={search}
                  />
                </>,
              )}
              {section(
                "Adapter ที่รองรับ",
                <div className="source-strip">
                  <span>MangaDex API</span>
                  <span>RSS / Atom</span>
                  <span>เพิ่มตอนเอง</span>
                  <span>Thunder / QiManga: ใช้ RSS สาธารณะผูก URL รายเรื่อง</span>
                  <span>Asura: รอสิทธิ์หรือฟีดที่เว็บอนุญาต</span>
                </div>,
              )}
            </>
          )}
          {page === "notifications" &&
            section(
              "ช่องทางแจ้งเตือน",
              empty(
                "ยังไม่เชื่อมบริการแจ้งเตือน",
                "Discord, Telegram และ Push ต้องมี backend ที่เก็บ secret อย่างปลอดภัย ขณะนี้ดูตอนใหม่ได้ในหน้าอัปเดตล่าสุด",
              ),
            )}
          {page === "logs" &&
            section(
              "ประวัติการตรวจ 100 รายการล่าสุด",
              <DenseTable
                id="logs"
                rows={data.logs}
                columns={[
                  {
                    key: "at",
                    label: "เวลา",
                    width: 150,
                    value: (l) => l.at,
                    cell: (l) => thaiDate(l.at),
                  },
                  {
                    key: "source",
                    label: "ต้นทาง",
                    width: 190,
                    value: (l) => l.source_name || "ลบแล้ว",
                  },
                  {
                    key: "status",
                    label: "สถานะ",
                    width: 120,
                    value: (l) => l.status,
                    cell: (l) => (
                      <Badge
                        className={
                          l.status === "ปกติ" ? "badge-success" : "badge-error"
                        }
                      >
                        {l.status}
                      </Badge>
                    ),
                  },
                  {
                    key: "message",
                    label: "รายละเอียด",
                    width: 330,
                    value: (l) => l.message,
                  },
                ]}
              />,
            )}
          {page === "database" &&
            section(
              cloudMode ? "ข้อมูลส่วนตัวออนไลน์" : "ข้อมูลในเครื่อง",
              <div className="database-panel">
                <div>
                  <Database size={25} />
                  <div>
                    <strong>{cloudMode ? "GitHub · Private JSON" : "SQLite · Local"}</strong>
                    <p>
                      {cloudMode ? "ข้อมูลอยู่ใน private repository ที่กำหนดบนเซิร์ฟเวอร์" : "ข้อมูลจริงเก็บใน data/mangawatcher.sqlite3 หรือฐานข้อมูล MangaPulse เดิม"}
                    </p>
                  </div>
                </div>
                <div className="database-actions">
                  <Button variant="outline" onClick={() => void exportBackup()}>
                    <Download size={15} /> สำรอง JSON ทั้งหมด
                  </Button>
                  <Button variant="outline" onClick={exportCsv}>
                    <Download size={15} /> ส่งออกตอน CSV
                  </Button>
                  <label className="import-label">
                    นำเข้า JSON
                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={(e) => {
                        void importBackup(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
                <p className="section-note">
                  {cloudMode ? "การนำเข้าบันทึกเป็น GitHub commit ใหม่และตรวจ SHA ก่อนเขียน เก็บไฟล์ JSON สำรองไว้เป็นส่วนตัว" : "การนำเข้าจะแทนข้อมูลปัจจุบันแบบธุรกรรมเดียว และสร้างไฟล์ .pre-import-*.bak ก่อนเสมอ เก็บไฟล์ JSON/SQLite ไว้เป็นส่วนตัว"}
                </p>
              </div>,
            )}
          {page === "settings" && (
            <>
              {section(
                "การตรวจสอบอัตโนมัติ",
                <div className="settings-panel">
                  <label htmlFor="refresh-mode">ขอบเขตการตรวจ</label>
                  <select
                    id="refresh-mode"
                    className="field-select"
                    value={data.refresh_mode}
                    onChange={(e) =>
                      action("settings", { refresh_mode: e.target.value })
                    }
                  >
                    <option value="all">ทุกเรื่องที่ผูกแหล่งข้อมูล</option>
                    <option value="tracked">เฉพาะเรื่องที่ติดตาม</option>
                  </select>
                  <p>
                    ปุ่มตรวจรายแหล่งยังใช้งานได้เสมอ และ scheduler local
                    ทำงานขณะเปิดโปรแกรม
                  </p>
                </div>,
              )}
              {section(
                "ความปลอดภัย",
                <div className="source-strip">
                  <span>
                    <ShieldCheck size={16} /> Local API ผูก 127.0.0.1 เท่านั้น
                  </span>
                  <span>ไม่ใส่ token ใน frontend</span>
                  <span>ยังไม่มี OAuth หรือ cloud backend</span>
                </div>,
              )}
            </>
          )}
        </main>
      </div>
      {form && (
        <EditorModal
          kind={form}
          editingId={editingId}
          mangaId={mangaId}
          data={data}
          onClose={close}
          onSubmit={async (path, payload) => {
            await mutate(path, payload);
            close();
          }}
        />
      )}
    </div>
  );
}

function EditorModal({
  kind,
  editingId,
  mangaId,
  data,
  onClose,
  onSubmit,
}: {
  kind: "manga" | "source" | "website" | "release";
  editingId: number | null;
  mangaId: number | null;
  data: AppState;
  onClose: () => void;
  onSubmit: (path: string, payload: unknown) => Promise<void>;
}) {
  const manga = data.manga.find((m) => m.id === editingId);
  const source = data.sources.find((s) => s.id === editingId);
  const website = data.websites.find((site) => site.id === editingId);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setWorking(true);
    setError("");
    const fields = Object.fromEntries(
      new FormData(event.currentTarget),
    ) as Record<string, string>;
    try {
      if (kind === "manga")
        await onSubmit("manga", {
          ...fields,
          id: editingId,
          tracked: fields.tracked === "on",
        });
      if (kind === "source")
        await onSubmit("source", {
          ...fields,
          id: editingId,
          enabled: fields.enabled === "on",
        });
      if (kind === "website") await onSubmit("website", { ...fields, id: editingId });
      if (kind === "release") await onSubmit("release", fields);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form className="editor-modal" onSubmit={(event) => void submit(event)}>
        <div className="modal-header">
          <h2>
            {kind === "manga"
              ? editingId
                ? "แก้ไขมังงะ"
                : "เพิ่มมังงะ"
              : kind === "source"
                ? editingId
                  ? "แก้ไขแหล่งรายเรื่อง"
                  : "เพิ่มแหล่งรายเรื่อง"
                : kind === "website"
                  ? editingId ? "แก้ไขเว็บไซต์ต้นทาง" : "เพิ่มเว็บไซต์ต้นทาง"
                  : "เพิ่มตอนด้วยตัวเอง"}
          </h2>
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            aria-label="ปิด"
            onClick={onClose}
          >
            <X size={17} />
          </Button>
        </div>
        <div className="modal-body">
          {kind === "manga" && (
            <>
              <label>
                ชื่อเรื่อง{" "}
                <Input name="title" required defaultValue={manga?.title} />
              </label>
              <label>
                ชื่ออื่น / Alias (คั่นด้วย |){" "}
                <Input name="aliases" defaultValue={manga?.aliases} />
              </label>
              <label>
                แปลเองถึงตอน{" "}
                <Input name="translated" defaultValue={manga?.translated} />
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  name="tracked"
                  defaultChecked={!!(manga?.tracked ?? 1)}
                />{" "}
                ติดตามเรื่องนี้
              </label>
            </>
          )}
          {kind === "source" && (
            <>
              <label>
                เรื่อง{" "}
                <select
                  className="field-select"
                  name="manga_id"
                  required
                  defaultValue={source?.manga_id || mangaId || ""}
                >
                  <option value="" disabled>
                    เลือกเรื่อง
                  </option>
                  {data.manga.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                ชื่อเว็บไซต์{" "}
                <Input name="name" required defaultValue={source?.name} />
              </label>
              <label>
                Adapter{" "}
                <select
                  className="field-select"
                  name="kind"
                  defaultValue={source?.kind || "rss"}
                >
                  <option value="rss">RSS / Atom</option>
                  <option value="site_feed">Thunder / QiManga RSS</option>
                  <option value="mangadex">MangaDex API</option>
                  <option value="manual">เพิ่มตอนเอง</option>
                </select>
              </label>
              <label>
                URL หน้าเรื่องหรือฟีด{" "}
                <Input
                  type="url"
                  name="url"
                  required
                  defaultValue={source?.url}
                />
              </label>
              <div className="form-grid">
                <label>
                  ภาษา{" "}
                  <select
                    className="field-select"
                    name="lang"
                    defaultValue={source?.lang || "ENG"}
                  >
                    <option>RAW</option>
                    <option>ENG</option>
                    <option>TH</option>
                    <option>ALL</option>
                  </select>
                </label>
                <label>
                  รอบตรวจ (นาที){" "}
                  <Input
                    type="number"
                    name="interval"
                    min={30}
                    max={1440}
                    required
                    defaultValue={source?.interval || 60}
                  />
                </label>
              </div>
              <label className="check-label">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={!!(source?.enabled ?? 1)}
                />{" "}
                เปิดใช้งาน
              </label>
              <p className="form-help">
                ALL ใช้กับ MangaDex เท่านั้น ใช้ API หรือ RSS ที่ได้รับอนุญาต
              </p>
            </>
          )}
          {kind === "website" && (
            <>
              <label>ชื่อเว็บไซต์ <Input name="name" required maxLength={150} defaultValue={website?.name} /></label>
              <label>URL หน้ารวมเรื่อง <Input type="url" name="url" required defaultValue={website?.url} placeholder="https://example.org/series" /></label>
              <label>ภาษา <select className="field-select" name="lang" defaultValue={website?.lang || "ENG"}>
                <option>RAW</option><option>ENG</option><option>TH</option>
              </select></label>
              <p className="form-help">บันทึกเป็นทะเบียนเว็บไซต์เท่านั้น ยังไม่เริ่มดึงข้อมูลจนกว่าจะมี Adapter และตรวจสิทธิ์ใช้งาน</p>
            </>
          )}
          {kind === "release" && (
            <>
              <label>
                เว็บไซต์ต้นทาง{" "}
                <select className="field-select" name="source_id" required>
                  <option value="">เลือกเว็บไซต์</option>
                  {data.sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} /{" "}
                      {data.manga.find((m) => m.id === s.manga_id)?.title}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-grid">
                <label>
                  เลขตอน <Input name="chapter" required />
                </label>
                <label>
                  ภาษา{" "}
                  <select className="field-select" name="lang">
                    <option>RAW</option>
                    <option>ENG</option>
                    <option>TH</option>
                  </select>
                </label>
              </div>
              <label>
                ชื่อตอน <Input name="title" />
              </label>
              <label>
                URL ตอน <Input type="url" name="url" required />
              </label>
            </>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <Button type="button" variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button disabled={working} type="submit">
            {working ? "กำลังบันทึก..." : "บันทึก"}
          </Button>
        </div>
      </form>
    </div>
  );
}

export default App;
