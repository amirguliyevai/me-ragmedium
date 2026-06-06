import json, sys, warnings
warnings.filterwarnings("ignore")
from ddgs import DDGS
query = sys.argv[1] if len(sys.argv) > 1 else "news"
ddgs = DDGS()
results = list(ddgs.text(query, max_results=8))
out = []
for r in results:
    out.append(r.get("title","") + ": " + r.get("body","")[:200])
print(json.dumps(out))
