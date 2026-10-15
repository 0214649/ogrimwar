'use strict';
// Ogrimwar — walks Ganymède's GP0 step by step, expanding every sub-guide range it points to.
// Guides are fetched live from ganymede-app.com (CORS open) and kept in the browser's Cache API.
const API = 'https://ganymede-app.com/api';
const GP0 = 2747;
const $ = id => document.getElementById(id);
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- state (browser storage + export code) ----------
// Several profiles per browser (one per team / friend); each keeps its own progress. A fresh visitor gets one blank profile.
const LEGACY = 'carnet-team-v1', PROFILES = 'eclosion-profiles-v1', PKEY = id => 'eclosion-p-' + id;
// Unlocked the moment a new character clicks "skip the tutorial": Premier temps, Second temps, Sur de bonnes bases, Temple Céleste
const START_ACH = ['First Steps', 'Second Phase', 'A Good Foundation', 'Celestial Temple (Achievement)'];
const blank = () => ({ pos: '0', t: {}, a: Object.fromEntries(START_ACH.map(k => [k, 1])), l: {}, align: 'bonta', v: 3 });   // l: put off until level 200 / a carry
const ALIGN = { bonta: 516, brak: 773 };   // GP9 Bontarien / Brâkmarien
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
let P = lsGet(PROFILES);
if (!P || !P.list?.length) {
  const id = Date.now().toString(36);
  P = { cur: id, list: [{ id, name: 'Ma team' }] };
  lsSet(PKEY(id), { ...blank(), ...(lsGet(LEGACY) || {}) });          // earlier progress becomes the first profile
  lsSet(PROFILES, P);
}
// profiles made before START_ACH existed get those four ticked once
for (const p of P.list) { const st = lsGet(PKEY(p.id)); if (st && !(st.v >= 3)) { st.a = { ...(st.a || {}) }; delete st.a.Beginning; START_ACH.forEach(k => st.a[k] = 1); st.v = 3; lsSet(PKEY(p.id), st); } }
let S = { ...blank(), ...(lsGet(PKEY(P.cur)) || {}) };
const save = () => lsSet(PKEY(P.cur), S);
const profName = () => P.list.find(p => p.id === P.cur)?.name || 'Profil';
const encode = () => btoa(unescape(encodeURIComponent(JSON.stringify({ ...S, name: profName() }))));
const decode = c => JSON.parse(decodeURIComponent(escape(atob(c.trim()))));

// ---------- fetching with cache + polite retry (Ganymède rate-limits bursts) ----------
let listUpdated = null;           // guide id -> updated_at, fetched once per visit
const memo = new Map();
async function getJSON(url, tries = 4) {
  for (let n = 0; ; n++) {
    const r = await fetch(url);
    if (r.status === 429 && n < tries) { await new Promise(ok => setTimeout(ok, 4000 * (n + 1))); continue; }
    if (!r.ok) throw new Error(`Ganymède a répondu ${r.status}`);
    return r.json();
  }
}
async function guideList() {
  if (!listUpdated) {
    try {
      const l = await getJSON(`${API}/guides?status=gp`);
      listUpdated = Object.fromEntries(l.map(g => [g.id, g.updated_at]));
    } catch { listUpdated = {}; }
  }
  return listUpdated;
}
function guide(id) {
  if (memo.has(id)) return memo.get(id);
  const p = (async () => {
    const url = `${API}/v2/guides/${id}`;
    let cache = null;
    try { cache = await caches.open('ganymede-guides'); } catch {}
    const hit = cache && await cache.match(url);
    if (hit) {
      const g = await hit.json();
      const fresh = (await guideList())[id];
      if (!fresh || fresh === g.updated_at) return g;
    }
    const g = await getJSON(url);
    try { await cache?.put(url, new Response(JSON.stringify(g), { headers: { 'content-type': 'application/json' } })); } catch {}
    return g;
  })();
  memo.set(id, p);
  p.catch(() => memo.delete(id));
  return p;
}

// ---------- route ----------
let R, gp0, items = [], idx = 0;
const txt = h => { const d = document.createElement('div'); d.innerHTML = h || ''; return d.textContent.replace(/\s+/g, ' ').trim(); };
const isBonus = i => /^[^A-Za-zÀ-ÿ]*Étape bonus/.test(txt(gp0.steps[i]?.web_text));
// pages of the GP0 that are not game steps (credits, welcome, how to read a step, closing words)
function introTitle(t) {
  if (/Guide rédigé par/.test(t)) return 'Crédits du guide';
  if (/Bienvenue/.test(t)) return 'Bienvenue : à quoi sert ce guide';
  if (/IMPORTANT/.test(t)) return 'Important : à lire en entier';
  if (/Lisez toujours/.test(t)) return 'Comment lire une étape';
  if (/terminé/.test(t)) return 'Fin du guide';
  return t.slice(0, 70);
}
function stepTitle(i) {
  const t = txt(gp0.steps[i]?.web_text);
  if (isBonus(i)) return t.replace(/.*?Étape bonus\s*👈?\s*/, '').slice(0, 70) || 'Étape bonus';
  const m = t.match(/^Objectifs?\s*:\s*(.*?)\./);
  return m ? m[1] : introTitle(t);
}
function buildItems() {
  const seen = new Set(); items = [];
  gp0.steps.forEach((_, i) => {
    items.push({ i, key: `${i}` });
    for (const [g, a, b] of R.steps[i] || []) for (let k = a; k < b; k++) {
      const id = `${g}:${k}`; if (seen.has(id)) continue; seen.add(id);
      items.push({ i, g, k, key: `${i}/${g}/${k}` });
    }
  });
}
const isIntro = i => !/^Objectifs?\s*:/.test(txt(gp0.steps[i]?.web_text)) && !isBonus(i);
const visible = it => it.g !== ALIGN[S.align === 'bonta' ? 'brak' : 'bonta'] && !it.gone;
let lastDir = 1;

// ---------- sanitising + enriching Ganymède HTML ----------
const COORD = /\[\s*(-?\d{1,3})\s*,\s*(-?\d{1,3})\s*\]/g;
// images whose host refuses them (Gyazo answers 503): show a quiet note with the link instead of a broken icon
// Fallback for images their host refuses (Gyazo answers 503): jump straight to the quest's page on
// Dofus pour les Noobs (DuckDuckGo "!ducky" opens the first result directly), or a quiet note when the
// image belongs to no quest (decorative banners).
function brokenImg(img) {
  const gc = img.closest('.gc');
  const quest = gc?.querySelector('[data-type=quest-block]')?.getAttribute('questname')
    || gc?.querySelector('[data-type=custom-tag][type=quest]')?.getAttribute('name');
  const el = document.createElement(quest ? 'a' : 'span');
  el.className = quest ? 'imgoff' : 'imgoff quiet';
  if (quest) {
    el.target = '_blank'; el.rel = 'noopener';
    el.href = 'https://duckduckgo.com/?q=' + encodeURIComponent(`!ducky site:dofuspourlesnoobs.com ${quest}`);
    el.innerHTML = `<b>Image du guide indisponible</b> (bloquée chez son hébergeur).<br>Ouvrir la quête « ${esc(quest)} » sur Dofus pour les Noobs, avec ses captures →`;
  } else el.textContent = 'Image décorative indisponible chez son hébergeur.';
  img.replaceWith(el);
}

