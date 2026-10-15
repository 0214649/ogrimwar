"""Expand GP0 into an ordered list of (gp0_step, guide_id, from, to) segments."""
import json, re, html, sys
D = sys.argv[1] if len(sys.argv) > 1 else 'data'
G = lambda gid: json.load(open(f'{D}/guides/{gid}.json'))
gp0 = G(2747)
# keycap emojis (1️⃣) follow step numbers in the text: drop them or "25" + "1️⃣" reads as 251
txt = lambda h: re.sub(r'\s+', ' ', re.sub(r'\d\ufe0f?\u20e3', '', html.unescape(re.sub(r'<[^>]+>', ' ', h)))).strip()
TAG = re.compile(r'<span data-type="custom-tag"[^>]*?type="(\w+)"[^>]*?dofusdbid="(\d+)"')
cursor, segs = {}, []
for i, st in enumerate(gp0['steps']):
    h = st.get('web_text') or ''
    if not re.match(r'\s*Objectifs?\s*:', txt(h)): continue      # intro / bonus pages only cite guides as examples
    for li in re.split(r'<li\b', h)[1:]:
        li = li.split('</li>')[0]                      # only this task line, not the paragraphs after the list
        refs = re.findall(r'data-type="guide-step"[^>]*?guideid="(\d+)"', li)
        if not refs: continue
        t = txt(li).replace(' ', ' ')
        gids = [g for g in dict.fromkeys(int(g) for g in refs) if g not in (0, 2747)]
        for gid in gids:
            try: n = len(G(gid)['steps'])
            except FileNotFoundError: print('missing guide', gid, file=sys.stderr); continue
            cur = cursor.get(gid, 0)
            m_de = re.search(r"(?:de|depuis) l' ?étapes? (\d+)", t)
            m_to = re.search(r"jusqu'à l' ?étape (\d+)", t) or re.search(r"(?:de|depuis) l' ?étapes? \d+ à l' ?étapes? (\d+)", t)
            if len(gids) > 1: m_de = m_to = None          # multi-guide line: handled via 'termin'/dungeon
            a = int(m_de.group(1)) - 1 if m_de else cur
            if m_to: b = int(m_to.group(1))
            elif re.search(r'termin', t, re.I): b = n
            else:
                # "avancez ... jusqu'à atteindre <dungeon>": stop at first sub-step with a dungeon tag from this GP0 step
                dj = {d for ty, d in TAG.findall(h) if ty == 'dungeon'}
                b = None
                for k in range(a, n):
                    if dj & {d for ty, d in TAG.findall(G(gid)['steps'][k].get('web_text') or '') if ty == 'dungeon'}:
                        b = k + 1; break
                if b is None: b = n
            segs.append((i, gid, a, b))
            cursor[gid] = max(cur, b)
json.dump({'segs': segs, 'cursor': cursor}, open(f'{D}/expanded.json', 'w'))
if __name__ == '__main__':
    names = {g['id']: g['name'] for g in json.load(open(f'{D}/gp_list.json'))}
    for s in segs: print(s, names.get(s[1]))
    import os
    print('--- guides not fully covered:')
    for f in os.listdir(f'{D}/guides'):
        gid = int(f[:-5]); n = len(G(gid)['steps'])
        if cursor.get(gid, 0) < n: print(gid, names.get(gid), cursor.get(gid, 0), '/', n)
