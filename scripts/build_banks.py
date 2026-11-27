#!/usr/bin/env python3
"""Build all question banks from banks.config.json.

Run:  python scripts/build_banks.py
"""
import filecmp
import json
import shutil
import sys
from collections import Counter, OrderedDict
from datetime import date
from pathlib import Path

from adapters import ADAPTERS

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "banks.config.json"
SCHEMA_VERSION = 2


def make_copier(bank_id):
    dest_dir = ROOT / "assets" / "banks" / bank_id
    dest_dir.mkdir(parents=True, exist_ok=True)

    def copy(src):
        src = Path(src)
        if not src.is_file():
            return None
        name = src.name
        target = dest_dir / name
        if target.exists() and not filecmp.cmp(src, target, shallow=False):
            stem, suffix, i = src.stem, src.suffix, 1
            while (dest_dir / ("%s_%d%s" % (stem, i, suffix))).exists():
                i += 1
            name = "%s_%d%s" % (stem, i, suffix)
            target = dest_dir / name
        if not target.exists():
            shutil.copy2(src, target)
        return "assets/banks/%s/%s" % (bank_id, name)

    return copy


def apply_analysis(bank):
    """Overlay analyses from sources/analysis/<bank_id>.json keyed by seq."""
    p = ROOT / "sources" / "analysis" / ("%s.json" % bank["id"])
    if not p.is_file():
        return 0
    try:
        m = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return 0
    n = 0
    for q in bank["questions"]:
        if (q.get("analysis") or "").strip():
            continue
        a = m.get(str(q.get("seq"))) or m.get(str(q.get("no")))
        if a and str(a).strip():
            q["analysis"] = str(a).strip()
            n += 1
    return n


def validate(bank):
    problems = []
    uids = Counter(q["uid"] for q in bank["questions"])
    for uid, n in uids.items():
        if n > 1:
            problems.append("duplicate uid: %s x%d" % (uid, n))
    seqs = Counter(q["seq"] for q in bank["questions"])
    for seq, n in seqs.items():
        if n > 1:
            problems.append("duplicate seq: %s x%d" % (seq, n))
    section_ids = {s["id"] for s in bank["sections"]}
    for q in bank["questions"]:
        if q["sectionId"] not in section_ids:
            problems.append("%s: unknown section %s" % (q["uid"], q["sectionId"]))
        if not q["stem"]:
            problems.append("%s: empty stem" % q["uid"])
        if not q["answer"]:
            problems.append("%s: missing answer" % q["uid"])
        elif not set(q["answer"]) <= {o["key"] for o in q["options"]}:
            problems.append("%s: answer not in options" % q["uid"])
        if q["type"] not in ("single", "multiple", "judge"):
            problems.append("%s: bad type %s" % (q["uid"], q["type"]))
    return problems


def summarize(bank):
    by_type = Counter(q["type"] for q in bank["questions"])
    by_section = Counter(q["sectionId"] for q in bank["questions"])
    for sec in bank["sections"]:
        sec["count"] = by_section.get(sec["id"], 0)
    bank["stats"] = {
        "total": len(bank["questions"]),
        "byType": dict(by_type),
        "bySection": dict(by_section),
        "hasAnalysis": any(q.get("analysis") for q in bank["questions"]),
        "hasImages": any(q.get("stemImages") or q.get("analysisImages")
                         or any(o.get("images") for o in q["options"])
                         or any(m.get("images") for s in bank["sections"] for m in s.get("materials", []))
                         for q in bank["questions"]),
    }
    return bank