function enrich(html, scope) {
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
  const root = doc.body.firstChild;
  root.querySelectorAll('script,style,iframe,object,embed,link,meta,form').forEach(n => n.remove());
  root.querySelectorAll('*').forEach(el => {
    for (const a of [...el.attributes]) if (/^on/i.test(a.name) || (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
    if (el.tagName === 'A') { el.target = '_blank'; el.rel = 'noopener'; }
    if (el.tagName === 'IMG') { el.loading = 'lazy'; el.setAttribute('onerror', 'brokenImg(this)'); }
  });
  // coordinates -> /travel buttons
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts = []; while (walker.nextNode()) texts.push(walker.currentNode);
  for (const t of texts) {
    if (!COORD.test(t.data) || t.parentElement.closest('a,button')) continue;
    COORD.lastIndex = 0;
    const frag = doc.createDocumentFragment(); let last = 0, m;
    while ((m = COORD.exec(t.data))) {
      frag.append(t.data.slice(last, m.index));
      const b = doc.createElement('button'); b.type = 'button'; b.className = 'travel';
      b.dataset.travel = `${m[1]},${m[2]}`; b.title = `Copier /travel ${m[1]},${m[2]}`; b.textContent = `[${m[1]},${m[2]}]`;
      frag.append(b); last = m.index + m[0].length;
    }
    frag.append(t.data.slice(last)); t.replaceWith(frag);
  }
  // task checkboxes, remembered per guide step
  root.querySelectorAll('li[data-type=taskItem]').forEach((li, n) => {
    const box = li.querySelector('input[type=checkbox]'); if (!box) return;
    const k = `${scope}:${n}`;
    box.dataset.task = k; box.checked = !!S.t[k]; box.removeAttribute('disabled');
    li.classList.toggle('checked', box.checked);
  });
  root.querySelectorAll('[data-type=guide-step]').forEach(s => { s.tabIndex = 0; s.setAttribute('role', 'link'); });
  addX4Badges(doc, root);
  return root.innerHTML;
}

// ---------- "x4" reminders: everything each of the 4 characters must do on its own ----------
const X4_RULES = [
  [/\b(seule?s?\s+contre|combat\s+seul|en\s+solo|combat\s+solo)\b/i, '⚔ Combat solo ×4', 'solo'],
  [/\bParle[rz]\b/i, '×4 PNJ', ''],
  [/\b(Cliquez|Cliquer|Utilisez|Utiliser|Interagissez|Ramassez|Fouillez|Récoltez)\b/i, '×4', ''],
];
function badge(doc, text, cls) { const b = doc.createElement('span'); b.className = 'x4 ' + cls; b.textContent = text; return b; }
function addX4Badges(doc, root) {
  root.querySelectorAll('[data-type=quest-block]').forEach(q => {
    const st = q.getAttribute('status');
    q.prepend(badge(doc, st === 'end' ? 'Rendre la quête ×4' : st === 'progress' ? 'Avancer la quête ×4' : 'Lancer la quête ×4', 'quest'));
  });
  root.querySelectorAll('p, li[data-type=taskItem] > div').forEach(el => {
    if (el.closest('[data-type=quest-block]') && el.tagName === 'P' && !/\S/.test(el.textContent)) return;
    const t = el.textContent;
    for (const [re, label, cls] of X4_RULES) if (re.test(t)) { el.append(' ', badge(doc, label, cls)); break; }
    if (/\b(Réalisez|Effectuez|Faites|Refaites)\b/.test(t) && el.querySelector('[type=dungeon]')) el.append(' ', badge(doc, '🗝 Clé ×4 ou trousseau', 'key'));
  });
  root.querySelectorAll('[data-type=custom-tag][type=item]').forEach(tag => {
    const prev = tag.previousSibling;
    const m = prev && prev.nodeType === 3 && prev.data.match(/(\d+)\s*$/);
    if (m && +m[1] > 0) tag.after(badge(doc, `×4 = ${+m[1] * 4}`, 'qty'));
  });
}

// ---------- shopping list: what the next GP0 steps ask you to bring, already ×4 ----------
// Keys only for dungeons outside the "Tour du Monde" objective (its quests and the Tornade hand out the keys):
// Divine Dimensions and the rest.
const RUN_RE = /\b(Réalise[zr]|Effectue[zr]|Faites|Refaites|Termine[zr]|Vainque[zr])\b/i;
const NOT_RE = /sans (faire|lancer)|plus tard|pour prendre la sauvegarde|il vous faudra|vous pourrez|qui vous demande|en parallèle|Atteindre|Une fois à/i;
// dungeons whose key comes from the Tour du Monde (Maître des clefs) or the Tornade (Emma Tompouce), anywhere on the route
let KEYED = null;
async function keyedDungeons() {
  if (KEYED) return KEYED;
  try { const k = await (await fetch('keyed.json?v=1')).json(); KEYED = new Map(Object.entries(k)); return KEYED; } catch {}
  KEYED = new Set();
  const tag = /data-type="custom-tag"[^>]*?type="dungeon"[^>]*?name="([^"]*)"/g;
  const clean = n => n.replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  for (const it of items) {
    let h;
    if (it.g === undefined) h = gp0.steps[it.i].web_text;
    else if (memo.has(it.g)) { try { h = (await guide(it.g)).steps[it.k]?.web_text; } catch { continue; } }
    if (!h) continue;
    const tdm = it.g === undefined && /Tour du Monde/.test(txt(h).split('.')[0]);
    for (const chunk of h.split(/<\/p>|<\/li>|<br\s*\/?>/)) {
      if (tdm || /Emma Tompouce|Tornade|Maître des clefs/i.test(chunk.replace(/<[^>]+>/g, ' ')))
        for (const m of chunk.matchAll(tag)) KEYED.add(clean(m[1]));
    }
  }
  return KEYED;
}
async function shoppingList(nSteps) {
  const from = items[idx].i, to = from + nSteps;
  const its = items.slice(idx).filter(it => it.i < to && visible(it) && !(it.g === undefined && (isIntro(it.i) || isBonus(it.i))));
  const need = new Map(), keys = new Map(), runs = new Map(), keyed = await keyedDungeons();
  for (const it of its) {
    let h;
    if (it.g === undefined) h = gp0.steps[it.i].web_text;
    else { try { h = (await guide(it.g)).steps[it.k]?.web_text; } catch { continue; } }
    if (!h) continue;
    const doc = new DOMParser().parseFromString(`<div>${h}</div>`, 'text/html').body.firstChild;
    doc.querySelectorAll('[data-type=custom-tag][type=item]').forEach(tag => {
      const prev = tag.previousSibling, m = prev && prev.nodeType === 3 && prev.data.match(/(\d+)\s*$/);
      if (!m || +m[1] <= 0) return;
      const name = tag.getAttribute('name'), cur = need.get(name) || { n: 0, img: tag.querySelector('img')?.src, where: stepRef(it) };
      cur.n += +m[1]; need.set(name, cur);
    });
    const covered = /Tour du Monde/.test(txt(gp0.steps[it.i].web_text).split('.')[0]) || /Emma Tompouce|Tornade|Maître des clefs/i.test(txt(h));
    for (const chunk of h.split(/<\/p>|<\/li>|<br\s*\/?>/)) {
      const t = chunk.replace(/<[^>]+>/g, ' ');
      if (!RUN_RE.test(t) || NOT_RE.test(t)) continue;
      for (const m of chunk.matchAll(/data-type="custom-tag"[^>]*?type="dungeon"[^>]*?name="([^"]*)"/g)) {
        const name = m[1].replace(/&#39;/g, "'").replace(/&amp;/g, '&');
        if (!runs.has(name)) runs.set(name, { where: stepRef(it), key: it, provided: keyed instanceof Map ? keyed.get(name) : (covered || keyed.has(name)) ? 'quête' : null });
      }
    }
  }
  return { need, runs, steps: its.length, from, to: Math.min(to, gp0.steps.length) };
}
async function openShopping(n = ui.shopN || 10) {
  ui.shopN = n;
  $('shopBody').innerHTML = '<p class="loading">Je lis les prochaines étapes…</p>';
  if (!$('shopDlg').open) $('shopDlg').showModal();
  const r = await shoppingList(n);
  const rows = [...r.need].sort((a, b) => a[0].localeCompare(b[0]));
  $('shopBody').innerHTML = `<div class="shophead"><h2>Liste de courses</h2>
      <label>Pour les <select id="shopN">${[5, 10, 20, 40].map(v => `<option${v === n ? ' selected' : ''}>${v}</option>`).join('')}</select> prochaines étapes du [GP0]</label></div>
    <p class="note">De [GP0] étape ${r.from + 1} à ${r.to}, ${r.steps} étapes lues. Quantités déjà multipliées par 4 (une par perso).</p>
    ${rows.length ? `<ul class="shop">${rows.map(([name, v]) => `<li>${v.img ? `<img src="${esc(v.img)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<span class="sn">${esc(name)}</span><b class="num">×${v.n * 4}</b><span class="sw">${v.n} par perso · dès ${esc(v.where)}</span></li>`).join('')}</ul>` : '<p class="empty">Aucune ressource demandée sur ces étapes.</p>'}
    <h3>Donjons à venir</h3>
    ${r.runs.size ? `<ul class="shop">${[...r.runs].map(([name, v]) => `<li><span class="sn">${v.provided ? '✓' : '🗝'} ${esc(name)}${DJ[name] ? ` <span class="num">niv. ${esc(DJ[name].lvl)}</span>` : ''}</span><b class="num ${v.provided ? 'ok' : ''}">${v.provided ? 'clé fournie' : 'clé ×4'}</b><span class="sw">${v.provided ? `par ${esc(v.provided)}` : DJ[name]?.keyring ? 'à prévoir, ou le trousseau' : 'à prévoir'} · ${esc(v.where)}</span></li>`).join('')}</ul>` : '<p class="empty">Aucun donjon sur ces étapes.</p>'}`;
}

// ---------- DPLN: their real page, shown in a side panel (never copied) ----------
const slug = n => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/œ/g, 'oe').replace(/æ/g, 'ae').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// A frame from another site can't be scrolled by this page (browser same-origin rule), so the panel shows
// the page from the top; the "new tab" link adds a text fragment that jumps to and highlights the boss.
function openDpln(name) {
  const url = `https://www.dofuspourlesnoobs.com/${slug(name)}.html`;
  const boss = DJ[name]?.rooms.flatMap(r => r.m).find(m => m[2])?.[0];
  $('dplnTitle').textContent = name;
  $('dplnOpen').href = boss ? `${url}#:~:text=${encodeURIComponent(boss)}` : url;
  $('dplnOpen').textContent = boss ? `Ouvrir dans un onglet, direct sur « ${boss} » ↗` : 'Ouvrir dans un onglet ↗';
  $('dplnSearch').href = 'https://duckduckgo.com/?q=' + encodeURIComponent(`!ducky site:dofuspourlesnoobs.com ${name}`);
  $('dplnFrame').src = url;
  $('dpln').classList.add('open');
  fitDpln();
}
// DPLN's layout needs ~1180px; on a narrower panel, render it at that width and scale it down instead of squeezing it
const DPLN_W = 1180;
let dz = 1;
try { dz = +localStorage.getItem('dplnZoom2') || 1; } catch {}
function fitDpln() {
  const v = $('dplnView'), f = $('dplnFrame');
  const k = Math.min(1, v.clientWidth / DPLN_W) * dz;        // never enlarged on its own; shrunk only if the panel is narrower than DPLN's layout
  $('dzVal').textContent = Math.round(k * 100) + ' %';
  f.style.width = (v.clientWidth / k) + 'px';
  f.style.height = (v.clientHeight / k) + 'px';
  f.style.transform = k !== 1 ? `scale(${k})` : '';
}
function zoomDpln(d) { dz = Math.max(.5, Math.min(2, +(dz + d).toFixed(2))); try { localStorage.setItem('dplnZoom2', dz); } catch {} fitDpln(); }
addEventListener('resize', () => { if ($('dpln').classList.contains('open')) fitDpln(); });
function closeDpln() { $('dpln').classList.remove('open'); }

// ---------- dungeon sheet (DofusWiki facts) ----------
let DJ = {};
function openDungeon(name) {
  const d = DJ[name];
  const achs = ACH.map((a, ai) => ai).filter(ai => ACH[ai].dj === name);
  let h = `<div class="djhead"><h2>${esc(name)}</h2>${d ? `<span class="num">niv. ${esc(d.lvl)}</span>` : ''}</div>`;
  if (d) {
    h += `<p class="djwhere">${esc(d.where)}</p><p class="djkey"><b>🗝 Clé :</b> une par perso, donc <b>4 clés</b>${d.keyring ? ', ou le <b>trousseau de clefs</b> (donjon inclus)' : ' (pas dans le trousseau)'}.</p>`;
    if (d.rooms.length) h += `<div class="rooms">${d.rooms.map((r, n) => `<div class="room"><span class="lbl">Salle ${n + 1}${/^\d+$/.test(r.n) ? '' : ' · ' + esc(r.n)}</span><ul>${r.m.map(([m, lv, boss]) => `<li class="${boss ? 'boss' : ''}">${boss ? '👑 ' : ''}${esc(m)} <span class="num">${lv}</span></li>`).join('')}</ul></div>`).join('')}</div>`;
    if (d.mech) h += `<details class="mech"><summary>Mécaniques notées par le wiki (en anglais)</summary><p>${esc(d.mech)}</p></details>`;
  } else h += `<p class="empty">Le wiki n'a pas de fiche pour ce donjon.</p>`;
  if (achs.length) h += `<div class="agroup dj"><span class="lbl">Succès du donjon · ${achs.filter(ai => got(ACH[ai])).length}/${achs.length}</span><ul class="al">${achs.map(ai => achLi(ai)).join('')}</ul></div>`;
  h += `<div class="row"><button class="btn primary" data-dpln="${esc(name)}">Stratégie sur Dofus pour les Noobs</button></div>`;
  $('djBody').innerHTML = h;
  $('djDlg').showModal();
}
function dungeonNames(html) {
  return [...new Set([...String(html || '').matchAll(/data-type="custom-tag"[^>]*?type="dungeon"[^>]*?name="([^"]*)"/g)].map(m => m[1].replace(/&#39;/g, "'").replace(/&amp;/g, '&')))];
}
function dungeonCards(html) {
  return dungeonNames(html).map(name => {
    const achs = ACH.map((a, ai) => ai).filter(ai => ACH[ai].dj === name);
    if (!achs.length && !DJ[name]) return '';
    const g = achs.filter(ai => got(ACH[ai])).length, l = achs.filter(ai => S.l[ACH[ai].en] && !got(ACH[ai])).length;
    return `<div class="agroup dj"><span class="lbl">Donjon · ${esc(name)}${DJ[name] ? ' · niv. ' + esc(DJ[name].lvl) : ''}</span>
      <div class="djbar"><span class="num">${g}/${achs.length} faits${l ? ` · ${l} ⏳` : ''}</span><button class="btn small" data-dungeon="${esc(name)}">Fiche du donjon</button><button class="btn small" data-dpln="${esc(name)}">DPLN</button></div>
      <ul class="al">${achs.map(ai => achLi(ai)).join('')}</ul></div>`;
  }).join('');
}

// ---------- rendering ----------
function renderSide() {
  const cur = items[idx].i;
  $('stepList').innerHTML = gp0.steps.map((_, i) => {
    const b = isBonus(i);
    const n = (doneByStep.get(i) || []).length + (sugByStep.get(i) || []).length;
    return `<li data-step="${i}" class="${i < cur ? 'past' : ''}${i === cur ? ' cur' : ''}${b ? ' bonus' : ''}"><span class="num">${i + 1}</span><span>${esc(stepTitle(i))}</span>${n ? `<span class="ac">${n} succès</span>` : ''}</li>`;
  }).join('');
  $('stepList').querySelector('.cur')?.scrollIntoView({ block: 'nearest' });
}
function segInfo(it) {
  const segs = R.steps[it.i] || [];
  const within = items.filter(x => x.i === it.i && x.g === it.g);
  return { n: within.indexOf(it) + 1, of: within.length, seg: segs.find(([g, a, b]) => g === it.g && it.k >= a && it.k < b) };
}
async function render() {
  const it = items[idx];
  S.pos = it.key; save();
  const total = gp0.steps.length;
  $('fill').style.width = `${(100 * it.i / (total - 1)).toFixed(1)}%`;
  $('meter').textContent = `${it.i + 1}/${total}`;
  $('pos').textContent = stepRef(it);
  $('prev').disabled = !items.slice(0, idx).some(visible);
  $('next').disabled = !items.slice(idx + 1).some(visible);
  renderSide();
  ui.html = it.g === undefined ? gp0.steps[it.i].web_text : '';
  renderAchPanel(it, ui.html);

  const ctx = $('ctx'), card = $('card'), links = $('links');
  $('stage').classList.toggle('is-sub', it.g !== undefined);
  if (it.g === undefined) {
    ctx.hidden = true;
    $('crumb').textContent = stepRef(it);
    const segs = (R.steps[it.i] || []);
    const pages = items.filter(x => x.i === it.i && x.g !== undefined).length;
    $('stepHead').innerHTML = `<div class="bignum"><small>[GP0]</small>${it.i + 1}</div><span class="eyebrow">[GP0] ${esc(gp0.name.replace(/^\[[^\]]+\]\s*/, ''))} · étape ${it.i + 1} sur ${gp0.steps.length}</span><h2>${esc(stepTitle(it.i))}</h2>${summary(it)}${pages ? `<p class="heronote">Cette étape t'envoie dans ${[...new Set(segs.map(([g]) => codeOf(g)))].join(', ')} : ${pages} étape${pages > 1 ? 's' : ''} à suivre avec Suivant.</p>` : ''}`;
    card.innerHTML = `<div class="gc">${enrich(gp0.steps[it.i].web_text, `${GP0}:${it.i}`)}</div>`;
    links.hidden = !segs.length;
    links.innerHTML = segs.length ? `<span class="lbl">Dans cette étape</span>` + segs.map(([g, a, b]) => {
      const first = items.find(x => x.i === it.i && x.g === g);
      return first ? `<button class="btn" data-goto="${first.key}">${esc(R.names[g] || g)} · ét. ${a + 1}→${b}</button>` : '';
    }).join('') : '';
  } else {
    const name = R.names[it.g] || `Guide ${it.g}`;
    $('crumb').textContent = stepRef(it);
    ctx.hidden = false;
    ctx.innerHTML = `<details><summary><span class="lbl">Consigne [GP0] étape ${it.i + 1}</span><span>${esc(stepTitle(it.i))}</span></summary><div class="body gc">${enrich(gp0.steps[it.i].web_text, `${GP0}:${it.i}`)}</div></details>`;
    card.innerHTML = `<p class="loading">Chargement de ${esc(name)}…</p>`;
    $('stepHead').innerHTML = subHero(it, name, null);
    let g;
    try { g = await guide(it.g); } catch (e) { card.innerHTML = `<p class="empty">Impossible de charger ${esc(name)} : ${esc(e.message)}. Réessaie dans un instant.</p>`; return; }
    if (items[idx] !== it) return;               // user moved on while loading
    const st = g.steps[it.k];
    const { n, of, seg } = segInfo(it);
    if (!st) { it.gone = true; step(lastDir); return; }     // guide got shorter since route.json was built
    $('stepHead').innerHTML = subHero(it, name, g, st);
    card.innerHTML = `<div class="gc">${enrich(st.web_text, `${it.g}:${it.k}`)}</div>`;
    ui.html = st.web_text; renderAchPanel(it, ui.html);
    links.hidden = true;   // the range bar in the hero already says where we are
  }
  // warm the next guide so the next click is instant
  const nx = items.slice(idx + 1).find(x => x.g !== undefined && x.g !== it.g);
  if (nx) setTimeout(() => guide(nx.g).catch(() => {}), 800);
}
// One naming scheme everywhere: "[GP0] étape 5 › [GP1] étape 44"
const codeOf = g => g === undefined ? '[GP0]' : ((R.names[g] || '').match(/^\[[^\]]+\]/)?.[0] || '[GP?]');
const labelOf = g => (R.names[g] || '').replace(/^\[[^\]]+\]\s*/, '');
const stepRef = it => `[GP0] étape ${it.i + 1}` + (it.g === undefined ? '' : ` › ${codeOf(it.g)} étape ${it.k + 1}`);

// Sub-guide page: a parent bar back to the GP0 step, the guide's code + page number, and the range progress.
function subHero(it, name, g, st) {
  const code = codeOf(it.g), label = labelOf(it.g) || name;
  const { n, of } = segInfo(it);
  return `<button class="parentbar" data-goto="${it.i}"><span class="up">↑</span><span><b>[GP0] étape ${it.i + 1}</b> · ${esc(stepTitle(it.i))}</span></button>
    <div class="bignum"><small>${esc(code)}</small>${it.k + 1}</div>
    <span class="eyebrow">${esc(code)} ${esc(label)} · étape ${it.k + 1}${g ? ' sur ' + g.steps.length : ''}</span>
    <h2>${esc(st?.name || stepTitle(it.i))}</h2>
    <div class="rangebar" title="Étapes de ${esc(code)} à faire pour [GP0] étape ${it.i + 1}"><div class="rfill" style="width:${(100 * n / of).toFixed(1)}%"></div><span>${n} / ${of} étapes de ${esc(code)} pour [GP0] étape ${it.i + 1}</span></div>
    ${st ? summary(it, st) : ''}`;
}
function summary(it, st) {
  const pills = [];
  if (st && st.map) pills.push(`<button type="button" class="pill where" data-travel="${st.pos_x},${st.pos_y}" title="Copier /travel ${st.pos_x},${st.pos_y}"><span class="ico">➜</span> ${esc(st.map)} <span class="num">[${st.pos_x},${st.pos_y}]</span> · copier /travel</button>`);
  if (it.g === undefined) {
    const d = (doneByStep.get(it.i) || []).length, g = (sugByStep.get(it.i) || []).length;
    if (d) pills.push(`<span class="pill done"><b>${d}</b> succès terminés dans cette étape</span>`);
    if (g) pills.push(`<span class="pill sug"><b>${g}</b> faisables à partir d'ici</span>`);
  } else {
    const d = (doneIn.get(idx) || []).length;
    const p = new Set((touch.get(idx) || []).map(([ai]) => ai).filter(ai => ACH[ai].di !== idx && ACH[ai].o.length > 1)).size;
    const g = (sugIn.get(idx) || []).length;
    if (d) pills.push(`<span class="pill done"><b>${d}</b> succès terminé${d > 1 ? 's' : ''} ici</span>`);
    if (p) pills.push(`<span class="pill prog"><b>${p}</b> avance${p > 1 ? 'nt' : ''}</span>`);
    if (g) pills.push(`<span class="pill sug"><b>${g}</b> faisable${g > 1 ? 's' : ''} dès maintenant</span>`);
  }
  return pills.length ? `<div class="summary">${pills.join('')}</div>` : '';
}
function go(to) {
  if (to < 0 || to >= items.length) return;
  const st = $('stage'); st.classList.remove('turn-next', 'turn-prev'); void st.offsetWidth;
  st.classList.add(to >= idx ? 'turn-next' : 'turn-prev');
  idx = to; render(); $('main').focus({ preventScroll: true }); scrollTo(0, 0);
}
const step = d => { lastDir = d; let j = idx + d; while (items[j] && !visible(items[j])) j += d; if (items[j]) go(j); };

// ---------- achievements (DofusWiki, placed on the route by tools/build_ach.py) ----------
let CATORD = {}, ACH = [], posOf = new Map(), touch = new Map(), doneIn = new Map(), doneByStep = new Map(), sugIn = new Map(), sugByStep = new Map();
const TOP_FR = { Dungeons: 'Donjons', Quests: 'Quêtes', Monsters: 'Monstres', 'Temporal Anomalies': 'Anomalies temporelles', Events: 'Événements',
  Exploration: 'Exploration', Sidekicks: 'Compagnons', Breeding: 'Élevage', 'Infinite Dreams': 'Songes infinis', Guilds: 'Guilde', Professions: 'Métiers', General: 'Général' };
const catFr = c => c.replace(/^Levels (\d+) - (\d+)$/, 'Niveaux $1 à $2');
const catOf = a => a.catfr || a.cat;
const gp0Of = key => +String(key).split('/')[0];
function indexAch(data) {
  ACH = data.ach;
  items.forEach((it, n) => posOf.set(it.key, n));
  ACH.forEach((a, ai) => {
    a.di = a.done != null && posOf.has(a.done) ? posOf.get(a.done) : -1;
    a.oi = a.o.map(([, k]) => (k != null && posOf.has(k) ? posOf.get(k) : -1));
    a.oi.forEach((p, oj) => { if (p >= 0) (touch.get(p) || touch.set(p, []).get(p)).push([ai, oj]); });
    a.si = a.di < 0 && a.sug != null && posOf.has(a.sug) ? posOf.get(a.sug) : -1;
    if (a.si >= 0) {
      (sugIn.get(a.si) || sugIn.set(a.si, []).get(a.si)).push(ai);
      const s = gp0Of(a.sug); (sugByStep.get(s) || sugByStep.set(s, []).get(s)).push(ai);
    }
    if (a.di >= 0) {
      (doneIn.get(a.di) || doneIn.set(a.di, []).get(a.di)).push(ai);
      const s = gp0Of(a.done); (doneByStep.get(s) || doneByStep.set(s, []).get(s)).push(ai);
    }
  });
}
const got = a => !!S.a[a.en];
// Duo achievements: which duo of the team takes it (A / B), stored per profile
function chips(a) {
  const d = (S.d || {})[a.en];
  return (a.duo ? `<span class="chip duo">Duo</span><span class="duopick" role="group" aria-label="Quel duo"><button class="${d === 'A' ? 'on' : ''}" data-duo="${esc(a.en)}" data-v="A" title="Duo A">A</button><button class="${d === 'B' ? 'on' : ''}" data-duo="${esc(a.en)}" data-v="B" title="Duo B">B</button></span>` : '')
    + (a.solo ? '<span class="chip solo">Solo</span>' : '');
}
function extra(label) {
  const q = label.replace(/^Quête : /, '');
  return /^Quête : /.test(label) ? `<button class="jump" data-dpln="${esc(q)}">voir sur DPLN</button>` : '<span class="todo">hors parcours</span>';
}
function where(p) {
  if (p < 0) return '<span class="todo">hors parcours</span>';
  const it = items[p];
  return `<button class="jump" data-goto="${it.key}">${esc(stepRef(it))}</button>`;
}
function achLi(ai, here) {
  const a = ACH[ai];
  let ob = '';
  if (here !== undefined && a.o.length > 1) {
    ob = '<div class="ob">' + a.o.map(([label], oj) => {
      const p = a.oi[oj];
      const cls = p === here ? 'here' : p >= 0 && p < here ? 'ok' : 'todo';
      return `<span class="${cls}">${p >= 0 && p <= here ? '✓' : '○'} ${esc(label)}${cls === 'todo' ? ' · ' + (p < 0 ? extra(label) : where(p)) : ''}</span>`;
    }).join('') + '</div>';
  } else {
    // quests Ganymède never covers: list them with a direct DPLN link, so they get done "on top of" the guide
    const miss = a.o.map(([label], oj) => [label, a.oi[oj]]).filter(([label, p]) => p < 0 && /^Quête : /.test(label));
    if (miss.length && !got(a)) ob = `<div class="ob extra"><span class="lbl">En plus de Ganymède</span>${miss.map(([label]) => `<span class="todo">○ ${esc(label)} · ${extra(label)}</span>`).join('')}</div>`;
  }
  const later = !!S.l[a.en] && !got(a);
  return `<li class="${got(a) ? 'got' : ''}${later ? ' later' : ''}"><input type="checkbox" data-ach="${esc(a.en)}"${got(a) ? ' checked' : ''} aria-label="${esc(a.n)}">
    <span><span class="an">${esc(a.n)}</span>${chips(a)}</span>
    <button class="laterbtn${later ? ' on' : ''}" data-later="${esc(a.en)}" title="Plus tard : au niveau 200 ou avec un passeur" aria-pressed="${later}">⏳</button>
    <span class="ad">${esc(a.d)}</span>${ob}</li>`;
}
function renderAchPanel(it, html) {
  const panel = $('achPanel');
  if (!ACH.length) { panel.hidden = true; return; }
  let h = it.g === undefined && isIntro(it.i) ? '' : dungeonCards(html ?? (it.g === undefined ? gp0.steps[it.i].web_text : ''));
  if (it.g === undefined) {
    const xs = doneByStep.get(it.i) || [], ss = sugByStep.get(it.i) || [];
    const hasExtra = ai => ACH[ai].oi.some((x, j) => x < 0 && /^Quête : /.test(ACH[ai].o[j][0]));
    const block = (arr, cls, label, tag) => {
      arr = [...arr].sort((x, y) => hasExtra(y) - hasExtra(x));   // achievements needing quests outside Ganymède first
      const open = ui.more === it.key + tag;
      return `<div class="agroup ${cls}"><span class="lbl">${label}</span><ul class="al">${(open ? arr : arr.slice(0, 8)).map(ai => achLi(ai)).join('')}</ul>${arr.length > 8 && !open ? `<button class="more" data-more="${it.key + tag}">Voir les ${arr.length}</button>` : ''}</div>`;
    };
    if (xs.length) h += block(xs, 'done', `Cette étape termine ${xs.length} succès`, 'd');
    if (ss.length) h += block(ss, 'sug', `${ss.length} succès faisables à partir de cette étape (zone et niveau)`, 's');
  } else {
    const done = doneIn.get(idx) || [];
    const prog = (touch.get(idx) || []).map(([ai]) => ai).filter((ai, n, arr) => arr.indexOf(ai) === n && ACH[ai].di !== idx && !(ACH[ai].o.length === 1));
    if (done.length) h += `<div class="agroup done"><span class="lbl">Succès terminé${done.length > 1 ? 's' : ''} ici</span><ul class="al">${done.map(ai => achLi(ai, idx)).join('')}</ul></div>`;
    if (prog.length) h += `<div class="agroup prog"><span class="lbl">Avance, à finir plus tard</span><ul class="al">${prog.map(ai => achLi(ai, idx)).join('')}</ul></div>`;
    const sug = sugIn.get(idx) || [];
    if (sug.length) h += `<div class="agroup sug"><span class="lbl">Faisable à partir d'ici : zone et niveau atteints</span><ul class="al">${sug.map(ai => achLi(ai)).join('')}</ul></div>`;
  }
  panel.innerHTML = h; panel.hidden = !h; $('cols').classList.toggle('solo', !h);
}
const ui = { more: null, q: '', hideGot: false, outOnly: false, view: 'route' };
function renderAchView() {
  const v = $('achView');
  const q = ui.q.trim().toLowerCase();
  const xs = ACH.map((a, ai) => ai).filter(ai => {
    const a = ACH[ai];
    if (ui.hideGot && got(a)) return false;
    if (ui.outOnly && a.di >= 0) return false;
    if (ui.laterOnly && !(S.l[a.en] && !got(a))) return false;
    if (ui.duoF && !(a.duo && (ui.duoF === '?' ? !(S.d || {})[a.en] : (S.d || {})[a.en] === ui.duoF))) return false;
    return !q || a.n.toLowerCase().includes(q) || a.en.toLowerCase().includes(q) || a.d.toLowerCase().includes(q);
  });
  const total = ACH.length, nGot = ACH.filter(got).length, onRoute = ACH.filter(a => a.di >= 0).length, sugg = ACH.filter(a => a.si >= 0).length;
  let h = `<div class="big"><div><b>${nGot}/${total}</b><span>succès cochés par la team</span></div><div><b>${onRoute}</b><span>terminés à une étape précise</span></div><div><b>${sugg}</b><span>placés selon la zone et le niveau</span></div><div><b>${total - onRoute - sugg}</b><span>événements saisonniers</span></div></div>
    <div class="tools"><input type="search" id="achQ" placeholder="Chercher un succès…" value="${esc(ui.q)}" aria-label="Chercher un succès">
    <label><input type="checkbox" id="hideGot"${ui.hideGot ? ' checked' : ''}> Masquer les cochés</label>
    <label><input type="checkbox" id="outOnly"${ui.outOnly ? ' checked' : ''}> Sans étape précise</label>
    <label>Duos : <select id="duoF"><option value="">tous les succès</option><option value="A"${ui.duoF === 'A' ? ' selected' : ''}>Duo A</option><option value="B"${ui.duoF === 'B' ? ' selected' : ''}>Duo B</option><option value="?"${ui.duoF === '?' ? ' selected' : ''}>Duo pas encore attribué</option></select></label>
    <label><input type="checkbox" id="laterOnly"${ui.laterOnly ? ' checked' : ''}> ⏳ Reportés (niveau 200 / passeur) : ${ACH.filter(a => S.l[a.en] && !got(a)).length}</label></div>`;
  const tops = new Map();
  for (const ai of xs) { const a = ACH[ai]; const t = a.topfr || TOP_FR[a.top] || a.top; (tops.get(t) || tops.set(t, new Map()).get(t)); const m = tops.get(t); (m.get(catOf(a)) || m.set(catOf(a), []).get(catOf(a))).push(ai); }
  const ord = (parent, name) => CATORD[`${parent}|${name}`] ?? 999;     // the game's own order: Général first, ...
  for (const [t, cats] of [...tops].sort((x, y) => ord('', x[0]) - ord('', y[0]))) {
    const all = [...cats.values()].flat(), g = all.filter(ai => got(ACH[ai])).length;
    h += `<details${q ? ' open' : ''}><summary><span>${esc(t)}</span><span class="cntc${g === all.length ? ' full' : ''}">${g}/${all.length}</span></summary><div class="inner">`;
    for (const [c, ais] of [...cats].sort((x, y) => ord(t, catFr(x[0])) - ord(t, catFr(y[0])) || x[0].localeCompare(y[0]))) {
      const gg = ais.filter(ai => got(ACH[ai])).length;
      ais.sort((x, y) => (ACH[x].di < 0) - (ACH[y].di < 0) || ACH[x].di - ACH[y].di);
      h += `<details${q ? ' open' : ''}><summary><span>${esc(catFr(c))}</span><span class="cntc${gg === ais.length ? ' full' : ''}">${gg}/${ais.length}</span></summary><ul class="al">${ais.map(ai => achLi(ai).replace('</li>', `<span class="ad">${ACH[ai].di >= 0 ? 'Terminé à l\'' + where(ACH[ai].di) : ACH[ai].si >= 0 ? 'Faisable à partir de l\'' + where(ACH[ai].si) : ACH[ai].seasonal ? 'Événement saisonnier' : where(-1)}</span></li>`)).join('')}</ul></details>`;
    }
    h += '</div></details>';
  }
  if (!xs.length) h += '<p class="empty">Aucun succès ne correspond.</p>';
  v.innerHTML = h;
}
function setView(view) {
  ui.view = view;
  document.querySelectorAll('.view').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === view));
  const route = view === 'route';
  $('stage').hidden = !route;
  $('achView').hidden = route; document.querySelector('.pager').style.display = route ? '' : 'none';
  if (route) render(); else renderAchView();
  scrollTo(0, 0);
}

