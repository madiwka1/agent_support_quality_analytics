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
:host{display:block;font:15px/1.5 "Inter","Segoe UI",system-ui,-apple-system,Roboto,sans-serif;color:#13231a}
*{box-sizing:border-box}
audio{width:100%;margin:0 0 10px}
.aerr{color:#d32f2f;font-size:13px;margin:-4px 0 10px}
.chat{display:flex;flex-direction:column;gap:8px;padding:14px;background:#eef3f0;border:1px solid #dbe5df;border-radius:20px;box-shadow:inset 0 1px 3px #0000000d;max-height:var(--chat-h,70vh);overflow:auto}
.msg{max-width:82%;padding:9px 14px 10px;border-radius:18px;box-shadow:0 1px 2px #0b2a1c0f;background:#fff;border:1px solid #e3e9e5;white-space:pre-wrap;word-break:break-word;align-self:flex-start}
.msg.client{border-bottom-left-radius:4px}
.msg.bot{border-bottom-left-radius:4px;background:#f1f2f4;color:#5c5c5c}
.msg.operator{align-self:flex-end;border-bottom-right-radius:4px;background:#e7f6ec;border-color:#bfe3c4}
.msg.system{align-self:center;max-width:90%;padding:3px 12px;border-radius:999px;background:transparent;border-color:transparent;color:#5c5c5c;font-size:13px;text-align:center}
.who{display:flex;gap:8px;align-items:baseline;font-size:12px;color:#5c5c5c;margin-bottom:2px}.who b{color:#13231a}
.msg.operator .who b{color:#178a3f}
.has-audio .msg{cursor:pointer}.has-audio .msg:hover{border-color:#178a3f}
.msg.now{box-shadow:0 0 0 2px #43b75c}
.msg.hl{background:#fff3c4;border-color:#e0b400;box-shadow:0 0 0 2px #e0b400}
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
