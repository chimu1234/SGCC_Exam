#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fix single-choice analyses whose letter claims (X正确/X错误/故选X) conflict with
the stored correct_answer by rotating correct_answer to the letter the analysis/options
actually support.

Strategy for single questions that have explicit per-option verdicts:
  - collect "X正确" -> the supported answer set
  - if empty, collect all "X错误" and pick the single option not marked wrong
  - rewrite correct_answer to that set (must be singleton)
Also rewrites trailing "故选X" already consistent (left as-is otherwise).
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "sources" / "newtech"
FILES = ["_part_iot.json", "_part_ai.json", "_part_cloud.json", "_part_bigdata.json"]

OPT_RE = re.compile(r"^\s*([A-D])[.．、]\s*(.*)$")

def analyse(t):
    t = t or ""
    right = set(re.findall(r"([A-D])\s*(?:项)?\s*(?:正确|对|是正确)", t))
    wrong = set(re.findall(r"([A-D])\s*(?:项)?\s*(?:错误|错|不正确)", t))
    return right, wrong

fixed = 0
report = []
for fname in FILES:
    p = SRC / fname
    if not p.is_file():
        continue
    obj = json.loads(p.read_text(encoding="utf-8"))
    for it in obj.get("items", []):
        t = it.get("analysis", "") or ""
        right, wrong = analyse(t)
        cur = "".join(sorted(set(re.findall(r"[A-D]", (it.get("correct_answer") or "").upper()))))
        target = None
        if len(right) == 1:
            target = next(iter(right))
        elif not right and wrong:
            keys = [o["key"].strip().upper() for o in it.get("options", [])]
            cand = [k for k in keys if k not in wrong]
            if len(cand) == 1:
                target = cand[0]
        if target and target != cur:
            it["correct_answer"] = target
            fixed += 1
            report.append("%s no%s: %s -> %s" % (fname, it.get("no"), cur, target))
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")

print("fixed:", fixed)
for r in report:
    print("  ", r)
