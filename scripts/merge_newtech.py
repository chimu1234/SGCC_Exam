#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Merge subagent-authored _part_*.json into sources/newtech/questions.json, then validate.

Run:  python scripts/merge_newtech.py
"""
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "sources" / "newtech"

PARTS = [
    ("_part_iot.json", "一、物联网基础（单选，每题1分）"),
    ("_part_ai.json", "二、人工智能基础（单选，每题1分）"),
    ("_part_cloud.json", "三、云计算基础（单选，每题1分）"),
    ("_part_bigdata.json", "四、大数据基础（单选，每题1分）"),
    ("_part_iot_multi.json", "五、物联网基础（多选，每题2分）"),
    ("_part_ai_cloud_multi.json", "六、人工智能与云计算（多选，每题2分）"),
    ("_part_judge.json", "七、信息新技术（判断，每题1分）"),
]

problems = []
sections = []
seq = 0
total = 0
by_sec = []

for fname, title in PARTS:
    path = SRC / fname
    if not path.is_file():
        problems.append("MISSING PART: %s" % fname)
        by_sec.append((title, 0))
        continue
    obj = json.loads(path.read_text(encoding="utf-8"))
    raw_items = obj.get("items") or []
    items = []
    for it in raw_items:
        seq += 1
        stem = (it.get("stem") or "").strip()
        opts = it.get("options") or []
        keys = [o.get("key", "").strip().upper() for o in opts]
        ans = "".join(sorted(set(re.findall(r"[A-D]", (it.get("correct_answer") or "").upper()))))
        ana = (it.get("analysis") or "").strip()
        if not stem:
            problems.append("%s seq%d: empty stem" % (fname, seq))
        if len(opts) not in (2, 4):
            problems.append("%s seq%d: %d options" % (fname, seq, len(opts)))
        if not ans:
            problems.append("%s seq%d: no answer" % (fname, seq))
        elif not set(ans) <= set(keys):
            problems.append("%s seq%d: answer %s not in %s" % (fname, seq, ans, keys))
        if not ana:
            problems.append("%s seq%d: empty analysis" % (fname, seq))
        if "多选" in title and len(ans) < 2:
            problems.append("%s seq%d: multiple but answer=%s" % (fname, seq, ans))
        if "判断" in title and ans not in ("A", "B"):
            problems.append("%s seq%d: judge answer=%s" % (fname, seq, ans))
        if "单选" in title and len(ans) != 1:
            problems.append("%s seq%d: single but answer=%s" % (fname, seq, ans))
        items.append({
            "seq": seq, "no": seq, "score": str(it.get("score") or 1),
            "stem": stem,
            "options": [{"key": (o.get("key") or "").strip().upper(), "text": (o.get("text") or "").strip()} for o in opts],
            "correct_answer": ans,
            "analysis": ana,
        })
    sections.append({"title": title, "materials": [], "items": items})
    by_sec.append((title, len(items)))
    total += len(items)

out = {
    "paper": "2027国网校招·信息新技术专项题库（物联网/人工智能/云计算/大数据）",
    "sections": sections,
}
(SRC / "questions.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

print("total questions:", total)
for t, n in by_sec:
    print("  %-34s %d" % (t, n))
print("problems:", len(problems))
for p in problems[:60]:
    print("  -", p)
