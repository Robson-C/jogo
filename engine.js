/* =====================[ TRECHO 1: engine.js - Render/Actions + Effect Runner ]===================== */
/**
 * [DOC]
 * - Renderiza a sala atual (título, descrição e ações) usando i18n.
 * - Roles:
 *    - "explore" → sorteia **qualquer** sala (inclui a atual), uniforme e determinístico.
 *    - "act"     → executa efeitos e permanece na sala.
 * - Effect Runner mínimo padronizado.
 * [CHANGE] Integração com i18n, log estruturado e HUD.
 * [CHANGE] Mecanismo especial para 'sala_armadilha':
 *   - Ao entrar, 'explorar' fica desativado.
 *   - Após executar uma ação não-explorar, todas as não-explorar desativam e 'explorar' habilita.
 * [CHANGE] Game Over por exaustão (energia efetiva = 0) → sala "Fim de Jogo".
 * [CHANGE] Aplica descrição e imagem de background por sala.
 * [NEW]    Seleção determinística de variação de descrição para 'sala_vazia' (7 opções),
 *          baseada em seed + roomId + dia, sem consumir RNG principal.
 * [NEW]    Loga a descrição da sala **apenas na entrada de uma nova sala** (explorar/restart),
 *          evitando duplicatas em re-renderizações.
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

let inputLocked = false;

const GAME_OVER_ROOM_ID = 'fim_de_jogo';

/* -------------------------------------------------------------------------------------------------
 * [STATE] Controle de uso de ações por dia (volátil, não persistido)
 * ------------------------------------------------------------------------------------------------- */
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

/* [DOC] Flags de salas especiais */
function isTrapRoom(roomId) { return String(roomId) === 'sala_armadilha'; }
function isGameOverRoom(roomId) { return String(roomId) === GAME_OVER_ROOM_ID; }

/* ---------------------- Variedade determinística de descrição ---------------------- */
/** [DOC] Hash FNV-1a 32-bit simples (local) — evita consumir `nextRandom`. */
function _hash32(str) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
/** [DOC]
 * Retorna uma descrição alternativa para uma sala, se disponível.
 * Implementado para 'sala_vazia': usa 7 variações `room.sala_vazia.desc.1..7`.
 * Cálculo: idx = (hash(seed|roomId|day) % 7) + 1 — determinístico por dia.
 */
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

/* ---------------------- [NEW] Logue a entrada de uma sala ---------------------- */
/**
 * [DOC] Registra no log a **descrição textual** da sala.
 * - Usa variação determinística para 'sala_vazia' (pickRoomDescVariant).
 * - Para demais salas, usa `descKey` com fallback do catálogo.
 * - Não consome RNG do jogo; side-effect: apenas appendLog().
 */
function logRoomEntry(roomId) {
  const room = ROOMS[roomId] || ROOMS['sala_vazia'];
  // tenta variação (sala_vazia) → descKey → fallback `desc` → string vazia
  const alt = pickRoomDescVariant(roomId);
  const baseDesc = room.descKey ? t(room.descKey, room.desc || '') : (room.desc || '');
  const msg = String(alt || baseDesc || '').trim();
  if (msg) appendLog({ sev: 'info', msg });
}

/* [DOC] Reinicia a run (mantém seed/RNG); limpa mods; reseta jogador e Dia; volta à sala inicial. */
function restartRun() {
  clearAllModifiers();
  initPlayerDefaults();
  setDay(1);
  resetActionUsageForToday();
  STATE.currentRoomId = 'sala_vazia';
  /* [CHANGE][WHY] Logar descrição ao entrar na sala inicial após restart, sem duplicar em re-render. */
  logRoomEntry(STATE.currentRoomId);
  renderRoom();
  renderHUD();
}

/* [DOC] Checa energia efetiva; se 0 → entra na sala de Game Over. Retorna true se entrou. */
function checkGameOverByEnergy() {
  const energyEff = getEffectiveStatus('energia');
  if (energyEff <= 0 && !isGameOverRoom(STATE.currentRoomId)) {
    STATE.currentRoomId = GAME_OVER_ROOM_ID;
    renderRoom();
    return true;
  }
  return false;
}