// ---------- events ----------
let toastT;
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 1600); }
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast(`Copié : ${text}`); }
  catch { toast(`À copier : ${text}`); }
}
$('prev').onclick = () => step(-1);
$('next').onclick = () => step(1);
$('finish').onclick = () => finishStep();

// One click per step: tick its boxes and the achievements it completes (except those put off ⏳), then move on.
let undo = null;
function finishStep() {
  const it = items[idx];
  undo = { t: { ...S.t }, a: { ...S.a }, idx };
  let boxes = 0, achs = 0;
  document.querySelectorAll('#card [data-task]').forEach(b => { if (!S.t[b.dataset.task]) { S.t[b.dataset.task] = 1; boxes++; } });
  const done = it.g === undefined ? [] : (doneIn.get(idx) || []);
  for (const ai of done) { const a = ACH[ai]; if (!S.a[a.en] && !S.l[a.en]) { S.a[a.en] = 1; achs++; } }
  save();
  if (achs) burst($('finish'));
  toast(achs ? `Étape terminée : ${achs} succès coché${achs > 1 ? 's' : ''} · Ctrl+Z pour annuler` : 'Étape terminée · Ctrl+Z pour annuler');
  step(1);
}
function undoFinish() {
  if (!undo) return;
  S.t = undo.t; S.a = undo.a; save(); const back = undo.idx; undo = null;
  go(back); toast('Annulé');
}
document.addEventListener('keydown', e => {
  if (e.target.closest('textarea,input[type=text],input[type=search],dialog') || ui.view !== 'route') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoFinish(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'arrowright' || k === 'd') { e.preventDefault(); step(1); }
  if (k === 'arrowleft' || k === 'a' || k === 'q') { e.preventDefault(); step(-1); }
  if (k === 'escape') closeDpln();
  if (k === 'enter' && !e.target.closest('button,a,input')) { e.preventDefault(); finishStep(); }
});
document.addEventListener('click', e => {
  const tr = e.target.closest('[data-travel]'); if (tr) { copy(`/travel ${tr.dataset.travel}`); return; }
  const li = e.target.closest('#stepList li'); if (li) { go(items.findIndex(x => x.key === li.dataset.step)); $('side').classList.remove('open'); return; }
  const gt = e.target.closest('[data-goto]'); if (gt) { if (ui.view !== 'route') setView('route'); go(items.findIndex(x => x.key === gt.dataset.goto)); return; }
  const vw = e.target.closest('[data-view]'); if (vw) { setView(vw.dataset.view); return; }
  const mo = e.target.closest('[data-more]'); if (mo) { ui.more = mo.dataset.more; renderAchPanel(items[idx], ui.html); return; }
  const du = e.target.closest('[data-duo]');
  if (du) {
    S.d = S.d || {}; const k = du.dataset.duo, v = du.dataset.v;
    if (S.d[k] === v) delete S.d[k]; else S.d[k] = v; save();
    document.querySelectorAll(`[data-duo="${CSS.escape(k)}"]`).forEach(b => b.classList.toggle('on', S.d[k] === b.dataset.v));
    toast(S.d[k] ? `Pour le duo ${S.d[k]}` : 'Duo non attribué'); return;
  }
  const lt = e.target.closest('[data-later]');
  if (lt) {
    const k = lt.dataset.later; if (S.l[k]) delete S.l[k]; else S.l[k] = 1; save();
    document.querySelectorAll(`[data-later="${CSS.escape(k)}"]`).forEach(b => { const on = !!S.l[k]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.closest('li')?.classList.toggle('later', on && !S.a[k]); });
    toast(S.l[k] ? 'Reporté : à refaire au niveau 200 ou avec un passeur' : 'Plus reporté'); return;
  }
  if (e.target.closest('#shopBtn')) { openShopping(); return; }
  const dj = e.target.closest('[data-dungeon]'); if (dj) { openDungeon(dj.dataset.dungeon); return; }
  const dp = e.target.closest('[data-dpln]'); if (dp) { if ($('djDlg').open) $('djDlg').close(); openDpln(dp.dataset.dpln); return; }
  const tag = e.target.closest('.gc [data-type=custom-tag]');
  if (tag) {
    const ty = tag.getAttribute('type'), name = tag.getAttribute('name');
    if (ty === 'dungeon') { openDungeon(name); return; }
    if (ty === 'quest') { openDpln(name); return; }
  }
  if (e.target.closest('#dplnClose')) { closeDpln(); return; }
  if (e.target.closest('#dzIn')) { zoomDpln(.1); return; }
  if (e.target.closest('#dzOut')) { zoomDpln(-.1); return; }
  const gs = e.target.closest('[data-type=guide-step]');
  if (gs) {
    const g = +gs.getAttribute('guideid'), cur = items[idx].i;
    const j = items.findIndex(x => x.i === cur && x.g === g);
    if (j >= 0) go(j); else toast(`${gs.textContent.trim()} n'a pas de plage dans cette étape`);
  }
});
document.addEventListener('change', e => {
  const b = e.target;
  if (b.dataset.ach) {
    if (b.checked) { S.a[b.dataset.ach] = 1; burst(b); toast('Succès coché pour la team !'); } else delete S.a[b.dataset.ach];
    save(); b.closest('li')?.classList.toggle('got', b.checked); return;
  }
  if (b.id === 'hideGot' || b.id === 'outOnly' || b.id === 'laterOnly') { ui[b.id] = b.checked; renderAchView(); return; }
  if (b.id === 'duoF') { ui.duoF = b.value; renderAchView(); return; }
  if (b.id === 'shopN') { openShopping(+b.value); return; }
  if (b.dataset.task) { if (b.checked) S.t[b.dataset.task] = 1; else delete S.t[b.dataset.task]; save(); b.closest('li')?.classList.toggle('checked', b.checked); }
  if (b.name === 'align') { S.align = b.value; save(); if (!visible(items[idx])) step(1); else render(); return; }
});
$('menuBtn').onclick = e => { e.stopPropagation(); const o = $('side').classList.toggle('open'); $('menuBtn').setAttribute('aria-expanded', o); };
document.addEventListener('pointerdown', e => { if ($('side').classList.contains('open') && !e.target.closest('#side,#menuBtn')) { $('side').classList.remove('open'); $('menuBtn').setAttribute('aria-expanded', false); } });
// ---------- profiles ----------
function renderProfiles() {
  $('profName').textContent = profName();
  $('profList').innerHTML = P.list.map(p => `<li class="${p.id === P.cur ? 'cur' : ''}">
    <span class="pn">${esc(p.name)}</span>${p.id === P.cur ? '<span class="chip duo">actif</span>' : `<button type="button" class="btn small" data-prof="${p.id}">Utiliser</button>`}
    <button type="button" class="btn small" data-rename="${p.id}">Renommer</button>
    ${P.list.length > 1 ? `<button type="button" class="btn small danger" data-del="${p.id}">Supprimer</button>` : ''}</li>`).join('');
  $('code').value = encode();
}
function switchProfile(id) {
  P.cur = id; lsSet(PROFILES, P);
  S = { ...blank(), ...(lsGet(PKEY(id)) || {}) };
  idx = Math.max(0, items.findIndex(x => x.key === S.pos));
  document.querySelector(`input[name=align][value=${S.align}]`).checked = true;
  renderProfiles(); if (ui.view === 'route') render(); else renderAchView();
  toast(`Profil « ${profName()} »`);
}
function addProfile(name, state) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  P.list.push({ id, name: name || `Profil ${P.list.length + 1}` }); lsSet(PKEY(id), state || blank());
  switchProfile(id);
}
let pendingDel = null;
$('profBtn').onclick = () => { renderProfiles(); $('importErr').hidden = true; pendingDel = null; $('saveDlg').showModal(); };
$('addProf').onclick = () => { addProfile($('newProf').value.trim()); $('newProf').value = ''; };
$('profList').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.prof) switchProfile(b.dataset.prof);
  if (b.dataset.rename) {
    const li = b.closest('li'), p = P.list.find(x => x.id === b.dataset.rename);
    li.querySelector('.pn').innerHTML = `<input type="text" maxlength="40" value="${esc(p.name)}" aria-label="Nouveau nom">`;
    const inp = li.querySelector('input'); inp.focus(); inp.select();
    const done = () => { p.name = inp.value.trim() || p.name; lsSet(PROFILES, P); renderProfiles(); };
    inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); done(); } });
    inp.addEventListener('blur', done);
  }
  if (b.dataset.del) {
    if (pendingDel !== b.dataset.del) { pendingDel = b.dataset.del; b.textContent = 'Confirmer ?'; return; }   // no confirm() in some viewers: click twice
    const id = b.dataset.del; P.list = P.list.filter(x => x.id !== id); try { localStorage.removeItem(PKEY(id)); } catch {}
    pendingDel = null;
    if (P.cur === id) switchProfile(P.list[0].id); else { lsSet(PROFILES, P); renderProfiles(); }
  }
};
$('copyCode').onclick = () => { $('code').select(); copy(encode()).then(() => {}); };
$('doImport').onclick = () => {
  try {
    const s = decode($('importCode').value);
    if (typeof s !== 'object' || !s.pos) throw 0;
    addProfile(s.name || 'Profil importé', { ...blank(), ...s }); $('importCode').value = '';
    toast('Profil importé');
  } catch { $('importErr').textContent = 'Ce code n\'est pas reconnu. Copie-le en entier depuis l\'autre PC.'; $('importErr').hidden = false; }
};
renderProfiles();

