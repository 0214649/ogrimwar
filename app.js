'use strict';
// Carnet de la Team — walks Ganymède's GP0 step by step, expanding every sub-guide range it points to.
// Guides are fetched live from ganymede-app.com (CORS open) and kept in the browser's Cache API.
const API = 'https://ganymede-app.com/api';
const GP0 = 2747;
const $ = id => document.getElementById(id);
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- state (browser storage + export code) ----------
const KEY = 'carnet-team-v1';
let S = { pos: '0', t: {}, a: {}, align: 'bonta' };
const ALIGN = { bonta: 516, brak: 773 };   // GP9 Bontarien / Brâkmarien
try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };
const encode = () => btoa(unescape(encodeURIComponent(JSON.stringify(S))));
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
const visible = it => !(it.g === undefined && isBonus(it.i))   // bonus pages (jobs, gear) are never shown
   && it.g !== ALIGN[S.align === 'bonta' ? 'brak' : 'bonta'] && !it.gone;
let lastDir = 1;

// ---------- sanitising + enriching Ganymède HTML ----------
const COORD = /\[\s*(-?\d{1,3})\s*,\s*(-?\d{1,3})\s*\]/g;
// images whose host refuses them (Gyazo answers 503): show a quiet note with the link instead of a broken icon
// Fallback: a search restricted to Dofus pour les Noobs, whose quest pages carry their own screenshots.
function brokenImg(img) {
  const gc = img.closest('.gc');
  const quest = gc?.querySelector('[data-type=quest-block]')?.getAttribute('questname')
    || gc?.querySelector('[data-type=custom-tag][type=quest]')?.getAttribute('name');
  const it = items[idx], topic = quest || (it && it.g !== undefined ? (R.names[it.g] || '').replace(/^\[[^\]]*\]\s*/, '') : '');
  const a = document.createElement('a');
  a.target = '_blank'; a.rel = 'noopener'; a.className = 'imgoff';
  a.href = 'https://www.google.com/search?q=' + encodeURIComponent(`site:dofuspourlesnoobs.com ${topic}`);
  a.innerHTML = `<b>Image du guide indisponible</b> (bloquée chez son hébergeur).<br>Voir les captures${topic ? ` de « ${esc(topic)} »` : ''} sur Dofus pour les Noobs →`;
  img.replaceWith(a);
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
  return root.innerHTML;
}

