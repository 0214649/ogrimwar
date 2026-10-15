"""Fetch every DofusWiki dungeon page (CC-BY-SA) and keep location, key, rooms and mechanics notes."""
import json, re, time, urllib.request, urllib.parse, os
HERE = os.path.dirname(os.path.abspath(__file__))
B = 'https://dofuswiki.fandom.com/api.php'
def get(p):
    req = urllib.request.Request(B + '?' + urllib.parse.urlencode(p), headers={'User-Agent': 'carnet-team/0.1 (personal achievement tracker)'})
    return json.load(urllib.request.urlopen(req, timeout=60))
titles, cont = [], {}
while True:
    r = get({'action': 'query', 'list': 'embeddedin', 'eititle': 'Template:Dungeon', 'eilimit': 500, 'einamespace': 0, 'format': 'json', **cont})
    titles += [p['title'] for p in r['query']['embeddedin']]
    if 'continue' not in r: break
    cont = r['continue']
link = lambda s: re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]+)\]\]", r'\1', s)
clean = lambda s: re.sub(r"'''?|\{\{[^}]*\}\}|<[^>]+>", '', link(s)).strip()
out = {}
for i in range(0, len(titles), 50):
    r = get({'action': 'query', 'prop': 'revisions', 'rvprop': 'content', 'rvslots': 'main', 'titles': '|'.join(titles[i:i + 50]), 'format': 'json'})
    for p in r['query']['pages'].values():
        w = p['revisions'][0]['slots']['main']['*']
        box = dict((k.strip(), v.strip()) for k, v in re.findall(r'^\s*\|\s*(\w+)\s*=\s*(.*)$', w.split('}}')[0], re.M))
        rooms = []
        for m in re.finditer(r'\{\{Room\|([^|]*)\|(.*?)\n\}\}', w, re.S):
            mons = []
            for line in m.group(2).splitlines():
                line = line.strip()
                if not line.startswith('*') or 'characters:' in line: continue
                mm = re.match(r"\*\s*(?:''')?\[\[([^\]|]+)[^\]]*\]\](?:''')?,\s*level\s*(\d+)", line)
                if mm: mons.append([mm.group(1), int(mm.group(2)), "'''" in line])
            rooms.append({'name': clean(m.group(1)), 'mons': mons})
        mech = re.search(r'==\s*Mechanics\s*==(.*?)(?=\n==[^=]|\Z)', w, re.S)
        notes = re.search(r'==\s*Notes\s*==(.*?)(?=\n==[^=]|\Z)', w, re.S)
        out[p['title']] = {'level': box.get('level'), 'area': clean(box.get('area', '')), 'subarea': clean(box.get('subarea', '')),
                           'coords': box.get('coords', ''), 'key': clean(box.get('key', '')), 'bunch': box.get('bunch', ''),
                           'rooms': rooms, 'mechanics': clean(mech.group(1))[:1500] if mech else '', 'notes': clean(notes.group(1))[:800] if notes else ''}
    time.sleep(1)
json.dump(out, open(f'{HERE}/wiki/dungeons_full.json', 'w'), ensure_ascii=False, indent=0)
print(len(out), 'dungeons;', sum(1 for d in out.values() if d['mechanics']), 'with mechanics;', sum(len(d['rooms']) for d in out.values()), 'rooms')
