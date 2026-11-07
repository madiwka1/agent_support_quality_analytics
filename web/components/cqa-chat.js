/* <cqa-chat api-base="">
 * Transcript as a chat: client and bot on the left, operator on the right, system events centred.
 * Clicking a message seeks the call audio to it and plays; the message being heard is marked while playing.
 * Property: element.conversation = {conversation_id, transcript, audio_url}. Method: highlight(from, to).
 */
(() => {
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SPK = { client: 'Клиент', operator: 'Оператор', bot: 'Бот', system: 'Система' };
const secs = t => {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t || '');
  if (m) return m[3] !== undefined ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
  const d = Date.parse(t); return isNaN(d) ? NaN : d / 1000;
};
const mmss = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const CSS = `
:host{display:block;font:15px/1.5 "Segoe UI",system-ui,-apple-system,Roboto,sans-serif;color:#191919}
*{box-sizing:border-box}
audio{width:100%;margin:0 0 10px}
.aerr{color:#d32f2f;font-size:13px;margin:-4px 0 10px}
.chat{display:flex;flex-direction:column;gap:8px;padding:14px;background:#eceef0;border:1px solid #d0d5db;border-radius:12px;box-shadow:inset 0 1px 3px #0000000d;max-height:var(--chat-h,70vh);overflow:auto}
.msg{max-width:82%;padding:8px 12px 9px;border-radius:14px;background:#fff;border:1px solid #e1e4e8;white-space:pre-wrap;word-break:break-word;align-self:flex-start}
.msg.client{border-bottom-left-radius:4px}
.msg.bot{border-bottom-left-radius:4px;background:#f1f2f4;color:#5c5c5c}
.msg.operator{align-self:flex-end;border-bottom-right-radius:4px;background:#e8f5e9;border-color:#bfe3c4}
.msg.system{align-self:center;max-width:90%;padding:3px 12px;border-radius:999px;background:transparent;border-color:transparent;color:#5c5c5c;font-size:13px;text-align:center}
.who{display:flex;gap:8px;align-items:baseline;font-size:12px;color:#5c5c5c;margin-bottom:2px}.who b{color:#191919}
.msg.operator .who b{color:#2a8640}
.has-audio .msg{cursor:pointer}.has-audio .msg:hover{border-color:#2a8640}
.msg.now{box-shadow:0 0 0 2px #4fb84e}
.msg.hl{background:#fff3c4;border-color:#e0b400;box-shadow:0 0 0 2px #e0b400}
`;

class CqaChat extends HTMLElement {
  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.conv = null; this.offs = [];
    this.root.addEventListener('click', e => {
      const m = e.target.closest('.msg');
      if (m) this.seek(+m.dataset.i, true);
    });
  }
  get apiBase() { return this.getAttribute('api-base') || ''; }
  set conversation(c) { this.conv = c; this.render(); }
  get conversation() { return this.conv; }

  render() {
    const c = this.conv, tr = c?.transcript || [];
    const t0 = secs(tr[0]?.timestamp);
    this.offs = tr.map(m => secs(m.timestamp) - t0);
    const audio = c?.audio_url && c.conversation_id
      ? `<audio controls preload="metadata" src="${esc(this.apiBase)}/api/conversations/${encodeURIComponent(c.conversation_id)}/audio"></audio>` : '';
    const ts = (m, i) => /^\d{1,2}:\d{2}/.test(m.timestamp || '') || !isFinite(this.offs[i]) ? esc(m.timestamp) : mmss(Math.max(this.offs[i], 0));
    const msgs = tr.map((m, i) => m.speaker === 'system'
      ? `<div class="msg system" data-i="${i}">${ts(m, i)} · ${esc(m.text)}</div>`
      : `<div class="msg ${esc(m.speaker)}" data-i="${i}"><div class="who"><b>${esc(SPK[m.speaker] || m.speaker)}</b><span>${ts(m, i)} · №${i + 1}</span></div>${esc(m.text)}</div>`).join('');
    this.root.innerHTML = `<style>${CSS}</style>${audio}<div class="aerr" hidden></div><div class="chat ${audio ? 'has-audio' : ''}">${msgs}</div>`;
    const au = this.root.querySelector('audio');
    if (au) {
      au.addEventListener('timeupdate', () => this.markNow(au.currentTime));
      au.addEventListener('error', () => {
        const e = this.root.querySelector('.aerr'); e.hidden = false; e.textContent = 'Не удалось загрузить запись звонка.';
      });
    }
  }
  markNow(t) {
    let cur = -1;
    this.offs.forEach((o, i) => { if (o <= t + 0.25) cur = i; });
    this.root.querySelectorAll('.msg.now').forEach(x => x.classList.remove('now'));
    this.root.querySelector(`.msg[data-i="${cur}"]`)?.classList.add('now');
  }
  seek(i, play = false) {
    const au = this.root.querySelector('audio'), off = this.offs[i];
    if (!au || !isFinite(off)) return;
    au.currentTime = Math.max(off, 0);
    if (play) au.play().catch(() => {});
  }
  highlight(a, b) {
    this.root.querySelectorAll('.hl').forEach(x => x.classList.remove('hl'));
    let first = null;
    for (let i = a; i <= b; i++) { const el = this.root.querySelector(`.msg[data-i="${i}"]`); if (el) { el.classList.add('hl'); first ||= el; } }
    first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    this.seek(a);
  }
}
customElements.define('cqa-chat', CqaChat);
})();
