/* =====================[ TRECHO 1: Cabeçalho, Imports e Constantes ]===================== */
/**
 * [DOC]
 * Núcleo de fluxo do jogo: render de sala, execução de ações e transições.
 * Mantém compatibilidade com state/ui/i18n/rooms e não inicia rede (offline).
 * [CHANGE] Arquivo foi apenas reorganizado em TRECHOS; lógica inalterada.
 */
import {
  STATE, nextRandom, getLogLastNTexts, appendLog,
  PlayerAPI, addModifier,
  removeModifierById, removeModifiersBySource, removeModifiersByTag,
  addDay, getDay, setDay, initPlayerDefaults, clearAllModifiers, getEffectiveStatus
} from './state.js';
import { setRoomTitle, setActionLabel, enableAction, getActionLabel, renderLog, setRunlineDay, renderHUD, setRoomDesc, setRoomBackground } from './ui.js';
import { ROOMS, ROOM_IDS } from './rooms.js';
import { t } from './i18n.js';

/* [STATE] Lock para anti multi-input (desbloqueado no próximo rAF) */
let inputLocked = false;

/* ID canônico de sala especial */
const GAME_OVER_ROOM_ID = 'fim_de_jogo';
/* =====================[ FIM TRECHO 1 ]===================== */


/* =====================[ TRECHO 2: Controle de Uso de Ações por Dia ]===================== */
/**
 * [DOC]
 * Controla ações "act" 1x por dia e a regra da sala armadilha.
 * Estruturas são voláteis (não persistidas).
 */
if (!STATE.actionsUsed) {
  STATE.actionsUsed = new Set();
}
if (typeof STATE.actionsLastResetDay !== 'number') {
  try { STATE.actionsLastResetDay = getDay(); } catch (_) { STATE.actionsLastResetDay = 1; }
}

function actionKey(roomId, idx) { return `${String(roomId)}#${String(idx)}`; }
function resetActionUsageForToday() { STATE.actionsUsed.clear(); STATE.actionsLastResetDay = getDay(); }
function ensureActionUsageDaySync() { const d = getDay(); if (STATE.actionsLastResetDay !== d) resetActionUsageForToday(); }
function isActionUsedToday(roomId, idx) { ensureActionUsageDaySync(); return STATE.actionsUsed.has(actionKey(roomId, idx)); }
function markActionUsedToday(roomId, idx) { ensureActionUsageDaySync(); STATE.actionsUsed.add(actionKey(roomId, idx)); }
/* =====================[ FIM TRECHO 2 ]===================== */


/* =====================[ TRECHO 3: Descrições — Hash e Variação Determinística ]===================== */
/**
 * [DOC]
 * Seleção determinística de variação de descrição para 'sala_vazia', baseada em seed+roomId+dia,
 * sem consumir o RNG principal (nextRandom).
 */
function _hash32(str) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
function pickRoomDescVariant(roomId) {
  if (roomId !== 'sala_vazia') return null;
  const seed = String(STATE.seed || '');
  const day  = getDay();
  const h = _hash32(`${seed}|${roomId}|${day}`);
  const idx = (h % 7) + 1; // 1..7
  const key = `room.${roomId}.desc.${idx}`;
  const val = t(key, '');
  return (val && val !== key) ? val : null; // fallback seguro
}
/* =====================[ FIM TRECHO 3 ]===================== */


/* =====================[ TRECHO 4: Utilitários de Sala (flags, log, transições) ]===================== */
/** [DOC] Predicados de tipo de sala */
function isTrapRoom(roomId)    { return String(roomId) === 'sala_armadilha'; }
function isGameOverRoom(roomId){ return String(roomId) === GAME_OVER_ROOM_ID; }

/**
 * [DOC] Registra no log a **descrição textual** da sala recém-entrante.
 * - Usa variação determinística para 'sala_vazia' (pickRoomDescVariant).
 * - Para demais salas, usa `descKey` com fallback do catálogo.
 * - Não consome RNG do jogo; side-effect: apenas appendLog().
 */
function logRoomEntry(roomId) {
  const room = ROOMS[roomId] || ROOMS['sala_vazia'];
  const alt = pickRoomDescVariant(roomId);
  const baseDesc = room.descKey ? t(room.descKey, room.desc || '') : (room.desc || '');
  const msg = String(alt || baseDesc || '').trim();
  if (msg) appendLog({ sev: 'info', msg });
}

/**
 * [DOC] Reinicia a run (mantém seed/RNG); limpa mods; reseta jogador e Dia; volta à sala inicial.
 * [WHY] Loga descrição ao entrar na sala inicial após restart, sem duplicar em re-render.
 */
