/* <cqa-schedule api-base="">
 * Card for scheduled auto-evaluation: on/off, daily time, dataset and group_id (saved on change),
 * "run now", live progress while a run is going and the result of the last run. API: /api/schedule.
 */
(() => {
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dt = s => {
  if (!s) return '';
  const d = new Date(s), today = new Date(), tm = d.toTimeString().slice(0, 5);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return `сегодня в ${tm}`;
  if (d.toDateString() === tomorrow.toDateString()) return `завтра в ${tm}`;
  return `${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} в ${tm}`;
};
const plural = (n, one, few, many) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many}`;

const CSS = `
:host{display:block;font:15px/1.55 "Inter","Segoe UI",system-ui,-apple-system,Roboto,sans-serif;color:#13231a}
*{box-sizing:border-box}
.wrap{max-width:1100px;margin:0 auto;padding:22px 16px 0}
.card{background:#fff;border:1px solid #e3e9e5;border-radius:20px;padding:16px 20px;box-shadow:0 2px 4px #0b2a1c0a,0 12px 32px #0b2a1c0f}
.top{display:flex;flex-wrap:wrap;gap:12px 20px;align-items:center;justify-content:space-between}
h2{margin:0;font-size:17px;font-weight:700;color:#0b2a1c}.sub{margin:2px 0 0;color:#5c5c5c;font-size:13px}
.sw{display:inline-flex;align-items:center;gap:10px;cursor:pointer;font-weight:600;user-select:none}
.sw input{position:absolute;opacity:0;pointer-events:none}
.sw i{width:44px;height:24px;border-radius:999px;background:#cfd8d2;position:relative;transition:background .2s;flex:none}
.sw i::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #0003;transition:left .2s}
.sw input:checked+i{background:#178a3f}.sw input:checked+i::after{left:23px}
.sw input:focus-visible+i{outline:2px solid #178a3f;outline-offset:2px}
.row{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:flex-end;margin-top:12px}
label.f{display:flex;flex-direction:column;gap:3px;font-size:13px;color:#5c5c5c}
input[type=time],select,input[type=text]{font:inherit;color:#13231a;padding:7px 10px;border:1px solid #e3e9e5;border-radius:12px;background:#fff}
input[type=text]{width:150px}
button{font:inherit;font-weight:600;cursor:pointer;border-radius:999px;padding:8px 18px;border:0;background:linear-gradient(135deg,#178a3f,#43b75c);color:#fff;box-shadow:0 6px 16px #178a3f40}
button:disabled{opacity:.5;cursor:default;box-shadow:none}
.st{margin-top:12px;display:flex;flex-wrap:wrap;gap:6px 22px;font-size:14px;color:#5c5c5c}.st b{color:#13231a}
.ok{color:#178a3f}.bad{color:#d32f2f}
.bar{height:8px;border-radius:999px;background:#eceef0;overflow:hidden;margin-top:10px}.bar i{display:block;height:100%;background:linear-gradient(90deg,#178a3f,#43b75c);transition:width .4s}
`;

class CqaSchedule extends HTMLElement {
  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.s = null; this.err = null; this.timer = null;
    this.root.addEventListener('change', e => this.save(e));
    this.root.addEventListener('click', e => { if (e.target.closest('[data-act=run]')) this.runNow(); });
  }
  get apiBase() { return this.getAttribute('api-base') || ''; }
  connectedCallback() { this.load(); }
  disconnectedCallback() { clearTimeout(this.timer); }

  async api(method = 'GET', path = '', body) {
    const r = await fetch(this.apiBase + '/api/schedule' + path, {
      method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(Array.isArray(d.detail) ? d.detail.map(x => x.msg).join('; ') : d.detail || 'HTTP ' + r.status);
    return d;
  }
  async load() {
    try { this.s = await this.api(); this.err = null; } catch (e) { this.err = e.message; }
    this.render(); this.poll();
  }
  poll() {  // every 3 s while a run is going, otherwise once a minute (to notice the nightly run)
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.load(), this.s?.running ? 3000 : 60000);
  }
  async save(e) {
    if (!e.target.closest('[data-k]')) return;
    const v = k => this.root.querySelector(`[data-k=${k}]`);
    const body = { enabled: v('enabled').checked, time: v('time').value || '02:00', dataset: v('dataset').value,
                   group_id: v('group_id').value.trim() || 'DEV' };
    try { this.s = await this.api('PUT', '', body); this.err = null; } catch (x) { this.err = 'Не удалось сохранить: ' + x.message; }
    this.render();
  }
  async runNow() {
    try { this.s = await this.api('POST', '/run'); this.err = null; } catch (x) { this.err = x.message; }
    this.render(); this.poll();
  }

  lastLine(l) {
    if (!l) return 'ещё не запускалась';
    const when = dt(l.finished || l.started), how = l.trigger === 'auto' ? 'по расписанию' : 'вручную';
    if (l.status === 'error') return `<span class="bad">${when}, ${how}: ошибка — ${esc(l.message)}</span>`;
    if (!l.evaluated && !l.errors) return `${when}, ${how}: новых диалогов не было`;
    return `${when}, ${how}: оценено ${plural(l.evaluated, 'новый диалог', 'новых диалога', 'новых диалогов')}`
      + (l.errors ? `, <span class="bad">с ошибкой ${l.errors}</span>` : ', <span class="ok">без ошибок</span>');
  }
  render() {
    const s = this.s;
    if (!s) { this.root.innerHTML = `<style>${CSS}</style><div class="wrap"><div class="card"><span class="bad">${esc(this.err || 'Загружаю…')}</span></div></div>`; return; }
    const p = s.progress, pct = p.total ? Math.round(p.done / p.total * 100) : 0;
    const opt = (v, l) => `<option value="${v}" ${s.dataset === v ? 'selected' : ''}>${l}</option>`;
    this.root.innerHTML = `<style>${CSS}</style><div class="wrap"><div class="card">
      <div class="top"><div><h2>Автоматическая оценка по расписанию</h2>
        <p class="sub">Каждый день загружает набор диалогов и оценивает новые по базовому чек-листу, по одному, не мешая работе в интерфейсе.</p></div>
        <label class="sw"><input type="checkbox" data-k="enabled" ${s.enabled ? 'checked' : ''}><i></i>${s.enabled ? 'Включена' : 'Выключена'}</label></div>
      <div class="row">
        <label class="f">Каждый день в<input type="time" data-k="time" value="${esc(s.time)}"></label>
        <label class="f">Набор<select data-k="dataset">${opt('dev', 'DEV (разработка)')}${opt('prod', 'Контрольный')}</select></label>
        <label class="f">ID набора<input type="text" data-k="group_id" value="${esc(s.group_id)}" maxlength="100"></label>
        <button data-act="run" ${s.running ? 'disabled' : ''}>${s.running ? 'Идёт оценка…' : 'Запустить сейчас'}</button>
      </div>
      ${s.running ? `<div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>` : ''}
      <div class="st">
        ${s.running ? `<span>Оценивается: <b>${p.total ? `${p.done} из ${p.total}` : 'загрузка набора…'}</b>${p.current ? ` · последний ${esc(p.current)}` : ''}</span>`
          : `<span>Следующий запуск: <b>${s.enabled ? dt(s.next_run) : '—'}</b></span>`}
        <span>Последний запуск: ${this.lastLine(s.last_run)}</span>
        ${s.source === 'saved' ? '<span>Источник: сохранённый набор</span>' : ''}
        ${this.err ? `<span class="bad">${esc(this.err)}</span>` : ''}
      </div></div></div>`;
  }
}
customElements.define('cqa-schedule', CqaSchedule);
})();
