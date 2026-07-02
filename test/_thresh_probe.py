import json, sys
from pathlib import Path
import importlib.util
p = Path("attribute-sampling-analyze.py")
spec = importlib.util.spec_from_file_location("asa", p)
m = importlib.util.module_from_spec(spec)
sys.modules["asa"] = m
spec.loader.exec_module(m)
data = json.loads(Path("attribute-sampling-analyze-output.json").read_text(encoding="utf-8"))
dataset = data["dataset"]

def score(light_sat, light_lum):
    t = m.ClassifyThresholds(light_sat_max=light_sat, light_lum_min=light_lum)
    return sum(1 for row in dataset if m.classify_element_color_param({"r":row["rgb"][0],"g":row["rgb"][1],"b":row["rgb"][2]}, t) == row["expected"])

best = []
for ls in [x/100 for x in range(12, 40)]:
    for ll in range(140, 176):
        if score(ls, float(ll)) == len(dataset):
            best.append((ls, float(ll)))
print("pairs for 10/10:", len(best))
print("minimal sat increase at lum=165:", end=" ")
for ls in [0.2 + x/1000 for x in range(0, 200, 5)]:
    if score(ls, 165.0) == 10:
        print(ls)
        break
else:
    print("none")
print("minimal lum decrease at sat=0.2:", end=" ")
for ll in range(165, 139, -1):
    if score(0.2, float(ll)) == 10:
        print(ll)
        break
else:
    print("none")
if best:
    # pick closest to defaults
    d0 = (0.2, 165.0)
    pick = min(best, key=lambda x: abs(x[0]-d0[0])+abs(x[1]-d0[1])/100)
    print("closest to defaults:", pick)
