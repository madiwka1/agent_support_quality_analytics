/* <cqa-checklist-picker api-base="">
 * Dropdowns for the scoring screen: which checklist (and which version) to apply.
 * Event "cqa-checklist-selected": detail = {checklist_id, version, name, pinned}
 *   version is always resolved to a number; pinned=false means "follow the latest".
 * Property: element.value returns the same object.
 * Send checklist_id + version with the evaluate request and store both on the evaluation.
 */
(() => {
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KEY = 'cqa.checklist';

class CqaChecklistPicker extends HTMLElement {
  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.lists = []; this.versions = []; this.cid = null; this.pin = null;
    this.onExternal = () => this.refresh();
    this.root.addEventListener('change', e => this.onChange(e));
  }
  get apiBase() { return this.getAttribute('api-base') || ''; }
  get ver() { return this.pin ?? this.versions[0]?.version ?? null; }
  get value() {
    const l = this.lists.find(x => x.id === this.cid);
    return this.cid ? { checklist_id: this.cid, version: this.ver, name: l?.name, pinned: this.pin !== null } : null;
  }
  connectedCallback() {
    document.addEventListener('cqa-checklist-saved', this.onExternal);
    document.addEventListener('cqa-checklists-changed', this.onExternal);
    try { const s = JSON.parse(localStorage.getItem(KEY) || '{}'); this.cid = s.cid ?? null; this.pin = s.pin ?? null; } catch (_) {}
    this.refresh();
  }
  disconnectedCallback() {
    document.removeEventListener('cqa-checklist-saved', this.onExternal);
    document.removeEventListener('cqa-checklists-changed', this.onExternal);
  }
  async get(path) {
    const r = await fetch(this.apiBase + path);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  async refresh() {
    try {
      this.lists = await this.get('/api/checklists');
      if (!this.lists.some(l => l.id === this.cid)) { this.cid = this.lists[0]?.id ?? null; this.pin = null; }
      this.versions = this.cid ? await this.get(`/api/checklists/${this.cid}/versions`) : [];
      if (this.pin && !this.versions.some(v => v.version === this.pin)) this.pin = null;
      this.paint(); this.emit();
    } catch (e) {
      this.root.innerHTML = `<span style="color:#b3261e;font:14px 'Segoe UI',sans-serif">Не удалось загрузить чек-листы: ${esc(e.message)}</span>`;
    }
  }
  paint() {
    this.root.innerHTML = `<style>
      :host{display:block;font:14px/1.4 "Segoe UI",system-ui,sans-serif;color:#17211c}
      .r{display:flex;flex-wrap:wrap;gap:12px}label{display:block;color:#5b6962}
      select{display:block;margin-top:3px;min-width:240px;padding:7px 9px;border:1px solid #d8dfdb;border-radius:4px;background:#fff;color:#17211c;font:inherit}
      select:focus-visible{outline:2px solid #14633f;outline-offset:1px}</style>
      <div class="r">
        <label>Чек-лист для оценки<select data-k="cl">${this.lists.map(l => `<option value="${l.id}" ${l.id === this.cid ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>
        <label>Версия<select data-k="ver"><option value="" ${this.pin ? '' : 'selected'}>Последняя (v${this.versions[0]?.version ?? '?'})</option>
          ${this.versions.map(v => `<option value="${v.version}" ${v.version === this.pin ? 'selected' : ''}>v${v.version} от ${esc(String(v.created_at).slice(0, 16).replace('T', ' '))}</option>`).join('')}</select></label>
      </div>`;
  }
  onChange(e) {
    const k = e.target.dataset.k;
    if (k === 'cl') { this.cid = +e.target.value; this.pin = null; this.refresh(); }
    else if (k === 'ver') { this.pin = e.target.value ? +e.target.value : null; this.paint(); this.emit(); }
  }
  emit() {
    try { localStorage.setItem(KEY, JSON.stringify({ cid: this.cid, pin: this.pin })); } catch (_) {}
    this.dispatchEvent(new CustomEvent('cqa-checklist-selected', { detail: this.value, bubbles: true, composed: true }));
  }
}
customElements.define('cqa-checklist-picker', CqaChecklistPicker);
})();
