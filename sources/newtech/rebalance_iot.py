# -*- coding: utf-8 -*-
import json, random, re
p = "D:/deepseek/repos/SGCC_Exam/sources/newtech/_part_iot.json"
d = json.load(open(p, encoding="utf-8"))
items = d["items"]
n = len(items)

# 目标答案分布：100题 -> A25 B25 C25 D25，构造均衡序列并打乱
targets = list("ABCD")*25
random.seed(20271126)
random.shuffle(targets)

keys = ["A","B","C","D"]
for it, tgt in zip(items, targets):
    opts = it["options"]
    old_ans = it["correct_answer"]
    correct_text = next(o["text"] for o in opts if o["key"]==old_ans)
    distractor_texts = [o["text"] for o in opts if o["key"]!=old_ans]
    random.shuffle(distractor_texts)
    # 目标位置
    pos = keys.index(tgt)
    new_texts = []
    di = 0
    for i in range(4):
        if i == pos:
            new_texts.append(correct_text)
        else:
            new_texts.append(distractor_texts[di]); di += 1
    it["options"] = [{"key":keys[i], "text":new_texts[i]} for i in range(4)]
    it["correct_answer"] = tgt
    # 修正解析中的 "故选X"
    it["analysis"] = re.sub(r"故选[A-D]", "故选"+tgt, it["analysis"])

json.dump(d, open(p,"w",encoding="utf-8"), ensure_ascii=False, indent=2)

from collections import Counter
print("remixed. answer dist:", dict(Counter(it["correct_answer"] for it in items)))
print("count:", len(items))
