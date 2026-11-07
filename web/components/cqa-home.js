/* <cqa-home api-base="">
 * Operator homepage: choose a checklist version, load a transcript, start evaluation.
 * Uses <cqa-checklist-picker> (load its script first) and <cqa-result> (load cqa-result.js).
 * Accepted transcript input:
 *   - JSON: one record, an array of records, the full organizers' API response, or a bare transcript array
 *   - Text: lines like "[00:02] operator: Здравствуйте!" (timestamp optional; client/operator/bot/system)
 * Events: "cqa-evaluate-requested": detail = {conversation_id, checklist_id, version}
 *         "cqa-evaluated": detail = evaluation result
 */
(() => {
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => String(Math.round(n * 100) / 100);
const SPK = { client: 'client', operator: 'operator', bot: 'bot', system: 'system', 'клиент': 'client', 'оператор': 'operator', 'бот': 'bot', 'система': 'system' };
const SPK_RU = { client: 'Клиент', operator: 'Оператор', bot: 'Бот', system: 'Система' };
const TYPE_RU = { yesno: 'Да/Нет', scale: 'Шкала', flag: 'Флаг' };
const LINE = /^\s*(?:\[?(\d{4}-\d{2}-\d{2}T[^\]\s]+|\d{1,2}:\d{2}(?::\d{2})?)\]?\s*[-–]?\s*)?(client|operator|bot|system|клиент|оператор|бот|система)\s*[:–-]\s*(.*)$/i;
const detectLang = t => /[әіңғүұқөһ]/i.test(t) ? 'KZ' : /[а-яё]/i.test(t) ? 'RU' : 'EN';

function parseText(txt) {
  const out = [];
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(LINE);
    if (m) out.push({ timestamp: m[1] || '', speaker: SPK[m[2].toLowerCase()], text: m[3] });
    else if (line.trim() && out.length) out[out.length - 1].text += '\n' + line.trim();
  }
  if (!out.length) throw new Error('Не нашёл ни одной реплики. Ожидаю строки вида «[00:02] operator: Здравствуйте!» или JSON.');
  return [{ transcript: out }];
}
function toRecords(j) {
  if (j?.data?.records) j = j.data.records;
  if (!Array.isArray(j)) j = [j];
  if (j[0] && typeof j[0] === 'object' && 'speaker' in j[0] && 'text' in j[0]) j = [{ transcript: j }];
  return j;
}
function normalize(r) {
  r = r || {};
  const tr = (Array.isArray(r.transcript) ? r.transcript : []).map(m => ({
    timestamp: String(m?.timestamp ?? ''), speaker: SPK[String(m?.speaker ?? '').toLowerCase()] || String(m?.speaker ?? ''), text: String(m?.text ?? ''),
  }));
  const lang = String(r.language || '').toUpperCase();
  return {
    conversation_id: r.conversation_id || null,
    channel: r.channel === 'voice call' ? 'voice call' : 'agent chat',
    language: ['RU', 'KZ', 'EN'].includes(lang) ? lang : detectLang(tr.map(m => m.text).join(' ')),
    transcript: tr, audio_url: r.audio_url || null,
  };
}
function problem(r) {
  if (!r.transcript.length) return 'В записи нет реплик.';
  const bad = r.transcript.find(m => !SPK_RU[m.speaker]);
  if (bad) return `Неизвестный автор реплики «${bad.speaker}». Допустимо: client, operator, bot, system.`;
  if (!r.transcript.some(m => m.speaker === 'operator')) return 'В диалоге нет реплик оператора, оценивать нечего.';
  return null;
}

