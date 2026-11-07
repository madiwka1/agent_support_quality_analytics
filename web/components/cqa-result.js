/* <cqa-result api-base="" evaluation-id="">
 * Evaluation card: total (after appeals), violation flag, sections, per-criterion answer / points /
 * explanation / evidence, transcript, and the appeal flow (select criteria + comments -> POST /api/appeals).
 * Property: element.evaluation = {...} (response of POST /api/evaluations), or set attribute evaluation-id.
 * Event: "cqa-appeal-submitted"
 */
(() => {
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => String(Math.round(n * 100) / 100);
const enc = encodeURIComponent;
const SPK = { client: 'Клиент', operator: 'Оператор', bot: 'Бот', system: 'Система' };
const secs = t => {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t || '');
  if (m) return m[3] !== undefined ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
  const d = Date.parse(t); return isNaN(d) ? NaN : d / 1000;
};
const short = (t, n = 90) => t.length > n ? t.slice(0, n) + '…' : t;
const lblOf = (type, a, v) => a === 'na' ? 'N/A' : type === 'flag' ? (a === 'yes' ? 'Нарушение выявлено' : 'Не выявлено')
  : type === 'scale' ? `${fmt(v)} по шкале` : (a === 'yes' ? 'Да' : 'Нет');

const CSS = `
:host{display:block;font:14px/1.45 "Segoe UI",system-ui,sans-serif;color:#17211c;--line:#d8dfdb;--mut:#5b6962;--acc:#14633f;--accbg:#e4f1ea;--err:#b3261e;--warn:#8a5300}
*{box-sizing:border-box}
.wrap{display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:20px;align-items:start;margin-top:20px}
@media(max-width:900px){.wrap{grid-template-columns:1fr}}
.panel{background:#fff;border:1px solid var(--line);border-radius:6px;padding:16px}
h2{margin:0 0 10px;font-size:16px;font-weight:600}
button,.btn{font:inherit;color:inherit;cursor:pointer;border:1px solid var(--line);background:#fff;border-radius:4px;padding:7px 12px}
button:hover:not(:disabled){border-color:var(--acc)}
button.pri{background:var(--acc);border-color:var(--acc);color:#fff;font-weight:600}
.head{display:flex;flex-wrap:wrap;gap:12px 24px;align-items:center;margin-bottom:12px}.head .btn{margin-left:auto}
.total{font-size:34px;font-weight:700;color:var(--acc)}.total small{font-size:16px;color:var(--mut);font-weight:400}
.pill{padding:3px 10px;border-radius:12px;font-size:13px;border:1px solid}
.pill.ok{color:var(--acc);border-color:var(--acc);background:var(--accbg)}.pill.bad{color:var(--err);border-color:var(--err);background:#fbf3f2}
.meta{color:var(--mut);font-size:13px}
.sum,.why{background:#f6faf8;border-left:3px solid var(--acc);padding:8px 12px;margin:10px 0}
.sum b,.why b,.rev b{display:block;font-size:11px;color:var(--mut);text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px}
.why{background:#fafcfb;border-color:var(--line);margin:8px 0}
.was{margin:6px 0;color:var(--mut)}
.note{padding:8px 12px;margin:10px 0;border-left:3px solid var(--acc);background:var(--accbg)}.note.e{border-color:var(--err);background:#fbf3f2}
.secs{margin:8px 0 16px}.sec{display:grid;grid-template-columns:minmax(120px,1fr) 2fr 90px;gap:10px;align-items:center;padding:3px 0}
.bar{height:8px;background:#edf0ee;border-radius:4px;overflow:hidden}.bar i{display:block;height:100%;background:var(--acc)}
.sec .v{text-align:right;font-variant-numeric:tabular-nums}
.cr{border-top:1px solid var(--line);padding:12px 0}
.top{display:flex;gap:10px;align-items:baseline;justify-content:space-between}.top h3{margin:0;font-size:15px}
.sect{color:var(--mut);font-size:12px}
.badge{white-space:nowrap;padding:2px 9px;border-radius:10px;font-size:13px;font-weight:600;border:1px solid}
.badge.good{color:var(--acc);border-color:var(--acc);background:var(--accbg)}.badge.bad{color:var(--err);border-color:var(--err);background:#fbf3f2}
.badge.mid{color:var(--warn);border-color:var(--warn);background:#faf5ea}.badge.na{color:var(--mut);border-color:var(--line);background:#f4f6f5}
.pts{color:var(--mut);margin:2px 0 6px}
.rev{padding:8px 12px;margin:8px 0;border-left:3px solid}
.rev.yes{border-color:var(--acc);background:var(--accbg)}.rev.no{border-color:var(--err);background:#fbf3f2}.rev.wait{border-color:var(--warn);background:#faf5ea}
.pick{display:flex;gap:8px;align-items:center;margin-top:8px;font-weight:600;color:var(--acc);cursor:pointer}
.abox textarea{width:100%;margin-top:6px;padding:8px 9px;border:1px solid var(--line);border-radius:4px;font:inherit;resize:vertical}
.abar{position:sticky;bottom:0;display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;background:#fff;border-top:1px solid var(--line);padding:12px 0 0;margin-top:8px}
.aerr{color:var(--err);flex:1}
.chips{display:flex;flex-direction:column;gap:4px;margin-top:6px}
button.chip{text-align:left;background:#fafcfb;padding:5px 8px}
button.chip:hover{background:var(--accbg)}button.chip.rng{color:var(--mut);background:#fff}
.tr{position:sticky;top:12px;max-height:80vh;overflow:auto}
audio{width:100%;margin-bottom:10px}
.m{display:grid;grid-template-columns:28px 52px 70px 1fr;gap:6px;padding:5px 6px;border-left:3px solid transparent;border-bottom:1px solid #edf0ee;white-space:pre-wrap;word-break:break-word}
.m.operator{border-left-color:var(--acc);background:#f6faf8}.m.bot,.m.system{color:var(--mut);font-style:italic}
.m .n,.m .ts{color:var(--mut);font-variant-numeric:tabular-nums}.m .s{font-weight:600;font-style:normal}
.m.hl{background:#fff3c4;outline:2px solid #e0b400;outline-offset:-2px}
.err{color:var(--err);padding:8px 10px;border-left:3px solid var(--err);background:#fbf3f2}
`;

class CqaResult extends HTMLElement {
  static get observedAttributes() { return ['evaluation-id']; }
  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.ev = null; this.fin = null; this.conv = null; this.apps = []; this.err = null;
    this.mode = false; this.note = null; this.busy = false;
    this.root.addEventListener('click', e => this.onClick(e));
    this.root.addEventListener('change', e => this.onChange(e));
  }
  get apiBase() { return this.getAttribute('api-base') || ''; }
  get evaluation() { return this.ev; }
  set evaluation(v) { this.ev = v; this.mode = false; this.note = null; this.loadConv(); }
  attributeChangedCallback(n, o, v) { if (v && o !== v) this.loadById(v); }

  async get(path) {
    const r = await fetch(this.apiBase + path);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || 'HTTP ' + r.status);
    return d;
  }
  async loadById(id) {
    try { this.ev = await this.get('/api/evaluations/' + enc(id)); this.mode = false; await this.loadConv(); }
    catch (e) { this.err = e.message; this.render(); }
  }
  async loadAux() {
    const id = this.ev.id;
    try { this.fin = await this.get(`/api/evaluations/${enc(id)}/final`); } catch (_) { this.fin = null; }
    try { this.apps = await this.get(`/api/appeals?evaluation_id=${enc(id)}`); } catch (_) { this.apps = []; }
  }
  async loadConv() {
    this.err = null; this.conv = null;
    try { this.conv = await this.get('/api/conversations/' + enc(this.ev.conversation_id)); }
    catch (e) { this.err = 'Не удалось загрузить транскрипт: ' + e.message; }
    await this.loadAux();
    this.render();
  }

  appOf(id) {
    let best = null;
    for (const a of this.apps) for (const i of a.items) if (i.criterion_id === id) {
      if (a.status === 'pending') return { st: 'pending', i };
      best ||= { st: i.decision, i };
    }
    return best;
  }
  badge(k) {
    const l = lblOf(k.type, k.answer, k.value);
    if (k.answer === 'na') return ['na', l];
    if (k.type === 'flag') return [k.answer === 'yes' ? 'bad' : 'good', l];
    const r = k.effective_weight ? k.points / k.effective_weight : 0;
    return [r >= 0.999 ? 'good' : r <= 0 ? 'bad' : 'mid', l];
  }
  ptsLine(k) {
    if (k.answer === 'na') return `Исключён из расчёта, вес ${fmt(k.weight)} перераспределён между остальными.`;
    if (k.type === 'flag') return 'Баллов нет, отмечается отдельно.';
    const re = k.effective_weight !== k.weight ? `, после перераспределения ${fmt(k.effective_weight)}` : '';
    return `${fmt(k.points)} из ${fmt(k.effective_weight)} (вес ${fmt(k.weight)}${re})`;
  }

  render() {
    const e = this.fin || this.ev;
    if (this.err && !e) { this.root.innerHTML = `<style>${CSS}</style><p class="err">${esc(this.err)}</p>`; return; }
    if (!e) { this.root.innerHTML = ''; return; }
    const tr = this.conv?.transcript || [];
    const secs_ = e.sections.filter(s => s.applicable).map(s => `<div class="sec"><span>${esc(s.name)}</span>
      <div class="bar"><i style="width:${s.max ? Math.min(100, s.points / s.max * 100) : 0}%"></i></div>
      <span class="v">${fmt(s.points)} / ${fmt(s.max)}</span></div>`).join('');
    const crit = e.criteria.map(k => {
      const [cls, lbl] = this.badge(k), r = k.checked_range, ap = this.appOf(k.id);
      const chips = k.evidence.map(x => `<button class="chip" data-from="${x.index}" data-to="${x.index}">№${x.index + 1} · ${esc(x.timestamp)} · ${esc(SPK[x.speaker] || x.speaker)}: ${esc(short(x.text))}</button>`).join('');
      const rng = r && !k.evidence.length ? `<button class="chip rng" data-from="${r.from}" data-to="${r.to}">Проверенный участок: реплики ${r.from + 1}–${r.to + 1} (${esc(r.from_ts)} – ${esc(r.to_ts)})</button>` : '';
      let extra = '';
      if (k.changed) extra += `<div class="rev yes"><b>Оценка изменена после апелляции</b>Было: ${esc(lblOf(k.type, k.original.answer, k.original.value))}${k.original.points == null ? '' : ` (${fmt(k.original.points)} б.)`}, стало: ${esc(lbl)}. Решение проверяющего: ${esc(k.review?.reason || '')}</div>`;
      else if (ap?.st === 'reject') extra += `<div class="rev no"><b>Апелляция отклонена</b>${esc(ap.i.reason || '')}</div>`;
      if (ap?.st === 'pending') extra += `<div class="rev wait"><b>Апелляция на рассмотрении</b>${esc(ap.i.comment)}</div>`;
      const pick = this.mode && ap?.st !== 'pending' ? `<label class="pick"><input type="checkbox" data-pick="${esc(k.id)}"> Оспорить этот критерий</label>
        <div class="abox" data-box="${esc(k.id)}" hidden><textarea data-c="${esc(k.id)}" rows="3" placeholder="Почему вы не согласны с оценкой? Что, по-вашему, должно быть выставлено?"></textarea></div>` : '';
      return `<article class="cr"><div class="top"><div><h3>${esc(k.name)}</h3><span class="sect">${esc(k.section)}</span></div>
        <span class="badge ${cls}">${esc(lbl)}</span></div>
        <div class="pts">${esc(this.ptsLine(k))}</div>
        <div class="why"><b>Обоснование</b>${esc(k.explanation)}</div>
        <div class="chips">${chips}${rng}</div>${extra}${pick}</article>`;
    }).join('');
    const trHtml = tr.map((m, i) => `<div class="m ${esc(m.speaker)}" data-i="${i}"><span class="n">${i + 1}</span><span class="ts">${esc(m.timestamp)}</span><span class="s">${esc(SPK[m.speaker] || m.speaker)}</span><span>${esc(m.text)}</span></div>`).join('');
    const audio = this.conv?.audio_url ? `<audio controls preload="none" src="${esc(this.conv.audio_url)}"></audio>` : '';
    this.root.innerHTML = `<style>${CSS}</style><div class="wrap">
      <div class="panel">
        <div class="head"><div class="total">${e.total == null ? 'не рассчитан' : fmt(e.total)}<small> / ${fmt(e.max_total)}</small></div>
          <span class="pill ${e.gross_violation ? 'bad' : 'ok'}">${e.gross_violation ? 'Грубое нарушение выявлено' : 'Грубых нарушений не выявлено'}</span>
          ${this.mode ? '' : '<button class="btn" data-act="appeal">Оспорить оценку</button>'}</div>
        ${e.changed ? `<div class="was">Итог пересчитан по результатам апелляции. Исходный итог: <b>${e.original_total == null ? '—' : fmt(e.original_total)}</b>.</div>` : ''}
        ${this.note ? `<div class="note ${this.note.t}">${esc(this.note.s)}${this.note.link ? ' <a href="#/appeals">Открыть апелляции</a>' : ''}</div>` : ''}
        <div class="meta">Диалог ${esc(e.conversation_id)} · чек-лист «${esc(e.checklist_name)}», версия ${e.checklist_version} · модель ${esc(e.model || '')}</div>
        ${e.summary ? `<div class="sum"><b>Общий вывод</b>${esc(e.summary)}</div>` : ''}
        ${this.mode ? '<p class="meta">Отметьте критерии, с которыми вы не согласны, и опишите причину для каждого.</p>' : ''}
        <div class="secs">${secs_}</div>${crit}
        ${this.mode ? `<div class="abar"><span>Выбрано критериев: <b id="cnt">0</b></span><span class="aerr" id="aerr"></span>
          <button data-act="cancel">Отмена</button><button class="pri" data-act="submit">Отправить апелляцию</button></div>` : ''}</div>
      <div class="panel tr"><h2>Транскрипт</h2>${this.err ? `<p class="err">${esc(this.err)}</p>` : ''}${audio}${trHtml}</div></div>`;
  }

  onClick(e) {
    const b = e.target.closest('[data-from]');
    if (b) return this.goto(+b.dataset.from, +b.dataset.to);
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'appeal') { this.mode = true; this.note = null; this.render(); }
    else if (a === 'cancel') { this.mode = false; this.render(); }
    else if (a === 'submit') this.submit();
  }
  onChange(e) {
    const t = e.target;
    if (t.dataset.pick === undefined) return;
    const box = this.root.querySelector(`[data-box="${t.dataset.pick}"]`);
    box.hidden = !t.checked;
    if (t.checked) box.querySelector('textarea').focus();
    this.root.getElementById('cnt').textContent = this.root.querySelectorAll('[data-pick]:checked').length;
  }
  async submit() {
    if (this.busy) return;
    const err = this.root.getElementById('aerr'); err.textContent = '';
    const items = [...this.root.querySelectorAll('[data-pick]:checked')].map(c => ({
      criterion_id: c.dataset.pick, comment: this.root.querySelector(`[data-c="${c.dataset.pick}"]`).value.trim() }));
    if (!items.length) { err.textContent = 'Выберите хотя бы один критерий.'; return; }
    if (items.some(i => i.comment.length < 5)) { err.textContent = 'Опишите причину для каждого выбранного критерия (от 5 символов).'; return; }
    this.busy = true;
    try {
      const res = await fetch(this.apiBase + '/api/appeals', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ evaluation_id: this.ev.id, items }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(Array.isArray(d.detail) ? d.detail.map(x => x.msg).join('; ') : d.detail || 'HTTP ' + res.status);
      this.mode = false;
      this.note = { t: 'o', s: 'Апелляция отправлена. Проверяющий рассмотрит её на вкладке «Апелляции».', link: true };
      await this.loadAux(); this.render();
      this.dispatchEvent(new CustomEvent('cqa-appeal-submitted', { bubbles: true, composed: true, detail: d }));
    } catch (x) { err.textContent = 'Не удалось отправить: ' + x.message; }
    this.busy = false;
  }

  goto(a, b) {
    const box = this.root.querySelector('.tr');
    box.querySelectorAll('.hl').forEach(x => x.classList.remove('hl'));
    let first = null;
    for (let i = a; i <= b; i++) { const el = box.querySelector(`[data-i="${i}"]`); if (el) { el.classList.add('hl'); first ||= el; } }
    first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const au = box.querySelector('audio'), tr = this.conv?.transcript;
    if (au && tr) { const off = secs(tr[a].timestamp) - secs(tr[0].timestamp); if (isFinite(off) && off >= 0) au.currentTime = off; }
  }
}
customElements.define('cqa-result', CqaResult);
})();