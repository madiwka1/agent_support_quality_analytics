/* <cqa-result api-base="" evaluation-id="">
 * Shows an evaluation: total, gross-violation flag, section scores, per-criterion answer / points /
 * explanation / evidence, plus the transcript. Evidence chips jump to the message (and seek the audio for calls).
 * Property: element.evaluation = {...} (response of POST /api/evaluations), or set attribute evaluation-id.
 */
(() => {
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => String(Math.round(n * 100) / 100);
const SPK = { client: 'Клиент', operator: 'Оператор', bot: 'Бот', system: 'Система' };
const secs = t => {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t || '');
  if (m) return m[3] !== undefined ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
  const d = Date.parse(t); return isNaN(d) ? NaN : d / 1000;
};
const short = (t, n = 90) => t.length > n ? t.slice(0, n) + '…' : t;

const CSS = `
:host{display:block;font:14px/1.45 "Segoe UI",system-ui,sans-serif;color:#17211c;--line:#d8dfdb;--mut:#5b6962;--acc:#14633f;--accbg:#e4f1ea;--err:#b3261e;--warn:#8a5300}
*{box-sizing:border-box}
.wrap{display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:20px;align-items:start;margin-top:20px}
@media(max-width:900px){.wrap{grid-template-columns:1fr}}
.panel{background:#fff;border:1px solid var(--line);border-radius:6px;padding:16px}
h2{margin:0 0 10px;font-size:16px;font-weight:600}
.head{display:flex;flex-wrap:wrap;gap:12px 24px;align-items:center;margin-bottom:12px}
.total{font-size:34px;font-weight:700;color:var(--acc)}.total small{font-size:16px;color:var(--mut);font-weight:400}
.pill{padding:3px 10px;border-radius:12px;font-size:13px;border:1px solid}
.pill.ok{color:var(--acc);border-color:var(--acc);background:var(--accbg)}.pill.bad{color:var(--err);border-color:var(--err);background:#fbf3f2}
.meta{color:var(--mut);font-size:13px}
.secs{margin:8px 0 16px}.sec{display:grid;grid-template-columns:minmax(120px,1fr) 2fr 90px;gap:10px;align-items:center;padding:3px 0}
.bar{height:8px;background:#edf0ee;border-radius:4px;overflow:hidden}.bar i{display:block;height:100%;background:var(--acc)}
.sec .v{text-align:right;font-variant-numeric:tabular-nums}
.cr{border-top:1px solid var(--line);padding:12px 0}
.top{display:flex;gap:10px;align-items:baseline;justify-content:space-between}.top h3{margin:0;font-size:15px}
.sect{color:var(--mut);font-size:12px}
.badge{white-space:nowrap;padding:2px 9px;border-radius:10px;font-size:13px;font-weight:600;border:1px solid}
.badge.good{color:var(--acc);border-color:var(--acc);background:var(--accbg)}.badge.bad{color:var(--err);border-color:var(--err);background:#fbf3f2}
.badge.mid{color:var(--warn);border-color:var(--warn);background:#faf5ea}.badge.na{color:var(--mut);border-color:var(--line);background:#f4f6f5}
.pts{color:var(--mut);margin:2px 0 6px}.cr p{margin:6px 0}
.chips{display:flex;flex-direction:column;gap:4px;margin-top:6px}
button.chip{font:inherit;text-align:left;cursor:pointer;border:1px solid var(--line);background:#fafcfb;border-radius:4px;padding:5px 8px;color:inherit}
button.chip:hover{border-color:var(--acc);background:var(--accbg)}
button.chip.rng{color:var(--mut);background:#fff}
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
    this.ev = null; this.conv = null; this.err = null;
    this.root.addEventListener('click', e => {
      const b = e.target.closest('[data-from]');
      if (b) this.goto(+b.dataset.from, +b.dataset.to);
    });
  }
  get apiBase() { return this.getAttribute('api-base') || ''; }
  get evaluation() { return this.ev; }
  set evaluation(v) { this.ev = v; this.loadConv(); }
  attributeChangedCallback(n, o, v) { if (v && o !== v) this.loadById(v); }

  async get(path) {
    const r = await fetch(this.apiBase + path);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || 'HTTP ' + r.status);
    return d;
  }
  async loadById(id) {
    try { this.ev = await this.get('/api/evaluations/' + encodeURIComponent(id)); await this.loadConv(); }
    catch (e) { this.err = e.message; this.render(); }
  }
  async loadConv() {
    this.err = null; this.conv = null;
    try { this.conv = await this.get('/api/conversations/' + encodeURIComponent(this.ev.conversation_id)); }
    catch (e) { this.err = 'Не удалось загрузить транскрипт: ' + e.message; }
    this.render();
  }

  badge(k) {
    if (k.answer === 'na') return ['na', 'N/A'];
    if (k.type === 'flag') return k.answer === 'yes' ? ['bad', 'Нарушение выявлено'] : ['good', 'Не выявлено'];
    const r = k.effective_weight ? k.points / k.effective_weight : 0;
    const cls = r >= 0.999 ? 'good' : r <= 0 ? 'bad' : 'mid';
    return [cls, k.type === 'scale' ? `${fmt(k.value)} по шкале` : (k.answer === 'yes' ? 'Да' : 'Нет')];
  }
  ptsLine(k) {
    if (k.answer === 'na') return `Исключён из расчёта, вес ${fmt(k.weight)} перераспределён между остальными.`;
    if (k.type === 'flag') return 'Баллов нет, отмечается отдельно.';
    const re = k.effective_weight !== k.weight ? `, после перераспределения ${fmt(k.effective_weight)}` : '';
    return `${fmt(k.points)} из ${fmt(k.effective_weight)} (вес ${fmt(k.weight)}${re})`;
  }
  render() {
    const e = this.ev;
    if (this.err && !e) { this.root.innerHTML = `<style>${CSS}</style><p class="err">${esc(this.err)}</p>`; return; }
    if (!e) { this.root.innerHTML = ''; return; }
    const tr = this.conv?.transcript || [];
    const secs_ = e.sections.filter(s => s.applicable).map(s => `<div class="sec"><span>${esc(s.name)}</span>
      <div class="bar"><i style="width:${s.max ? Math.min(100, s.points / s.max * 100) : 0}%"></i></div>
      <span class="v">${fmt(s.points)} / ${fmt(s.max)}</span></div>`).join('');
    const crit = e.criteria.map(k => {
      const [cls, lbl] = this.badge(k), r = k.checked_range;
      const chips = k.evidence.map(x => `<button class="chip" data-from="${x.index}" data-to="${x.index}">№${x.index + 1} · ${esc(x.timestamp)} · ${esc(SPK[x.speaker] || x.speaker)}: ${esc(short(x.text))}</button>`).join('');
      const rng = r && !k.evidence.length ? `<button class="chip rng" data-from="${r.from}" data-to="${r.to}">Проверенный участок: реплики ${r.from + 1}–${r.to + 1} (${esc(r.from_ts)} – ${esc(r.to_ts)})</button>` : '';
      return `<article class="cr"><div class="top"><div><h3>${esc(k.name)}</h3><span class="sect">${esc(k.section)}</span></div>
        <span class="badge ${cls}">${esc(lbl)}</span></div>
        <div class="pts">${esc(this.ptsLine(k))}</div><p>${esc(k.explanation)}</p>
        <div class="chips">${chips}${rng}</div></article>`;
    }).join('');
    const trHtml = tr.map((m, i) => `<div class="m ${esc(m.speaker)}" data-i="${i}"><span class="n">${i + 1}</span><span class="ts">${esc(m.timestamp)}</span><span class="s">${esc(SPK[m.speaker] || m.speaker)}</span><span>${esc(m.text)}</span></div>`).join('');
    const audio = this.conv?.audio_url ? `<audio controls preload="none" src="${esc(this.conv.audio_url)}"></audio>` : '';
    this.root.innerHTML = `<style>${CSS}</style><div class="wrap">
      <div class="panel">
        <div class="head"><div class="total">${e.total == null ? 'не рассчитан' : fmt(e.total)}<small> / ${fmt(e.max_total)}</small></div>
          <span class="pill ${e.gross_violation ? 'bad' : 'ok'}">${e.gross_violation ? 'Грубое нарушение выявлено' : 'Грубых нарушений не выявлено'}</span></div>
        <div class="meta">Диалог ${esc(e.conversation_id)} · чек-лист «${esc(e.checklist_name)}», версия ${e.checklist_version} · модель ${esc(e.model || '')}</div>
        <div class="secs">${secs_}</div>${crit}</div>
      <div class="panel tr"><h2>Транскрипт</h2>${this.err ? `<p class="err">${esc(this.err)}</p>` : ''}${audio}${trHtml}</div></div>`;
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
