"""Place DofusWiki achievements (CC-BY-SA) on the Ganymède route, item by item.

Inputs : tools/cache/guides/*.json (Ganymède guides, not committed), route.json, tools/wiki/*.lua
Output : ach.json  — achievements with the route item where each objective gets done.
"""
import json, re, sys, html, unicodedata, collections, os
sys.path.insert(0, os.path.dirname(__file__))
from lua_table import load

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
W = lambda n: load(f'{HERE}/wiki/{n}.lua')
route = json.load(open(f'{ROOT}/route.json'))
G = {}
def guide(gid):
    if gid not in G: G[gid] = json.load(open(f'{HERE}/cache/guides/{gid}.json'))
    return G[gid]

def norm(t):
    t = unicodedata.normalize('NFKD', html.unescape(str(t)).lower().replace('’', "'"))
    t = ''.join(c for c in t if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]+', ' ', t).strip()

ach = W('Achievements')['achievements']
parentcats = W('Achievements')['parentCategories']
ills = {}
for n in ('Quests_ILLs', 'Dungeons_ILLs', 'Monsters_ILLs'):
    ills[n.split('_')[0]] = W(n)['ills']
fr2en = {k: {norm(v.get('fr', '')): en for en, v in sorted(t.items(), key=lambda kv: '(summon' in kv[0] or '(monster summon' in kv[0], reverse=True)
             if isinstance(v, dict) and v.get('fr')} for k, t in ills.items()}
en2fr = lambda kind, en: (ills[kind].get(en) or {}).get('fr') if isinstance(ills[kind].get(en), dict) else None
# quest ILL keys sometimes carry a "(quest)" suffix
for en in list(ills['Quests']):
    if en.endswith(' (quest)'): ills['Quests'].setdefault(en[:-8], ills['Quests'][en])

# ---------- route items, same order as app.js ----------
gp0 = guide(route['gp0'])
items, seen = [], set()
for i, st in enumerate(gp0['steps']):
    items.append((f'{i}', st.get('web_text')))
    for g, a, b in route['steps'].get(str(i), []):
        for k in range(a, min(b, len(guide(g)['steps']))):
            if (g, k) in seen: continue
            seen.add((g, k)); items.append((f'{i}/{g}/{k}', guide(g)['steps'][k].get('web_text')))
TAG = re.compile(r'<span data-type="custom-tag"[^>]*?type="(\w+)"[^>]*?name="([^"]*)"')
QB = re.compile(r'data-type="quest-block"[^>]*?questname="([^"]*)"[^>]*?status="(\w+)"')
qend, qlast, dpos, mpos = {}, {}, {}, {}
miss = collections.Counter()
for p, (key, h) in enumerate(items):
    h = h or ''
    for ty, name in TAG.findall(h):
        n = norm(name)
        if ty == 'quest':
            en = fr2en['Quests'].get(n)
            if en: qlast[en] = p
            else: miss['quest:' + name] += 1
        elif ty == 'dungeon':
            en = fr2en['Dungeons'].get(n)
            if en: dpos.setdefault(en, p)
            else: miss['dungeon:' + name] += 1
        elif ty == 'monster':
            en = fr2en['Monsters'].get(n)
            if en: mpos.setdefault(en, p)
    for name, status in QB.findall(h):
        en = fr2en['Quests'].get(norm(name))
        if not en: miss['qblock:' + name] += 1; continue
        qlast[en] = p
        if status == 'end': qend[en] = p
qpos = {**qlast, **qend}
plain = [' ' + norm(re.sub(r'<[^>]+>', ' ', h or '')) + ' ' for _, h in items]
_text_memo = {}
def text_pos(fr):
    """First route item whose text names `fr` (whole words), or None."""
    if not fr: return None
    n = ' ' + norm(fr) + ' '
    if len(n) < 7: return None                       # too short to be safe
    if n not in _text_memo:
        _text_memo[n] = next((p for p, t in enumerate(plain) if n in t), None)
    return _text_memo[n]

# ---------- boss -> dungeon, from the dungeon's own achievement ("Royal Gobball's Court": defeat Royal Gobball)
crit = lambda v: [c for ob in (v.get('objectives') or []) if isinstance(ob, dict) for c in (ob.get('criteria') or []) if isinstance(c, dict)]
boss2d = {}
for name, v in ach.items():
    if name in ills['Dungeons']:
        for c in crit(v):
            if c.get('type') == 'Defeat monster': boss2d.setdefault(c['value'], name)

ach_bosses = {}                                   # dungeon -> bosses named by its own achievement
for b, dn in boss2d.items(): ach_bosses.setdefault(dn, set()).add(b)
for dname, info in json.load(open(f'{HERE}/wiki/dungeon_monsters.json')).items():
    for mname in info['monsters']: boss2d.setdefault(mname, dname)

def top(cat):
    seen_ = set()
    while cat in parentcats and cat not in seen_: seen_.add(cat); cat = parentcats[cat]
    return cat
EXCLUDE_TOP = {'Kolizeum', 'Temporis', 'The Source', 'Dungeon Rusher World Tour'}

