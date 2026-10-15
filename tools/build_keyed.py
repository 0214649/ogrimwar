"""keyed.json: dungeons whose key is handed out by the Tour du Monde / the Tornade des donjons (lists from Skyzio's sheet,
which names bosses), matched to dungeon names or to the dungeon's boss."""
import json, re, unicodedata, os
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
norm = lambda t: re.sub(r'[^a-z0-9]+', ' ', ''.join(c for c in unicodedata.normalize('NFKD', t.lower()) if not unicodedata.combining(c))).strip()
k = json.load(open(f'{HERE}/cache/skyzio/keyed.json'))
gd = json.load(open(f'{HERE}/cache/game/game_dungeons.json'))      # names exactly as Ganymède writes them
dj = {d['fr']: {'rooms': [{'m': [[b, 0, True] for b in d['bosses']]}]} for d in gd if d['fr']}
word = lambda t, s: re.search(r'\b' + re.escape(t) + r's?\b', s)
# Skyzio's spellings that match neither a dungeon nor a boss name
ALIAS = {'Champs': 'Grange du Tournesol Affamé', 'Minotorror': 'Centre du Labyrinthe du Minotoror', 'Blop Royal': 'Clos des Blops',
         'Kanniboule Ebil': 'Village Kanniboul', 'Gelées Royales': 'Gelaxième Dimension'}
keyed, unmatched = {}, []
for src, lst in (('Tour du Monde', k['tdm']), ('Tornade des donjons', k['tornade'])):
    for v in lst:
        for t in (x.strip() for x in v.split('\n')):
            if not t or t == '-' or t.startswith('Fin '): continue
            if t in ALIAS: keyed.setdefault(ALIAS[t], src); continue
            nt = norm(t).rstrip('s')
            hit = [n for n in dj if word(nt, norm(n))] or \
                  [n for n, d in dj.items() if any(b and word(nt, norm(m)) for r in d['rooms'] for m, _, b in r['m'])]
            for n in hit: keyed.setdefault(n, src)
            if not hit: unmatched.append(t)
json.dump(keyed, open(f'{ROOT}/keyed.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(keyed), 'dungeons with a provided key; unmatched:', unmatched)