function restartRun() {
  clearAllModifiers();
  initPlayerDefaults();
  setDay(1);
  resetActionUsageForToday();
  STATE.currentRoomId = 'sala_vazia';
  logRoomEntry(STATE.currentRoomId);
  renderRoom();
  renderHUD();
}

/** [DOC] Game Over por energia efetiva 0 → entra na sala de Fim de Jogo; retorna true se entrou. */
function checkGameOverByEnergy() {
  const energyEff = getEffectiveStatus('energia');
  if (energyEff <= 0 && !isGameOverRoom(STATE.currentRoomId)) {
    STATE.currentRoomId = GAME_OVER_ROOM_ID;
    renderRoom();
    return true;
  }
  return false;
}
/* =====================[ FIM TRECHO 4 ]===================== */


/* =====================[ TRECHO 5: Renderização da Sala (Título, Descrição, Ações) ]===================== */
/**
 * [DOC]
 * - Aplica título (i18n), descrição (variação para sala_vazia) e background declarativo.
 * - Configura os 4 botões conforme a lógica da sala e do dia.
 * - Sala de Game Over: apenas "Jogar Novamente" no slot 4.
 */
export function renderRoom() {
  const room = ROOMS[STATE.currentRoomId] || ROOMS['sala_vazia'];
  const trap = isTrapRoom(STATE.currentRoomId);
  const isGO = isGameOverRoom(STATE.currentRoomId);

  // Título
  if (isGO) {
    const base = room.titleKey ? t(room.titleKey, room.title || '') : (room.title || 'Fim de Jogo');
    setRoomTitle(`${base} — Pontuação: 0`);
  } else {
    const title = room.titleKey ? t(room.titleKey, room.title || '') : (room.title || '');
    setRoomTitle(title);
  }

  // Descrição
  const altDesc = pickRoomDescVariant(STATE.currentRoomId);
  const desc = altDesc != null
    ? altDesc
    : (room.descKey ? t(room.descKey, room.desc || '') : (room.desc || ''));
  setRoomDesc(desc || '');

  // Background
  setRoomBackground(room.bg || null);

  // Game Over: 3 inativos + "Jogar Novamente"
  if (isGO) {
    for (let i = 0; i < 3; i++) { setActionLabel(i, ''); enableAction(i, false); }
    setActionLabel(3, t('action.jogar_novamente', 'Jogar Novamente'));
    enableAction(3, true);
    return;
  }

  // Regras normais (inclui sala armadilha)
  let anyNonExploreUsed = false;
  if (trap) {
    for (let j = 0; j < 4; j++) {
      const aj = room.actions?.[j];
      const roleJ = aj ? (aj.role || 'act') : 'act';
      if (aj && roleJ !== 'explore' && isActionUsedToday(STATE.currentRoomId, j)) {
        anyNonExploreUsed = true; break;
      }
    }
  }

  for (let i = 0; i < 4; i++) {
    const a = room.actions?.[i];
    if (a) {
      const label = a.labelKey ? t(a.labelKey, a.label || '') : (a.label || '');
      setActionLabel(i, label);

      let enabled = true;
      if (trap) {
        const role = a.role || 'act';
        if (role === 'explore') {
          enabled = anyNonExploreUsed;        // só habilita após usar uma não-explorar
        } else {
          enabled = !anyNonExploreUsed && !isActionUsedToday(STATE.currentRoomId, i);
        }
      }
      enableAction(i, enabled);
    } else {
      setActionLabel(i, '???');
      enableAction(i, false);
    }
  }
}
/* =====================[ FIM TRECHO 5 ]===================== */


/* =====================[ TRECHO 6: Effect Runner (execução defensiva de efeitos) ]===================== */
/**
 * [DOC]
 * Interpreta efeitos declarativos e aplica no estado,
 * logando mudanças com severidade "mod".
 */