// ---------- life: a little burst on success, slow amber motes in the background ----------
function burst(el) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const colors = ['#9fe6b8', '#ffb6d3', '#fff0f6', '#c3b8ff'];
  for (let n = 0; n < 14; n++) {
    const d = document.createElement('i'); d.className = 'burst';
    const a = (n / 14) * Math.PI * 2, dist = 30 + Math.random() * 40;
    d.style.cssText = `left:${cx - 4}px;top:${cy - 4}px;background:${colors[n % 4]};--dx:${Math.cos(a) * dist}px;--dy:${Math.sin(a) * dist}px`;
    document.body.append(d); setTimeout(() => d.remove(), 800);
  }
}
(function motes() {
  const c = $('motes'), ctx = c.getContext('2d');
  if (!ctx || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let w, h, dots;
  const size = () => { w = c.width = innerWidth; h = c.height = innerHeight; dots = Array.from({ length: Math.round(w * h / 38000) }, () => ({ x: Math.random() * w, y: Math.random() * h, r: .6 + Math.random() * 1.8, v: .12 + Math.random() * .35, p: Math.random() * 6.28 })); };
  size(); addEventListener('resize', size);
  (function frame(t) {
    if (!document.hidden) {
      ctx.clearRect(0, 0, w, h);
      for (const d of dots) {
        d.y -= d.v; d.x += Math.sin(t / 2400 + d.p) * .25;
        if (d.y < -10) { d.y = h + 10; d.x = Math.random() * w; }
        const a = .25 + .25 * Math.sin(t / 900 + d.p);
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 6.283);
        ctx.fillStyle = `rgba(255,182,211,${a})`; ctx.shadowColor = '#ffb6d3'; ctx.shadowBlur = 8; ctx.fill();
      }
    }
    requestAnimationFrame(frame);
  })(0);
})();

