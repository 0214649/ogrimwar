"""Second pass after build_ach.py: place achievements with the GAME's own objectives (read-only copy in tools/cache/game).

Ganymède tags carry the game ids (dofusdbid) of quests, dungeons and monsters, so objectives match by id, not by name.
Where the game data places an achievement, it overrides the wiki-based placement in ach.json.
"""
import json, os, re, sys, warnings
warnings.filterwarnings('ignore')
import UnityPy
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE); G = f'{HERE}/cache/game'
sys.path.insert(0, HERE)
import i18n
UnityPy.config.FALLBACK_UNITY_VERSION = '6000.3.16f1'

def rows(name):
    env = UnityPy.load(f'{G}/data_assets_{name}dataroot.asset.bundle')
    for o in env.objects:
        if o.type.name == 'MonoBehaviour':
            return [r['data'] for r in o.read_typetree()['references']['RefIds'] if 'data' in r]
fr = i18n.load(f'{G}/fr.bin')
achs = {a['id']: a for a in rows('achievements')}
objs = {}
for o in rows('achievementobjectives'): objs.setdefault(o['achievementId'], []).append(o)
dungeons = rows('dungeons')
quests = {q['id']: q for q in rows('quests')}
a2d = {}
for d in sorted(dungeons, key=lambda d: len(d.get('achievements') or [])):   # most specific dungeon first ("Tempête" also lists the 4 horsemen's)
    for aid in d.get('achievements') or []: a2d.setdefault(aid, d)
boss2d = {b: d for d in dungeons for b in d.get('bosses') or []}

# ---------- route items, same order as app.js ----------
route = json.load(open(f'{ROOT}/route.json'))
GU = {}
def guide(gid):
    if gid not in GU: GU[gid] = json.load(open(f'{HERE}/cache/guides/{gid}.json'))
    return GU[gid]
gp0 = guide(route['gp0']); items, seen = [], set()
for i, st in enumerate(gp0['steps']):
    items.append((f'{i}', st.get('web_text') or ''))
    for g, a, b in route['steps'].get(str(i), []):
        for k in range(a, min(b, len(guide(g)['steps']))):
            if (g, k) in seen: continue
            seen.add((g, k)); items.append((f'{i}/{g}/{k}', guide(g)['steps'][k].get('web_text') or ''))
import html

_plain = lambda h: re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', h or ''))).strip()
def counts(key):
    """False for GP0 pages that are not game steps: credits/welcome/how-to-read examples and the hidden bonus pages."""
    if '/' in key: return True
    return bool(re.match(r'Objectifs?\s*:', _plain(gp0['steps'][int(key)].get('web_text'))))
TAG = re.compile(r'data-type="custom-tag"[^>]*?type="(\w+)"[^>]*?dofusdbid="(\d+)"')
QB = re.compile(r'<div data-type="quest-block"[^>]*?status="(\w+)"[^>]*>(.*?)</div>', re.S)

RUN_RE = re.compile(r'\b(Réalise[zr]|Effectue[zr]|Faites|Faire|Refaites|Termine[zr]|Vainque[zr]|Battez|Combattez|Lancez le combat)\b', re.I)
NOT_RE = re.compile(r'sans (faire|lancer)|plus tard|pour prendre la sauvegarde|il vous faudra|vous pourrez|qui vous demande|en parallèle|Atteindre|Une fois à', re.I)
def runs(h):
    """Dungeon ids actually run in this step: tag in a sentence with a 'do it' verb, not a 'later' mention."""
    out = []
    for chunk in re.split(r'</p>|</li>|<br\s*/?>', h or ''):
        t = re.sub(r'<[^>]+>', ' ', chunk)
        if RUN_RE.search(t) and not NOT_RE.search(t):
            out += [i for ty, i in re.findall(r'data-type="custom-tag"[^>]*?type="(\w+)"[^>]*?dofusdbid="(\d+)"', chunk) if ty == 'dungeon']
    return out
qend, qlast, dpos, mpos, dmention, dmention_all, druns = {}, {}, {}, {}, {}, {}, {}
for p, (k_, h) in enumerate(items):
    if not counts(k_): continue
    for ty, i in TAG.findall(h):
        i = int(i)
        if ty == 'quest': qlast[i] = p
        elif ty == 'dungeon': dmention.setdefault(i, p); dmention_all.setdefault(i, []).append(p)
        elif ty == 'monster': mpos.setdefault(i, p)
    for status, inner in QB.findall(h):
        for ty, i in TAG.findall(inner):
            if ty == 'quest' and status == 'end': qend[int(i)] = p
    for i in runs(h): druns.setdefault(int(i), []).append(p)