/** Renderiza título, descrição e botões da sala atual (com i18n) */
export function renderRoom() {
  const room = ROOMS[STATE.currentRoomId] || ROOMS['sala_vazia'];
  const trap = isTrapRoom(STATE.currentRoomId);
  const isGO = isGameOverRoom(STATE.currentRoomId);

  // Título (com i18n). Para Game Over, inclui "Pontuação: 0".
  if (isGO) {
    const base = room.titleKey ? t(room.titleKey, room.title || '') : (room.title || 'Fim de Jogo');
    setRoomTitle(`${base} — Pontuação: 0`);
  } else {
    const title = room.titleKey ? t(room.titleKey, room.title || '') : (room.title || '');
    setRoomTitle(title);
  }

  // Descrição: variação determinística em 'sala_vazia', senão fallback padrão.
  const altDesc = pickRoomDescVariant(STATE.currentRoomId);
  const desc = altDesc != null
    ? altDesc
    : (room.descKey ? t(room.descKey, room.desc || '') : (room.desc || ''));
  setRoomDesc(desc || '');

  // Background declarativo por sala (URL local ou 'none')
  setRoomBackground(room.bg || null);

  // Sala de Game Over: 3 botões vazios/desativados + slot 4 "Jogar Novamente"
  if (isGO) {
    for (let i = 0; i < 3; i++) { setActionLabel(i, ''); enableAction(i, false); }
    setActionLabel(3, t('action.jogar_novamente', 'Jogar Novamente'));
    enableAction(3, true);
    return;
  }

  // Lógica normal (incl. sala armadilha)
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

      // Habilitação padrão
      let enabled = true;

      // Regras especiais: sala de armadilha
      if (trap) {
        const role = a.role || 'act';
        if (role === 'explore') {
          enabled = anyNonExploreUsed;        // só habilita após escolher uma das outras
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

/** Effect Runner mínimo (defensivo) */
function runEffects(effects, labelForLog) {
  if (!effects || !effects.length) return;
  for (let i = 0; i < effects.length; i++) {
    const eff = effects[i];
    if (!eff || typeof eff.type !== 'string') continue;

    switch (eff.type) {
      case 'noop': { if (labelForLog) appendLog({ sev: 'info', msg: `${String(labelForLog)}` }); break; }
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
      case 'removeModById': { const { id } = eff; if (typeof id === 'string') { removeModifierById(id); appendLog({ sev:'mod', msg:`${String(labelForLog||'')}` }); } break; }
      case 'removeModsBySource': { const { source } = eff; if (typeof source === 'string') { removeModifiersBySource(source); appendLog({ sev:'mod', msg:`${String(labelForLog||'')}` }); } break; }
      case 'removeModsByTag': { const { tag } = eff; if (typeof tag === 'string') { removeModifiersByTag(tag); appendLog({ sev:'mod', msg:`${String(labelForLog||'')}` }); } break; }
      default: { break; }
    }
  }
}

/** Wrapper anti multi-input */
function withInputLock(fn) {
  if (inputLocked) return;
  inputLocked = true;
  try { fn(); } finally { requestAnimationFrame(() => { inputLocked = false; }); }
}

/** Ação do usuário: idx ∈ [0..3] */
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
      return; // 1x/dia por ação de 'act'
    }
    if (role !== 'explore') {
      markActionUsedToday(STATE.currentRoomId, idx);
    }

    runEffects(action.effects || [], labelResolved);

    // Sala de armadilha: após executar QUALQUER ação não-explorar,
    // marca todas as não-explorar como usadas e habilita 'explorar'.
    if (isTrapRoom(STATE.currentRoomId) && role !== 'explore') {
      for (let j = 0; j < 4; j++) {
        const aj = room.actions?.[j];
        const rj = aj ? (aj.role || 'act') : 'act';
        if (aj && rj !== 'explore') {
          markActionUsedToday(STATE.currentRoomId, j);
        }
      }
      renderRoom();
    }

    if (role === 'explore') {
      // Custo padrão: -10 energia
      PlayerAPI.addStatus('energia', -10);

      // XP variável 5..8 (no sorteio efetivo, não no clique)
      const xpGain = 5 + Math.floor(nextRandom() * 4); // 5..8
      PlayerAPI.addXP(xpGain);
      appendLog({ sev: 'mod', msg: `+${xpGain} XP` });

      // Avança o dia e reseta uso de ações
      addDay(1);
      setRunlineDay(getDay());
      resetActionUsageForToday();

      // Sorteio da próxima sala (uniforme)
      const nextId = ROOM_IDS[Math.floor(nextRandom() * ROOM_IDS.length)] || STATE.currentRoomId;
      STATE.currentRoomId = nextId;

      /* [CHANGE][WHY] Logar a descrição **na entrada** da nova sala (uma vez),
         antes do render, para que o log curto/ modal mostre o ambiente visitado. */
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
/* =====================[ FIM TRECHO 1 ]===================== */
