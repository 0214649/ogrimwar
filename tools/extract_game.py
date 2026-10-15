"""Read-only: achievements + categories from a local COPY of the Dofus 3 data (tools/cache/game), FR/EN texts from I18n."""
import json, os, sys, warnings
warnings.filterwarnings('ignore')
import UnityPy
HERE = os.path.dirname(os.path.abspath(__file__)); G = f'{HERE}/cache/game'
sys.path.insert(0, HERE)
import i18n
UnityPy.config.FALLBACK_UNITY_VERSION = '6000.3.16f1'
def rows(name):
    env = UnityPy.load(f'{G}/data_assets_{name}dataroot.asset.bundle')
    for o in env.objects:
        if o.type.name == 'MonoBehaviour':
            return [r['data'] for r in o.read_typetree()['references']['RefIds'] if 'data' in r]
fr, en = i18n.load(f'{G}/fr.bin'), i18n.load(f'{G}/en.bin')
cats = {c['id']: {'parent': c.get('parentId'), 'fr': fr.get(c.get('nameId'), ''), 'en': en.get(c.get('nameId'), '')} for c in rows('achievementcategories')}
achs = [{'id': a['id'], 'cat': a['categoryId'], 'pts': a.get('points'), 'lvl': a.get('level'),
         'fr': fr.get(a['nameId'], ''), 'en': en.get(a['nameId'], ''), 'dfr': fr.get(a['descriptionId'], ''), 'den': en.get(a['descriptionId'], '')}
        for a in rows('achievements')]
json.dump({'cats': cats, 'achs': achs}, open(f'{G}/game_achievements.json', 'w'), ensure_ascii=False)
print(len(achs), 'achievements,', len(cats), 'categories')
