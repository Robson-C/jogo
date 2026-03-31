/* =====================[ TRECHO 1: main.js - Entry Point com i18n aplicado no DOM ]===================== */
/**
 * [DOC] Ponto de entrada do app.
 * Ordem de boot: i18n → seed → defaults → UI → render inicial → HUD → bind.
 * Reaplica i18n e re-renderiza sala/HUD quando o idioma muda.
 */
import { initI18n, onLocaleChange, applyI18nToDOM, t } from './i18n.js';
import { STATE, initSeed, getDay, getCurrentFloor, initPlayerDefaults, appendLog, getLogLastNTexts, getSaveSlotMeta, saveCurrentGameToSlot } from './state.js'; // [CHANGE]
import { initUI, bindActions, bindMainMenu, bindTopMenuButton, setTopMenuButtonEnabled, showMainMenu, hideMainMenu, setMainMenuFeedback, setRunlineDay, setRunlineFloor, renderHUD, renderLog, setMainMenuTitle, setMainMenuSubtitle, configureMainMenuButton } from './ui.js'; // [CHANGE]
import { initScenePanel } from './scene_panel.js';
import { handleAction, renderRoom, startNewGameForSlot, restartRun } from './engine.js';

const MAIN_MENU_MODE = Object.freeze({
  ROOT: 'root',
  NEW_GAME_SLOTS: 'new_game_slots',
  INGAME: 'ingame'
});

let currentMainMenuMode = MAIN_MENU_MODE.ROOT;

function appendIntroLogsIfNeeded() {
  try {
    if (!STATE.bootInitLogged) {
      appendLog({ sev: 'info', msg: t('intro.1', 'Você acorda em um local com pouca luz.') });
      appendLog({ sev: 'info', msg: t('intro.2', 'Não lembra quem é... nem onde está...') });
      appendLog({ sev: 'info', msg: t('intro.3', 'Parece uma sala vazia e abandonada há muito tempo.') });
      STATE.bootInitLogged = true;
    }
  } catch (_) {}
}

function getNewGameSlotLabel(slot) {
  const prefix = t('ui.main_menu.slot_prefix', 'Slot');
  const meta = getSaveSlotMeta(slot);
  const status = meta
    ? t('ui.main_menu.slot.filled', 'Ocupado')
    : t('ui.main_menu.slot.empty', 'Vazio');
  return `${prefix} ${slot} — ${status}`;
}

function renderMainMenu() {
  if (currentMainMenuMode === MAIN_MENU_MODE.INGAME) {
    setMainMenuTitle(t('ui.ingame_menu.title', 'Menu do Jogo'));
    setMainMenuSubtitle(t('ui.ingame_menu.subtitle', 'Salvar ainda não está disponível.'));
    configureMainMenuButton('newGame', { text: t('ui.ingame_menu.save', 'Salvar'), primary: true, disabled: false, hidden: false });
    configureMainMenuButton('loadGame', { text: t('ui.ingame_menu.exit_to_menu', 'Sair para Menu'), primary: false, disabled: false, hidden: false });
    configureMainMenuButton('exitGame', { text: '', primary: false, disabled: true, hidden: true });
    configureMainMenuButton('extra1', { text: t('ui.ingame_menu.close', 'Fechar'), primary: false, disabled: false, hidden: false });
    configureMainMenuButton('extra2', { text: '', primary: false, disabled: true, hidden: true });
    return;
  }

  if (currentMainMenuMode === MAIN_MENU_MODE.NEW_GAME_SLOTS) {
    setMainMenuTitle(t('ui.main_menu.slot_select.title', 'Escolher Slot'));
    setMainMenuSubtitle(t('ui.main_menu.slot_select.subtitle', 'Novo jogo sobrescreve o slot escolhido.'));
    configureMainMenuButton('newGame', { text: getNewGameSlotLabel(1), primary: true, disabled: false, hidden: false });
    configureMainMenuButton('loadGame', { text: getNewGameSlotLabel(2), primary: false, disabled: false, hidden: false });
    configureMainMenuButton('exitGame', { text: getNewGameSlotLabel(3), primary: false, disabled: false, hidden: false });
    configureMainMenuButton('extra1', { text: t('ui.main_menu.back', 'Voltar'), primary: false, disabled: false, hidden: false });
    configureMainMenuButton('extra2', { text: '', primary: false, disabled: true, hidden: true });
    return;
  }

  setMainMenuTitle(t('ui.main_menu.title', 'Menu Inicial'));
  setMainMenuSubtitle(t('ui.main_menu.subtitle', 'Estrutura pronta para até 5 opções.'));
  configureMainMenuButton('newGame', { text: t('ui.main_menu.new_game', 'Novo Jogo'), primary: true, disabled: false, hidden: false });
  configureMainMenuButton('loadGame', { text: t('ui.main_menu.load', 'Carregar'), primary: false, disabled: false, hidden: false });
  configureMainMenuButton('exitGame', { text: t('ui.main_menu.exit', 'Exit'), primary: false, disabled: false, hidden: false });
  configureMainMenuButton('extra1', { text: '', primary: false, disabled: true, hidden: true });
  configureMainMenuButton('extra2', { text: '', primary: false, disabled: true, hidden: true });
}

