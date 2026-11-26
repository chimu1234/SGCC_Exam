# -*- coding: utf-8 -*-
import json, re
from collections import Counter
p = "D:/deepseek/repos/SGCC_Exam/sources/newtech/_part_iot.json"
d = json.load(open(p, encoding="utf-8"))
items = d["items"]
bad=[]
for it in items:
    m = re.findall(r"故选([A-D])", it["analysis"])
    if not m or set(m)!={it["correct_answer"]}:
        bad.append((it["seq"], it["correct_answer"], m))
print("analysis-mismatch:", bad)
# 重复题干检查
stems=[it["stem"] for it in items]
print("unique stems:", len(set(stems)), "/", len(stems))
print("count:", len(items))
print("\n--- 样例题干 1 (seq1) ---")
print(items[0]["stem"]); [print(o["key"],o["text"]) for o in items[0]["options"]]; print("ans",items[0]["correct_answer"])
print("\n--- 样例题干 2 (seq30) ---")
print(items[29]["stem"]); [print(o["key"],o["text"]) for o in items[29]["options"]]; print("ans",items[29]["correct_answer"]); print(items[29]["analysis"])
