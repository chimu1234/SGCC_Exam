# -*- coding: utf-8 -*-
import json
p = "D:/deepseek/repos/SGCC_Exam/sources/newtech/_part_iot.json"
d = json.load(open(p, encoding="utf-8"))
items = d["items"]
print("title:", d["title"])
print("count:", len(items))
print("seq_ok:", [it["seq"] for it in items] == list(range(1,101)))
print("no_ok:", [it["no"] for it in items] == list(range(1,101)))
# checks
bad = []
for it in items:
    if len(it["options"]) != 4: bad.append(("opt", it["seq"]))
    if it["correct_answer"] not in "ABCD": bad.append(("ans", it["seq"]))
    if len(it["analysis"]) < 10: bad.append(("ana", it["seq"]))
    if not it["stem"].strip(): bad.append(("stem", it["seq"]))
print("bad:", bad)
total_chars = sum(len(it["stem"]) + sum(len(o["text"]) for o in it["options"]) + len(it["analysis"]) for it in items)
print("total_cn_chars:", total_chars)
# answer distribution
from collections import Counter
print("answer dist:", dict(Counter(it["correct_answer"] for it in items)))
print("\n=== 样例1 ===")
print(items[0]["stem"])
for o in items[0]["options"]: print(o["key"], o["text"])
print("答案:", items[0]["correct_answer"])
print("解析:", items[0]["analysis"])
print("\n=== 样例2 ===")
print(items[50]["stem"])
for o in items[50]["options"]: print(o["key"], o["text"])
print("答案:", items[50]["correct_answer"])
print("解析:", items[50]["analysis"])
