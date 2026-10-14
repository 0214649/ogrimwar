import json, urllib.request, urllib.error, sys, os, time
OUT = sys.argv[1]
gl = [g for g in json.load(open(f'{OUT}/gp_list.json')) if g['lang']=='fr' and g['game_type']=='dofus']
os.makedirs(f'{OUT}/guides', exist_ok=True)
for g in gl:
    p = f"{OUT}/guides/{g['id']}.json"
    if os.path.exists(p): continue
    for attempt in range(6):
        try:
            req = urllib.request.Request(f"https://ganymede-app.com/api/v2/guides/{g['id']}", headers={'User-Agent': 'team-succes/0.1'})
            with urllib.request.urlopen(req, timeout=60) as r: d = json.load(r)
            json.dump(d, open(p, 'w'), ensure_ascii=False); break
        except urllib.error.HTTPError as e:
            if e.code != 429: raise
            time.sleep(int(e.headers.get('Retry-After') or 20))
    time.sleep(1.5)
print(len(os.listdir(f'{OUT}/guides')), 'of', len(gl))
