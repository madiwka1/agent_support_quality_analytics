/* <cqa-appeals api-base="" appeal-id="">
 * Reviewer side. Without appeal-id: list of appeals. With appeal-id: appeal card with the disputed criteria,
 * the author's comments, dialog fragments, and a decision form (reject / accept with a new answer) + reason.
 */
(() => {
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => String(Math.round(n * 100) / 100);
const enc = encodeURIComponent;
const when = s => esc(String(s || '').slice(0, 16).replace('T', ' '));
const SPK = { client: 'Клиент', operator: 'Оператор', bot: 'Бот', system: 'Система' };
const ST = { pending: ['wait', 'На рассмотрении'], accepted: ['ok', 'Принята'], rejected: ['bad', 'Отклонена'], partial: ['mid', 'Принята частично'] };
const lblOf = (type, a, v) => a === 'na' ? 'N/A' : type === 'flag' ? (a === 'yes' ? 'Нарушение выявлено' : 'Не выявлено')
  : type === 'scale' ? `${fmt(v)} по шкале` : (a === 'yes' ? 'Да' : 'Нет');
const tot = n => n == null ? '—' : fmt(n);
const pill = s => `<span class="pill ${ST[s][0]}">${ST[s][1]}</span>`;

const CSS = `
:host{display:block;font:14px/1.45 "Segoe UI",system-ui,sans-serif;color:#17211c;--line:#d8dfdb;--mut:#5b6962;--acc:#14633f;--accbg:#e4f1ea;--err:#b3261e;--warn:#8a5300}
*{box-sizing:border-box}a{color:var(--acc)}
h1{margin:0;font-size:24px;font-weight:600}h3{margin:0;font-size:15px}
.top{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:16px}
.sub{color:var(--mut);margin:4px 0 0}
button,select,textarea{font:inherit;color:inherit}
button{cursor:pointer;border:1px solid var(--line);background:#fff;border-radius:4px;padding:8px 14px}
button.pri{background:var(--acc);border-color:var(--acc);color:#fff;font-weight:600}
button:disabled{opacity:.5;cursor:default}
select,textarea{width:100%;padding:7px 9px;border:1px solid var(--line);border-radius:4px;background:#fff}
.flt select{width:auto}
.panel{background:#fff;border:1px solid var(--line);border-radius:6px;overflow:auto}
table{width:100%;border-collapse:collapse}
th,td{padding:9px 12px;border-top:1px solid var(--line);text-align:left;font-weight:400}
thead th{border-top:0;color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.04em;background:#fafcfb}
td.n,th.n{text-align:right}td.t{color:var(--mut)}
tr[data-href]{cursor:pointer}tr[data-href]:hover td{background:var(--accbg)}
.pill{padding:2px 9px;border-radius:10px;font-size:12px;border:1px solid;white-space:nowrap}
.pill.ok{color:var(--acc);border-color:var(--acc);background:var(--accbg)}.pill.bad{color:var(--err);border-color:var(--err);background:#fbf3f2}
.pill.wait,.pill.mid{color:var(--warn);border-color:var(--warn);background:#faf5ea}
.empty{padding:28px 16px;text-align:center;color:var(--mut)}
.err{color:var(--err);padding:8px 10px;border-left:3px solid var(--err);background:#fbf3f2;margin:0 0 12px}
.note{padding:8px 12px;margin:0 0 12px;border-left:3px solid var(--acc);background:var(--accbg)}
.meta{display:flex;flex-wrap:wrap;gap:6px 18px;color:var(--mut);margin:6px 0 16px}.meta b{color:#17211c}
.it{background:#fff;border:1px solid var(--line);border-radius:6px;padding:16px;margin-bottom:14px}
.row{display:flex;gap:10px;align-items:baseline;justify-content:space-between}
.badge{white-space:nowrap;padding:2px 9px;border-radius:10px;font-size:13px;font-weight:600;border:1px solid var(--line);background:#f4f6f5}
.pts{color:var(--mut);margin:2px 0 8px}
.blk{padding:8px 12px;margin:8px 0;border-left:3px solid var(--line);background:#fafcfb}
.blk b,.res b{display:block;font-size:11px;color:var(--mut);text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px}
.blk.cmt{border-color:var(--warn);background:#faf5ea}
.frag{border:1px solid var(--line);border-radius:4px;margin:8px 0;max-height:260px;overflow:auto}
.m{display:grid;grid-template-columns:28px 52px 70px 1fr;gap:6px;padding:5px 8px;border-left:3px solid transparent;border-bottom:1px solid #edf0ee;white-space:pre-wrap;word-break:break-word}
.m.operator{border-left-color:var(--acc);background:#f6faf8}.m.bot,.m.system{color:var(--mut);font-style:italic}
.m .n,.m .ts{color:var(--mut)}.m .s{font-weight:600;font-style:normal}
.m.hl{background:#fff3c4;outline:2px solid #e0b400;outline-offset:-2px}
.gap{text-align:center;color:var(--mut);padding:2px}
audio{width:100%;margin:8px 0}
.dec{border-top:1px solid var(--line);margin-top:12px;padding-top:12px}
.dec label.r{display:block;margin-bottom:6px;cursor:pointer}
.dec .newa,.dec .why{margin:8px 0 0 22px}.dec .why{margin-left:0}
.dec small{display:block;color:var(--mut);margin-bottom:3px}
.res{padding:8px 12px;border-left:3px solid;margin-top:10px}
.res.accept{border-color:var(--acc);background:var(--accbg)}.res.reject{border-color:var(--err);background:#fbf3f2}
.bar{display:flex;gap:12px;align-items:center;margin-top:6px}.derr{color:var(--err)}
`;

class CqaAppeals extends HTMLElement {
  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.list = []; this.detail = null; this.conv = null; this.err = null; this.msg = null;
    this.filter = 'all'; this.busy = false; this.ready = false;
    this.root.addEventListener('click', e => this.onClick(e));
    this.root.addEventListener('change', e => this.onChange(e));
  }
  static get observedAttributes() { return ['appeal-id']; }
  get apiBase() { return this.getAttribute('api-base') || ''; }
  connectedCallback() { this.ready = true; this.load(); }
  attributeChangedCallback(n, o, v) { if (this.ready && o !== v) this.load(); }

  async api(path, body) {
    const r = await fetch(this.apiBase + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(Array.isArray(d.detail) ? d.detail.map(x => x.msg).join('; ') : d.detail || 'HTTP ' + r.status);
    return d;
  }
  async load() {
    const id = this.getAttribute('appeal-id');
    this.err = null; this.msg = null;
    this.root.innerHTML = `<style>${CSS}</style><p class="sub">Загружаю…</p>`;
    try {
      if (id) { this.detail = await this.api('/api/appeals/' + enc(id)); this.conv = await this.api('/api/conversations/' + enc(this.detail.conversation_id)); }
      else { this.detail = null; this.list = await this.api('/api/appeals'); }
    } catch (e) { this.err = e.message; }
    this.render();
  }
  render() {
    const body = this.err ? `<p class="err">Не удалось загрузить данные: ${esc(this.err)}</p>` : this.detail ? this.renderDetail() : this.renderList();
    this.root.innerHTML = `<style>${CSS}</style>${body}`;
  }

  /* ---------- list ---------- */
  renderList() {
    const f = this.filter, rows = this.list.filter(a => f === 'all' || (f === 'pending' ? a.status === 'pending' : a.status !== 'pending'));
    const pend = this.list.filter(a => a.status === 'pending').length;
    const tr = rows.map(a => `<tr data-href="#/appeals/${enc(a.id)}"><td class="t">${when(a.created_at)}</td>
      <td><a href="#/dialogs/${enc(a.conversation_id)}">${esc(a.conversation_id)}</a></td>
      <td>${a.items.map(i => esc(i.name)).join(', ')}</td><td>${pill(a.status)}</td>
      <td class="n">${tot(a.original_total)}${a.final_total != null && a.final_total !== a.original_total ? ` → <b>${tot(a.final_total)}</b>` : ''}</td>
      <td><a href="#/appeals/${enc(a.id)}">${a.status === 'pending' ? 'Рассмотреть' : 'Открыть'}</a></td></tr>`).join('');
    return `<div class="top"><div><h1>Апелляции</h1><p class="sub">На рассмотрении: ${pend}, всего: ${this.list.length}</p></div>
      <label class="flt">Показывать: <select data-k="flt"><option value="all" ${f === 'all' ? 'selected' : ''}>Все</option>
        <option value="pending" ${f === 'pending' ? 'selected' : ''}>На рассмотрении</option>
        <option value="done" ${f === 'done' ? 'selected' : ''}>Рассмотренные</option></select></label></div>
      <div class="panel">${rows.length ? `<table><thead><tr><th>Подана</th><th>Диалог</th><th>Критерии</th><th>Статус</th><th class="n">Итог</th><th></th></tr></thead><tbody>${tr}</tbody></table>`
        : '<div class="empty">Апелляций нет. Подать её можно на странице оценки.</div>'}</div>`;
  }

  /* ---------- detail ---------- */
  frag(it) {
    const tr = this.conv?.transcript || [], c = it.criterion;
    if (!tr.length) return '';
    const ev = new Set(c.evidence.map(x => x.index)), show = new Set();
    ev.forEach(i => { for (let j = i - 1; j <= i + 1; j++) if (j >= 0 && j < tr.length) show.add(j); });
    if (!ev.size && c.checked_range) for (let j = c.checked_range.from; j <= Math.min(c.checked_range.to, c.checked_range.from + 13); j++) show.add(j);
    if (!show.size) return '';
    let prev = -2, h = '';
    for (const i of [...show].sort((a, b) => a - b)) {
      if (prev >= 0 && i > prev + 1) h += '<div class="gap">…</div>';
      const m = tr[i];
      h += `<div class="m ${esc(m.speaker)} ${ev.has(i) ? 'hl' : ''}"><span class="n">${i + 1}</span><span class="ts">${esc(m.timestamp)}</span><span class="s">${esc(SPK[m.speaker] || m.speaker)}</span><span>${esc(m.text)}</span></div>`;
      prev = i;
    }
    return `<div class="frag">${h}</div>`;
  }
  options(it) {
    const c = it.criterion, m = it.meta || {}; let o = [];
    if (m.type === 'scale') (m.scale || []).forEach(s => o.push(['score', s.value, `${fmt(s.value)}${s.desc ? ' — ' + s.desc : ''}`]));
    else if (m.type === 'flag') o = [['yes', null, 'Нарушение выявлено'], ['no', null, 'Не выявлено']];
    else o = [['yes', null, 'Да'], ['no', null, 'Нет']];
    if (m.na_allowed) o.push(['na', null, 'N/A']);
    return o.map(([a, v, l]) => {
      const cur = a === c.answer && (a !== 'score' || v === c.value);
      return `<option value="${a}|${v ?? ''}" ${cur ? 'disabled' : ''}>${esc(l)}${cur ? ' (текущая)' : ''}</option>`;
    }).join('');
  }
  renderItem(it, pending) {
    const c = it.criterion, id = esc(it.criterion_id), type = it.meta?.type || c.type;
    const pts = c.answer === 'na' ? 'Исключён из расчёта' : c.points == null ? 'Баллов нет' : `${fmt(c.points)} из ${fmt(c.effective_weight)}`;
    const form = pending ? `<div class="dec">
        <label class="r"><input type="radio" name="d-${id}" value="reject"> <b>Отклонить</b> апелляцию: оценка остаётся</label>
        <label class="r"><input type="radio" name="d-${id}" value="accept"> <b>Принять</b> апелляцию: изменить оценку</label>
        <div class="newa" data-na-box="${id}" hidden><small>Новый ответ</small><select data-na="${id}">${this.options(it)}</select></div>
        <div class="why"><small>Причина решения (обязательно)</small><textarea data-r="${id}" rows="2" placeholder="Почему апелляция принята или отклонена"></textarea></div></div>`
      : `<div class="res ${esc(it.decision)}"><b>${it.decision === 'accept' ? 'Апелляция принята' : 'Апелляция отклонена'}</b>
        ${it.decision === 'accept' ? `Новая оценка: ${esc(lblOf(type, it.answer, it.value))} (было: ${esc(lblOf(type, c.answer, c.value))}). ` : ''}Причина: ${esc(it.reason || '')}</div>`;
    return `<article class="it"><div class="row"><h3>${esc(c.name)}</h3><span class="badge">${esc(lblOf(type, c.answer, c.value))}</span></div>
      <div class="pts">${esc(c.section)} · ${esc(pts)}</div>
      <div class="blk"><b>Обоснование модели</b>${esc(c.explanation)}</div>
      <div class="blk cmt"><b>Комментарий автора апелляции</b>${esc(it.comment)}</div>
      ${this.frag(it) ? `<b style="font-size:11px;color:var(--mut)">ФРАГМЕНТ ДИАЛОГА</b>${this.frag(it)}` : ''}${form}</article>`;
  }
  renderDetail() {
    const d = this.detail, pending = d.status === 'pending';
    const totals = pending ? `Итог сейчас: <b>${tot(d.current_total)}</b> / ${fmt(d.max_total)}`
      : `Итог: было <b>${tot(d.original_total)}</b>, после решения <b>${tot(d.result?.total)}</b> / ${fmt(d.max_total)}`;
    return `<div class="top"><div><a href="#/appeals">← Все апелляции</a><h1>Апелляция ${esc(d.id)} ${pill(d.status)}</h1></div>
        <a href="#/evaluations/${enc(d.evaluation_id)}">Открыть оценку</a></div>
      ${this.msg ? `<div class="note">${esc(this.msg)}</div>` : ''}
      <div class="meta"><span>Диалог: <a href="#/dialogs/${enc(d.conversation_id)}">${esc(d.conversation_id)}</a></span>
        <span>Чек-лист: <b>${esc(d.checklist_name)}</b></span><span>Подана: <b>${when(d.created_at)}</b></span>
        ${d.resolved_at ? `<span>Решение: <b>${when(d.resolved_at)}</b></span>` : ''}<span>${totals}</span></div>
      ${this.conv?.audio_url ? `<audio controls preload="none" src="${esc(this.conv.audio_url)}"></audio>` : ''}
      ${d.items.map(it => this.renderItem(it, pending)).join('')}
      ${pending ? '<div class="bar"><button class="pri" data-act="save">Сохранить решение</button><span class="derr" id="derr"></span></div>' : ''}`;
  }

  onChange(e) {
    const t = e.target;
    if (t.dataset.k === 'flt') { this.filter = t.value; this.render(); }
    else if (t.type === 'radio' && t.name.startsWith('d-')) this.root.querySelector(`[data-na-box="${t.name.slice(2)}"]`).hidden = t.value !== 'accept';
  }
  onClick(e) {
    if (e.target.closest('a,button,select,textarea,input')) { if (e.target.closest('[data-act="save"]')) this.save(); return; }
    const tr = e.target.closest('tr[data-href]');
    if (tr) location.hash = tr.dataset.href;
  }
  async save() {
    if (this.busy) return;
    const err = this.root.getElementById('derr'); err.textContent = '';
    const items = [];
    for (const it of this.detail.items) {
      const cid = it.criterion_id, name = it.criterion.name;
      const dec = this.root.querySelector(`input[name="d-${cid}"]:checked`)?.value;
      const reason = this.root.querySelector(`[data-r="${cid}"]`).value.trim();
      if (!dec) { err.textContent = `Выберите решение по критерию «${name}».`; return; }
      if (reason.length < 3) { err.textContent = `Укажите причину решения по критерию «${name}».`; return; }
      const o = { criterion_id: cid, decision: dec, reason };
      if (dec === 'accept') {
        const [a, v] = this.root.querySelector(`[data-na="${cid}"]`).value.split('|');
        o.answer = a; o.value = a === 'score' ? Number(v) : null;
      }
      items.push(o);
    }
    this.busy = true;
    try {
      this.detail = await this.api(`/api/appeals/${enc(this.detail.id)}/decision`, { items });
      this.msg = 'Решение сохранено. Итог пересчитан.';
      this.render();
    } catch (x) { err.textContent = 'Не удалось сохранить: ' + x.message; }
    this.busy = false;
  }
}
customElements.define('cqa-appeals', CqaAppeals);
})();