def boss_dungeon(b):
    if b in boss2d: return boss2d[b]
    nb = norm(b)
    hits = [d for d in ills['Dungeons'] if nb and (nb in norm(d) or norm(d).split(' ')[-1] == nb.split(' ')[-1] and len(nb) > 4)]
    return hits[0] if len(hits) == 1 else None

def where(c, cond):
    """Route position for one criterion, or None."""
    t, v = c.get('type'), c.get('value')
    if t == 'Quest': return qpos[v] if v in qpos else text_pos(en2fr('Quests', v))
    if t in ('Defeat monster', 'Complete challenges against monster'):
        d = boss_dungeon(v)
        if d in dpos: return dpos[d]
        return mpos[v] if v in mpos else text_pos(en2fr('Monsters', v))
    if t == 'Complete challenge':
        d = boss_dungeon(cond)
        if d in dpos: return dpos[d]
        return mpos[cond] if cond in mpos else text_pos(en2fr('Monsters', cond))
    return None

memo = {}
def done_at(name, stack=()):
    if name in memo: return memo[name]
    if name in stack or name not in ach: return None
    ps = []
    for ob in ach[name].get('objectives') or []:
        if not isinstance(ob, dict): continue
        cs = [c for c in ob.get('criteria') or [] if isinstance(c, dict) and c.get('type') != 'Level']
        if not cs: continue
        got = [done_at(c['value'], stack + (name,)) if c.get('type') == 'Achievement' else where(c, ob.get('condition')) for c in cs]
        if any(g is None for g in got): memo[name] = None; return None
        ps.append(max(got))
    memo[name] = max(ps) if ps else None
    return memo[name]

CHAL = {'Duo': 'Duo', 'Blitzkrieg': 'Blitzkrieg', 'Cautious': 'Prudent', 'First': 'Premier', 'Last': 'Dernier', 'Zombie': 'Zombie',
        'Bold': 'Hardi', 'Freedom': 'Liberté', 'Quartet': 'Quatuor', 'Barbaric': 'Barbare', 'Statue': 'Statue', 'Nomad': 'Nomade',
        'Special': 'Spécial', 'Chrono': 'Chrono', 'Duel': 'Duel', 'Focus': 'Focus', 'Untouchable': 'Intouchable', 'Versatile': 'Versatile',
        'Mystique': 'Mystique', 'Anchorite': 'Anachorète', 'Sticky': 'Collant', 'Last Man Standing': 'Dernier survivant'}
def fr_name(name):
    if name in ills['Dungeons']: return en2fr('Dungeons', name) or name
    m = re.fullmatch(r'(.+) \((.+)\)', name)
    if m:
        b = en2fr('Monsters', m.group(1)) or en2fr('Dungeons', m.group(1))
        if b: return f'{b} ({CHAL.get(m.group(2), m.group(2))})'
    return name

def obj_label(c, cond):
    t, v = c.get('type'), c.get('value')
    if t == 'Quest': return 'Quête : ' + (en2fr('Quests', v) or v)
    if t == 'Achievement': return 'Succès : ' + fr_name(v)
    if t == 'Complete challenge': return f'{en2fr("Monsters", cond) or cond} : challenge {CHAL.get(v, v)}'
    if t in ('Defeat monster', 'Complete challenges against monster'): return ('Vaincre ' if t == 'Defeat monster' else 'Challenge contre ') + (en2fr('Monsters', v) or v)
    return cond or str(v)

# ---------- "from here on" suggestion for achievements with no exact step (zone monsters, exploration, ...)
LEVEL_STEPS = [(1, 4), (40, 23), (60, 41), (100, 60), (120, 79), (150, 91), (180, 106), (200, 127)]   # GP0 equipment brackets
ZONE_GUIDES = {
    'Incarnam': 2, 'Astrub': 2, 'Amakna': 375, 'Kingdom of Amakna': 375, 'Bonta': 308, 'Brakmar': 308, 'Bonta and Brakmar': 308,
    'Otomai': 183, 'Otomai Island': 183, 'Moon Island': 30, 'Wabbit Island': 24, 'Wabbit Islands': 24, 'Cawwot Island': 24,
    'Cania': 305, 'Cania Plains': 305, 'Sidimote': 306, 'Sidimote Moors': 306, 'Koalak Mountain': 309, 'Ohwymi': 65,
    'Frigost': 98, 'Frigost Island': 98, 'Pandala': 428, 'Pandala Island': 428, 'Sufokia': 310, 'Depths of Sufokia': 310,
    'Sufokia Bay': 310, 'Archipelago of Valonia': 25, 'Evil Forest': 606, 'Srambad': 480, 'Xelorium': 434, 'Ecaflipus': 538,
    'Enurado': 431, 'Eliocalypse': 1714, 'Atoll of the Possessed': 2044, "Destroyers' Nightmare": 2022, 'Nimaltopia': 354,
    'Bwork and Goblin Camps': 28, 'Vigilantes': 430, 'Alignment': 516, 'Krosmoz': 374, 'Almanax': 484, 'Main Quests': 374,
    'Towers of the Brotherhood of the Forgotten': 427, 'Divine Dimensions': 434, 'Dimensions': 434, "The Horsemen's Dimension": 2010,
}
SEASONAL = {'Kwismas Island', 'Al Howin', 'Fleaster Island', 'Vulkanian Archipelago', 'Archipelago of Vulkania', 'Trool Fair'}
gp0_first = {}
for p_, (key, _) in enumerate(items):
    gp0_first.setdefault(int(key.split('/')[0]), p_)