// ---------- boot ----------
(async () => {
  try {
    R = await (await fetch('route.json')).json();
    gp0 = await guide(GP0);
  } catch (e) { $('card').innerHTML = `<p class="empty">Le [GP0] n'a pas pu être chargé (${esc(e.message)}). Recharge la page dans un instant.</p>`; return; }
  buildItems();
  try { indexAch(await (await fetch('ach.json?v=15')).json()); } catch (e) { console.warn('ach.json', e); }
  try { DJ = await (await fetch('dungeons.json?v=2')).json(); } catch (e) { console.warn('dungeons.json', e); }
  try { CATORD = await (await fetch('catorder.json?v=1')).json(); } catch (e) { console.warn('catorder.json', e); }
  idx = Math.max(0, items.findIndex(x => x.key === S.pos));
  document.querySelector(`input[name=align][value=${S.align}]`).checked = true;
  if (!visible(items[idx])) { const j = items.findIndex((x, n) => n > idx && visible(x)); if (j >= 0) idx = j; }
  if (gp0.updated_at !== R.gp0_updated) console.info('GP0 modifié depuis la préparation du parcours :', gp0.updated_at, '≠', R.gp0_updated);
  render();
})();

let qt; document.addEventListener('input', e => { if (e.target.id === 'achQ') { clearTimeout(qt); qt = setTimeout(() => { ui.q = e.target.value; renderAchView(); const f = $('achQ'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }, 200); } });