function closeInGameMenu() {
  if (currentMainMenuMode !== MAIN_MENU_MODE.INGAME) return;
  hideMainMenu();
}

function openInGameMenu() {
  currentMainMenuMode = MAIN_MENU_MODE.INGAME;
  renderMainMenu();
  showMainMenu();
}

function returnToTitleMenu() {
  restartRun();
  currentMainMenuMode = MAIN_MENU_MODE.ROOT;
  renderMainMenu();
  setTopMenuButtonEnabled(false);
  showMainMenu();
}

function startSelectedSlotNewGame(slot) {
  startNewGameForSlot(slot);
  appendIntroLogsIfNeeded();
  renderLog(getLogLastNTexts(4));
  const saveResult = saveCurrentGameToSlot(slot);
  if (!saveResult.ok) {
    appendLog({ sev: 'warn', msg: 'Falha ao criar save inicial do slot.' });
    renderLog(getLogLastNTexts(4));
  }
  currentMainMenuMode = MAIN_MENU_MODE.ROOT;
  renderMainMenu();
  setTopMenuButtonEnabled(true);
  hideMainMenu();
}

function boot() {
  initI18n('pt-BR');
  initSeed();
  initPlayerDefaults();

  initUI();
  initScenePanel();

  setRunlineDay(getDay());
  setRunlineFloor(getCurrentFloor());

  appendIntroLogsIfNeeded();

  renderRoom();
  renderHUD();
  renderLog(getLogLastNTexts(4));

  bindActions((idx) => {
    handleAction(idx);
  });

  // [ALERTA DE MUDANÇA] Mantém o menu interno do jogo e a seleção de slots do Novo Jogo no mesmo overlay, sem alterar o fluxo da run fora desses dois pontos.
  bindMainMenu({
    onNewGame: () => {
      if (currentMainMenuMode === MAIN_MENU_MODE.INGAME) {
        setMainMenuFeedback(t('ui.ingame_menu.save_pending', 'Salvar ainda não está disponível.'));
        return;
      }
      if (currentMainMenuMode === MAIN_MENU_MODE.NEW_GAME_SLOTS) {
        startSelectedSlotNewGame(1);
        return;
      }
      currentMainMenuMode = MAIN_MENU_MODE.NEW_GAME_SLOTS;
      renderMainMenu();
      setMainMenuFeedback('Escolha um slot para iniciar uma nova run.');
    },
    onLoadGame: () => {
      if (currentMainMenuMode === MAIN_MENU_MODE.INGAME) {
        returnToTitleMenu();
        return;
      }
      if (currentMainMenuMode === MAIN_MENU_MODE.NEW_GAME_SLOTS) {
        startSelectedSlotNewGame(2);
        return;
      }
      setMainMenuFeedback('Carregar ainda não está disponível.');
    },
    onExitGame: () => {
      if (currentMainMenuMode === MAIN_MENU_MODE.NEW_GAME_SLOTS) {
        startSelectedSlotNewGame(3);
        return;
      }
      let closed = false;
      try { window.close(); } catch (_) {}
      try { if (typeof history.length === 'number' && history.length > 1) { history.back(); closed = true; } } catch (_) {}
      if (!closed) setMainMenuFeedback('Exit não está disponível neste ambiente.');
    },
    onExtra1: () => {
      if (currentMainMenuMode === MAIN_MENU_MODE.INGAME) {
        closeInGameMenu();
        return;
      }
      if (currentMainMenuMode !== MAIN_MENU_MODE.NEW_GAME_SLOTS) return;
      currentMainMenuMode = MAIN_MENU_MODE.ROOT;
      renderMainMenu();
      setMainMenuFeedback('');
    },
    onBackdrop: () => {
      if (currentMainMenuMode === MAIN_MENU_MODE.INGAME) closeInGameMenu();
    }
  });
  bindTopMenuButton(() => {
    openInGameMenu();
  });
  setTopMenuButtonEnabled(false);
  renderMainMenu();
  showMainMenu();

  onLocaleChange(() => {
    applyI18nToDOM(document);
    renderMainMenu();
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
