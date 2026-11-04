// Минимальный шаблонизатор: html`...` экранирует подстановки, вложенные шаблоны и массивы — как есть.

class Html {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

function toHtml(v) {
  if (v == null || v === false) return '';
  if (v instanceof Html) return v.s;
  if (Array.isArray(v)) return v.map(toHtml).join('');
  return escapeHtml(v);
}

export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += toHtml(values[i]);
  });
  return new Html(out);
}

/** Доверенная разметка (иконки). */
export const raw = (s) => new Html(s);

export const attr = (cond, name) => (cond ? raw(` ${name}`) : '');