function runEffects(effects, labelForLog) {
  if (!effects || !effects.length) return;
  for (let i = 0; i < effects.length; i++) {
    const eff = effects[i];
    if (!eff || typeof eff.type !== 'string') continue;

    switch (eff.type) {
      case 'noop': {
        if (labelForLog) appendLog({ sev: 'info', msg: `${String(labelForLog)}` });
        break;
      }
      case 'statusDelta': {
        const { key, delta } = eff;
        if (typeof key === 'string' && Number.isFinite(delta)) {
          PlayerAPI.addStatus(key, delta);
          appendLog({ sev: 'mod', msg: `${String(labelForLog || '')}` });
        }
        break;
      }
      case 'atributoDelta': {
        const { key, delta } = eff;
        if (typeof key === 'string' && Number.isFinite(delta)) {
          PlayerAPI.addAtributo(key, delta);
          appendLog({ sev: 'mod', msg: `${String(labelForLog || '')}` });
        }
        break;
      }
      case 'statusMaxDelta': {
        const { key, delta } = eff;
        if (typeof key === 'string' && Number.isFinite(delta)) {
          PlayerAPI.addStatusMax(key, delta);
          appendLog({ sev: 'mod', msg: `${String(labelForLog || '')}` });
        }
        break;
      }
      case 'xpDelta': {
        const { amount } = eff;
        if (Number.isFinite(amount)) {
          PlayerAPI.addXP(amount);
          appendLog({ sev: 'mod', msg: `${String(labelForLog || '')}` });
        }
        break;
      }
      case 'addMod': {
        const { mod } = eff;
        if (mod && typeof mod === 'object') {
          addModifier(mod);
          appendLog({ sev: 'mod', msg: `${String(labelForLog || '')}` });
        }
        break;
      }
      case 'removeModById': {
        const { id } = eff;
        if (typeof id === 'string') { removeModifierById(id); appendLog({ sev:'mod', msg:`${String(labelForLog||'')}` }); }
        break;
      }
      case 'removeModsBySource': {
        const { source } = eff;
        if (typeof source === 'string') { removeModifiersBySource(source); appendLog({ sev:'mod', msg:`${String(labelForLog||'')}` }); }
        break;
      }
      case 'removeModsByTag': {
        const { tag } = eff;
        if (typeof tag === 'string') { removeModifiersByTag(tag); appendLog({ sev:'mod', msg:`${String(labelForLog||'')}` }); }
        break;
      }
      default: { break; }
    }
  }
}
/* =====================[ FIM TRECHO 6 ]===================== */


/* =====================[ TRECHO 7: Input Lock e Dispatcher de Ações ]===================== */
/**
 * [DOC]
 * - `withInputLock` evita múltiplos cliques simultâneos.
 * - `handleAction` executa a ação (0..3), aplica custos/efeitos,
 *   sorteia próxima sala em "explore", loga descrição da nova sala,
 *   atualiza HUD e log curto.
 */
function withInputLock(fn) {
  if (inputLocked) return;
  inputLocked = true;
  try { fn(); } finally { requestAnimationFrame(() => { inputLocked = false; }); }
}

export function handleAction(idx) {
  withInputLock(() => {
    ensureActionUsageDaySync();

    // Sala de Game Over: somente botão 4 reinicia a run
    if (isGameOverRoom(STATE.currentRoomId)) {
      if (idx === 3) {
        restartRun();
        renderLog(getLogLastNTexts(4));
      }
      return;
    }

    const room = ROOMS[STATE.currentRoomId] || ROOMS['sala_vazia'];
    const action = room.actions?.[idx];
    if (!action) return;

    const labelResolved = action.labelKey ? t(action.labelKey, '') : getActionLabel(idx);
    const role = action.role || 'act';

    if (role !== 'explore' && isActionUsedToday(STATE.currentRoomId, idx)) {
      return; // 1x/dia por ação 'act'
    }
    if (role !== 'explore') {
      markActionUsedToday(STATE.currentRoomId, idx);
    }

    runEffects(action.effects || [], labelResolved);

    // Sala armadilha: após qualquer 'act', todas as 'act' contam como usadas
    if (isTrapRoom(STATE.currentRoomId) && role !== 'explore') {
      for (let j = 0; j < 4; j++) {
        const aj = room.actions?.[j];
        const rj = aj ? (aj.role || 'act') : 'act';
        if (aj && rj !== 'explore') markActionUsedToday(STATE.currentRoomId, j);
      }
      renderRoom();
    }

    if (role === 'explore') {
      // Custo padrão: -10 energia
      PlayerAPI.addStatus('energia', -10);

      // XP variável 5..8
      const xpGain = 5 + Math.floor(nextRandom() * 4); // 5..8
      PlayerAPI.addXP(xpGain);
      appendLog({ sev: 'mod', msg: `+${xpGain} XP` });

      // Avança o dia, reseta uso de ações
      addDay(1);
      setRunlineDay(getDay());
      resetActionUsageForToday();

      // Sorteio da próxima sala (uniforme)
      const nextId = ROOM_IDS[Math.floor(nextRandom() * ROOM_IDS.length)] || STATE.currentRoomId;
      STATE.currentRoomId = nextId;

      // Loga descrição ao entrar na nova sala (evita duplicatas)
      logRoomEntry(nextId);

      renderRoom();
    }

    // Checa Game Over (energia 0) após aplicar efeitos/custos
    if (checkGameOverByEnergy()) {
      renderHUD();
      renderLog(getLogLastNTexts(4));
      return;
    }

    renderHUD();
    renderLog(getLogLastNTexts(4));
  });
}
/* =====================[ FIM TRECHO 7 ]===================== */