const CSS = `
:host{display:block;font:14px/1.45 "Segoe UI",system-ui,sans-serif;color:#17211c;--line:#d8dfdb;--mut:#5b6962;--acc:#14633f;--accbg:#e4f1ea;--err:#b3261e}
*{box-sizing:border-box}
.wrap{max-width:1100px;margin:0 auto;padding:22px 16px 40px}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:18px}
h1{margin:0;font-size:24px;font-weight:600}
h2{margin:0 0 12px;font-size:16px;font-weight:600}
a.btn,button{font:inherit;color:inherit;cursor:pointer;border:1px solid var(--line);background:#fff;border-radius:4px;padding:7px 12px;text-decoration:none;display:inline-block}
a.btn:hover,button:hover:not(:disabled){border-color:var(--acc)}
button:disabled{opacity:.45;cursor:default}
button.pri{background:var(--acc);border-color:var(--acc);color:#fff;font-weight:600;padding:9px 18px}
:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.grid{display:grid;grid-template-columns:minmax(300px,2fr) 3fr;gap:20px;align-items:start}
@media(max-width:820px){.grid{grid-template-columns:1fr}}
.panel{background:#fff;border:1px solid var(--line);border-radius:6px;padding:16px}
.sub{color:var(--mut);margin:10px 0 0}
table{width:100%;border-collapse:collapse;margin-top:12px}
td,th{padding:5px 4px;border-top:1px solid var(--line);text-align:left;font-weight:400}
td.n{text-align:right;font-weight:600}td.t{color:var(--mut)}
.link{display:inline-block;margin-top:12px;color:var(--acc)}
.drop{display:block;border:2px dashed #9db5a8;border-radius:6px;padding:34px 16px;text-align:center;cursor:pointer;background:#fafcfb}
.drop:hover,.drop.over{border-color:var(--acc);background:var(--accbg)}
.drop strong{display:block;font-size:16px;margin-bottom:4px}.drop span{color:var(--mut)}
details{margin:12px 0}summary{cursor:pointer;color:var(--acc)}
textarea,select{width:100%;margin-top:8px;padding:8px 9px;border:1px solid var(--line);border-radius:4px;font:inherit;background:#fff;color:inherit}
details button{margin-top:8px}
.meta{margin:14px 0 8px;display:flex;flex-wrap:wrap;gap:6px 16px;color:var(--mut)}.meta b{color:#17211c}
.err{color:var(--err);margin:12px 0;padding:8px 10px;border-left:3px solid var(--err);background:#fbf3f2}
.pv{max-height:340px;overflow:auto;border:1px solid var(--line);border-radius:4px}
.m{display:grid;grid-template-columns:52px 76px 1fr;gap:8px;padding:6px 10px;border-bottom:1px solid #edf0ee;border-left:3px solid transparent;white-space:pre-wrap;word-break:break-word}
.m:last-child{border-bottom:0}
.m.operator{border-left-color:var(--acc);background:#f6faf8}
.m.bot,.m.system{color:var(--mut);font-style:italic}
.m .s{font-weight:600;font-style:normal}.m .ts{color:var(--mut);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis}
.act{margin-top:20px;display:flex;flex-wrap:wrap;gap:12px 20px;align-items:center;justify-content:space-between;background:#fff;border:1px solid var(--line);border-radius:6px;padding:14px 16px}
.act .sum{color:var(--mut)}.act .sum b{color:#17211c}
.ok{color:var(--acc)}.bad{color:var(--err)}
`;