guide_first = {}
for p_, (key, _) in enumerate(items):
    parts = key.split('/')
    if len(parts) == 3: guide_first.setdefault(int(parts[1]), p_)
monsters = {}
for f in ('Monsters_Stats_A-K', 'Monsters_Stats_L-Z'):
    if os.path.exists(f'{HERE}/wiki/{f}.lua'): monsters.update(W(f)['monsters'])
def level_pos(lvl):
    step = max(s_ for l_, s_ in LEVEL_STEPS if l_ <= (lvl or 1))
    return gp0_first.get(step)
def suggest(name, v):
    zones = {v.get('category')}
    for c in crit(v):
        if c.get('type') in ('Complete challenges against monster', 'Defeat monster'):
            zones.update((monsters.get(c.get('value')) or {}).get('areas') or [])
    if zones & SEASONAL: return None
    zp = [guide_first[ZONE_GUIDES[z]] for z in zones if z in ZONE_GUIDES and ZONE_GUIDES[z] in guide_first]
    lp = level_pos(v.get('level'))
    cand = ([min(zp)] if zp else []) + ([lp] if lp is not None else [])
    return max(cand) if cand else None

out, keyof = [], lambda p: items[p][0] if p is not None else None
stats = collections.Counter()
for name, v in ach.items():
    cat = v.get('category') or ''; tp = top(cat)
    if tp in EXCLUDE_TOP or cat in EXCLUDE_TOP: stats['excluded'] += 1; continue
    objs = []
    for ob in v.get('objectives') or []:
        if not isinstance(ob, dict): continue
        cs = [c for c in ob.get('criteria') or [] if isinstance(c, dict) and c.get('type') != 'Level']
        if not cs: continue
        pos = [done_at(c['value']) if c.get('type') == 'Achievement' else where(c, ob.get('condition')) for c in cs]
        objs.append([obj_label(cs[0], ob.get('condition')), keyof(max(pos)) if all(p is not None for p in pos) else None])
    d = done_at(name)
    stats['placed' if d is not None else ('partial' if any(o[1] for o in objs) else 'outside')] += 1
    sug = keyof(suggest(name, v)) if d is None and (tp not in ('Events',) and cat not in SEASONAL) else None
    if sug: stats['suggested'] += 1
    djn = name if name in ills['Dungeons'] else None
    if not djn:
        for ob in v.get('objectives') or []:
            if not isinstance(ob, dict): continue
            for c in ob.get('criteria') or []:
                if not isinstance(c, dict): continue
                b = ob.get('condition') if c.get('type') == 'Complete challenge' else c.get('value') if c.get('type') == 'Defeat monster' else None
                if b and boss_dungeon(b): djn = boss_dungeon(b); break
            if djn: break
    out.append({'dj': en2fr('Dungeons', djn) if djn else None, 'sug': sug, 'seasonal': cat in SEASONAL or tp == 'Events', 'n': fr_name(name), 'en': name, 'cat': cat, 'top': tp, 'lvl': v.get('level'),
                'd': re.sub(r'\[challenge,\d+\] ?', '', html.unescape(v.get('description') or '')), 'done': keyof(d), 'o': objs,
                'duo': name.endswith('(Duo)'), 'solo': name.endswith('(Solitary)') or name.endswith('(Lone Wolf)')})
json.dump({'built': '2026-10-15', 'source': 'DofusWiki (dofuswiki.fandom.com), CC-BY-SA', 'ach': out},
          open(f'{ROOT}/ach.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print(dict(stats), 'items', len(items))
print('unmatched FR names (top):', miss.most_common(12))
print('top categories:', collections.Counter(a['top'] for a in out).most_common())

# ---------- dungeon sheets for the hover cards (DofusWiki, CC-BY-SA) ----------
full = json.load(open(f'{HERE}/wiki/dungeons_full.json'))
bosses_of = {k: ach_bosses.get(k) or set(v['monsters']) for k, v in json.load(open(f'{HERE}/wiki/dungeon_monsters.json')).items()}
sheets = {}
for en, d in full.items():
    fr = en2fr('Dungeons', en) or en
    sheets[fr] = {'en': en, 'lvl': d['level'], 'where': ' · '.join(x for x in (d['area'], d['subarea'], d['coords']) if x),
                  'key': d['key'], 'keyring': d['bunch'].lower().startswith('y'),
                  'rooms': [{'n': r['name'], 'm': [[en2fr('Monsters', m) or m, lv, m in bosses_of.get(en, ())] for m, lv, _ in r['mons']]} for r in d['rooms']],
                  'mech': d['mechanics'], 'notes': d['notes']}
json.dump(sheets, open(f'{ROOT}/dungeons.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print('dungeon sheets', len(sheets))