# never explicitly run: first mention, but not before the step matching the dungeon's level
BRACKETS = [(1, 4), (40, 23), (60, 41), (100, 60), (120, 79), (150, 91), (180, 106), (200, 127)]
real_first = {}
for p_, (k_, _) in enumerate(items):
    if '/' not in k_ and counts(k_): real_first.setdefault(int(k_), p_)
def level_item(lvl):
    step = max(s_ for l_, s_ in BRACKETS if l_ <= (lvl or 1))
    while step not in real_first and step < len(gp0['steps']): step += 1
    return real_first.get(step, 0)
dlevel = {d['id']: d.get('optimalPlayerLevel') or 0 for d in dungeons}
for i, ps in druns.items():                  # explicit runs: the first one reached at the dungeon's level
    lp = level_item(dlevel.get(i, 0))
    ok = [q for q in ps if q >= lp]
    dpos[i] = ok[0] if ok else ps[-1]
for i, p in dmention.items():
    if i in dpos: continue
    lp = level_item(dlevel.get(i, 0))
    later = [q for q in dmention_all.get(i, []) if q >= lp]
    dpos[i] = later[0] if later else max(p, lp)
qpos = {**qlast, **qend}

memo = {}
def place(aid, stack=()):
    """(position, [(label, position|None)]) — position None when some objective is outside the route."""
    if aid in memo: return memo[aid]
    if aid in stack: return None, []
    if aid in a2d:
        d = a2d[aid]; p = dpos.get(d['id'])
        r = (p, [(fr.get(d['nameId'], 'Donjon'), p)]); memo[aid] = r; return r
    out, ok = [], True
    for o in sorted(objs.get(aid, []), key=lambda o: o['order']):
        c = (o.get('criterion') or '').strip(); label = fr.get(o.get('nameId'), '')
        if not c or re.fullmatch(r'\(?PL>\d+\)?', c): continue
        q = [int(x) for x in re.findall(r'Q[fF][=>](\d+)', c)]
        oa = [int(x) for x in re.findall(r'OA=(\d+)', c)]
        em = [int(x) for x in re.findall(r'E[MH]>(\d+)', c)]
        p = None
        if q:
            got = [qpos[x] for x in q if x in qpos]
            p = min(got) if got and '|' in c else (max(got) if len(got) == len(q) else None)
            label = label or fr.get(quests.get(q[0], {}).get('nameId'), '')
            label = f'Quête : {label}'
        elif oa:
            got = [place(x, stack + (aid,))[0] for x in oa]
            got = [g for g in got if g is not None]
            p = (min(got) if '|' in c else max(got)) if got and ('|' in c or len(got) == len(oa)) else None
            label = f'Succès : {label}'
        elif re.search(r'EM>(\d+)', c) and int(re.search(r'EM>(\d+)', c).group(1)) in boss2d:
            p = dpos.get(boss2d[int(re.search(r'EM>(\d+)', c).group(1))]['id'])
        else:
            m = re.search(r'E[fM]>(\d+)', c)
            p = mpos.get(int(m.group(1))) if m else None
        if p is None: ok = False
        out.append((label or c, p))
    pos = max(x[1] for x in out) if out and ok else None
    memo[aid] = (pos, out); return memo[aid]

# ---------- where the route walks: step position -> sub-area (polygons from the game's sub-area shapes) ----------
import unicodedata
nrm = lambda t: re.sub(r'[^a-z0-9]+', ' ', ''.join(c for c in unicodedata.normalize('NFKD', (t or '').lower()) if not unicodedata.combining(c))).strip()
worlds = {w['id']: fr.get(w['nameId'], '') for w in rows('worldmaps')}
super_world = {x['id']: x.get('worldmapId') for x in rows('superareas')}
# an area's world: its own worldmapId, else its super-area's (Incarnam = "Zone de départ" -> world 2), else the main world
area_world = {a['id']: (a.get('worldmapId') or super_world.get(a.get('superAreaId')) or 1) for a in rows('areas')}
GANY_WORLD = {'douze': 1}
def world_of(name):
    n = nrm(name)
    if not n: return None
    if n in GANY_WORLD: return GANY_WORLD[n]
    for wid, wn in worlds.items():
        if n in nrm(wn) or nrm(wn) in n: return wid
    return None