// ---------- rendering ----------
function renderSide() {
  const cur = items[idx].i;
  $('stepList').innerHTML = gp0.steps.map((_, i) => {
    const b = isBonus(i);
    const n = (doneByStep.get(i) || []).length + (sugByStep.get(i) || []).length;
    if (b) return '';
    return `<li data-step="${i}" class="${i < cur ? 'past' : ''}${i === cur ? ' cur' : ''}"><span class="num">${i + 1}</span><span>${esc(stepTitle(i))}</span>${n ? `<span class="ac">${n} succès</span>` : ''}</li>`;
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
  $('pos').textContent = it.g === undefined ? `Étape ${it.i + 1} du GP0` : `GP0 ${it.i + 1} · sous-étape ${segInfo(it).n}/${segInfo(it).of}`;
  $('prev').disabled = !items.slice(0, idx).some(visible);
  $('next').disabled = !items.slice(idx + 1).some(visible);
  renderSide();
  renderAchPanel(it);

  const ctx = $('ctx'), card = $('card'), links = $('links');
  if (it.g === undefined) {
    ctx.hidden = true;
    $('crumb').textContent = `Guide principal · étape ${it.i + 1}`;
    const segs = (R.steps[it.i] || []);
    $('stepHead').innerHTML = `<div class="bignum">${it.i + 1}</div><span class="eyebrow">Guide principal · étape ${it.i + 1} sur ${gp0.steps.length}</span><h2>${esc(stepTitle(it.i))}</h2>${summary(it)}`;
    card.innerHTML = `<div class="gc">${enrich(gp0.steps[it.i].web_text, `${GP0}:${it.i}`)}</div>`;
    links.hidden = !segs.length;
    links.innerHTML = segs.length ? `<span class="lbl">Dans cette étape</span>` + segs.map(([g, a, b]) => {
      const first = items.find(x => x.i === it.i && x.g === g);
      return first ? `<button class="btn" data-goto="${first.key}">${esc(R.names[g] || g)} · ét. ${a + 1}→${b}</button>` : '';
    }).join('') : '';
  } else {
    const name = R.names[it.g] || `Guide ${it.g}`;
    $('crumb').textContent = `GP0 ${it.i + 1} › ${name} › étape ${it.k + 1}`;
    ctx.hidden = false;
    ctx.innerHTML = `<details><summary><span class="lbl">Consigne du guide principal</span><span>Étape ${it.i + 1} · ${esc(stepTitle(it.i))}</span></summary><div class="body gc">${enrich(gp0.steps[it.i].web_text, `${GP0}:${it.i}`)}</div></details>`;
    card.innerHTML = `<p class="loading">Chargement de ${esc(name)}…</p>`;
    $('stepHead').innerHTML = `<div class="bignum">${it.i + 1}</div><span class="eyebrow">${esc(name)} · étape ${it.k + 1}</span><h2>${esc(stepTitle(it.i))}</h2>`;
    let g;
    try { g = await guide(it.g); } catch (e) { card.innerHTML = `<p class="empty">Impossible de charger ${esc(name)} : ${esc(e.message)}. Réessaie dans un instant.</p>`; return; }
    if (items[idx] !== it) return;               // user moved on while loading
    const st = g.steps[it.k];
    const { n, of, seg } = segInfo(it);
    if (!st) { it.gone = true; step(lastDir); return; }     // guide got shorter since route.json was built
    $('stepHead').innerHTML = `<div class="bignum">${it.i + 1}</div><span class="eyebrow">${esc(name)} · étape ${it.k + 1} sur ${g.steps.length}</span><h2>${esc(st.name || stepTitle(it.i))}</h2>${summary(it, st)}`;
    card.innerHTML = `<div class="gc">${enrich(st.web_text, `${it.g}:${it.k}`)}</div>`;
    links.hidden = false;
    links.innerHTML = `<span class="lbl">Plage du GP0</span><span class="num">ét. ${seg ? seg[1] + 1 : '?'}→${seg ? seg[2] : '?'} · ${n}/${of}</span>`;
  }
  // warm the next guide so the next click is instant
  const nx = items.slice(idx + 1).find(x => x.g !== undefined && x.g !== it.g);
  if (nx) setTimeout(() => guide(nx.g).catch(() => {}), 800);
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
let ACH = [], posOf = new Map(), touch = new Map(), doneIn = new Map(), doneByStep = new Map(), sugIn = new Map(), sugByStep = new Map();
const TOP_FR = { Dungeons: 'Donjons', Quests: 'Quêtes', Monsters: 'Monstres', 'Temporal Anomalies': 'Anomalies temporelles', Events: 'Événements',
  Exploration: 'Exploration', Sidekicks: 'Compagnons', Breeding: 'Élevage', 'Infinite Dreams': 'Songes infinis', Guilds: 'Guilde', Professions: 'Métiers', General: 'Général' };
const catFr = c => c.replace(/^Levels (\d+) - (\d+)$/, 'Niveaux $1 à $2');
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
function chips(a) { return (a.duo ? '<span class="chip duo">Duo</span>' : '') + (a.solo ? '<span class="chip solo">Solo</span>' : ''); }
function where(p) {
  if (p < 0) return '<span class="todo">hors parcours</span>';
  const it = items[p];
  return `<button class="jump" data-goto="${it.key}">étape ${it.i + 1}${it.g !== undefined ? ` · ${esc(R.names[it.g] || '')} ${it.k + 1}` : ''}</button>`;
}
function achLi(ai, here) {
  const a = ACH[ai];
  let ob = '';
  if (here !== undefined && a.o.length > 1) {
    ob = '<div class="ob">' + a.o.map(([label], oj) => {
      const p = a.oi[oj];
      const cls = p === here ? 'here' : p >= 0 && p < here ? 'ok' : 'todo';
      return `<span class="${cls}">${p >= 0 && p <= here ? '✓' : '○'} ${esc(label)}${cls === 'todo' ? ' · ' + where(p) : ''}</span>`;
    }).join('') + '</div>';
  }
  return `<li class="${got(a) ? 'got' : ''}"><input type="checkbox" data-ach="${esc(a.en)}"${got(a) ? ' checked' : ''} aria-label="${esc(a.n)}">
    <span><span class="an">${esc(a.n)}</span>${chips(a)}</span><span class="ad">${esc(a.d)}</span>${ob}</li>`;
}
function renderAchPanel(it) {
  const panel = $('achPanel');
  if (!ACH.length) { panel.hidden = true; return; }
  let h = '';
  if (it.g === undefined) {
    const xs = doneByStep.get(it.i) || [], ss = sugByStep.get(it.i) || [];
    const block = (arr, cls, label, tag) => {
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
    return !q || a.n.toLowerCase().includes(q) || a.en.toLowerCase().includes(q) || a.d.toLowerCase().includes(q);
  });
  const total = ACH.length, nGot = ACH.filter(got).length, onRoute = ACH.filter(a => a.di >= 0).length, sugg = ACH.filter(a => a.si >= 0).length;
  let h = `<div class="big"><div><b>${nGot}/${total}</b><span>succès cochés par la team</span></div><div><b>${onRoute}</b><span>terminés à une étape précise</span></div><div><b>${sugg}</b><span>placés selon la zone et le niveau</span></div><div><b>${total - onRoute - sugg}</b><span>événements saisonniers</span></div></div>
    <div class="tools"><input type="search" id="achQ" placeholder="Chercher un succès…" value="${esc(ui.q)}" aria-label="Chercher un succès">
    <label><input type="checkbox" id="hideGot"${ui.hideGot ? ' checked' : ''}> Masquer les cochés</label>
    <label><input type="checkbox" id="outOnly"${ui.outOnly ? ' checked' : ''}> Sans étape précise</label></div>`;
  const tops = new Map();
  for (const ai of xs) { const a = ACH[ai]; const t = TOP_FR[a.top] || a.top; (tops.get(t) || tops.set(t, new Map()).get(t)); const m = tops.get(t); (m.get(a.cat) || m.set(a.cat, []).get(a.cat)).push(ai); }
  for (const [t, cats] of [...tops].sort((x, y) => [...y[1].values()].flat().length - [...x[1].values()].flat().length)) {
    const all = [...cats.values()].flat(), g = all.filter(ai => got(ACH[ai])).length;
    h += `<details${q ? ' open' : ''}><summary><span>${esc(t)}</span><span class="cntc${g === all.length ? ' full' : ''}">${g}/${all.length}</span></summary><div class="inner">`;
    for (const [c, ais] of [...cats].sort()) {
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
document.addEventListener('keydown', e => {
  if (e.target.closest('textarea,input[type=text],input[type=search],dialog') || ui.view !== 'route') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'arrowright' || k === 'd') { e.preventDefault(); step(1); }
  if (k === 'arrowleft' || k === 'a' || k === 'q') { e.preventDefault(); step(-1); }
});
document.addEventListener('click', e => {
  const tr = e.target.closest('[data-travel]'); if (tr) { copy(`/travel ${tr.dataset.travel}`); return; }
  const li = e.target.closest('#stepList li'); if (li) { go(items.findIndex(x => x.key === li.dataset.step)); $('side').classList.remove('open'); return; }
  const gt = e.target.closest('[data-goto]'); if (gt) { if (ui.view !== 'route') setView('route'); go(items.findIndex(x => x.key === gt.dataset.goto)); return; }
  const vw = e.target.closest('[data-view]'); if (vw) { setView(vw.dataset.view); return; }
  const mo = e.target.closest('[data-more]'); if (mo) { ui.more = mo.dataset.more; renderAchPanel(items[idx]); return; }
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
  if (b.id === 'hideGot' || b.id === 'outOnly') { ui[b.id] = b.checked; renderAchView(); return; }
  if (b.dataset.task) { if (b.checked) S.t[b.dataset.task] = 1; else delete S.t[b.dataset.task]; save(); b.closest('li')?.classList.toggle('checked', b.checked); }
  if (b.name === 'align') { S.align = b.value; save(); if (!visible(items[idx])) step(1); else render(); return; }
});
$('menuBtn').onclick = e => { e.stopPropagation(); const o = $('side').classList.toggle('open'); $('menuBtn').setAttribute('aria-expanded', o); };
document.addEventListener('pointerdown', e => { if ($('side').classList.contains('open') && !e.target.closest('#side,#menuBtn')) { $('side').classList.remove('open'); $('menuBtn').setAttribute('aria-expanded', false); } });
$('saveBtn').onclick = () => { $('code').value = encode(); $('importErr').hidden = true; $('saveDlg').showModal(); };
$('copyCode').onclick = () => { $('code').select(); copy(encode()).then(() => {}); };
$('doImport').onclick = () => {
  try {
    const s = decode($('importCode').value);
    if (typeof s !== 'object' || !s.pos) throw 0;
    S = { pos: '0', t: {}, a: {}, align: 'bonta', ...s }; save();
    idx = Math.max(0, items.findIndex(x => x.key === S.pos));
    $('saveDlg').close(); render(); toast('Progression chargée');
  } catch { $('importErr').textContent = 'Ce code n\'est pas reconnu. Copie-le en entier depuis l\'autre PC.'; $('importErr').hidden = false; }
};

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
  } catch (e) { $('card').innerHTML = `<p class="empty">Le guide principal n'a pas pu être chargé (${esc(e.message)}). Recharge la page dans un instant.</p>`; return; }
  buildItems();
  try { indexAch(await (await fetch('ach.json')).json()); } catch (e) { console.warn('ach.json', e); }
  idx = Math.max(0, items.findIndex(x => x.key === S.pos));
  document.querySelector(`input[name=align][value=${S.align}]`).checked = true;
  if (!visible(items[idx])) { const j = items.findIndex((x, n) => n > idx && visible(x)); if (j >= 0) idx = j; }
  if (gp0.updated_at !== R.gp0_updated) console.info('GP0 modifié depuis la préparation du parcours :', gp0.updated_at, '≠', R.gp0_updated);
  render();
})();

let qt; document.addEventListener('input', e => { if (e.target.id === 'achQ') { clearTimeout(qt); qt = setTimeout(() => { ui.q = e.target.value; renderAchView(); const f = $('achQ'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }, 200); } });
