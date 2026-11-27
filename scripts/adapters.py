"""Source adapters: convert a source file into the unified bank model.

Each adapter has the signature:

    build(cfg, project_root, copier) -> dict

`cfg` is one entry of banks.config.json, `project_root` is the project
directory, and `copier(src_path)` copies an image into
`assets/banks/<bank_id>/` and returns the web-relative path (or None).
"""
import json
import re
from collections import Counter, OrderedDict
from pathlib import Path

from pypdf import PdfReader

TYPE_MAP = {"单选题": "single", "多选题": "multiple", "判断题": "judge"}
PART_NUM = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5}
PART_NAMES = {1: "形势政策", 2: "企业文化", 3: "公司战略", 4: "新型电力系统", 5: "品牌建设"}
CN_NUM = "一二三四五六七八九十"


# ---------------------------------------------------------------- helpers

def _latex_to_text(fragment: str) -> str:
    s = fragment
    s = s.replace("\\mathrm", "").replace("\\text", "")
    s = s.replace("\\%", "%").replace("\\ ", " ")
    s = re.sub(r"\\[a-zA-Z]+", "", s)
    s = s.replace("{", "").replace("}", "")
    s = s.replace("_", "").replace("^", "").replace("~", " ")
    s = s.replace("\\", "")
    return s


def _clean_text(s: str) -> str:
    if not s:
        return ""
    s = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", s)
    s = re.sub(r"\$([^$]*)\$", lambda m: _latex_to_text(m.group(1)), s)
    s = s.replace("　", " ")
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"(?<=[一-鿿])\s+(?=[一-鿿])", "", s)
    s = re.sub(r"(?<=[一-鿿])\s+(?=[，。；：？！、])", "", s)
    return s


def _letters(text: str):
    return sorted(set(re.findall(r"[A-D]", text or "")))


def _strip_option_prefix(text: str, key: str) -> str:
    return re.sub(r"^\s*" + key + r"\s*[.．、]\s*", "", text or "").strip()


# ---------------------------------------------------------------- PDF bank

PDF_TYPE_RE = re.compile(r"^[一二三]、\s*(单选题|多选题|判断题)\s*$")
PDF_PART_RE = re.compile(r"^第([一二三四五])部分\s*(.+?)\s*$")
PDF_Q_RE = re.compile(r"^(\d{1,3})、\s*(.*)$")
PDF_OPT_RE = re.compile(r"^([A-D])\s*[.．、]\s*(.*)$")
PDF_ANS_RE = re.compile(r"^答\s*案?\s*[:：]\s*(.*)$")
PDF_PAGE_RE = re.compile(r"^第\s*\d+\s*页\s*共\s*\d+\s*页$")


def _pdf_lines(pdf_path: Path):
    reader = PdfReader(str(pdf_path))
    for page in reader.pages:
        text = page.extract_text() or ""
        for raw in text.split("\n"):
            line = raw.strip()
            if not line or PDF_PAGE_RE.match(line):
                continue
            if line in ("国家电网 STATE GRID", "电网"):
                continue
            yield line


def _parse_pdf(lines):
    questions = []
    cur = None
    qtype = None
    part = None
    target = None
    after_answer = False

    def close():
        nonlocal cur
        if cur is not None:
            questions.append(cur)
            cur = None

    for line in lines:
        m = PDF_TYPE_RE.match(line)
        if m:
            close()
            qtype = TYPE_MAP[m.group(1)]
            target = None
            after_answer = False
            continue
        m = PDF_PART_RE.match(line)
        if m:
            part = PART_NUM[m.group(1)]
            continue
        m = PDF_Q_RE.match(line)
        if m:
            close()
            cur = {
                "id": int(m.group(1)),
                "type": qtype,
                "part": part,
                "stem": m.group(2),
                "options": OrderedDict(),
                "answer": "",
            }
            target = ("stem",)
            after_answer = False
            continue
        if cur is None:
            continue
        if after_answer and re.fullmatch(r"\d{1,3}", line):
            continue
        m = PDF_ANS_RE.match(line)
        if m:
            cur["answer"] = m.group(1)
            target = ("answer",)
            after_answer = True
            continue
        m = PDF_OPT_RE.match(line)
        if m:
            cur["options"][m.group(1)] = m.group(2)
            target = ("option", m.group(1))
            after_answer = False
            continue
        if target is None:
            continue
        if target[0] == "stem":
            cur["stem"] += " " + line
        elif target[0] == "option":
            cur["options"][target[1]] += " " + line
        elif target[0] == "answer":
            cur["answer"] += " " + line
            after_answer = True
    close()
    return questions


