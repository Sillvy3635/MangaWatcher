import unittest

from scripts.import_manga_notifier import empty_snapshot
from scripts.import_historical_asura import import_historical_asura


class HistoricalAsuraImportTests(unittest.TestCase):
    def setUp(self):
        self.base = empty_snapshot()
        self.tracker = {
            "asura:older": {"title": "Example Story", "chapter": "Chapter 9",
                            "series_url": "https://asurascans.com/comics/example-old",
                            "chapter_url": "https://asurascans.com/comics/example-old/chapter/9"},
            "asura:newer": {"title": "Example Story", "chapter": "Chapter 10",
                            "series_url": "https://asurascans.com/comics/example-new",
                            "chapter_url": "https://asurascans.com/comics/example-new/chapter/10"},
            "asura:another": {"title": "Another Story", "chapter": "Chapter 2.5",
                              "series_url": "https://asurascans.com/comics/another",
                              "chapter_url": "https://asurascans.com/comics/another/chapter/2-5"},
        }
        self.observed = {"asura:older": "2026-10-01T00:00:00+00:00",
                         "asura:newer": "2026-10-02T00:00:00+00:00",
                         "asura:another": "2026-10-03T00:00:00+00:00"}

    def test_imports_last_observation_once_per_title_and_preserves_base(self):
        snapshot, report = import_historical_asura(self.base, self.tracker, self.observed)
        self.assertEqual(report["historical_keys"], 3)
        self.assertEqual(report["added_manga"], 2)
        self.assertEqual(len(self.base["tables"]["manga"]), 0)
        self.assertEqual(len(snapshot["tables"]["sources"]), 2)
        self.assertTrue(all(row["enabled"] == 0 and row["kind"] == "manual"
                            for row in snapshot["tables"]["sources"]))
        self.assertTrue(all(row["tracked"] == 0 for row in snapshot["tables"]["manga"]))
        example_source = next(row for row in snapshot["tables"]["sources"]
                              if row["url"].endswith("example-new"))
        example_release = next(row for row in snapshot["tables"]["releases"]
                               if row["source_id"] == example_source["id"])
        self.assertEqual(example_release["chapter"], "10")
        self.assertEqual(example_release["detected"], self.observed["asura:newer"])
        self.assertIsNone(example_release["published"])
        again, second_report = import_historical_asura(snapshot, self.tracker, self.observed)
        self.assertEqual(second_report["added_manga"], 0)
        self.assertEqual(again, snapshot)

    def test_rejects_wrong_host_and_missing_provenance(self):
        tracker = {"asura:bad": {**self.tracker["asura:older"],
                                 "series_url": "https://asurascans.com.evil.test/comics/x"}}
        with self.assertRaises(ValueError):
            import_historical_asura(self.base, tracker, {"asura:bad": self.observed["asura:older"]})
        with self.assertRaises(ValueError):
            import_historical_asura(self.base, self.tracker, {})


if __name__ == "__main__":
    unittest.main()