def polygons(shape):
    polys, cur, k = [], None, 0
    while k + 1 < len(shape):
        x, y = shape[k], shape[k + 1]; k += 2
        if x > 5000 or y > 5000:
            cur = [(x - 11000, y - 11000)]; polys.append(cur)
        elif cur is not None: cur.append((x, y))
    return polys
def inside(px, py, poly):
    c = False
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        if (y1 > py) != (y2 > py) and px < (x2 - x1) * (py - y1) / (y2 - y1) + x1: c = not c
    return c
subs = []
for sa in rows('subareas'):
    w = sa['customWorldMapId'] if sa.get('customWorldMapId', -1) >= 0 else area_world.get(sa['areaId'])
    subs.append({'id': sa['id'], 'fr': fr.get(sa['nameId'], ''), 'world': w, 'polys': polygons(sa.get('shape') or []), 'monsters': sa.get('monsters') or []})
def sub_at(world, x, y):
    for sa in subs:
        if sa['world'] == world and any(inside(x + .5, y + .5, pg) or inside(x, y, pg) for pg in sa['polys']): return sa
    return None
COORD = re.compile(r'\[\s*(-?\d{1,3})\s*,\s*(-?\d{1,3})\s*\]')
first_visit = {}
for p_, (key_, h) in enumerate(items):
    if not counts(key_): continue
    parts = key_.split('/')
    st = gp0['steps'][int(parts[0])] if len(parts) == 1 else guide(int(parts[1]))['steps'][int(parts[2])]
    w = world_of(st.get('map'))
    if w is None: continue
    pts = [(st.get('pos_x'), st.get('pos_y'))] + [(int(a_), int(b_)) for a_, b_ in COORD.findall(re.sub(r'<[^>]+>', ' ', h))]
    for x, y in pts:
        if x is None: continue
        sa = sub_at(w, x, y)
        if sa: first_visit.setdefault(sa['id'], p_)
print('sub-areas visited by the route:', len(first_visit), 'of', len(subs))
sub_by_name = {}
for sa in subs: sub_by_name.setdefault(nrm(sa['fr']), []).append(sa)
mon_first = {}
for sa in subs:
    if sa['id'] in first_visit:
        for m in sa['monsters']: mon_first[m] = min(mon_first.get(m, 10**9), first_visit[sa['id']])

data = json.load(open(f'{ROOT}/ach.json'))
key = lambda p: items[p][0] if p is not None else None
better = gained = 0
for a in data['ach']:
    gid = a.get('gid')
    if not gid or gid not in achs: continue
    pos, ob = place(gid)
    if pos is None and not any(p is not None for _, p in ob): continue
    if pos is not None:
        if a['done'] is None: gained += 1
        elif a['done'] != key(pos): better += 1
        a['done'] = key(pos); a['sug'] = None
    if ob: a['o'] = [[label, key(p)] for label, p in ob]
# exploration: "Découvrir la zone X" is done the first time the route walks into sub-area X
cat_top = {}
explo = 0; monst = 0
for a in data['ach']:
    if a['done'] or a.get('top') != 'Exploration' and not (a.get('d') or '').startswith('Découvrir la zone'): continue
    cands = [sa for sa in sub_by_name.get(nrm(a['n']), []) if sa['id'] in first_visit]
    if cands:
        p_ = min(first_visit[sa['id']] for sa in cands)
        a['done'] = key(p_); a['sug'] = None; a['o'] = [[f"Découvrir : {a['n']}", key(p_)]]; explo += 1
# monster challenges: doable from the first step that walks through a sub-area where all its monsters live
for a in data['ach']:
    gid = a.get('gid')
    if a['done'] or not gid: continue
    mons = [int(m) for o in objs.get(gid, []) for m in re.findall(r'E[fM]>(\d+)', o.get('criterion') or '')]
    if mons and all(m in mon_first for m in mons):
        a['sug'] = key(max(mon_first[m] for m in mons)); monst += 1
print(f'exploration placed: {explo}; monster achievements doable-from: {monst}')
json.dump(data, open(f'{ROOT}/ach.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print(f'game pass: {gained} newly placed at an exact step, {better} moved, '
      f'{sum(1 for a in data["ach"] if a["done"])} exact in total out of {len(data["ach"])}')