def build_pdf_question_bank(cfg, project_root, copier):
    bank_id = cfg["id"]
    source = project_root / cfg["source"]
    raw = _parse_pdf(_pdf_lines(source))

    sections = []
    for no in range(1, 6):
        count = sum(1 for q in raw if q["part"] == no)
        if not count:
            continue
        sections.append({
            "id": "p%d" % no,
            "name": PART_NAMES[no],
            "order": no,
            "type": None,
            "scorePer": 1,
            "count": count,
            "materials": [],
        })

    questions = []
    for q in raw:
        part = q["part"]
        warnings = []
        options = [{"key": k, "text": _clean_text(v), "images": []}
                   for k, v in q["options"].items()]
        answer = _letters(q["answer"])
        if not answer:
            warnings.append("missing_answer")
        keys = {o["key"] for o in options}
        if not set(answer) <= keys:
            warnings.append("answer_not_in_options")
        questions.append({
            "uid": "%s:%d" % (bank_id, q["id"]),
            "bankId": bank_id,
            "localId": q["id"],
            "seq": q["id"],
            "no": q["id"],
            "type": q["type"] or "single",
            "sectionId": "p%d" % part if part else None,
            "sectionName": PART_NAMES.get(part, ""),
            "stem": _clean_text(q["stem"]),
            "stemImages": [],
            "options": options,
            "answer": answer,
            "score": 1,
            "analysis": None,
            "analysisImages": [],
            "warnings": warnings,
        })

    return {
        "id": bank_id,
        "name": cfg["name"],
        "shortName": cfg.get("shortName", cfg["name"]),
        "description": cfg.get("description", ""),
        "source": {"type": "pdf", "file": cfg["source"]},
        "tags": cfg.get("tags", []),
        "exam": {
            "durationMin": cfg.get("options", {}).get("durationMin"),
            "totalScore": len(questions),
        },
        "sections": sections,
        "questions": questions,
    }


# ------------------------------------------------------- structured JSON bank

SEC_TITLE_RE = re.compile(r"^[一二三四五六七八九十]+、\s*(.*)$")
SCORE_PER_RE = re.compile(r"每题\s*([\d.]+)\s*分")


def _section_type(title: str) -> str:
    if "多选" in title:
        return "multiple"
    if "判断" in title:
        return "judge"
    return "single"


def build_structured_json_bank(cfg, project_root, copier):
    bank_id = cfg["id"]
    source = project_root / cfg["source"]
    data = json.loads(source.read_text(encoding="utf-8"))
    base_dir = source.parent

    sections = []
    questions = []

    for si, sec in enumerate(data.get("sections", []), 1):
        raw_title = sec.get("title", "").strip()
        m = SEC_TITLE_RE.match(raw_title)
        title_rest = m.group(1) if m else raw_title
        name = re.split(r"[（(]", title_rest, 1)[0].strip()
        stype = _section_type(raw_title)
        if sec.get("type") in ("single", "multiple", "judge"):
            stype = sec["type"]
        sm = SCORE_PER_RE.search(raw_title)
        score_per = float(sm.group(1)) if sm else 1.0
        section_id = "s%d" % si

        materials = []
        for mi, mat in enumerate(sec.get("materials") or [], 1):
            images = []
            for rel in mat.get("images") or []:
                web = copier(base_dir / rel)
                if web:
                    images.append(web)
            materials.append({
                "id": "%s-m%d" % (section_id, mi),
                "title": ("材料" + CN_NUM[mi - 1]) if mi <= len(CN_NUM) else ("材料%d" % mi),
                "text": (mat.get("text") or "").strip(),
                "images": images,
            })

        items = sec.get("items") or []
        sections.append({
            "id": section_id,
            "name": name,
            "order": si,
            "type": stype,
            "scorePer": score_per,
            "count": len(items),
            "materials": materials,
        })

        for item in items:
            seq = int(item.get("seq") or 0)
            warnings = []
            options = []
            for opt in item.get("options") or []:
                key = opt.get("key") or ""
                images = []
                for rel in opt.get("images") or []:
                    web = copier(base_dir / rel)
                    if web:
                        images.append(web)
                options.append({
                    "key": key,
                    "text": _clean_text(_strip_option_prefix(opt.get("text", ""), key)),
                    "images": images,
                })
            answer = _letters(item.get("correct_answer", ""))
            if not answer:
                warnings.append("missing_answer")
            keys = {o["key"] for o in options}
            if not set(answer) <= keys:
                warnings.append("answer_not_in_options")

            stem_images = []
            for rel in item.get("stem_images") or []:
                web = copier(base_dir / rel)
                if web:
                    stem_images.append(web)
            analysis_images = []
            for rel in item.get("analysis_images") or []:
                web = copier(base_dir / rel)
                if web:
                    analysis_images.append(web)

            try:
                score = float(item.get("score") or score_per)
            except (TypeError, ValueError):
                score = score_per

            questions.append({
                "uid": "%s:%d" % (bank_id, seq),
                "bankId": bank_id,
                "localId": seq,
                "seq": seq,
                "no": item.get("no"),
                "type": stype,
                "sectionId": section_id,
                "sectionName": name,
                "stem": _clean_text(item.get("stem", "")),
                "stemImages": stem_images,
                "options": options,
                "answer": answer,
                "score": score,
                "analysis": (item.get("analysis") or "").strip() or None,
                "analysisImages": analysis_images,
                "warnings": warnings,
            })

    total_score = sum(q["score"] for q in questions)
    return {
        "id": bank_id,
        "name": cfg["name"],
        "shortName": cfg.get("shortName", cfg["name"]),
        "description": cfg.get("description", ""),
        "source": {"type": "structured-json", "file": cfg["source"]},
        "tags": cfg.get("tags", []),
        "exam": {
            "durationMin": cfg.get("options", {}).get("durationMin"),
            "totalScore": total_score,
        },
        "sections": sections,
        "questions": questions,
    }


ADAPTERS = {
    "pdf_question_bank": build_pdf_question_bank,
    "structured_json_bank": build_structured_json_bank,
}
