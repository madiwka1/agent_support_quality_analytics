/* <cqa-checklist-editor api-base="">
 * Self-contained web component (Shadow DOM, no dependencies).
 * API:  GET  {api-base}/api/checklists                  all checklists
 *       GET  {api-base}/api/checklists/{id}             latest version of one
 *       POST {api-base}/api/checklists                  create (optional copy_from)
 *       POST {api-base}/api/checklists/{id}/versions    save a NEW version
 * Attribute: checklist-id (optional) opens that checklist first.
 * Events: "cqa-checklist-saved", "cqa-checklists-changed"
 * Event: "cqa-checklist-saved" (detail = saved checklist)
 * Property: element.checklist = {...} loads a config without the API.
 */
const T = {
  title: 'Конструктор чек-листа', save: 'Сохранить как новую версию', revert: 'Отменить изменения',
  dirty: 'Есть несохранённые изменения', clean: 'Сохранено', sum: 'Сумма весов',
  addCrit: '+ Критерий', addSec: '+ Секция', del: 'Удалить критерий', up: 'Выше', down: 'Ниже',
  empty: 'Выберите критерий слева или добавьте новый.',
};
const TYPES = { yesno: 'Да / Нет', scale: 'Шкала', flag: 'Флаг нарушения' };
const SHORT = { yesno: 'Да/Нет', scale: 'Шкала', flag: 'Флаг' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => String(Math.round(n * 100) / 100);

const CSS = `
:host{display:block;font:15px/1.55 "Inter","Segoe UI",system-ui,-apple-system,Roboto,sans-serif;color:#13231a;
  --line:#e3e9e5;--mut:#5c5c5c;--acc:#178a3f;--accbg:#e7f6ec;--err:#d32f2f;--warn:#b26a00;--bg:#fff}
*{box-sizing:border-box}
.wrap{max-width:1180px;margin:0 auto;padding:20px 16px 40px}
header{display:flex;flex-wrap:wrap;gap:12px 24px;align-items:flex-end;justify-content:space-between;margin-bottom:14px}
h2{margin:0 0 6px;font-size:26px;font-weight:700}
input,select,textarea,button{font:inherit;color:inherit}
input,select,textarea{width:100%;padding:7px 9px;border:1px solid var(--line);border-radius:10px;background:#fff}
textarea{resize:vertical}
input:focus-visible,select:focus-visible,textarea:focus-visible,button:focus-visible{outline:2px solid var(--acc);outline-offset:1px}
input:disabled,select:disabled{background:#f1f2f4;color:var(--mut)}
.cl-name{font-size:15px;min-width:320px}
.h-right{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.ver{font-weight:600}.state{color:var(--mut)}.state.d{color:var(--warn)}
button{cursor:pointer;border:1px solid var(--line);background:#fff;border-radius:10px;padding:7px 12px}
button:hover:not(:disabled){border-color:var(--acc)}
button:disabled{opacity:.45;cursor:default}
button.pri{background:var(--acc);border-color:var(--acc);color:#fff;font-weight:600;border-radius:8px}
.share{display:flex;flex-wrap:wrap;gap:18px 28px;align-items:center;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin:6px 0 10px;box-shadow:0 1px 3px #0000000d}
.donut{width:150px;height:150px;flex:none}.donut circle{fill:none;stroke-width:5;transition:stroke-width .15s}.donut circle.on{stroke-width:7.5}
.donut text{font-weight:700;fill:#13231a;text-anchor:middle}
.legend{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:4px 18px;flex:1;min-width:260px}
.legend button{display:flex;gap:8px;align-items:center;text-align:left;border-color:transparent;padding:4px 8px}
.legend button.on{background:var(--accbg);border-color:var(--acc)}
.legend i{width:12px;height:12px;border-radius:3px;flex:none}.legend .nm{flex:1}.legend .pc{color:var(--mut);font-variant-numeric:tabular-nums}
.sumline{color:var(--mut);margin-bottom:8px}.sumline b{color:#13231a}.sumline b.bad{color:var(--warn)}
.problems{margin:0 0 12px;padding:0;list-style:none}
.problems li{padding:6px 10px;border-left:3px solid;margin-bottom:4px;background:#faf8f3}
.problems .e{border-color:var(--err);color:var(--err)}.problems .w{border-color:var(--warn);color:var(--warn)}.problems .o{border-color:var(--acc);color:var(--acc)}
.body{display:grid;grid-template-columns:340px 1fr;gap:20px;align-items:start}
@media(max-width:820px){.body{grid-template-columns:1fr}}
aside{border:1px solid var(--line);border-radius:20px;box-shadow:0 2px 4px #0b2a1c0a,0 12px 32px #0b2a1c0f;background:var(--bg);padding:6px 10px 10px}
.sec{padding:8px 0;border-bottom:1px solid var(--line)}
.sec-h{display:flex;gap:6px;align-items:center;margin-bottom:4px}
.sec-name{border-color:transparent;font-weight:600;padding:4px 6px}.sec-name:hover{border-color:var(--line)}
.sec-sum{color:var(--mut);min-width:28px;text-align:right}
.icon{padding:2px 8px;border-color:transparent}
.item{display:flex;width:100%;gap:8px;align-items:center;text-align:left;border-color:transparent;padding:6px 8px}
.item.on{background:var(--accbg);border-color:var(--acc)}
.item .nm{flex:1}.item .w{min-width:28px;text-align:right;font-weight:600}
.tag{font-size:12px;color:var(--mut);border:1px solid var(--line);border-radius:10px;padding:0 7px}
.add{border:none;color:var(--acc);padding:6px 8px;background:none}
section{border:1px solid var(--line);border-radius:20px;box-shadow:0 2px 4px #0b2a1c0a,0 12px 32px #0b2a1c0f;background:var(--bg);padding:16px}
label{display:block;margin-bottom:12px;color:var(--mut)}
label>input,label>select,label>textarea{margin-top:3px;color:#13231a}
.row{display:flex;gap:12px;flex-wrap:wrap}.row>label{flex:0 1 160px}.row>label.grow{flex:1 1 260px}
label.chk{display:flex;gap:8px;align-items:center;flex:0 0 auto;margin-top:22px;color:#13231a}
label.chk input{width:auto;margin:0}
.steps h3{margin:4px 0 6px;font-size:14px}
.step{display:grid;grid-template-columns:80px 1fr 34px;gap:8px;margin-bottom:6px}
.hint{color:var(--mut);margin:6px 0 12px}
.actions{display:flex;gap:8px;border-top:1px solid var(--line);padding-top:12px;margin-top:8px}
.actions .del{margin-left:auto;color:var(--err)}
.lists{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--line)}
.lists select{width:auto;min-width:260px;font-weight:600}
dialog.ask{border:0;border-radius:18px;padding:22px 22px 18px;width:min(420px,calc(100vw - 32px));box-shadow:0 20px 60px #0b2a1c40;color:#13231a}
dialog.ask::backdrop{background:#0b2a1c59;backdrop-filter:blur(2px)}
dialog.ask h3{margin:0 0 6px;font-size:18px}dialog.ask p{margin:0 0 12px;color:#5c5c5c}
dialog.ask input{margin-bottom:4px}
dialog.ask .btns{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}
dialog.ask button.danger{background:#d32f2f;border-color:#d32f2f;color:#fff}
/* ---- theme layer ---- */
:host{--line:#e3e9e5;--accg:linear-gradient(135deg,#178a3f,#43b75c);color:#13231a}
h1,h2,h3{letter-spacing:-.01em;color:#0b2a1c}
button,.btn,a.btn{border-radius:999px;font-weight:600;padding:8px 18px;background:#fff;transition:transform .12s,box-shadow .2s,border-color .2s,background-color .2s}
button:hover:not(:disabled),.btn:hover,a.btn:hover{border-color:#178a3f;box-shadow:0 4px 12px #178a3f26}
button.pri,.btn.pri,a.btn.pri{background:var(--accg);border-color:transparent;color:#fff;box-shadow:0 6px 16px #178a3f40}
button.pri:hover:not(:disabled),.btn.pri:hover{transform:translateY(-1px);box-shadow:0 8px 20px #178a3f55;border-color:transparent}
input,select,textarea{border-radius:12px;padding:9px 12px;transition:border-color .2s,box-shadow .2s}
input:focus-visible,select:focus-visible,textarea:focus-visible{outline:none;border-color:#178a3f;box-shadow:0 0 0 3px #178a3f26}
.panel,section,aside,.it,.act,.share{border-radius:20px}
.it,.act{box-shadow:0 2px 4px #0b2a1c0a,0 12px 32px #0b2a1c0f;border-color:#e3e9e5}
thead th{background:#eef8f1;color:#178a3f}
.item,.legend button,button.chip,.icon,.add{border-radius:12px;font-weight:500}
.item .w,.legend .pc{font-weight:600}
.pill,.badge{border-radius:999px;font-weight:600}
.drop{border-radius:20px;border:2px dashed #9fd3ae;background:linear-gradient(180deg,#f7fcf8,#eef8f1)}
.pv,.frag{border-radius:14px}
.note,.err,.sum,.why,.rev,.blk,.problems li{border-radius:0 12px 12px 0}
.bar{height:12px}

`;

class CqaChecklistEditor extends HTMLElement {
  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.state = null; this.saved = ''; this.sel = null; this.msg = null; this.busy = false;
    this.lists = []; this.cid = null;
    this.root.addEventListener('input', e => this.onInput(e));
    this.root.addEventListener('change', e => this.onChange(e));
    this.root.addEventListener('click', e => this.onClick(e));
  }
  get apiBase() { return this.getAttribute('api-base') || ''; }
  get checklist() { return this.state; }
  set checklist(cfg) { this.load(cfg); }
  connectedCallback() {
    if (!this.state) this.init();
    this.onLeave = e => { if (this.state && this.isDirty()) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', this.onLeave);
  }
  disconnectedCallback() { window.removeEventListener('beforeunload', this.onLeave); }
  $(s) { return this.root.querySelector(s); }
  cur() { return this.state?.criteria.find(k => k.id === this.sel); }

  load(cfg, msg = null) {
    this.state = structuredClone(cfg);
    this.saved = JSON.stringify(cfg);
    if (!this.state.criteria.some(k => k.id === this.sel)) this.sel = this.state.criteria[0]?.id ?? null;
    this.msg = msg; this.render();
  }
  isDirty() { return JSON.stringify(this.state) !== this.saved; }
  applyDraft(cfg) {
    const s = this.state;
    this.state = { ...structuredClone(cfg), id: s.id, version: s.version, created_at: s.created_at };
    this.sel = this.state.criteria[0]?.id ?? null;
    this.msg = { t: 'o', s: 'Черновик от ИИ загружен. Проверьте критерии и нажмите «Сохранить как новую версию». «Отменить изменения» вернёт прежний вариант.' };
    this.render();
  }
  weightSum() { return this.state.criteria.filter(k => k.type !== 'flag').reduce((a, k) => a + (+k.weight || 0), 0); }

  validate() {
    const c = this.state, errors = [], warnings = [];
    if (!c.name.trim()) errors.push('Укажите название чек-листа.');
    const names = new Set(c.sections);
    if (names.size !== c.sections.length) errors.push('Названия секций повторяются.');
    c.criteria.forEach((k, i) => {
      const p = `Критерий ${i + 1}${k.name ? ` «${k.name}»` : ''}`;
      if (!k.name.trim()) errors.push(`${p}: пустое название.`);
      if (k.type !== 'flag' && !(k.weight > 0)) errors.push(`${p}: вес должен быть больше 0.`);
      if (k.type === 'scale') {
        const v = (k.scale || []).map(s => s.value);
        if (v.length < 2) errors.push(`${p}: в шкале нужно минимум 2 ступени.`);
        if (new Set(v).size !== v.length) errors.push(`${p}: значения ступеней повторяются.`);
        if (v.length && Math.max(...v) <= 0) errors.push(`${p}: верхняя ступень должна быть больше 0.`);
        if (v.some(x => x < 0)) errors.push(`${p}: ступени не могут быть отрицательными.`);
        if ((k.scale || []).some(s => !s.desc.trim())) warnings.push(`${p}: у ступени нет описания.`);
      }
      if (k.na_allowed && !k.na_condition.trim()) errors.push(`${p}: опишите условие N/A.`);
    });
    const s = this.weightSum();
    if (Math.abs(s - 100) > 1e-9) warnings.push(`Сумма весов ${fmt(s)}, а не 100. Итог всё равно нормируется к 100.`);
    return { errors, warnings };
  }

  /* ---------- rendering ---------- */
  render() {
    const c = this.state;
    this.root.innerHTML = `<style>${CSS}</style><div class="wrap">
      <div class="lists" id="lists"></div>
      <header>
        <div><h2>${T.title}</h2><input class="cl-name" data-meta="name" value="${esc(c.name)}" aria-label="Название чек-листа"></div>
        <div class="h-right" id="meta"></div>
      </header>
      <div id="problems"></div>
      <div class="body"><aside id="list"></aside><section id="form"></section></div></div>`;
    this.paintLists(); this.paintMeta(); this.paintList(); this.paintForm();
  }
  paintLists() {
    this.$('#lists').innerHTML = `
      <select data-pick aria-label="Чек-лист">${this.lists.map(l => `<option value="${l.id}" ${l.id === this.cid ? 'selected' : ''}>${esc(l.name)} (v${l.latest_version})</option>`).join('')}</select>
      <button data-act="newlist">Новый чек-лист</button>
      <button data-act="duplist">Дублировать</button>
      <button data-act="dellist" ${this.lists.length < 2 ? 'disabled' : ''}>Удалить чек-лист</button>`;
  }
  paintMeta() {
    const { errors, warnings } = this.validate(), dirty = this.isDirty(), c = this.state;
    this.$('#meta').innerHTML = `
      <span class="ver">Версия ${c.version ?? 'нет'}</span>
      <span class="state ${dirty ? 'd' : ''}">${dirty ? T.dirty : T.clean}</span>
      <button data-act="revert" ${dirty ? '' : 'disabled'}>${T.revert}</button>
      <button class="pri" data-act="save" ${dirty && !errors.length && !this.busy ? '' : 'disabled'}>${T.save}</button>`;
    const scored = c.criteria.filter(k => k.type !== 'flag');
    const hues = ['#178a3f', '#43b75c', '#0f5c2e', '#8ccf7e', '#1f6f8b', '#c99a2e', '#5c5c5c', '#3e9e9e'];
    const sum = this.weightSum();
    let off = 0;
    const arcs = scored.map((k, i) => {
      const pc = sum > 0 ? (+k.weight || 0) / sum * 100 : 0, a = `<circle class="${k.id === this.sel ? 'on' : ''}" r="15.915" cx="21" cy="21" stroke="${hues[i % hues.length]}" stroke-dasharray="${pc} ${100 - pc}" stroke-dashoffset="${25 - off}"><title>${esc(k.name)}: ${fmt(+k.weight || 0)}</title></circle>`;
      off += pc; return a;
    }).join('');
    const legend = scored.map((k, i) => `<button class="${k.id === this.sel ? 'on' : ''}" data-act="select" data-id="${esc(k.id)}"><i style="background:${hues[i % hues.length]}"></i>
      <span class="nm">${esc(k.name || '(без названия)')}</span><span class="pc">${fmt(+k.weight || 0)} · ${sum > 0 ? Math.round((+k.weight || 0) / sum * 100) : 0}%</span></button>`).join('');
    const bar = `<svg class="donut" viewBox="0 0 42 42" role="img" aria-label="${T.sum}: ${fmt(sum)}"><circle r="15.915" cx="21" cy="21" stroke="#eceef0"></circle>${arcs}
      <text x="21" y="21" font-size="${Math.min(7, 26 / Math.max(fmt(sum).length, 1))}">${fmt(sum)}</text><text x="21" y="27" font-size="3.2" style="font-weight:400;fill:#5c5c5c">из 100</text></svg><div class="legend">${legend}</div>`;
    const msg = this.msg ? `<li class="${this.msg.t}">${esc(this.msg.s)}</li>` : '';
    this.$('#problems').innerHTML = `
      <div class="share">${bar}</div>
      <div class="sumline">${T.sum}: <b class="${Math.abs(sum - 100) > 1e-9 ? 'bad' : ''}">${fmt(sum)}</b> из 100. Критерии с N/A исключаются, их вес перераспределяется между остальными.</div>
      <ul class="problems">${msg}${errors.map(x => `<li class="e">${esc(x)}</li>`).join('')}${warnings.map(x => `<li class="w">${esc(x)}</li>`).join('')}</ul>`;
  }
  paintList() {
    const c = this.state;
    this.$('#list').innerHTML = c.sections.map((sec, si) => {
      const items = c.criteria.filter(k => k.section === sec);
      const sum = items.filter(k => k.type !== 'flag').reduce((a, k) => a + (+k.weight || 0), 0);
      return `<div class="sec"><div class="sec-h">
        <input class="sec-name" data-sec="${si}" value="${esc(sec)}" aria-label="Название секции">
        <span class="sec-sum">${sum ? fmt(sum) : ''}</span>
        <button class="icon" data-act="delsec" data-i="${si}" ${items.length ? 'disabled' : ''} title="Удалить пустую секцию" aria-label="Удалить секцию">×</button></div>
        ${items.map(k => `<button class="item ${k.id === this.sel ? 'on' : ''}" data-act="select" data-id="${esc(k.id)}">
          <span class="nm">${esc(k.name || '(без названия)')}</span><span class="tag">${SHORT[k.type]}</span>
          <span class="w">${k.type === 'flag' ? '' : fmt(+k.weight || 0)}</span></button>`).join('')}
        <button class="add" data-act="add" data-i="${si}">${T.addCrit}</button></div>`;
    }).join('') + `<button class="add" data-act="addsec">${T.addSec}</button>`;
  }
  paintForm() {
    const k = this.cur(), f = this.$('#form');
    if (!k) { f.innerHTML = `<p class="hint">${T.empty}</p>`; return; }
    const flag = k.type === 'flag', opt = (v, l, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(l)}</option>`;
    let scale = '';
    if (k.type === 'scale') {
      scale = `<div class="steps"><h3>Шкала</h3>${k.scale.map((s, i) => `<div class="step">
        <input type="number" step="any" data-si="${i}" data-sf="value" value="${s.value}" aria-label="Баллы ступени ${i + 1}">
        <input data-si="${i}" data-sf="desc" value="${esc(s.desc)}" placeholder="Что соответствует этой ступени" aria-label="Описание ступени ${i + 1}">
        <button class="icon" data-act="delstep" data-i="${i}" aria-label="Удалить ступень">×</button></div>`).join('')}
        <button class="add" data-act="addstep">+ Ступень</button>
        <p class="hint" id="scalehint">${this.scaleHint(k)}</p></div>`;
    }
    f.innerHTML = `
      <div class="row"><label class="grow">Название<input data-f="name" value="${esc(k.name)}"></label>
        <label>Секция<select data-f="section">${this.state.sections.map(s => opt(s, s, s === k.section)).join('')}</select></label></div>
      <label>Формулировка и правило оценки<textarea data-f="description" rows="4">${esc(k.description)}</textarea></label>
      <div class="row">
        <label>Тип ответа<select data-f="type">${Object.entries(TYPES).map(([v, l]) => opt(v, l, v === k.type)).join('')}</select></label>
        <label>Вес<input type="number" min="0" step="any" data-f="weight" value="${flag ? 0 : k.weight}" ${flag ? 'disabled' : ''}></label>
        <label class="chk"><input type="checkbox" data-f="na_allowed" ${k.na_allowed ? 'checked' : ''} ${flag ? 'disabled' : ''}>N/A допустим</label></div>
      ${k.na_allowed ? `<label>Условие N/A<textarea data-f="na_condition" rows="2" placeholder="Когда критерий неприменим">${esc(k.na_condition)}</textarea></label>` : ''}
      ${scale}
      ${flag ? '<p class="hint">Флаг не даёт баллов и не входит в итог. «Да» означает, что нарушение выявлено, это отмечается отдельно.</p>' : ''}
      <div class="actions"><button data-act="up">${T.up}</button><button data-act="down">${T.down}</button>
        <button class="del" data-act="del">${T.del}</button></div>`;
  }
  scaleHint(k) { return `Верхняя ступень (${fmt(Math.max(...k.scale.map(s => +s.value)))}) даёт полный вес ${fmt(+k.weight || 0)}. Остальные пересчитываются пропорционально.`; }
  refresh(full = false) { this.paintMeta(); this.paintList(); if (full) this.paintForm(); }

  /* ---------- editing ---------- */
  onInput(e) {
    const t = e.target, k = this.cur();
    if (t.dataset.meta === 'name') { this.state.name = t.value; this.paintMeta(); return; }
    if (t.dataset.sf && k) {
      const s = k.scale[+t.dataset.si];
      s[t.dataset.sf] = t.dataset.sf === 'value' ? (t.value === '' ? 0 : Number(t.value)) : t.value;
      this.paintMeta(); this.paintHint(k); return;
    }
    const f = t.dataset.f;
    if (!f || !k) return;
    const v = t.type === 'checkbox' ? t.checked : t.type === 'number' ? (t.value === '' ? 0 : Number(t.value)) : t.value;
    k[f] = v;
    if (f === 'type') this.applyType(k);
    this.refresh(['type', 'na_allowed'].includes(f));
    this.paintHint(k);
  }
  paintHint(k) { const h = this.$('#scalehint'); if (h && k.type === 'scale') h.textContent = this.scaleHint(k); }
  onChange(e) {
    const t = e.target;
    if (t.dataset.pick !== undefined) return this.switchTo(+t.value);
    if (t.dataset.sec === undefined) return;
    const i = +t.dataset.sec, old = this.state.sections[i], name = t.value.trim();
    if (!name || this.state.sections.includes(name)) { t.value = old; return; }
    this.state.sections[i] = name;
    this.state.criteria.forEach(k => { if (k.section === old) k.section = name; });
    this.refresh(true);
  }
  applyType(k) {
    if (k.type === 'flag') { k.weight = 0; k.na_allowed = false; k.na_condition = ''; k.scale = null; }
    else {
      if (!(k.weight > 0)) k.weight = 5;
      k.scale = k.type === 'scale' ? (k.scale || [{ value: 10, desc: '' }, { value: 5, desc: '' }, { value: 0, desc: '' }]) : null;
    }
  }
  nextId() { return 'c' + (Math.max(0, ...this.state.criteria.map(k => parseInt(k.id.slice(1)) || 0)) + 1); }
  onClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const a = b.dataset.act, c = this.state, k = this.cur(), i = +b.dataset.i;
    if (a === 'save') return this.save();
    if (a === 'newlist') return this.createList(false);
    if (a === 'duplist') return this.createList(true);
    if (a === 'dellist') return this.deleteList();
    if (a === 'revert') return this.load(JSON.parse(this.saved));
    if (a === 'select') { this.sel = b.dataset.id; this.msg = null; this.refresh(true); return; }
    if (a === 'add') {
      const nk = { id: this.nextId(), name: 'Новый критерий', description: '', section: c.sections[i], type: 'yesno', weight: 5, scale: null, na_allowed: false, na_condition: '' };
      c.criteria.push(nk); this.sel = nk.id;
    } else if (a === 'addsec') {
      let n = 1; while (c.sections.includes('Новая секция ' + n)) n++;
      c.sections.push('Новая секция ' + n);
    } else if (a === 'delsec') c.sections.splice(i, 1);
    else if (a === 'del' && k) {
      this.ask({ title: 'Удалить критерий?', text: `«${k.name}» будет удалён из черновика. Сохранённые версии не изменятся.`, ok: 'Удалить', danger: true })
        .then(yes => {
          if (!yes) return;
          const at = c.criteria.indexOf(k); c.criteria.splice(at, 1);
          this.sel = (c.criteria[at] || c.criteria[at - 1])?.id ?? null;
          this.msg = null; this.refresh(true);
        });
      return;
    } else if ((a === 'up' || a === 'down') && k) {
      const at = c.criteria.indexOf(k), step = a === 'up' ? -1 : 1;
      let j = at + step;
      while (c.criteria[j] && c.criteria[j].section !== k.section) j += step;
      if (c.criteria[j]) [c.criteria[at], c.criteria[j]] = [c.criteria[j], c.criteria[at]];
    } else if (a === 'addstep' && k) k.scale.push({ value: 0, desc: '' });
    else if (a === 'delstep' && k) k.scale.splice(i, 1);
    this.msg = null; this.refresh(true);
  }

  /* In-app replacement for prompt()/confirm(): resolves to the entered text (value given), true, or null if cancelled. */
  ask({ title, text = '', value = null, ok = 'OK', danger = false }) {
    return new Promise(done => {
      const d = document.createElement('dialog');
      d.className = 'ask';
      d.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}
        ${value !== null ? `<input name="v" value="${esc(value)}" maxlength="120" required aria-label="${esc(text || title)}">` : ''}
        <div class="btns"><button type="button" data-cancel>Отмена</button><button value="ok" class="${danger ? 'danger' : 'pri'}">${esc(ok)}</button></div></form>`;
      d.querySelector('[data-cancel]').addEventListener('click', () => d.close('cancel'));  // not a submit button: Enter confirms
      d.addEventListener('close', () => {
        const input = d.querySelector('input');
        d.remove();
        done(d.returnValue !== 'ok' ? null : input ? input.value.trim() || null : true);
      });
      this.root.append(d);
      d.showModal();
      d.querySelector('input')?.select();
    });
  }
  fail(e, what) { this.busy = false; this.msg = { t: 'e', s: `${what}: ${e.message}` }; this.paintMeta(); }
  announce(name, detail) { this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true })); }
  async api(path, method = 'GET', body) {
    const r = await fetch(this.apiBase + path, {
      method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const d = data.detail;
      throw new Error(Array.isArray(d) ? d.map(x => x.msg).join('; ') : d || 'HTTP ' + r.status);
    }
    return data;
  }
  async init() {
    try {
      this.lists = await this.api('/api/checklists');
      const want = +this.getAttribute('checklist-id');
      await this.open(this.lists.some(l => l.id === want) ? want : this.lists[0].id);
    } catch (e) {
      this.root.innerHTML = `<style>${CSS}</style><div class="wrap"><ul class="problems"><li class="e">Не удалось загрузить чек-листы: ${esc(e.message)}. Проверьте, что сервер запущен и api-base указан верно.</li></ul></div>`;
    }
  }
  async open(id, msg = null) {
    const cfg = await this.api('/api/checklists/' + id);
    this.cid = id; this.sel = null; this.load(cfg, msg);
  }
  async switchTo(id) {
    if (this.isDirty() && !await this.ask({ title: 'Переключить чек-лист?', text: 'Несохранённые изменения будут потеряны.', ok: 'Переключить', danger: true })) { this.paintLists(); return; }
    try { await this.open(id); } catch (e) { this.fail(e, 'Не удалось открыть чек-лист'); }
  }
  async createList(copy) {
    const name = await this.ask({ title: copy ? 'Дублировать чек-лист' : 'Новый чек-лист', text: 'Название чек-листа',
      value: copy ? `${this.state.name} (копия)` : 'Новый чек-лист', ok: copy ? 'Создать копию' : 'Создать' });
    if (!name) return;
    if (this.isDirty() && !await this.ask({ title: 'Продолжить без сохранения?', ok: 'Продолжить', danger: true,
      text: 'Несохранённые изменения текущего чек-листа будут потеряны. Копия делается из сохранённой версии.' })) return;
    try {
      const cfg = await this.api('/api/checklists', 'POST', { name, copy_from: copy ? this.cid : null });
      this.lists = await this.api('/api/checklists');
      this.cid = cfg.id; this.sel = null;
      this.load(cfg, { t: 'o', s: `Создан чек-лист «${name}».` });
      this.announce('cqa-checklists-changed', cfg);
    } catch (e) { this.fail(e, 'Не удалось создать чек-лист'); }
  }
  async deleteList() {
    if (!await this.ask({ title: 'Удалить чек-лист?', text: `«${this.state.name}» исчезнет из списка. Прежние оценки сохранят ссылку на него.`, ok: 'Удалить', danger: true })) return;
    try {
      const gone = this.cid;
      await this.api('/api/checklists/' + gone, 'DELETE');
      this.lists = await this.api('/api/checklists');
      await this.open(this.lists[0].id, { t: 'o', s: 'Чек-лист удалён.' });
      this.announce('cqa-checklists-changed', { deleted: gone });
    } catch (e) { this.fail(e, 'Не удалось удалить чек-лист'); }
  }
  async save() {
    if (this.validate().errors.length) return;
    this.busy = true; this.paintMeta();
    try {
      const data = await this.api(`/api/checklists/${this.cid}/versions`, 'POST', this.state);
      this.lists = await this.api('/api/checklists');
      this.busy = false;
      this.load(data, { t: 'o', s: `Сохранено как версия ${data.version}. Новые оценки с этим чек-листом будут использовать её.` });
      this.announce('cqa-checklist-saved', data);
    } catch (e) { this.fail(e, 'Не удалось сохранить'); }
  }
}
customElements.define('cqa-checklist-editor', CqaChecklistEditor);
