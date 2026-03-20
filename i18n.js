/* =====================[ TRECHO 1: i18n.js - Internacionalização offline + DOM ]===================== */
/**
 * [DOC]
 * i18n minimalista, 100% local/offline.
 * [CHANGE] Adicionadas chaves de descrição das salas e mensagens iniciais (intro.*).
 * [NEW] Variantes para 'sala_vazia' (desc.1..desc.7) — usadas em engine.js.
 */

const STORAGE_KEY = 'app.locale';
const listeners = [];

export const LOCALES = {
  'pt-BR': {
    // --- UI estática (index.html) ---
    'ui.stats.hp': 'Vida',
    'ui.stats.energy': 'Energia',
    'ui.stats.mana': 'Mana',
    'ui.stats.sanity': 'Sanidade',
    'ui.stats.xp': 'XP',
    'ui.actions': 'Ações',
    'ui.log': 'Log',
    'ui.rotate': 'Gire o aparelho para continuar',

    // --- Salas (títulos) ---
    'room.sala_vazia.title': 'Sala Vazia',
    'room.sala_fonte.title': 'Sala com Fonte',
    'room.sala_armadilha.title': 'Sala com Armadilha',
    'room.sala_combate.title': 'Sala de Combate',
    'room.fim_de_jogo.title': 'Fim de Jogo',

    // --- Descrições de salas (fallback padrão) ---
    'room.sala_vazia.desc': 'Uma sala silenciosa e vazia.',
    'room.sala_fonte.desc': 'Uma fonte de água límpida murmura ao centro.',
    'room.sala_armadilha.desc': 'Dispositivos suspeitos cobrem o chão. Cuidado ao agir.',
    'room.sala_combate.desc': 'Uma presença hostil bloqueia a passagem. Você precisa escapar.',
    'room.fim_de_jogo.desc': 'Sua jornada termina aqui — por enquanto.',

    // --- [NEW] Variações para Sala Vazia (7 seleções possíveis) ---
    // Selecionadas do seu conjunto: 1, 2, 4, 5, 7, 8, 9
    'room.sala_vazia.desc.1': 'Quatro paredes nuas e poeira no chão. O silêncio pesa no ar.',
    'room.sala_vazia.desc.2': 'A sala está vazia; apenas o eco dos seus passos responde.',
    'room.sala_vazia.desc.3': 'O ar é parado e úmido. Marcas antigas riscam as paredes.',
    'room.sala_vazia.desc.4': 'Sombras se esticam pelo chão, sem objetos para quebrá-las.',
    'room.sala_vazia.desc.5': 'Pedras frias cercam você; restam só poeira e silêncio.',
    'room.sala_vazia.desc.6': 'Um cheiro de mofo domina o ambiente, desprovido de vida.',
    'room.sala_vazia.desc.7': 'Há espaço demais e história de menos; parece esquecida.',

    // --- Ações ---
    'action.descansar': 'Descansar',
    'action.meditar': 'Meditar',
    'action.treinar': 'Treinar',
    'action.explorar': 'Explorar',
    'action.beber_agua': 'Beber água',
    'action.lavar_rosto': 'Lavar o Rosto',
    'action.contemplar': 'Contemplar',
    'action.desarmar': 'Desarmar',
    'action.forcar': 'Forçar',
    'action.analisar': 'Analisar',
    'action.fugir': 'Fugir',
    'action.jogar_novamente': 'Jogar Novamente',

    // --- Combate / fuga ---
    'combat.flee_success': 'Fuga bem-sucedida',
    'combat.flee_fail': 'Fuga falhou',

    // --- Mensagens iniciais (intro) ---
    'intro.1': '...',
    'intro.2': 'Você não lembra quem é... nem onde está...',
    'intro.3': 'Parece uma sala vazia e abandonada há muito tempo.'
  }
};

let CURRENT_LOCALE = 'pt-BR';

