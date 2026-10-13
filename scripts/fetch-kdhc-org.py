"""한국지역난방공사 조직 트리 뽑기 (제출처 트리 선택용).

임직원검색(전체 직원 목록)의 부서명으로 처/실/지사 > 부 > 과 트리를 만들고,
조직도 이미지 기준의 본부 배치를 얹어 [본사 | 지사] 두 갈래로 나눈다.
조직 개편으로 배치가 바뀌면 HQ·BRANCHES만 고친다. 형식은 data/kdhc-org/README.md 참고.

사용: python3 scripts/fetch-kdhc-org.py   → data/kdhc-org/ 에 json·csv·txt 저장
"""
import collections
import csv
import datetime
import json
import pathlib
import re
import urllib.request

LIST_URL = ("https://www.kdhc.co.kr/kdhc/kdhcIntrcn/ecctvEmp/list.do"
            "?menuNo=200320&searchCnd=2&searchWrd=&pageIndex=1&pageUnit=5000")
OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "kdhc-org"

# 본사: 묶음 → 처/실/센터. 값이 dict면 하위 본부. 이름이 "("로 시작하는 묶음은 실제 조직이 아님(선택 불가).
# 조직도(menuNo=200319) 이미지 기준.
HQ = {
    "(사장 직속)": ["임원실", "비서부"],
    "(상임감사위원)": ["감사실"],
    "기획본부": {
        "_": ["기획처", "경영관리처", "열에너지정책실"],
        "경영지원본부": ["경영지원처", "재무처", "AX추진처", "사이버보안센터"],
    },
    "GX본부": ["에너지전환사업처", "사업지원처", "고객서비스처"],
    "안전기술본부": {
        "_": ["플랜트기술처", "안전처", "통합운영처"],
        "건설본부": ["건설처", "열수송처"],
    },
    "(기타)": ["교육팀", "노동조합", "경영전문위원"],
}
# 지사: 관할 본부 → 지사·사업소 (조직도 그림 순서)
BRANCHES = {
    "안전기술본부": ["중앙지사", "동탄지사", "대구지사", "강남지사", "판교지사", "청주지사",
                 "파주지사", "광교지사", "광주전남지사", "삼송지사", "용인지사", "양산지사",
                 "고양사업소", "분당사업소", "세종지사", "화성지사", "평택지사", "김해사업소"],
    "건설본부": ["수원사업소"],
}
# 직원 목록의 부서명이 조직도 이름과 다른 경우
ALIAS = {"기획본부": "부사장(기획본부)"}
# 파견·외부 기관 등 공사 조직이 아닌 부서명
EXCLUDE = {"(주)넥스젠에너지솔루션", "(주)테크윌", "한국남부발전", "한국서부발전", "기후에너지환경부"}


def unit_type(name):
    for suffix, t in [("본부", "본부"), ("지사", "지사"), ("사업소", "사업소"), ("센터", "센터"),
                      ("처", "처"), ("실", "실"), ("TF", "TF"), ("관리관", "관"),
                      ("부", "부"), ("과", "과"), ("팀", "팀")]:
        if name.endswith(suffix):
            return t
    return "기타"


def fetch_depts():
    req = urllib.request.Request(LIST_URL, headers={"User-Agent": "Mozilla/5.0"})
    html = urllib.request.urlopen(req, timeout=60).read().decode("utf-8")
    depts = collections.Counter(d.strip() for d in re.findall(r"<tr>\s*<td>(.*?)</td>", html, re.S))
    print(f"직원 {sum(depts.values())}명, 부서명 {len(depts)}개")
    return {d: n for d, n in depts.items() if d not in EXCLUDE}


def build_units(depts):
    """'강남지사 운영1부 운영1과' → {강남지사: {직속인원, 하위: {운영1부: {..., 하위: {운영1과}}}}}"""
    units = {}
    for dept, n in depts.items():
        parts = dept.split()
        cur = units.setdefault(parts[0], {"n": 0, "sub": {}})
        for p in parts[1:]:
            cur = cur["sub"].setdefault(p, {"n": 0, "sub": {}})
        cur["n"] += n
    return units


