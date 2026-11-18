import unittest

from scripts.import_manga_notifier import chapter_number, convert, empty_snapshot, https_url


class MangaNotifierImportTests(unittest.TestCase):
    def setUp(self):
        self.thunder = "https://en-thunderscans.com/comics/example"
        self.qimanga = "https://qimanga.com/series/example"
        self.config = {"thunder": [{"url": self.thunder}], "qimanga": [{"url": self.qimanga}]}
        self.tracker = {
            "thunder:example": {"title": "Example", "chapter": "Chapter 12.5",
                                "chapter_url": "https://en-thunderscans.com/example-chapter-12-5/",
                                "series_url": self.thunder},
            "qimanga:example": {"title": "Example", "chapter": "Chapter 13",
                                "chapter_url": "https://qimanga.com/series/example/chapter-13",
                                "series_url": self.qimanga},
            "asura:old": {"title": "Old", "chapter": "Chapter 1",
                          "chapter_url": "https://example.org/old/1", "series_url": "https://example.org/old"},
        }
        self.observed = {"thunder:example": "2026-10-01T00:00:00+00:00",
                         "qimanga:example": "2026-10-02T00:00:00+00:00"}

    def test_imports_current_sources_and_merges_only_exact_title_and_slug(self):
        snapshot, report = convert(self.config, self.tracker, self.observed)
        tables = snapshot["tables"]
        self.assertEqual(report["configured"], 2)
        self.assertEqual(report["added_manga"], 1)
        self.assertEqual(report["added_sources"], 2)
        self.assertEqual(report["added_releases"], 2)
        self.assertEqual(len(tables["releases"]), 2)
        self.assertTrue(all(source["kind"] == "manual" and source["enabled"] == 0 for source in tables["sources"]))
        self.assertEqual(tables["releases"][0]["chapter"], "12.5")
        self.assertIsNone(tables["releases"][0]["published"])
        self.assertEqual(tables["releases"][0]["detected"], self.observed["thunder:example"])
        self.assertEqual(tables["manga"][0]["raw_done"], "")

    def test_preserves_existing_data_and_skips_existing_source(self):
        base = empty_snapshot()
        base["tables"]["manga"].append({"id": 7, "title": "Existing", "aliases": "", "raw_done": "3",
                                          "eng_done": "", "th_done": "", "translated": "", "tracked": 1})
        base["tables"]["sources"].append({"id": 9, "manga_id": 7, "name": "Old", "url": self.thunder,
                                            "kind": "manual", "lang": "ENG", "interval": 60, "enabled": 0,
                                            "checked": None, "status": "old"})
        snapshot, report = convert(self.config, self.tracker, self.observed, base)
        self.assertEqual(report["already_present"], 1)
        self.assertEqual(snapshot["tables"]["manga"][0]["raw_done"], "3")
        self.assertEqual(snapshot["tables"]["sources"][0]["status"], "old")
        self.assertEqual(report["added_sources"], 1)

    def test_missing_tracker_is_reported_without_inventing_title(self):
        snapshot, report = convert({"thunder": [{"url": "https://example.org/new"}]}, {}, {})
        self.assertEqual(report["added_manga"], 0)
        self.assertEqual(len(report["missing_tracker"]), 1)
        self.assertEqual(snapshot["tables"]["releases"], [])

    def test_url_and_korean_chapter(self):
        self.assertEqual(chapter_number("제목 26화"), "26")
        with self.assertRaises(ValueError):
            https_url("http://127.0.0.1/private")
        with self.assertRaises(ValueError):
            https_url("https://user:password@example.org/")


if __name__ == "__main__":
    unittest.main()
