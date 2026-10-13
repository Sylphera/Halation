// Translations: t(key, vars) reads locales/<lang>.json and falls back to English silently.
// The main window loads the dictionaries; the tool frames reuse the same instance.
(() => {
  const P = window.parent !== window ? window.parent : null;
  if (P && P.__i18n) { window.__i18n = P.__i18n; window.t = P.__i18n.t; document.documentElement.lang = P.__i18n.lang(); return; }

  const LANGS = ["en", "es"];
  const dicts = { en: {} };
  const missing = new Set();
  let lang = "en";
  let errorPatterns = [];
  // Test mode: every translated string is wrapped, so untranslated visible text stands out.
  const pseudo = !!window.__halPseudo;

  function t(key, vars) {
    let s = dicts[lang] && dicts[lang][key];
    if (s == null) s = dicts.en[key];
    if (s == null) { missing.add(key); s = key; }
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? (k === "error" || k === "msg" ? error(vars[k]) : String(vars[k])) : m));
    return pseudo ? "⟦" + s + "⟧" : s;
  }
  // Localize Halation's own backend/worker errors at display time. Keep internal error
  // values, file names, user content and third-party diagnostics unchanged.
  function error(value) {
    if (lang === "en" && !pseudo) return String(value);
    const text = String(value && value.message || value);
    for (const { key, re, names } of errorPatterns) {
      const match = re.exec(text);
      if (match) return t(key, Object.fromEntries(names.map((name, i) => [name, match[i + 1]])));
    }
    if (text.startsWith("Error: ")) {
      const message = text.slice(7), translated = error(message);
      if (translated !== message) return t("common.error", { error: translated });
    }
    return text;
  }
  // <el data-i18n="key">, data-i18n-title, data-i18n-placeholder, data-i18n-aria-label
  function apply(root) {
    root.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
    for (const attr of ["title", "placeholder", "aria-label"]) {
      root.querySelectorAll(`[data-i18n-${attr}]`).forEach(el => el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`))));
    }
  }
  async function load(wanted) {
    const get = async name => {
      try { const r = await fetch(`locales/${name}.json`); return r.ok ? await r.json() : {}; } catch (e) { return {}; }
    };
    lang = LANGS.includes(wanted) ? wanted : "en";
    dicts.en = await get("en");
    errorPatterns = Object.entries(dicts.en).filter(([key]) => key.startsWith("error.native")).map(([key, source]) => {
      const names = [], escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      let pattern = "", end = 0;
      for (const match of source.matchAll(/\{(\w+)\}/g)) {
        pattern += escape(source.slice(end, match.index)) + "(.+?)";
        names.push(match[1]); end = match.index + match[0].length;
      }
      return { key, names, re: new RegExp("^" + pattern + escape(source.slice(end)) + "$", "s") };
    }).sort((a, b) => a.names.length - b.names.length);
    if (lang !== "en") dicts[lang] = await get(lang);
    document.documentElement.lang = lang;
  }
  window.__i18n = { t, error, apply, load, lang: () => lang, LANGS, missing, pseudo };
  window.t = t;
})();
