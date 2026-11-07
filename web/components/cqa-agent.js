/* <cqa-agent api-base="">
 * Floating AI helper for the checklist constructor. The user's request goes to POST /api/agent/checklist
 * (with the constructor's current state unless "from scratch" is chosen); the returned draft is loaded into
 * the sibling <cqa-checklist-editor> as unsaved changes, so nothing is stored until the user saves.
 */
(() => {
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EXAMPLES = [
  'Добавь критерий «Вежливость» с весом 10, остальные веса уменьши пропорционально',
  'Составь чек-лист для звонков продаж: 6 критериев и флаг грубых ошибок',
  'Разреши N/A для «Идентификации», если клиент задаёт общий вопрос',
];

const CSS = `
:host{font:15px/1.5 "Segoe UI",system-ui,-apple-system,Roboto,sans-serif;color:#191919}
*{box-sizing:border-box}
.fab{position:fixed;right:24px;bottom:24px;z-index:50;display:flex;align-items:center;gap:10px;padding:5px 18px 5px 5px;border:0;border-radius:999px;cursor:pointer;
  background:linear-gradient(135deg,#2a8640,#4fb84e);color:#fff;font:700 15px/1 inherit;box-shadow:0 6px 18px #2a864066;transition:transform .15s}
.fab{transition:transform .15s,background-color .35s,box-shadow .35s,padding .35s,gap .35s}
.lbl{display:inline-block;overflow:hidden;white-space:nowrap;max-width:140px;transition:max-width .35s,opacity .25s}
.fab.mini{padding:0;gap:0;background:transparent;box-shadow:none}.fab.mini .lbl{max-width:0;opacity:0}
.fab.mini .ava{background:transparent}.fab.mini .ava img{width:58px;height:58px;filter:drop-shadow(0 4px 8px #00000055)}
.ava img{transition:width .35s,height .35s}
.fab:hover{transform:translateY(-2px)}.fab:focus-visible{outline:3px solid #191919;outline-offset:3px}
.ava{position:relative;width:50px;height:50px;border-radius:50%;background:#fff;display:grid;place-items:center;flex:none}
.ava img{width:44px;height:44px;object-fit:contain}
.fab.busy .ava::after{content:"";position:absolute;inset:-4px;border-radius:50%;border:3px solid #fff;border-top-color:transparent;animation:spin 1s linear infinite}
.hd .ava{width:30px;height:30px;background:#e8f5e9}.hd .ava img{width:26px;height:26px}.hd span{display:flex;align-items:center;gap:8px}
@keyframes spin{to{transform:rotate(360deg)}}
.panel{position:fixed;right:24px;bottom:90px;z-index:50;width:min(400px,calc(100vw - 32px));max-height:calc(100vh - 120px);overflow:auto;
  background:#fff;border:1px solid #e1e4e8;border-radius:14px;box-shadow:0 12px 40px #0000002e;padding:16px}
.panel[hidden]{display:none}
.hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}.hd b{font-size:16px}
.x{border:0;background:none;font-size:22px;line-height:1;cursor:pointer;color:#5c5c5c}
.sub{color:#5c5c5c;font-size:13px;margin:0 0 10px}
.ex{display:flex;flex-direction:column;gap:6px;margin-bottom:10px}
.ex button{text-align:left;font:inherit;font-size:13px;border:1px solid #e1e4e8;background:#f8f9fa;border-radius:8px;padding:6px 9px;cursor:pointer}
.ex button:hover{border-color:#2a8640;background:#e8f5e9}
textarea{width:100%;min-height:92px;resize:vertical;font:inherit;padding:9px 10px;border:1px solid #e1e4e8;border-radius:8px}
textarea:focus-visible{outline:2px solid #2a8640;outline-offset:1px}
.row{display:flex;gap:10px;align-items:center;justify-content:space-between;margin-top:10px;flex-wrap:wrap}
label{display:flex;gap:6px;align-items:center;font-size:13px;color:#5c5c5c;cursor:pointer}
.go{font:inherit;font-weight:600;border:0;border-radius:8px;padding:8px 16px;background:#2a8640;color:#fff;cursor:pointer}
.go:disabled{opacity:.5;cursor:default}.stop{font:inherit;border:1px solid #e1e4e8;background:#fff;border-radius:8px;padding:7px 12px;cursor:pointer}
.st{margin-top:12px;padding:9px 11px;border-radius:8px;font-size:14px}
.st.wait{background:#f1f2f4;color:#5c5c5c}.st.ok{background:#e8f5e9;border-left:3px solid #2a8640}.st.e{background:#fdecec;color:#d32f2f;border-left:3px solid #d32f2f}
`;

class CqaAgent extends HTMLElement {
  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.ctrl = null; this.timer = null; this.idle = null;
  }
  get apiBase() { return this.getAttribute('api-base') || ''; }
  get editor() { return this.parentNode?.querySelector('cqa-checklist-editor'); }
  $(s) { return this.root.querySelector(s); }

  connectedCallback() {
    this.root.innerHTML = `<style>${CSS}</style>
      <div class="panel" id="panel" role="dialog" aria-label="AI-помощник по чек-листу" hidden>
        <div class="hd"><span><span class="ava"><img src="${esc(this.apiBase)}/assets/mascot.png" alt=""></span><b>AI-помощник</b></span><button class="x" data-act="close" aria-label="Закрыть">×</button></div>
        <p class="sub">Опишите, какой чек-лист нужен или что изменить. Результат появится в конструкторе как черновик, сохраните его сами.</p>
        <div class="ex">${EXAMPLES.map(x => `<button data-ex="${esc(x)}">${esc(x)}</button>`).join('')}</div>
        <textarea id="q" maxlength="2000" placeholder="Например: убери критерий «Завершение», его вес отдай «Эмпатии»"></textarea>
        <div class="row"><label><input type="checkbox" id="cur" checked> Изменить текущий чек-лист</label>
          <span><button class="stop" data-act="stop" hidden>Отменить</button> <button class="go" data-act="go">Составить</button></span></div>
        <div id="st"></div>
      </div>
      <button class="fab" data-act="toggle" aria-label="AI-помощник по чек-листу" aria-expanded="false"><span class="ava"><img src="${esc(this.apiBase)}/assets/mascot.png" alt=""></span><span class="lbl">AI-помощник</span></button>`;
    this.root.addEventListener('click', e => this.onClick(e));
    const fab = this.$('.fab');
    for (const ev of ['pointerenter', 'pointerleave', 'focus']) fab.addEventListener(ev, () => this.wake());
    this.wake();
    this.$('#q').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) this.send(); });
    this.root.addEventListener('keydown', e => { if (e.key === 'Escape') this.toggle(false); });
  }
  disconnectedCallback() { this.ctrl?.abort(); clearInterval(this.timer); clearTimeout(this.idle); }
  wake() {  // after 6 s without touching it only the bird stays; it never shrinks while open or busy
    this.$('.fab').classList.remove('mini');
    clearTimeout(this.idle);
    this.idle = setTimeout(() => { const f = this.$('.fab'); if (this.$('#panel').hidden && !this.ctrl && !f.matches(':hover')) f.classList.add('mini'); else this.wake(); }, 6000);
  }

  onClick(e) {
    const ex = e.target.closest('[data-ex]');
    if (ex) { this.$('#q').value = ex.dataset.ex; this.$('#q').focus(); return; }
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'toggle') this.toggle();
    else if (a === 'close') this.toggle(false);
    else if (a === 'go') this.send();
    else if (a === 'stop') this.ctrl?.abort();
  }
  toggle(open = this.$('#panel').hidden) {
    this.$('#panel').hidden = !open;
    this.$('.fab').setAttribute('aria-expanded', String(open));
    if (open) this.$('#q').focus();
    this.wake();
  }
  status(cls, html) { this.$('#st').innerHTML = html ? `<div class="st ${cls}">${html}</div>` : ''; }
  busy(on) {
    this.$('.go').disabled = on; this.$('[data-act=stop]').hidden = !on; this.$('.fab').classList.toggle('busy', on);
    clearInterval(this.timer);
    if (on) {
      const t0 = Date.now(), tick = () => this.status('wait', `Модель составляет чек-лист… ${Math.round((Date.now() - t0) / 1000)} с. Обычно это 1–3 минуты.`);
      tick(); this.timer = setInterval(tick, 1000);
    }
  }

  async send() {
    const prompt = this.$('#q').value.trim(), ed = this.editor;
    if (this.ctrl) return;
    if (prompt.length < 3) return this.status('e', 'Опишите, что нужно сделать.');
    if (!ed?.checklist) return this.status('e', 'Конструктор ещё не загрузился.');
    this.ctrl = new AbortController(); this.busy(true);
    try {
      const r = await fetch(this.apiBase + '/api/agent/checklist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: this.ctrl.signal,
        body: JSON.stringify({ prompt, current: this.$('#cur').checked ? ed.checklist : null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(Array.isArray(d.detail) ? d.detail.map(x => x.msg).join('; ') : d.detail || 'HTTP ' + r.status);
      ed.applyDraft(d.checklist);
      const n = d.checklist.criteria.length;
      this.status('ok', `<b>Готово.</b> ${esc(d.notes)}<br>Критериев: ${n}, сумма весов: ${d.weight_sum}. Черновик загружен в конструктор.`);
    } catch (e) {
      this.status('e', e.name === 'AbortError' ? 'Запрос отменён.' : esc(e.message));
    } finally {
      this.ctrl = null; this.busy(false); this.wake();
      if (this.$('#st .wait')) this.status('', '');
    }
  }
}
customElements.define('cqa-agent', CqaAgent);
})();
