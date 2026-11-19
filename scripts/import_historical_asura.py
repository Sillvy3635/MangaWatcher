"""Add archived Asura tracker metadata to a private MangaWatcher schema 2 snapshot.

This reads local files only. It imports one last-observed record per exact title;
historical URL variants stay in the private manga-notifier archive.
"""

import argparse
import json
import os
import tempfile
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import urlparse

try:
    from scripts.import_manga_notifier import blame_observed_times, chapter_number, https_url, TABLES
except ModuleNotFoundError:
    from import_manga_notifier import blame_observed_times, chapter_number, https_url, TABLES


def import_historical_asura(base, tracker, observed):
    if base.get("schema_version") != 2 or any(
        not isinstance(base.get("tables", {}).get(name), list) for name in TABLES
    ):
        raise ValueError("ฐานข้อมูลเดิมไม่ใช่ MangaWatcher schema 2")
    snapshot = json.loads(json.dumps(base))
    tables = snapshot["tables"]
    groups = {}
    for key, record in tracker.items():
        if not key.startswith("asura:") or not isinstance(record, dict):
            continue
        title = record.get("title")
        if not isinstance(title, str) or not title.strip():
            raise ValueError(f"ไม่มีชื่อเรื่อง: {key}")
        series_url = https_url(record.get("series_url"))
        chapter_url = https_url(record.get("chapter_url"))
        if any(urlparse(url).hostname != "asurascans.com" for url in (series_url, chapter_url)):
            raise ValueError(f"URL ไม่ใช่ Asura: {key}")
        if key not in observed:
            raise ValueError(f"ไม่พบเวลา commit: {key}")
        chapter = chapter_number(record.get("chapter"))
        try:
            chapter_sort = Decimal(chapter)
        except InvalidOperation:
            chapter_sort = Decimal(-1)
        candidate = (observed[key], chapter_sort, key, record)
        groups.setdefault(title.strip(), []).append(candidate)

    existing_urls = {source["url"].rstrip("/") for source in tables["sources"]}
    existing_asura_titles = {
        manga["title"].casefold()
        for manga in tables["manga"]
        if any(source["manga_id"] == manga["id"] and
               urlparse(source["url"]).hostname == "asurascans.com"
               for source in tables["sources"])
    }
    ids = {name: max((row["id"] for row in tables[name]), default=0) + 1
           for name in ("manga", "sources", "releases", "logs")}
    imported_at = datetime.now(timezone.utc).isoformat()
    report = {"historical_keys": sum(map(len, groups.values())), "unique_titles": len(groups),
              "added_manga": 0, "added_sources": 0, "added_releases": 0,
              "already_present": 0}
    for title in sorted(groups):
        # A later saved chapter URL is the last observation, not proof that
        # the chapter or URL is still available on the website today.
        detected, _, _, record = max(groups[title], key=lambda row: (row[0], row[1], row[2]))
        series_url = https_url(record["series_url"])
        if series_url in existing_urls or title.casefold() in existing_asura_titles:
            report["already_present"] += 1
            continue
        manga_id, source_id, release_id, log_id = (ids[name] for name in ("manga", "sources", "releases", "logs"))
        for name in ids:
            ids[name] += 1
        tables["manga"].append({"id": manga_id, "title": title, "aliases": "", "raw_done": "",
                                "eng_done": "", "th_done": "", "translated": "", "tracked": 0})
        tables["sources"].append({"id": source_id, "manga_id": manga_id, "name": "Asura Scans",
                                  "url": series_url, "kind": "manual", "lang": "ENG", "interval": 60,
                                  "enabled": 0, "checked": None,
                                  "status": "นำเข้าประวัติจาก manga-notifier; ยังไม่ตรวจสด"})
        chapter_url = https_url(record["chapter_url"])
        tables["releases"].append({"id": release_id, "source_id": source_id,
                                   "chapter": chapter_number(record.get("chapter")),
                                   "title": record["chapter"], "url": chapter_url,
                                   "published": None, "detected": detected, "lang": "ENG",
                                   "external_id": chapter_url})
        tables["logs"].append({"id": log_id, "source_id": source_id, "at": imported_at,
                               "status": "นำเข้า", "message": "ประวัติ manga-notifier; เวลาอ้างอิงจาก Git commit; ยังไม่ตรวจเว็บไซต์สด"})
        existing_urls.add(series_url)
        existing_asura_titles.add(title.casefold())
        report["added_manga"] += 1
        report["added_sources"] += 1
        report["added_releases"] += 1
    if report["added_manga"]:
        snapshot["exported_at"] = imported_at
    return snapshot, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True, help="private manga-notifier checkout")
    parser.add_argument("--base", type=Path, required=True, help="existing private schema 2 JSON")
    parser.add_argument("--output", type=Path, required=True, help="private output path")
    args = parser.parse_args()
    tracker = json.loads((args.repo / "manga_tracker.json").read_text(encoding="utf-8-sig"))
    base = json.loads(args.base.read_text(encoding="utf-8"))
    snapshot, report = import_historical_asura(base, tracker, blame_observed_times(args.repo))
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=args.output.parent,
                                     prefix=".mangawatcher-", suffix=".tmp", delete=False) as temp:
        temp.write(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n")
        temp_path = temp.name
    try:
        os.replace(temp_path, args.output)
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
