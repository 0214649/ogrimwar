"""Consistency audit of ach.json against the route and the game's own categories. Prints problems; exit 1 if any."""
import json, os, re, html, collections, sys
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
A = json.load(open(f'{ROOT}/ach.json'))['ach']
route = json.load(open(f'{ROOT}/route.json'))
G = json.load(open(f'{HERE}/cache/game/game_achievements.json'))
gp0 = json.load(open(f'{HERE}/cache/guides/{route["gp0"]}.json'))
plain = lambda h: re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', h or ''))).strip()
real = {str(i) for i, st in enumerate(gp0['steps']) if re.match(r'Objectifs?\s*:', plain(st.get('web_text')))}
GU = {}
def text_of(key):
    p = key.split('/')
    if len(p) == 1: return gp0['steps'][int(p[0])].get('web_text') or ''
    g = int(p[1]); GU.setdefault(g, json.load(open(f'{HERE}/cache/guides/{g}.json')))
    return GU[g]['steps'][int(p[2])].get('web_text') or ''
cats = G['cats']
def top(cid):
    c, seen = cats.get(str(cid)), set()
    while c and c.get('parent') and str(c['parent']) in cats and c['parent'] not in seen: seen.add(c['parent']); c = cats[str(c['parent'])]
    return (c or {}).get('fr')
gby = {g['id']: g for g in G['achs']}
problems = collections.defaultdict(list)
P = lambda k, msg: problems[k].append(msg)

# 1. nothing placed on example / credit / bonus pages
for a in A:
    for field in ('done', 'sug'):
        k = a.get(field)
        if k and '/' not in k and k not in real: P('placé sur une page exemple/bonus', f"{a['n']} ({field}={k})")
    for label, k in a['o']:
        if k and '/' not in k and k not in real: P('objectif sur une page exemple/bonus', f"{a['n']} : {label} ({k})")
# 2. categories are the game's
for a in A:
    if not a.get('gid'): P('sans identifiant du jeu', a['n']); continue
    g = gby[a['gid']]
    if a.get('topfr') != top(g['cat']): P('catégorie principale différente du jeu', f"{a['n']}: site={a.get('topfr')} jeu={top(g['cat'])}")
    if a.get('catfr') != (cats.get(str(g['cat'])) or {}).get('fr'): P('sous-catégorie différente du jeu', a['n'])
    if a['n'] != g['fr']: P('nom différent du jeu', f"{a['n']} / {g['fr']}")
# 3. types land in the right family
for a in A:
    if a['d'].startswith('Découvrir la zone') and a.get('topfr') != 'Exploration': P('« Découvrir la zone » hors Exploration', f"{a['n']} -> {a.get('topfr')}")
    if a.get('seasonal') and a.get('topfr') != 'Événements': P('saisonnier hors Événements', f"{a['n']} -> {a.get('topfr')}")
    if a.get('topfr') == 'Événements' and (a['done'] or a['sug']) and not a.get('seasonal'): P('événement placé dans le parcours', a['n'])
# 4. a dungeon achievement is finished on a step that names that dungeon
for a in A:
    if a.get('dj') and a['done'] and a['dj'].lower() not in html.unescape(text_of(a['done'])).lower():
        P('donjon terminé à une étape qui ne le cite pas', f"{a['n']} ({a['dj']}) @ {a['done']}")
# 5. duplicates / coverage of the game's in-scope list
c = collections.Counter(a['gid'] for a in A if a.get('gid'))
for gid, n in c.items():
    if n > 1: P('doublon', gby[gid]['fr'])
SKIP = {'Temporis', 'Kolizéum', "La Source : L'Héritage des Dofus"}
for g in G['achs']:
    if top(g['cat']) in SKIP or 'Rusher' in (cats.get(str(g['cat'])) or {}).get('fr', '') or not g['fr']: continue
    if g['id'] not in c: P('succès du jeu absent du site', f"{g['fr']} ({top(g['cat'])})")
# 6. level sanity: an exact step far below the achievement's level is suspicious
BR = [(1, 4), (40, 23), (60, 41), (100, 60), (120, 79), (150, 91), (180, 106), (200, 127)]
def step_level(k):
    i = int(k.split('/')[0]); return max(l for l, s in BR if s <= i) if i >= 4 else 1
for a in A:
    lvl = a.get('lvl') or (gby.get(a.get('gid')) or {}).get('lvl') or 0
    if a['done'] and lvl - step_level(a['done']) > 60: P('niveau du succès bien au-dessus de l\'étape', f"{a['n']} (niv. {lvl}) @ [GP0] étape {int(a['done'].split('/')[0]) + 1}")
for k, v in sorted(problems.items(), key=lambda kv: -len(kv[1])):
    print(f'\n## {k} : {len(v)}'); [print('  -', x) for x in v[:12]]
by_top = collections.Counter(a.get('topfr') for a in A)
print('\nRépartition par catégorie :', dict(by_top.most_common()))
print('Total', len(A), '· exacts', sum(1 for a in A if a['done']), '· faisables', sum(1 for a in A if a['sug'] and not a['done']), '· saisonniers', sum(1 for a in A if a.get('seasonal')))
sys.exit(1 if problems else 0)