def main():
    units = build_units(fetch_depts())
    used = set()

    def make(name, parent_id, category, kind=None, selectable=True, src=None):
        """id는 직원 목록 부서명과 같은 전체 이름(예: '강남지사 운영1부'). 제출처 이름으로 그대로 쓴다."""
        node_id = f"{parent_id} {name}" if parent_id else name
        return {"id": node_id, "name": name, "type": kind or unit_type(name), "category": category,
                "selectable": selectable, "headcount": src["n"] if src else 0, "children": []}

    def unit_node(name, category):
        src = units.get(name)
        used.add(name)
        n = make(name, None, category, src=src)

        def add_sub(parent, sub):
            for nm, s in sub.items():
                c = make(nm, parent["id"], category, src=s)
                add_sub(c, s["sub"])
                parent["children"].append(c)
        if src:
            add_sub(n, src["sub"])
        return n

    def bonbu_node(name, category):
        src = units.get(ALIAS.get(name, name)) or units.get(name)
        used.update({name, ALIAS.get(name, name)})
        return {"id": name, "name": name, "type": "본부", "category": category, "selectable": True,
                "headcount": src["n"] if src else 0, "children": []}

    hq = {"id": "본사", "name": "본사", "type": "구분", "category": "hq", "selectable": False,
          "headcount": 0, "children": []}
    for group, spec in HQ.items():
        if group.startswith("("):
            g = {"id": group, "name": group.strip("()"), "type": "묶음", "category": "hq",
                 "selectable": False, "headcount": 0, "children": []}
        else:
            g = bonbu_node(group, "hq")
        if isinstance(spec, dict):
            g["children"] += [unit_node(u, "hq") for u in spec["_"]]
            for sub, names in spec.items():
                if sub != "_":
                    s = bonbu_node(sub, "hq")
                    s["children"] = [unit_node(u, "hq") for u in names]
                    g["children"].append(s)
        else:
            g["children"] = [unit_node(u, "hq") for u in spec]
        hq["children"].append(g)

    br = {"id": "지사", "name": "지사", "type": "구분", "category": "branch", "selectable": False,
          "headcount": 0, "children": []}
    for bonbu, names in BRANCHES.items():
        for nm in names:
            n = unit_node(nm, "branch")
            n["bonbu"] = bonbu
            br["children"].append(n)

    left = sorted(set(units) - used)
    if left:
        raise SystemExit(f"배치 안 된 부서가 있음 → HQ·BRANCHES에 추가: {left}")

    def finalize(n, level):
        n["level"] = level
        n["total"] = n["headcount"] + sum(finalize(c, level + 1) for c in n["children"])
        n["leaf"] = not n["children"]
        # 키 순서 정리 (children 맨 뒤)
        kids = n.pop("children")
        n["children"] = kids
        return n["total"]
    for root in (hq, br):
        finalize(root, 0)

    def strip(n):
        out = {k: v for k, v in n.items() if k not in ("headcount", "total", "children")}
        out["children"] = [strip(c) for c in n["children"]]
        return out

    OUT.mkdir(parents=True, exist_ok=True)
    data = {
        "version": 1,
        "fetchedAt": datetime.date.today().isoformat(),
        "source": "https://www.kdhc.co.kr 조직도(menuNo=200319)·임직원검색(menuNo=200320)",
        "categories": [{"id": "hq", "name": "본사"}, {"id": "branch", "name": "지사"}],
        "tree": [strip(hq), strip(br)],   # 인원수는 저장하지 않는다 (제출처 고르기에 필요 없음)
    }
    (OUT / "kdhc-org.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    rows, lines = [], []

    def walk(n, path, prefix, last):
        path = path + [n["name"]]
        if n["level"] > 0:
            rows.append(["본사" if n["category"] == "hq" else "지사", n["level"], n["type"], n["name"], n["id"],
                         " > ".join(path), "Y" if n["selectable"] else "N", n.get("bonbu", "")])
        mark = "" if n["selectable"] else " *"
        lines.append(f"{prefix}{('└─ ' if last else '├─ ') if n['level'] else ''}{n['name']}{mark}")
        child_prefix = prefix + (("   " if last else "│  ") if n["level"] else "")
        for i, c in enumerate(n["children"]):
            walk(c, path, child_prefix, i == len(n["children"]) - 1)
    for root in (hq, br):
        walk(root, [], "", True)
        lines.append("")

    with open(OUT / "kdhc-org.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["구분", "단계", "유형", "이름", "제출처이름(id)", "경로", "선택가능", "관할본부"])
        w.writerows(rows)
    lines.append("* = 선택 불가(묶음)")
    (OUT / "kdhc-org.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"저장: {OUT} (본사 {hq['total']}명, 지사 {br['total']}명, 노드 {len(rows)}개)")


if __name__ == "__main__":
    main()