export function initI18n(defaultLocale = 'pt-BR') {
  let desired = defaultLocale;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LOCALES[saved]) desired = saved;
  } catch (_) {}
  if (!LOCALES[desired]) desired = 'pt-BR';
  CURRENT_LOCALE = desired;
  applyI18nToDOM(); // traduz o DOM já no boot
  return CURRENT_LOCALE;
}

export function setLocale(locale) {
  if (!LOCALES[locale]) return false;
  CURRENT_LOCALE = locale;
  try { localStorage.setItem(STORAGE_KEY, locale); } catch (_) {}
  applyI18nToDOM();
  notifyLocaleChange();
  return true;
}

export function getLocale() { return CURRENT_LOCALE; }
export function onLocaleChange(cb) { if (typeof cb === 'function' && !listeners.includes(cb)) listeners.push(cb); }
function notifyLocaleChange() { for (let i = 0; i < listeners.length; i++) { try { listeners[i](CURRENT_LOCALE); } catch (_) {} } }

/** [DOC] Tradução com fallback: locale atual → pt-BR → fallback → key */
export function t(key, fallback = '') {
  const dict = LOCALES[CURRENT_LOCALE] || {};
  if (Object.prototype.hasOwnProperty.call(dict, key)) return String(dict[key]);
  const base = LOCALES['pt-BR'] || {};
  if (Object.prototype.hasOwnProperty.call(base, key)) return String(base[key]);
  return fallback || key;
}

export function hasKey(key) {
  return !!(LOCALES[CURRENT_LOCALE] && Object.prototype.hasOwnProperty.call(LOCALES[CURRENT_LOCALE], key))
      || !!(LOCALES['pt-BR'] && Object.prototype.hasOwnProperty.call(LOCALES['pt-BR'], key));
}
/* =====================[ FIM TRECHO 1 ]===================== */


/* =====================[ TRECHO 2: Tradução do DOM ]===================== */
/**
 * [DOC] Aplica traduções em elementos:
 *  - data-i18n="chave"                 → textContent
 *  - data-i18n-aria="chave"           → aria-label
 *  - data-i18n-title="chave"          → title
 *  - data-i18n-placeholder="chave"    → placeholder
 */
export function applyI18nToDOM(root = document) {
  try {
    // textContent
    const nodes = root.querySelectorAll('[data-i18n]');
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      const key = el.getAttribute('data-i18n') || '';
      if (!key) continue;
      const fallback = el.textContent || '';
      el.textContent = t(key, fallback);
    }
    // aria-label
    const ariaNodes = root.querySelectorAll('[data-i18n-aria]');
    for (let i = 0; i < ariaNodes.length; i++) {
      const el = ariaNodes[i];
      const key = el.getAttribute('data-i18n-aria') || '';
      if (!key) continue;
      const fallback = el.getAttribute('aria-label') || '';
      el.setAttribute('aria-label', t(key, fallback));
    }
    // title
    const titleNodes = root.querySelectorAll('[data-i18n-title]');
    for (let i = 0; i < titleNodes.length; i++) {
      const el = titleNodes[i];
      const key = el.getAttribute('data-i18n-title') || '';
      if (!key) continue;
      const fallback = el.getAttribute('title') || '';
      el.setAttribute('title', t(key, fallback));
    }
    // placeholder
    const phNodes = root.querySelectorAll('[data-i18n-placeholder]');
    for (let i = 0; i < phNodes.length; i++) {
      const el = phNodes[i];
      const key = el.getAttribute('data-i18n-placeholder') || '';
      if (!key) continue;
      const fallback = el.getAttribute('placeholder') || '';
      el.setAttribute('placeholder', t(key, fallback));
    }
    // <html lang="...">
    const htmlEl = document.documentElement;
    if (htmlEl) htmlEl.setAttribute('lang', CURRENT_LOCALE);
  } catch (_) {
    // silencioso por política do projeto (sem console no build final)
  }
}
/* =====================[ FIM TRECHO 2 ]===================== */
