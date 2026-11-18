export type Language = "RAW" | "ENG" | "TH" | "ALL";
export type Manga = {
  id: number;
  title: string;
  aliases: string;
  translated: string;
  tracked: number;
};
export type Source = {
  id: number;
  manga_id: number;
  name: string;
  url: string;
  kind: "mangadex" | "rss" | "manual";
  lang: Language;
  interval: number;
  enabled: number;
  checked: string | null;
  next_due: string | null;
  status: string;
};
export type Release = {
  id: number;
  manga_id: number;
  manga_title: string;
  source_id: number;
  source_name: string;
  chapter: string;
  title: string;
  url: string;
  lang: Language;
  published: string | null;
  detected: string;
};
export type Log = {
  id: number;
  source_id: number | null;
  source_name: string | null;
  at: string;
  status: string;
  message: string;
};
export type Task = {
  id: number;
  release_id: number;
  manga_id: number;
  manga_title: string;
  chapter: string;
  url: string;
  lang: Language;
  source_name: string;
  stage:
    | "RAW"
    | "OCR"
    | "TRANSLATE"
    | "PROOFREAD"
    | "LETTERING"
    | "PUBLISHER"
    | "PUBLISHED";
  updated: string;
};
export type AppState = {
  manga: Manga[];
  sources: Source[];
  releases: Release[];
  tasks: Task[];
  logs: Log[];
  refresh_mode: "all" | "tracked";
  busy: boolean;
};
export const emptyState: AppState = {
  manga: [],
  sources: [],
  releases: [],
  tasks: [],
  logs: [],
  refresh_mode: "all",
  busy: false,
};
