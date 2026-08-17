'use strict';

/* Lostman i18n — gettext style: the English string is the key, locale dictionaries map it
   to a translation, and a missing entry falls back to English. Dynamic values use {name}
   placeholders: t('Saved to "{name}"', { name }). */

window.LOSTMAN_LOCALES = window.LOSTMAN_LOCALES || {};

const I18N_META = {
  en: { name: 'English', dir: 'ltr' },
  ar: { name: 'العربية', dir: 'rtl' },
  fr: { name: 'Français', dir: 'ltr' },
  es: { name: 'Español', dir: 'ltr' },
  de: { name: 'Deutsch', dir: 'ltr' },
};

let i18nLocale = 'en';

function t(text, params) {
  const dict = window.LOSTMAN_LOCALES[i18nLocale];
  let out = (dict && dict[text]) || text;
  if (params) {
    for (const [k, v] of Object.entries(params)) out = out.split('{' + k + '}').join(String(v));
  }
  return out;
}

function currentLocale() {
  return i18nLocale;
}

function setLocale(loc) {
  i18nLocale = I18N_META[loc] ? loc : 'en';
  document.documentElement.lang = i18nLocale;
  document.documentElement.dir = I18N_META[i18nLocale].dir;
  applyStaticI18n();
}

/* Translates marked static HTML. data-i18n translates the first non-empty text node
   (so counter spans inside buttons survive); data-i18n-title and data-i18n-placeholder
   translate those attributes. The original English is captured once as the key. */
function applyStaticI18n() {
  for (const node of document.querySelectorAll('[data-i18n]')) {
    let textNode = null;
    for (const child of node.childNodes) {
      if (child.nodeType === 3 && child.nodeValue.trim() !== '') {
        textNode = child;
        break;
      }
    }
    if (!textNode) continue;
    if (!node.dataset.i18nKey) node.dataset.i18nKey = textNode.nodeValue.trim();
    textNode.nodeValue = t(node.dataset.i18nKey);
  }
  for (const node of document.querySelectorAll('[data-i18n-title]')) {
    if (!node.dataset.i18nTitleKey) node.dataset.i18nTitleKey = node.getAttribute('title') || '';
    node.setAttribute('title', t(node.dataset.i18nTitleKey));
  }
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) {
    if (!node.dataset.i18nPlaceholderKey) node.dataset.i18nPlaceholderKey = node.getAttribute('placeholder') || '';
    node.setAttribute('placeholder', t(node.dataset.i18nPlaceholderKey));
  }
}