def manifest_entry(bank):
    return OrderedDict([
        ("id", bank["id"]),
        ("name", bank["name"]),
        ("shortName", bank["shortName"]),
        ("description", bank["description"]),
        ("tags", bank.get("tags", [])),
        ("total", bank["stats"]["total"]),
        ("byType", bank["stats"]["byType"]),
        ("sections", [OrderedDict([
            ("id", s["id"]), ("name", s["name"]), ("order", s["order"]),
            ("type", s["type"]), ("count", s["count"]), ("scorePer", s["scorePer"]),
            ("hasMaterials", bool(s.get("materials"))),
        ]) for s in bank["sections"]]),
        ("exam", bank.get("exam") or {}),
        ("hasAnalysis", bank["stats"]["hasAnalysis"]),
        ("hasImages", bank["stats"]["hasImages"]),
        ("file", "data/banks/%s.js" % bank["id"]),
    ])


def main():
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    banks = []
    report = [
        "# 题库构建报告",
        "",
        "- 构建日期：%s" % date.today().isoformat(),
        "",
        "| 题库 | ID | 题量 | 单选 | 多选 | 判断 | 解析 | 图片 |",
        "|---|---|---|---|---|---|---|---|",
    ]

    for cfg in config["banks"]:
        adapter = ADAPTERS.get(cfg.get("adapter"))
        if not adapter:
            raise SystemExit("unknown adapter: %s" % cfg.get("adapter"))
        bank = adapter(cfg, ROOT, make_copier(cfg["id"]))
        apply_analysis(bank)
        bank = summarize(bank)
        problems = validate(bank)
        bank["problems"] = problems
        banks.append(bank)

        by_type = bank["stats"]["byType"]
        report.append("| %s | %s | %d | %d | %d | %d | %s | %s |" % (
            bank["name"], bank["id"], bank["stats"]["total"],
            by_type.get("single", 0), by_type.get("multiple", 0), by_type.get("judge", 0),
            "有" if bank["stats"]["hasAnalysis"] else "无",
            "有" if bank["stats"]["hasImages"] else "无",
        ))

    out_dir = ROOT / config.get("outputDir", "data")
    bank_dir = out_dir / "banks"
    bank_dir.mkdir(parents=True, exist_ok=True)

    for bank in banks:
        payload = {k: v for k, v in bank.items() if k != "problems"}
        payload["schemaVersion"] = SCHEMA_VERSION
        js = ("window.__BANK_DATA__ = window.__BANK_DATA__ || {};\n"
              "window.__BANK_DATA__[%s] = %s;\n" % (
                  json.dumps(bank["id"]), json.dumps(payload, ensure_ascii=False)))
        (bank_dir / ("%s.js" % bank["id"])).write_text(js, encoding="utf-8")

    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "builtAt": date.today().isoformat(),
        "banks": [manifest_entry(b) for b in banks],
    }
    (bank_dir / "manifest.js").write_text(
        "window.__BANK_MANIFEST__ = %s;\n" % json.dumps(manifest, ensure_ascii=False),
        encoding="utf-8")
    (out_dir / "banks.json").write_text(
        json.dumps({"schemaVersion": SCHEMA_VERSION, "builtAt": manifest["builtAt"],
                    "banks": [{k: v for k, v in b.items() if k != "problems"} for b in banks]},
                   ensure_ascii=False, indent=1),
        encoding="utf-8")

    report += ["", "## 校验", ""]
    any_problem = False
    for bank in banks:
        if bank["problems"]:
            any_problem = True
            report.append("- **%s**：" % bank["id"])
            for p in bank["problems"][:50]:
                report.append("  - %s" % p)
        else:
            report.append("- %s：通过" % bank["id"])
    if not any_problem:
        report += ["", "所有题库校验通过。"]

    (out_dir / "build_report.md").write_text("\n".join(report) + "\n", encoding="utf-8")

    print("built %d banks" % len(banks))
    for bank in banks:
        print("  %s: %d questions %s" % (
            bank["id"], bank["stats"]["total"], dict(bank["stats"]["byType"])))
        if bank["problems"]:
            print("  WARNINGS: %d" % len(bank["problems"]))
            for p in bank["problems"][:10]:
                print("    - " + p)


if __name__ == "__main__":
    main()