class CqaHome extends HTMLElement {
  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.recs = []; this.idx = 0; this.file = ''; this.err = null; this.sel = null; this.cfg = null; this.busy = false; this.msg = null;
    this.root.addEventListener('cqa-checklist-selected', e => this.onSel(e.detail));
    this.root.addEventListener('click', e => this.onClick(e));
    this.root.addEventListener('change', e => this.onChange(e));
    this.root.addEventListener('dragover', e => { if (e.target.closest?.('.drop')) { e.preventDefault(); this.$('.drop').classList.add('over'); } });
    this.root.addEventListener('dragleave', () => this.$('.drop')?.classList.remove('over'));
    this.root.addEventListener('drop', e => {
      if (!e.target.closest?.('.drop')) return;
      e.preventDefault(); this.$('.drop').classList.remove('over');
      if (e.dataTransfer.files[0]) this.readFile(e.dataTransfer.files[0]);
    });
  }
  get apiBase() { return this.getAttribute('api-base') || ''; }
  connectedCallback() { this.render(); }
  $(s) { return this.root.querySelector(s); }
  rec() { return this.recs[this.idx]; }

  render() {
    this.root.innerHTML = `<style>${CSS}</style><div class="wrap">
      <header><h1>Оценка диалога</h1><a class="btn" href="checklist.html">Конструктор чек-листа</a></header>
      <div class="grid">
        <div class="panel"><h2>1. Чек-лист</h2>
          <cqa-checklist-picker api-base="${esc(this.apiBase)}"></cqa-checklist-picker>
          <div id="cl"></div></div>
        <div class="panel"><h2>2. Транскрипт</h2>
          <label class="drop"><input type="file" hidden accept=".json,.txt,.log,application/json,text/plain">
            <strong>Перетащите файл или нажмите, чтобы выбрать</strong>
            <span>JSON в формате API организаторов или текст со строками «оператор: текст»</span></label>
          <details><summary>Вставить текст вместо файла</summary>
            <textarea id="paste" rows="6" placeholder="[00:02] operator: Здравствуйте!&#10;[00:15] client: Добрый день, хочу узнать тариф"></textarea>
            <button data-act="parse">Прочитать текст</button></details>
          <div id="tr"></div></div>
      </div>
      <div class="act" id="act"></div>
      <div id="res"></div></div>`;
    this.paintCl(); this.paintTr(); this.paintAct();
  }

  /* ---------- checklist ---------- */
  async onSel(d) {
    this.sel = d; this.cfg = null; this.paintCl(); this.paintAct();
    if (!d) return;
    try {
      const r = await fetch(`${this.apiBase}/api/checklists/${d.checklist_id}/versions/${d.version}`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const cfg = await r.json();
      if (this.sel?.version === d.version) { this.cfg = cfg; this.paintCl(); }
    } catch (e) { this.cfg = null; this.$('#cl').innerHTML = `<p class="err">Не удалось загрузить критерии: ${esc(e.message)}</p>`; }
  }
  paintCl() {
    const c = this.cfg, box = this.$('#cl');
    if (!c) { box.innerHTML = this.sel ? '<p class="sub">Загружаю критерии…</p>' : ''; return; }
    const scored = c.criteria.filter(k => k.type !== 'flag');
    box.innerHTML = `<table>${c.criteria.map(k => `<tr><th>${esc(k.name)}${k.na_allowed ? ' <span class="t">(N/A)</span>' : ''}</th><td class="t">${TYPE_RU[k.type]}</td><td class="n">${k.type === 'flag' ? '' : fmt(k.weight)}</td></tr>`).join('')}</table>
      <p class="sub">Сумма весов: ${fmt(scored.reduce((a, k) => a + k.weight, 0))}. Флаг грубых ошибок баллов не даёт.</p>
      <a class="link" href="checklist.html?id=${c.id}">Изменить критерии</a>`;
  }

  /* ---------- transcript ---------- */
  async readFile(f) { this.ingest(await f.text(), f.name); }
  ingest(text, name) {
    this.msg = null; this.idx = 0; this.file = name; this.$('#res').innerHTML = '';
    try {
      const t = text.trim();
      if (!t) throw new Error('Файл пустой.');
      let recs;
      if (t[0] === '{' || t[0] === '[') {
        try { recs = toRecords(JSON.parse(t)); } catch (e) { throw new Error('Файл похож на JSON, но не читается: ' + e.message); }
      } else recs = parseText(t);
      this.recs = recs.map(normalize); this.err = null;
    } catch (e) { this.recs = []; this.err = e.message; }
    this.paintTr(); this.paintAct();
  }
  paintTr() {
    const box = this.$('#tr');
    if (this.err) { box.innerHTML = `<p class="err">${esc(this.err)}</p>`; return; }
    if (!this.recs.length) { box.innerHTML = ''; return; }
    const r = this.rec(), p = problem(r), many = this.recs.length > 1;
    const opN = r.transcript.filter(m => m.speaker === 'operator').length;
    box.innerHTML = `
      ${many ? `<select data-k="rec" aria-label="Диалог из файла">${this.recs.map((x, i) => `<option value="${i}" ${i === this.idx ? 'selected' : ''}>${esc(x.conversation_id || 'Диалог ' + (i + 1))}, ${x.language}, ${x.transcript.length} реплик</option>`).join('')}</select>` : ''}
      <div class="meta"><span>Источник: <b>${esc(this.file)}</b></span>${many ? `<span>Записей в файле: <b>${this.recs.length}</b></span>` : ''}
        <span>Язык: <b>${r.language}</b></span><span>Канал: <b>${r.channel === 'voice call' ? 'звонок' : 'чат'}</b></span>
        <span>Реплик: <b>${r.transcript.length}</b>, оператора: <b>${opN}</b></span>
        <button data-act="clear">Сбросить</button></div>
      ${p ? `<p class="err">${esc(p)}</p>` : ''}
      <div class="pv">${r.transcript.map(m => `<div class="m ${esc(m.speaker)}"><span class="ts">${esc(m.timestamp)}</span><span class="s">${esc(SPK_RU[m.speaker] || m.speaker)}</span><span>${esc(m.text)}</span></div>`).join('')}</div>`;
  }
  paintAct() {
    const r = this.rec(), ok = this.sel && this.cfg && r && !problem(r) && !this.busy;
    const cl = this.sel ? `<b>${esc(this.sel.name)}</b>, версия ${this.sel.version}` : 'не выбран';
    const dl = r ? `<b>${esc(r.conversation_id || 'новый диалог')}</b> (${r.language}, ${r.transcript.length} реплик)` : 'не загружен';
    this.$('#act').innerHTML = `<div class="sum">Чек-лист: ${cl}. Диалог: ${dl}.
      ${this.msg ? `<br><span class="${this.msg.t === 'e' ? 'bad' : 'ok'}">${esc(this.msg.s)}</span>` : ''}</div>
      <button class="pri" data-act="run" ${ok ? '' : 'disabled'}>${this.busy ? 'Оцениваю…' : 'Запустить оценку'}</button>`;
  }

  onChange(e) {
    const t = e.target;
    if (t.type === 'file' && t.files[0]) this.readFile(t.files[0]);
    else if (t.dataset.k === 'rec') { this.idx = +t.value; this.msg = null; this.$('#res').innerHTML = ''; this.paintTr(); this.paintAct(); }
  }
  onClick(e) {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'parse') this.ingest(this.$('#paste').value, 'вставленный текст');
    else if (a === 'clear') { this.recs = []; this.err = null; this.msg = null; this.$('input[type=file]').value = ''; this.$('#paste').value = ''; this.$('#res').innerHTML = ''; this.paintTr(); this.paintAct(); }
    else if (a === 'run') this.run();
  }

  /* ---------- save conversation, then evaluate ---------- */
  async post(path, body) {
    const res = await fetch(this.apiBase + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(Array.isArray(d.detail) ? d.detail.map(x => x.msg).join('; ') : d.detail || 'HTTP ' + res.status);
    return d;
  }
  async run() {
    const r = this.rec(); this.busy = true; this.msg = null; this.$('#res').innerHTML = ''; this.paintAct();
    try {
      const d = await this.post('/api/conversations', r);
      r.conversation_id = d.conversation_id;
      const detail = { conversation_id: d.conversation_id, checklist_id: this.sel.checklist_id, version: this.sel.version };
      this.dispatchEvent(new CustomEvent('cqa-evaluate-requested', { bubbles: true, composed: true, detail }));
      this.msg = { t: 'o', s: 'Оцениваю диалог, это может занять до минуты…' }; this.paintAct();
      const ev = await this.post('/api/evaluations', detail);
      this.msg = { t: 'o', s: `Готово. Итог: ${ev.total == null ? 'не рассчитан' : fmt(ev.total)}.` };
      this.$('#res').innerHTML = `<cqa-result api-base="${esc(this.apiBase)}"></cqa-result>`;
      this.$('#res cqa-result').evaluation = ev;
      this.dispatchEvent(new CustomEvent('cqa-evaluated', { bubbles: true, composed: true, detail: ev }));
    } catch (e) { this.msg = { t: 'e', s: 'Ошибка: ' + e.message }; }
    this.busy = false; this.paintTr(); this.paintAct();
  }
}
customElements.define('cqa-home', CqaHome);
})();