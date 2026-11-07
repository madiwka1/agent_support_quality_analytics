/* <cqa-app api-base="">
 * App shell: sidebar tabs + hash routing.
 *   #/evaluate            upload a transcript and run an evaluation  (<cqa-home>)
 *   #/dialogs[/<id>]      saved dialogs; a dialog card with its evaluations
 *   #/evaluations[/<id>]  all evaluations; one evaluation             (<cqa-result>)
 *   #/checklists[/<id>]   checklist editor                           (<cqa-checklist-editor>)
 * Load the other components' scripts first.
 */
(() => {
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => String(Math.round(n * 100) / 100);
const enc = encodeURIComponent;
const when = s => esc(String(s || '').slice(0, 16).replace('T', ' '));
const CHAN = { 'agent chat': 'чат', 'voice call': 'звонок' };
const NAV = [['checklists', 'Конструктор чек-листа'], ['evaluate', 'Новая оценка'], ['dialogs', 'Диалоги'], ['evaluations', 'Оценки'], ['appeals', 'Апелляции']];
const score = e => e.total == null ? '—' : `${e.original_total != null && e.original_total !== e.total ? `<s class="was">${fmt(e.original_total)}</s> → ` : ''}<b>${fmt(e.total)}</b> / ${fmt(e.max_total)}`;
const flag = e => e.gross_violation ? '<span class="pill bad">Грубое нарушение</span>' : '<span class="pill ok">Нет</span>';

const CSS = `
:host{display:block;min-height:100vh;font:15px/1.55 "Segoe UI",system-ui,-apple-system,Roboto,sans-serif;color:#191919;
  --line:#e1e4e8;--mut:#5c5c5c;--acc:#2a8640;--accbg:#e8f5e9;--err:#d32f2f;--side:#0f4d33}
*{box-sizing:border-box}[hidden]{display:none!important}
.app{display:grid;grid-template-columns:220px minmax(0,1fr);min-height:100vh}
nav{background:var(--side);color:#fff;padding:20px 12px;position:sticky;top:0;height:100vh}
.logo{font-size:22px;font-weight:800;padding:2px 12px 22px;letter-spacing:.02em}
nav a,nav .soon{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-radius:6px;margin-bottom:4px;text-decoration:none}
nav a{color:#dcebe3;font-weight:500}nav a:hover{background:#ffffff1a}nav a.on{background:#1f8a57;color:#fff;font-weight:700}
nav .soon{color:#8fb3a1;cursor:default}nav .soon small{border:1px solid #8fb3a1;border-radius:8px;padding:0 6px;font-size:11px}
@media(max-width:760px){.app{grid-template-columns:1fr}nav{position:static;height:auto;display:flex;flex-wrap:wrap;gap:4px;padding:10px}.logo{padding:6px 12px}}
a{color:var(--acc)}
.back{display:inline-flex;align-items:center;gap:6px;margin-bottom:10px;padding:7px 18px;border-radius:999px;background:var(--acc);color:#fff;font-weight:600;text-decoration:none;box-shadow:0 2px 6px #2a864055}.back:hover{background:#226d34}
.page{max-width:1100px;margin:0 auto;padding:22px 16px 40px}
h1{margin:0;font-size:26px;font-weight:700}h2{margin:24px 0 10px;font-size:17px;font-weight:700}
.top{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:16px}
.sub{color:var(--mut);margin:4px 0 0}
.btn,button{font:inherit;color:inherit;cursor:pointer;border:1px solid var(--line);background:#fff;border-radius:4px;padding:7px 12px;text-decoration:none;display:inline-block}
.btn:hover,button:hover:not(:disabled){border-color:var(--acc)}button:disabled{opacity:.5;cursor:default}
.btn.pri{background:var(--acc);border-color:var(--acc);color:#fff;font-weight:600;border-radius:8px;box-shadow:0 2px 6px #2a864044}.btn.pri:hover{background:#226d34}
.panel{background:#fff;border:1px solid var(--line);border-radius:12px;overflow:auto;box-shadow:0 1px 3px #0000000f,0 4px 14px #00000008}
table{width:100%;border-collapse:collapse}
th,td{padding:9px 12px;border-top:1px solid var(--line);text-align:left;font-weight:400;white-space:nowrap}
thead th{border-top:0;color:#2a8640;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;background:#f0f8f0}
s.was{color:var(--mut)}
td.n,th.n{text-align:right}td.t{color:var(--mut)}
tr[data-href]{cursor:pointer}tr[data-href]:hover td{background:var(--accbg)}
td.x{overflow:visible}.panel:has(details[open]){overflow:visible}
.exp{position:relative;display:inline-block}.exp summary{list-style:none;cursor:pointer;color:var(--acc);font-weight:600;padding:3px 10px;border:1px solid var(--acc);border-radius:999px;font-size:13px}
.exp summary::-webkit-details-marker{display:none}.exp summary::after{content:" ▾"}.exp[open] summary{background:var(--accbg)}
.exp .menu{position:absolute;right:0;top:calc(100% + 4px);z-index:5;background:#fff;border:1px solid var(--line);border-radius:8px;box-shadow:0 6px 18px #0000001f;min-width:150px;padding:4px}
.exp .menu a{display:block;padding:7px 10px;border-radius:6px;text-decoration:none;color:#191919}.exp .menu a:hover{background:var(--accbg)}
tr.cur td{background:var(--accbg)}tr.cur td:first-child{box-shadow:inset 3px 0 0 var(--acc)}.open{color:var(--acc)}
.pill{padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid}
.pill.ok{color:var(--acc);border-color:var(--acc);background:var(--accbg)}.pill.bad{color:var(--err);border-color:var(--err);background:#fdecec}
.empty{padding:28px 16px;text-align:center;color:var(--mut)}
.err{color:var(--err);padding:8px 10px;border-left:3px solid var(--err);background:#fdecec;margin:16px}
.hint{padding:20px 16px;color:var(--mut)}
.meta{display:flex;flex-wrap:wrap;gap:6px 18px;color:var(--mut);margin:8px 0 14px}.meta b{color:#191919}
`;

class CqaApp extends HTMLElement {
  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.panes = {}; this.edId = null; this.tok = null; this.trail = [];
    this.onHash = () => this.route();
    this.root.addEventListener('click', e => {
      const t0 = e.composedPath()[0];  // close an open export menu on any click outside it or on its items
      this.root.querySelectorAll('details.exp[open]').forEach(d => { if (!d.querySelector('summary').contains(t0)) d.open = false; });
      const back = e.composedPath()[0]?.closest?.('a.back');
      if (back && this.trail.length > 1) { e.preventDefault(); history.back(); return; }
      if (e.target.closest('a,button,details')) return;
      const tr = e.target.closest('tr[data-href]');
      if (tr) location.hash = tr.dataset.href;
    });
  }
  get apiBase() { return this.getAttribute('api-base') || ''; }
  connectedCallback() {
    this.root.innerHTML = `<style>${CSS}</style><div class="app">
      <nav><div class="logo"><b>CQA</b></div>
        ${NAV.map(([v, l]) => `<a href="#/${v}" data-v="${v}">${l}</a>`).join('')}
        </nav>
      <main id="main"></main></div>`;
    this.main = this.root.getElementById('main');
    window.addEventListener('hashchange', this.onHash);
    this.route();
  }
  disconnectedCallback() { window.removeEventListener('hashchange', this.onHash); }

  async get(path) {
    const r = await fetch(this.apiBase + path);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || 'HTTP ' + r.status);
    return d;
  }
  pane(v) {
    if (!this.panes[v]) { const p = document.createElement('div'); this.main.append(p); this.panes[v] = p; }
    return this.panes[v];
  }
  route() {
    const t = this.tok = {};
    const h = location.hash, tr = this.trail;
    if (tr[tr.length - 2] === h) tr.pop(); else if (tr[tr.length - 1] !== h) tr.push(h);
    const [v0, a, b] = h.replace(/^#\/?/, '').split('/');
    const v = NAV.some(n => n[0] === v0) ? v0 : 'evaluate';
    this.root.querySelectorAll('nav a').forEach(x => x.classList.toggle('on', x.dataset.v === v));
    const p = this.pane(v);
    for (const k in this.panes) this.panes[k].hidden = this.panes[k] !== p;
    this['show_' + v](p, a ? decodeURIComponent(a) : null, t, b ? decodeURIComponent(b) : null);
  }
  fail(p, e) { p.innerHTML = `<div class="page"><p class="err">Не удалось загрузить данные: ${esc(e.message)}</p></div>`; }

  /* ---------- Новая оценка ---------- */
  show_evaluate(p) {
    if (!p.firstChild) p.innerHTML = `<cqa-home api-base="${esc(this.apiBase)}"></cqa-home>`;
  }

  /* ---------- Чек-листы ---------- */
  show_checklists(p, arg) {
    const id = arg ? +arg : null;
    if (p.firstChild && this.edId === id) return;
    this.edId = id;
    p.innerHTML = `<cqa-checklist-editor api-base="${esc(this.apiBase)}"${id ? ` checklist-id="${id}"` : ''}></cqa-checklist-editor>
      <cqa-agent api-base="${esc(this.apiBase)}"></cqa-agent>`;
  }

  /* ---------- Диалоги ---------- */
  async show_dialogs(p, arg, t, evId) {
    p.innerHTML = '<div class="page"><p class="hint">Загружаю…</p></div>';
    try {
      const [data, evs] = await Promise.all([
        this.get(arg ? '/api/conversations/' + enc(arg) : '/api/conversations'),
        this.get('/api/evaluations' + (arg ? '?conversation_id=' + enc(arg) : '')),
      ]);
      if (this.tok !== t) return;
      p.innerHTML = arg ? this.dialogCard(data, evs, evId) : this.dialogList(data, evs);
      if (arg && !evs.length) p.querySelector('cqa-chat').conversation = data;
    } catch (e) { if (this.tok === t) this.fail(p, e); }
  }
  dialogList(cs, evs) {
    const by = {};
    evs.forEach(e => (by[e.conversation_id] ||= []).push(e));
    const rows = cs.map(c => {
      const id = c.conversation_id, es = by[id] || [];
      return `<tr data-href="#/dialogs/${enc(id)}"><td><a href="#/dialogs/${enc(id)}">${esc(id)}</a></td>
        <td>${CHAN[c.channel] || esc(c.channel)}</td><td>${esc(c.language)}</td><td class="n">${c.messages}</td>
        <td class="t">${when(c.created_at)}</td>
        <td class="n">${es.length ? `${es.length}, последняя: ${score(es[0])}` : '—'}</td></tr>`;
    }).join('');
    return `<div class="page"><div class="top"><div><h1>Диалоги</h1><p class="sub">Загруженные диалоги: ${cs.length}</p></div>
      <a class="btn pri" href="#/evaluate">+ Новая оценка</a></div>
      <div class="panel">${cs.length ? `<table><thead><tr><th>Диалог</th><th>Канал</th><th>Язык</th><th class="n">Реплик</th><th>Загружен</th><th class="n">Оценки</th></tr></thead><tbody>${rows}</tbody></table>`
        : '<div class="empty">Диалогов пока нет. <a href="#/evaluate">Загрузите первый</a>.</div>'}</div></div>`;
  }
  dialogCard(c, evs, evId) {
    const cur = evs.find(e => e.id === evId) || evs[0], base = `#/dialogs/${enc(c.conversation_id)}/`;
    return `<div class="page"><div class="top"><div><a class="back" href="#/dialogs">Назад</a><h1>${esc(c.conversation_id)}</h1></div>
      <a class="btn" href="#/evaluate">+ Новая оценка</a></div>
      <div class="meta"><span>Канал: <b>${CHAN[c.channel] || esc(c.channel)}</b></span><span>Язык: <b>${esc(c.language)}</b></span><span>Реплик: <b>${c.transcript.length}</b></span></div>
      ${cur ? `<cqa-result api-base="${esc(this.apiBase)}" evaluation-id="${esc(cur.id)}"></cqa-result>
        <h2>Оценки этого диалога${evs.length > 1 ? ' - выберите, какую открыть' : ''}</h2>${this.evalTable(evs, false, base, cur.id)}`
        : `<cqa-chat api-base="${esc(this.apiBase)}"></cqa-chat><h2>Оценки этого диалога</h2>${this.evalTable(evs, false)}`}</div>`;
  }

  /* ---------- Оценки ---------- */
  async show_evaluations(p, arg, t) {
        if (arg) {
      p.innerHTML = `<div class="page"><div class="top"><a class="back" href="#/evaluations">Назад</a></div>
        <cqa-result api-base="${esc(this.apiBase)}" evaluation-id="${esc(arg)}"></cqa-result></div>`;
      return;
    } 
    p.innerHTML = '<div class="page"><p class="hint">Загружаю…</p></div>';
    try {
      const evs = await this.get('/api/evaluations');
      if (this.tok !== t) return;
      p.innerHTML = `<div class="page"><div class="top"><div><h1>Оценки</h1><p class="sub">Всего оценок: ${evs.length}</p></div>
        <a class="btn pri" href="#/evaluate">+ Новая оценка</a></div>${this.evalTable(evs, true)}</div>`;
    } catch (e) { if (this.tok === t) this.fail(p, e); }
  }
    /* ---------- Апелляции ---------- */
  show_appeals(p, arg) {
    p.innerHTML = `<div class="page"><cqa-appeals api-base="${esc(this.apiBase)}"${arg ? ` appeal-id="${esc(arg)}"` : ''}></cqa-appeals></div>`;
  }
  exportMenu(id) {
    const u = f => `${esc(this.apiBase)}/api/evaluations/${enc(id)}/export?format=${f}`;
    return `<details class="exp"><summary>Экспорт</summary><div class="menu">
      <a href="${u('xlsx')}" download>Excel (.xlsx)</a><a href="${u('json')}" download>JSON</a></div></details>`;
  }
  evalTable(evs, withDialog, base = '#/evaluations/', curId = null) {
    if (!evs.length) return '<div class="panel"><div class="empty">Оценок пока нет.</div></div>';
    const rows = evs.map(e => `<tr data-href="${base}${enc(e.id)}"${e.id === curId ? ' class="cur"' : ''}><td class="t">${when(e.created_at)}</td>
      ${withDialog ? `<td><a href="#/dialogs/${enc(e.conversation_id)}">${esc(e.conversation_id)}</a></td>` : ''}
      <td>${esc(e.checklist_name || 'Чек-лист ' + e.checklist_id)}, v${e.checklist_version}</td>
      <td class="n">${score(e)}</td><td>${flag(e)}</td><td class="x">${this.exportMenu(e.id)}</td><td>${e.id === curId ? '<b class="open">Открыта</b>' : `<a href="${base}${enc(e.id)}">Открыть</a>`}</td></tr>`).join('');
    return `<div class="panel"><table><thead><tr><th>Дата</th>${withDialog ? '<th>Диалог</th>' : ''}<th>Чек-лист</th><th class="n">Итог</th><th>Грубые ошибки</th><th></th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
}
customElements.define('cqa-app', CqaApp);
})();