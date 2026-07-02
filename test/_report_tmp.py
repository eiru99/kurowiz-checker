import json
from pathlib import Path
src = Path(r"C:\Users\mishi_rn2lh85\Documents\GitHub_kurowiz\kurowiz-checker\test\attribute-sampling-analyze.py").read_text(encoding="utf-8")
ns = {}
exec(compile(src.split("def luminance")[0], "x", "exec"), ns)
CASES = ns["CASES"]
d = json.load(open(Path(r"C:\Users\mishi_rn2lh85\Documents\GitHub_kurowiz\kurowiz-checker\test\attribute-sampling-analyze-output.json"), encoding="utf-8"))
case_map = {f: (m, s) for f, m, s in CASES}
ok = 0
for r in d["results"]:
    f = r["file"]
    em, es = case_map[f]
    ok += int(r["main"]["match"]) + int(r["sub"]["match"])
    print(f"{f}")
    print(f"  main: expected={em} actual={r['main']['actual']} match={r['main']['match']}")
    print(f"  sub:  expected={es} actual={r['sub']['actual']} match={r['sub']['match']}")
print(f"SUMMARY: {ok}/8 regions correct")
