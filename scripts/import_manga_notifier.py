"""Convert a private manga-notifier snapshot to MangaWatcher schema 2.

Only series in manga_list.json are imported. The source pages are never fetched.
Historical tracker entries remain in the original private backup, not the live UI.
"""

import argparse
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse


SOURCE_LANG = {"thunder": "ENG", "vortex": "ENG", "kakao": "RAW", "qimanga": "ENG"}
SOURCE_NAME = {"thunder": "Thunder Scans", "vortex": "Vortex Scans", "kakao": "Kakao Page", "qimanga": "QiManga"}
TABLES = ("manga", "sources", "releases", "translation_tasks", "logs", "settings")


def https_url(value):
    if not isinstance(value, str) or len(value) > 2000:
        raise ValueError("URL ไม่ถูกต้อง")
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("ต้องใช้ HTTPS URL ที่ไม่มีข้อมูลเข้าสู่ระบบ")
    return value.rstrip("/")


def chapter_number(label):
    if not isinstance(label, str) or not label.strip():
        raise ValueError("ไม่พบเลขตอน")
    match = re.search(r"(?:\bchapter\s*|\bch\.?\s*)(\d+(?:\.\d+)?)\b", label, re.I)
    if not match:
        match = re.search(r"(\d+(?:\.\d+)?)\s*화\s*$", label)
    return match.group(1) if match else label.strip()[:100]


def empty_snapshot():
    return {"schema_version": 2, "exported_at": datetime.now(timezone.utc).isoformat(),
            "tables": {**{name: [] for name in TABLES}, "settings": [{"key": "refresh_mode", "value": "tracked"}]}}


def blame_observed_times(repo, tracker_name="manga_tracker.json"):
    """Use each saved chapter URL line's commit time as its observed timestamp."""
    result = subprocess.run(
        ["git", "-C", str(repo), "blame", "--line-porcelain", "--", tracker_name],
        check=True, capture_output=True, text=True, encoding="utf-8",
    )
    times = {}
    current_key = None
    current_time = None
    current_commit = None
    commit_times = {}
    for line in result.stdout.splitlines():
        header = re.match(r"^([0-9a-f]{40}) \d+ \d+(?: \d+)?$", line)
        if header:
            current_commit = header.group(1)
            current_time = commit_times.get(current_commit)
        elif line.startswith("committer-time "):
            current_time = datetime.fromtimestamp(int(line.split()[1]), timezone.utc).isoformat()
            commit_times[current_commit] = current_time
        elif line.startswith("\t"):
            content = line[1:]
            key = re.match(r'^  ("(?:\\.|[^"\\])+"): \{$', content)
            if key:
                current_key = json.loads(key.group(1))
            elif content.startswith('    "chapter_url": ') and current_key and current_time:
                times[current_key] = current_time
    return times


def convert(config, tracker, observed, base=None):
    snapshot = json.loads(json.dumps(base)) if base is not None else empty_snapshot()
    if snapshot.get("schema_version") != 2 or any(not isinstance(snapshot.get("tables", {}).get(t), list) for t in TABLES):
        raise ValueError("ฐานข้อมูลเดิมไม่ใช่ MangaWatcher schema 2")
    tables = snapshot["tables"]
    by_url = {}
    for key, value in tracker.items():
        if isinstance(value, dict) and "series_url" in value:
            url = https_url(value["series_url"])
            by_url.setdefault(url, []).append((key, value))
    existing_urls = {https_url(row["url"]) for row in tables["sources"]}
    next_ids = {name: max((row["id"] for row in tables[name]), default=0) + 1 for name in ("manga", "sources", "releases", "logs")}
    grouped = {}
    result = {"configured": 0, "added_manga": 0, "added_sources": 0, "added_releases": 0,
              "already_present": 0, "missing_tracker": [], "ambiguous_tracker": [], "merged_exact": []}
    imported_at = datetime.now(timezone.utc).isoformat()
    for source, entries in config.items():
        if source not in SOURCE_LANG or not isinstance(entries, list):
            raise ValueError(f"ไม่รู้จัก source: {source}")
        for entry in entries:
            result["configured"] += 1
            url = https_url(entry["url"])
            if url in existing_urls:
                result["already_present"] += 1
                continue
            matches = by_url.get(url, [])
            if not matches:
                result["missing_tracker"].append(url)
                continue
            if len(matches) != 1:
                result["ambiguous_tracker"].append(url)
                continue
            tracker_key, saved = matches[0]
            title = saved.get("title")
            if not isinstance(title, str) or not title.strip():
                result["missing_tracker"].append(url)
                continue
            title = title.strip()
            slug = urlparse(url).path.rstrip("/").split("/")[-1]
            merge_key = (title.casefold(), slug)
            if merge_key in grouped:
                manga_id = grouped[merge_key]
                result["merged_exact"].append(url)
            else:
                manga_id = next_ids["manga"]
                next_ids["manga"] += 1
                grouped[merge_key] = manga_id
                tables["manga"].append({"id": manga_id, "title": title, "aliases": "", "raw_done": "",
                                        "eng_done": "", "th_done": "", "translated": "", "tracked": 1})
                result["added_manga"] += 1
            source_id = next_ids["sources"]
            next_ids["sources"] += 1
            tables["sources"].append({"id": source_id, "manga_id": manga_id, "name": SOURCE_NAME[source],
                                      "url": url, "kind": "manual", "lang": SOURCE_LANG[source], "interval": 60,
                                      "enabled": 0, "checked": None,
                                      "status": "นำเข้าจาก manga-notifier; ยังไม่ตรวจสด"})
            existing_urls.add(url)
            result["added_sources"] += 1
            chapter_url = https_url(saved.get("chapter_url"))
            label = saved.get("chapter", "")
            observed_at = observed.get(tracker_key)
            if not observed_at:
                raise ValueError(f"ไม่พบเวลา commit สำหรับ {tracker_key}")
            tables["releases"].append({"id": next_ids["releases"], "source_id": source_id,
                                       "chapter": chapter_number(label), "title": label, "url": chapter_url,
                                       "published": None, "detected": observed_at, "lang": SOURCE_LANG[source],
                                       "external_id": chapter_url})
            next_ids["releases"] += 1
            result["added_releases"] += 1
            tables["logs"].append({"id": next_ids["logs"], "source_id": source_id, "at": imported_at,
                                   "status": "นำเข้า", "message": "manga-notifier tracker; ตอนและเวลาอ้างอิงจาก Git commit; ยังไม่ตรวจเว็บไซต์สด"})
            next_ids["logs"] += 1
    snapshot["exported_at"] = imported_at
    return snapshot, result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True, help="private manga-notifier checkout")
    parser.add_argument("--base", type=Path, help="existing MangaWatcher schema 2 JSON")
    parser.add_argument("--output", type=Path, required=True, help="private output path")
    args = parser.parse_args()
    config = json.loads((args.repo / "manga_list.json").read_text(encoding="utf-8-sig"))
    tracker = json.loads((args.repo / "manga_tracker.json").read_text(encoding="utf-8-sig"))
    base = json.loads(args.base.read_text(encoding="utf-8")) if args.base else None
    snapshot, report = convert(config, tracker, blame_observed_times(args.repo), base)
    if report["missing_tracker"] or report["ambiguous_tracker"]:
        raise SystemExit("พบรายการที่จับคู่ไม่ได้หรือกำกวม; ไม่เขียนไฟล์ข้อมูล")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
