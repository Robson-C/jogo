/* =====================[ TRECHO 1: main.js - Entry Point com i18n aplicado no DOM ]===================== */
/**
 * [DOC] Ponto de entrada do app.
 * Ordem de boot: i18n → seed → defaults → UI → render inicial → HUD → bind.
 * Reaplica i18n e re-renderiza sala/HUD quando o idioma muda.
 */
import { initI18n, onLocaleChange, applyI18nToDOM, t } from './i18n.js';
import { STATE, initSeed, getDay, initPlayerDefaults, appendLog, getLogLastNTexts } from './state.js'; // [CHANGE]
import { initUI, bindActions, setRunlineDay, renderHUD, renderLog } from './ui.js'; // [CHANGE]
import { handleAction, renderRoom } from './engine.js';

function boot() {
  initI18n('pt-BR'); // idioma inicial
  initSeed();
  initPlayerDefaults(); // [CHANGE] define 100/100 nos status e XP=0

  initUI();

  // Exibe o status do dia na runline
  setRunlineDay(getDay());

  // [NEW][WHY] Mensagens iniciais de ambientação — logadas apenas 1x por sessão
  try {
    if (!STATE.bootInitLogged) {
      appendLog({ sev: 'info', msg: t('intro.1', 'Você acorda em um local com pouca luz.') });
      appendLog({ sev: 'info', msg: t('intro.2', 'Não lembra quem é... nem onde está...') });
      appendLog({ sev: 'info', msg: t('intro.3', 'Parece uma sala vazia e abandonada há muito tempo.') });
      STATE.bootInitLogged = true; // [STATE] flag volátil de sessão
    }
  } catch (_) {}

  renderRoom();
  renderHUD(); // [CHANGE] sincroniza HUD com o estado efetivo
  renderLog(getLogLastNTexts(4)); // [NEW] garante log curto visível no boot

  // Bind das ações após render inicial
  bindActions((idx) => {
    handleAction(idx);
  });

  // Reaplica i18n em troca de linguagem (sem relogar intro)
  onLocaleChange(() => {
    applyI18nToDOM(document);
    renderRoom();
    renderHUD();
    renderLog(getLogLastNTexts(4));
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true, passive: true });
} else {
  boot();
}
/* =====================[ FIM TRECHO 1 ]===================== */
