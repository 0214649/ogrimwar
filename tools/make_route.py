"""route.json: GP0 step index -> sub-guide ranges [guideId, from0, toExclusive]. Run expand.py first."""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__)); D = f'{HERE}/cache'
ex = json.load(open(f'{D}/expanded.json'))
names = {g['id']: g['name'] for g in json.load(open(f'{D}/gp_list.json'))}
gp0 = json.load(open(f'{D}/guides/2747.json'))
route = {}
for s, gid, a, b in ex['segs']:
    if b > a: route.setdefault(str(s), []).append([gid, a, b])
json.dump({'gp0': 2747, 'gp0_updated': gp0['updated_at'], 'steps': route,
           'names': {str(g): names.get(g) for g in {x[0] for v in route.values() for x in v}}},
          open(f'{os.path.dirname(HERE)}/route.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(route), 'steps with ranges')
