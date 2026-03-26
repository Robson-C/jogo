/* =====================[ TRECHO 1: Cabeçalho, Imports e Constantes ]===================== */
/**
 * [DOC]
 * Núcleo de fluxo do jogo: render de sala, execução de ações e transições.
 * Mantém compatibilidade com state/ui/i18n/rooms e não inicia rede (offline).
 * [CHANGE] Combate com resolução centralizada:
 *  - combat_flow calcula turno/resultado.
 *  - engine decide XP, transição de sala e Game Over em um ponto único.
 * [CHANGE] Preparado para novas ações de combate: ataque, defesa e habilidade dinâmica.
 */
import {
  STATE, nextRandom, getLogLastNTexts, appendLog,
  PlayerAPI, addModifier,
  removeModifierById, removeModifiersBySource, removeModifiersByTag,
  addDay, getDay, setDay, initPlayerDefaults, clearAllModifiers,
  getEffectiveStatus, getEffectiveStatusMax, getEffectiveAtributo, getActiveCombatSkill
} from './state.js';
import { setActionLabel, enableAction, getActionLabel, renderLog, setRunlineDay, renderHUD } from './ui.js';
import { showRoomPanel, showEnemyPanel } from './scene_panel.js';
import { ROOMS, ROOM_IDS } from './rooms.js';
import { t } from './i18n.js';
import { ensureEncounterForCurrentRoom, clearCurrentEncounter, isCombatEncounterRoom } from './encounter.js';
import {
  isPlayerCombatTurn,
  queueCombatPlayerAction,
  resolvePendingEnemyTurn,
  getCombatActionAvailability,
  hasUsableActiveCombatSkill
} from './combat_flow.js';

/* [STATE] Lock para anti multi-input e janela de resposta inimiga */
let inputLocked = false;
let combatResponseSequence = 0;

const ENEMY_RESPONSE_DELAY_MS = 500;

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
  return (val && val !== key) ? val : null;
}
/* =====================[ FIM TRECHO 3 ]===================== */


/* =====================[ TRECHO 4: Utilitários de Sala (flags, transições) ]===================== */
/** [DOC] Predicados de tipo de sala */
function isTrapRoom(roomId)    { return String(roomId) === 'sala_armadilha'; }
function isCombatRoom(roomId)  { return isCombatEncounterRoom(roomId); }
function isGameOverRoom(roomId){ return String(roomId) === GAME_OVER_ROOM_ID; }

function logRoomEntry() {
  /* intencionalmente vazio (política minimalista de log) */
}

function invalidatePendingCombatResponse() {
  combatResponseSequence += 1;
}

function createCombatResponseToken() {
  combatResponseSequence += 1;
  return combatResponseSequence;
}

function isCombatResponseTokenCurrent(token) {
  return Number(token) === combatResponseSequence;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitEnemyResponseWindow(token) {
  await wait(ENEMY_RESPONSE_DELAY_MS);
  return isCombatResponseTokenCurrent(token);
}

function clearCombatEnemy() {
  invalidatePendingCombatResponse();
  clearCurrentEncounter();
}

function ensureCombatEnemy() {
  const encounter = ensureEncounterForCurrentRoom();
  return encounter && encounter.enemy ? encounter.enemy : null;
}

/** [DOC] Reinicia a run (mantém seed/RNG); limpa mods; reseta jogador e Dia; volta à sala inicial. */
function restartRun() {
  clearAllModifiers();
  initPlayerDefaults();
  setDay(1);
  resetActionUsageForToday();
  STATE.nextRoomEmptyChanceRealBoost = false;
  clearCombatEnemy();
  STATE.currentRoomId = 'sala_vazia';
  setRunlineDay(getDay());
  renderRoom();
  renderHUD();
}

function goToGameOver() {
  if (isGameOverRoom(STATE.currentRoomId)) return true;
  clearCombatEnemy();
  STATE.currentRoomId = GAME_OVER_ROOM_ID;
  renderRoom();
  return true;
}

/** [DOC] Game Over centralizado por Vida ou Energia efetivas zeradas. */
function checkGameOver() {
  const energyEff = getEffectiveStatus('energia');
  const lifeEff = getEffectiveStatus('vida');
  if ((energyEff <= 0 || lifeEff <= 0) && !isGameOverRoom(STATE.currentRoomId)) {
    return goToGameOver();
  }
  return false;
}
/* =====================[ FIM TRECHO 4 ]===================== */


/* =====================[ TRECHO 5: Renderização da Sala (Título, Descrição, Ações) ]===================== */
const STAT_EMOJI = { vida:'❤️', energia:'⚡', mana:'💧', sanidade:'🧠' };
const ATR_EMOJI  = { ataque:'⚔️', defesa:'🛡️', precisao:'🎯', agilidade:'💨' };
const XP_EMOJI   = '⭐';
const EXPLORE_ENERGY_COST = 10;
const COMBAT_ATTACK_ENERGY_COST = 5;
const COMBAT_DEFEND_ENERGY_COST = 5;
const FLEE_ENERGY_COST = 5;
const FLEE_SANITY_COST = 5;
const FLEE_SUCCESS_CHANCE = 0.5;

const TRAP_RULES_BY_FLOOR = Object.freeze({
  1: Object.freeze({ difficulty: 12, disarmFailLife: 4, disarmFailSanity: 6, forceEnergy: 6, forceFailLife: 5, analyzeSanity: 7 }),
  2: Object.freeze({ difficulty: 14, disarmFailLife: 5, disarmFailSanity: 7, forceEnergy: 7, forceFailLife: 6, analyzeSanity: 8 }),
  3: Object.freeze({ difficulty: 16, disarmFailLife: 6, disarmFailSanity: 8, forceEnergy: 8, forceFailLife: 7, analyzeSanity: 9 }),
  4: Object.freeze({ difficulty: 18, disarmFailLife: 7, disarmFailSanity: 9, forceEnergy: 9, forceFailLife: 8, analyzeSanity: 10 }),
  5: Object.freeze({ difficulty: 20, disarmFailLife: 8, disarmFailSanity: 10, forceEnergy: 10, forceFailLife: 9, analyzeSanity: 11 })
});

function _pctToInt(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return null;
  const p = Math.round(n * 100);
  return Number.isFinite(p) ? p : null;
}


function clampTrapFloor(rawFloor) {
  const floor = Math.floor(Number(rawFloor) || 1);
  if (floor < 1) return 1;
  if (floor > 5) return 5;
  return floor;
}

function getTrapRules(room) {
  const floor = clampTrapFloor(room && room.trapFloor);
  return TRAP_RULES_BY_FLOOR[floor] || TRAP_RULES_BY_FLOOR[1];
}

function getCombatActionCostPreview(role) {
  if (role === 'combat_attack') return `[-${COMBAT_ATTACK_ENERGY_COST} ${STAT_EMOJI.energia}]`;
  if (role === 'combat_defend') return `[-${COMBAT_DEFEND_ENERGY_COST} ${STAT_EMOJI.energia}]`;
  return '';
}

function getTrapActionPreview(action, room) {
  const trapKind = action && typeof action.trapKind === 'string' ? action.trapKind : '';
  if (!trapKind) return '';
  const rules = getTrapRules(room);
  switch (trapKind) {
    case 'desarmar':
      return `[falha: -${rules.disarmFailLife} ${STAT_EMOJI.vida} -${rules.disarmFailSanity} ${STAT_EMOJI.sanidade}]`;
    case 'forcar':
      return `[-${rules.forceEnergy} ${STAT_EMOJI.energia} | falha: -${rules.forceFailLife} ${STAT_EMOJI.vida}]`;
    case 'analisar':
      return `[-${rules.analyzeSanity} ${STAT_EMOJI.sanidade}]`;
    default:
      return '';
  }
}

function canPayCombatActionCost(role) {
  const energy = getEffectiveStatus('energia');
  const sanity = getEffectiveStatus('sanidade');
  switch (role) {
    case 'combat_attack':
      return energy >= COMBAT_ATTACK_ENERGY_COST;
    case 'combat_defend':
      return energy >= COMBAT_DEFEND_ENERGY_COST;
    case 'flee':
      return energy >= FLEE_ENERGY_COST && sanity >= FLEE_SANITY_COST;
    default:
      return true;
  }
}

function applyStatusAndGetRealDelta(key, delta) {
  if (typeof key !== 'string' || !Number.isFinite(delta)) return 0;
  const before = getEffectiveStatus(key);
  PlayerAPI.addStatus(key, delta);
  const after = getEffectiveStatus(key);
  return Math.trunc(after - before);
}

function formatStatusDeltaMessage(label, delta) {
  return `${delta >= 0 ? '+' : ''}${delta} ${label}`;
}

function rollTrapBonus() {
  return Math.floor(nextRandom() * 4);
}

function runTrapAction(trapKind, room) {
  const rules = getTrapRules(room);
  const msgs = [];

  switch (trapKind) {
    case 'desarmar': {
      const score = getEffectiveAtributo('precisao') + Math.floor(getEffectiveAtributo('agilidade') / 2) + rollTrapBonus();
      if (score >= rules.difficulty) {
        msgs.push(t('trap.disarm_success', 'Armadilha desarmada'));
        return msgs;
      }
      msgs.push(t('trap.disarm_fail', 'Falha no desarme'));
      const lifeDelta = applyStatusAndGetRealDelta('vida', -rules.disarmFailLife);
      const sanityDelta = applyStatusAndGetRealDelta('sanidade', -rules.disarmFailSanity);
      if (lifeDelta !== 0) msgs.push(formatStatusDeltaMessage('Vida', lifeDelta));
      if (sanityDelta !== 0) msgs.push(formatStatusDeltaMessage('Sanidade', sanityDelta));
      return msgs;
    }
    case 'forcar': {
      const energyDelta = applyStatusAndGetRealDelta('energia', -rules.forceEnergy);
      const score = getEffectiveAtributo('ataque') + Math.floor(getEffectiveAtributo('defesa') / 2) + rollTrapBonus();
      if (score >= rules.difficulty) {
        msgs.push(t('trap.force_success', 'Passagem forçada'));
        if (energyDelta !== 0) msgs.push(formatStatusDeltaMessage('Energia', energyDelta));
        return msgs;
      }
      msgs.push(t('trap.force_fail', 'Você força a passagem, mas se fere'));
      if (energyDelta !== 0) msgs.push(formatStatusDeltaMessage('Energia', energyDelta));
      const lifeDelta = applyStatusAndGetRealDelta('vida', -rules.forceFailLife);
      if (lifeDelta !== 0) msgs.push(formatStatusDeltaMessage('Vida', lifeDelta));
      return msgs;
    }
    case 'analisar': {
      msgs.push(t('trap.analyze_success', 'Rota segura encontrada'));
      const sanityDelta = applyStatusAndGetRealDelta('sanidade', -rules.analyzeSanity);
      if (sanityDelta !== 0) msgs.push(formatStatusDeltaMessage('Sanidade', sanityDelta));
      return msgs;
    }
    default:
      return msgs;
  }
}

function _formatEffectsForButton(action, role, room = null) {
  if (role === 'explore') return `[-${EXPLORE_ENERGY_COST} ${STAT_EMOJI.energia}]`;
  if (role === 'flee') return `[-${FLEE_ENERGY_COST} ${STAT_EMOJI.energia} -${FLEE_SANITY_COST} ${STAT_EMOJI.sanidade}]`;

  const combatPreview = getCombatActionCostPreview(role);
  if (combatPreview) return combatPreview;

  const trapPreview = getTrapActionPreview(action, room);
  if (trapPreview) return trapPreview;

  const effs = action && Array.isArray(action.effects) ? action.effects : [];
  if (!effs.length) return '';

  const parts = [];
  for (let i = 0; i < effs.length; i++) {
    const eff = effs[i];
    if (!eff || typeof eff.type !== 'string') continue;

    switch (eff.type) {
      case 'noop':
        break;
      case 'statusDeltaPctOfMax': {
        const key = String(eff.key || '');
        const p = _pctToInt(eff.pct);
        const em = STAT_EMOJI[key];
        if (p !== null && em && p !== 0) parts.push(`+${p}% ${em}`);
        break;
      }
      case 'statusDelta': {
        const key = String(eff.key || '');
        const em = STAT_EMOJI[key];
        const d = Math.trunc(Number(eff.delta) || 0);
        if (em && d !== 0) parts.push(`${d >= 0 ? '+' : ''}${d} ${em}`);
        break;
      }
      case 'atributoDelta': {
        const key = String(eff.key || '');
        const em = ATR_EMOJI[key];
        const d = Math.trunc(Number(eff.delta) || 0);
        if (em && d !== 0) parts.push(`${d >= 0 ? '+' : ''}${d} ${em}`);
        break;
      }
      case 'statusMaxDelta': {
        const key = String(eff.key || '');
        const em = STAT_EMOJI[key];
        const d = Math.trunc(Number(eff.delta) || 0);
        if (em && d !== 0) parts.push(`${d >= 0 ? '+' : ''}${d} Máx ${em}`);
        break;
      }
      case 'xpDeltaRange': {
        const min = Math.floor(Number(eff.min));
        const max = Math.floor(Number(eff.max));
        if (Number.isFinite(min) && Number.isFinite(max) && max >= min) {
          parts.push(`+${min}–${max} ${XP_EMOJI}`);
        }
        break;
      }
      case 'xpDelta': {
        const a = Math.trunc(Number(eff.amount) || 0);
        if (a !== 0) parts.push(`${a >= 0 ? '+' : ''}${a} ${XP_EMOJI}`);
        break;
      }
      default:
        break;
    }
  }

  return parts.length ? `[${parts.join(' ')}]` : '';
}

function pickNextRoomId() {
  const ids = Array.isArray(ROOM_IDS) ? ROOM_IDS.slice() : [];
  if (!ids.length) return STATE.currentRoomId;

  const boosted = !!STATE.nextRoomEmptyChanceRealBoost;
  STATE.nextRoomEmptyChanceRealBoost = false;

  if (!boosted) {
    return ids[Math.floor(nextRandom() * ids.length)] || STATE.currentRoomId;
  }

  const emptyId = 'sala_vazia';
  const others = ids.filter(id => id !== emptyId);
  if (!ids.includes(emptyId) || others.length === 0) {
    return ids[Math.floor(nextRandom() * ids.length)] || STATE.currentRoomId;
  }

  if (nextRandom() < 0.5) return emptyId;
  return others[Math.floor(nextRandom() * others.length)] || emptyId;
}

export function renderRoom() {
  const room = ROOMS[STATE.currentRoomId] || ROOMS['sala_vazia'];
  const trap = isTrapRoom(STATE.currentRoomId);
  const combat = isCombatRoom(STATE.currentRoomId);
  const isGO = isGameOverRoom(STATE.currentRoomId);
  const sceneMode = room.sceneMode === 'enemy' ? 'enemy' : 'room';

  if (sceneMode === 'enemy') {
    const encounter = ensureEncounterForCurrentRoom();
    showEnemyPanel(encounter && encounter.enemy ? encounter.enemy : null, { backgroundUrl: room.bg || null });
  } else {
    clearCombatEnemy();

    let title = '';
    if (isGO) {
      const base = room.titleKey ? t(room.titleKey, room.title || '') : (room.title || 'Fim de Jogo');
      title = `${base} — Pontuação: 0`;
    } else {
      title = room.titleKey ? t(room.titleKey, room.title || '') : (room.title || '');
    }

    const altDesc = pickRoomDescVariant(STATE.currentRoomId);
    const desc = altDesc != null
      ? altDesc
      : (room.descKey ? t(room.descKey, room.desc || '') : (room.desc || ''));

    showRoomPanel({ title, desc: desc || '', backgroundUrl: room.bg || null });
  }

  if (isGO) {
    for (let i = 0; i < 3; i++) { setActionLabel(i, ''); enableAction(i, false); }
    setActionLabel(3, t('action.jogar_novamente', 'Jogar Novamente'));
    enableAction(3, true);
    return;
  }

  if (combat) {
    const playerTurn = isPlayerCombatTurn();
    const availability = getCombatActionAvailability();
    const skill = getActiveCombatSkill();
    const attackAction = room.actions?.[0];
    const defendAction = room.actions?.[1];
    const skillAction = room.actions?.[2];
    const fleeAction = room.actions?.[3];

    const attackLabel = attackAction?.labelKey ? t(attackAction.labelKey, attackAction.label || '') : (attackAction?.label || '');
    const defendLabel = defendAction?.labelKey ? t(defendAction.labelKey, defendAction.label || '') : (defendAction?.label || '');
    const skillBaseLabel = (skill && skill.name) || (skillAction?.labelKey ? t(skillAction.labelKey, skillAction.label || '') : (skillAction?.label || ''));
    const attackSuffix = _formatEffectsForButton(attackAction, 'combat_attack', room);
    const defendSuffix = _formatEffectsForButton(defendAction, 'combat_defend', room);
    const fleeBaseLabel = fleeAction?.labelKey ? t(fleeAction.labelKey, fleeAction.label || '') : (fleeAction?.label || '');
    const fleeSuffix = _formatEffectsForButton(fleeAction, 'flee', room);

    setActionLabel(0, attackSuffix ? `${attackLabel} ${attackSuffix}` : attackLabel);
    enableAction(0, !!attackAction && !!availability.attack && playerTurn && canPayCombatActionCost('combat_attack'));

    setActionLabel(1, defendSuffix ? `${defendLabel} ${defendSuffix}` : defendLabel);
    enableAction(1, !!defendAction && !!availability.defend && playerTurn && canPayCombatActionCost('combat_defend'));

    setActionLabel(2, skillBaseLabel);
    enableAction(2, !!skillAction && !!availability.skill && playerTurn && !!skill && hasUsableActiveCombatSkill());

    setActionLabel(3, fleeSuffix ? `${fleeBaseLabel} ${fleeSuffix}` : fleeBaseLabel);
    enableAction(3, !!fleeAction && !!availability.flee && playerTurn && canPayCombatActionCost('flee'));
    return;
  }

  let anyNonExploreUsed = false;
  const singleChoiceActs = !!room.singleChoiceActs;
  if (trap || singleChoiceActs) {
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
      const baseLabel = a.labelKey ? t(a.labelKey, a.label || '') : (a.label || '');
      const role = a.role || 'act';
      const suffix = _formatEffectsForButton(a, role, room);
      const finalLabel = suffix ? `${baseLabel} ${suffix}` : baseLabel;

      setActionLabel(i, finalLabel);

      let enabled = true;
      if (trap) {
        if (role === 'explore') {
          enabled = anyNonExploreUsed;
        } else {
          enabled = !anyNonExploreUsed && !isActionUsedToday(STATE.currentRoomId, i);
        }
      } else if (singleChoiceActs) {
        if (role === 'explore') {
          enabled = true;
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


/* =====================[ TRECHO 6: Effect Runner (execução + coleta de mensagens) ]===================== */
function runEffectsCollectMessages(effects) {
  const msgs = [];
  if (!effects || !effects.length) return msgs;

  const STAT_LABEL = { vida:'Vida', energia:'Energia', mana:'Mana', sanidade:'Sanidade' };
  const ATR_LABEL  = { ataque:'Ataque', defesa:'Defesa', precisao:'Precisão', agilidade:'Agilidade' };

  const toInt = (n) => Math.trunc(Number(n) || 0);

  for (let i = 0; i < effects.length; i++) {
    const eff = effects[i];
    if (!eff || typeof eff.type !== 'string') continue;

    switch (eff.type) {
      case 'noop':
        break;
      case 'statusDelta': {
        const { key, delta } = eff;
        if (typeof key === 'string' && Number.isFinite(delta)) {
          const realDelta = applyStatusAndGetRealDelta(key, delta);
          const label = STAT_LABEL[key] || key;
          if (realDelta !== 0) msgs.push(`${realDelta >= 0 ? '+' : ''}${toInt(realDelta)} ${label}`);
        }
        break;
      }
      case 'statusDeltaPctOfMax': {
        const { key, pct } = eff;
        if (typeof key === 'string' && Number.isFinite(pct)) {
          const maxEff = getEffectiveStatusMax(key);
          const delta = Math.floor(Math.max(0, pct) * Math.max(0, maxEff));
          if (delta !== 0) {
            const realDelta = applyStatusAndGetRealDelta(key, delta);
            const label = STAT_LABEL[key] || key;
            if (realDelta !== 0) msgs.push(`${realDelta >= 0 ? '+' : ''}${toInt(realDelta)} ${label}`);
          }
        }
        break;
      }
      case 'atributoDelta': {
        const { key, delta } = eff;
        if (typeof key === 'string' && Number.isFinite(delta)) {
          PlayerAPI.addAtributo(key, delta);
          const label = ATR_LABEL[key] || key;
          msgs.push(`${delta >= 0 ? '+' : ''}${toInt(delta)} ${label}`);
        }
        break;
      }
      case 'statusMaxDelta': {
        const { key, delta } = eff;
        if (typeof key === 'string' && Number.isFinite(delta)) {
          PlayerAPI.addStatusMax(key, delta);
          const label = STAT_LABEL[key] || key;
          msgs.push(`${delta >= 0 ? '+' : ''}${toInt(delta)} Máx. ${label}`);
        }
        break;
      }
      case 'xpDelta': {
        const { amount } = eff;
        if (Number.isFinite(amount)) {
          PlayerAPI.addXP(amount);
          msgs.push(`${amount >= 0 ? '+' : ''}${toInt(amount)} XP`);
        }
        break;
      }
      case 'xpDeltaRange': {
        const min = Math.floor(Number(eff.min));
        const max = Math.floor(Number(eff.max));
        if (Number.isFinite(min) && Number.isFinite(max) && max >= min) {
          const span = (max - min + 1);
          const roll = min + Math.floor(nextRandom() * span);
          PlayerAPI.addXP(roll);
          msgs.push(`+${toInt(roll)} XP`);
        }
        break;
      }
      case 'addMod': {
        const { mod } = eff;
        if (mod && typeof mod === 'object') {
          addModifier(mod);
          msgs.push('Mod aplicado');
        }
        break;
      }
      case 'removeModById': {
        const { id } = eff;
        if (typeof id === 'string') { removeModifierById(id); msgs.push('Mod removido'); }
        break;
      }
      case 'removeModsBySource': {
        const { source } = eff;
        if (typeof source === 'string') { removeModifiersBySource(source); msgs.push('Mod removido'); }
        break;
      }
      case 'removeModsByTag': {
        const { tag } = eff;
        if (typeof tag === 'string') { removeModifiersByTag(tag); msgs.push('Mod removido'); }
        break;
      }
      default:
        break;
    }
  }
  return msgs;
}
/* =====================[ FIM TRECHO 6 ]===================== */


/* =====================[ TRECHO 7: Resolução central de combate ]===================== */
function appendActionLog(eventLabel, effectMsgs) {
  if (!eventLabel) return;
  const tail = effectMsgs.length ? ` ${effectMsgs.join(', ')}` : '';
  appendLog({ sev: 'mod', msg: `${String(eventLabel)}:${tail}`, ctx: { day: getDay() } });
}

function appendActionLogSections(eventLabel, sections) {
  if (!eventLabel) return;
  const normalized = Array.isArray(sections) ? sections : [];
  let wroteAny = false;

  for (let i = 0; i < normalized.length; i++) {
    const section = normalized[i];
    const msgs = Array.isArray(section)
      ? section.filter(msg => typeof msg === 'string' && msg.trim())
      : [];
    if (!msgs.length) continue;

    const prefix = wroteAny ? '' : `${String(eventLabel)}: `;
    appendLog({ sev: 'mod', msg: `${prefix}${msgs.join(', ')}`, ctx: { day: getDay() } });
    wroteAny = true;
  }

  if (!wroteAny) {
    appendLog({ sev: 'mod', msg: `${String(eventLabel)}:`, ctx: { day: getDay() } });
  }
}

function moveToNextRoomAfterCombat(effectMsgs) {
  STATE.nextRoomEmptyChanceRealBoost = true;
  addDay(1);
  setRunlineDay(getDay());
  resetActionUsageForToday();
  clearCombatEnemy();
  STATE.currentRoomId = pickNextRoomId();
  renderRoom();
}

function resolveCombatOutcome(outcome) {
  const safeOutcome = outcome && typeof outcome === 'object' ? outcome : { kind: 'none' };
  const summaryMsgs = [];
  switch (safeOutcome.kind) {
    case 'victory': {
      const xpReward = Math.max(0, Math.floor(Number(safeOutcome.xpReward) || 0));
      if (xpReward > 0) {
        PlayerAPI.addXP(xpReward);
        summaryMsgs.push(`+${xpReward} XP`);
      }
      summaryMsgs.unshift(t('combat.victory', 'Vitória'));
      moveToNextRoomAfterCombat(summaryMsgs);
      return { terminal: true, summaryMsgs };
    }
    case 'defeat': {
      goToGameOver();
      return { terminal: true, summaryMsgs };
    }
    default:
      return { terminal: false, summaryMsgs };
  }
}

function resolveCombatEnemyPhase() {
  const enemyStep = resolvePendingEnemyTurn();
  if (!enemyStep.ok) return false;
  for (const msg of enemyStep.enemyLogs) {
    appendLog({ sev: 'combat', msg, ctx: { day: getDay() } });
  }
  resolveCombatOutcome(enemyStep.outcome);
  renderRoom();
  return true;
}

async function resolveCombatEnemyPhaseWithDelay() {
  const responseToken = createCombatResponseToken();
  const stillValid = await waitEnemyResponseWindow(responseToken);
  if (!stillValid) return false;
  return resolveCombatEnemyPhase();
}
/* =====================[ FIM TRECHO 7 ]===================== */


/* =====================[ TRECHO 8: Input Lock e Dispatcher de Ações (log minimalista) ]===================== */
function withInputLock(fn) {
  if (inputLocked) return;
  inputLocked = true;

  const unlock = () => {
    requestAnimationFrame(() => { inputLocked = false; });
  };

  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.finally(unlock);
    }
    unlock();
    return result;
  } catch (err) {
    unlock();
    throw err;
  }
}

function _stripButtonSuffix(label) {
  const s = String(label || '');
  const cut = s.indexOf(' [');
  return cut > 0 ? s.slice(0, cut) : s;
}

function getCombatActionTypeFromRole(role) {
  if (role === 'combat_attack') return 'attack';
  if (role === 'combat_defend') return 'defend';
  if (role === 'combat_skill') return 'skill';
  return null;
}

export function handleAction(idx) {
  return withInputLock(async () => {
    ensureActionUsageDaySync();

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

    const role = action.role || 'act';
    const eventLabel = action.labelKey
      ? t(action.labelKey, '')
      : _stripButtonSuffix(getActionLabel(idx));

    if (role === 'act' && isActionUsedToday(STATE.currentRoomId, idx)) {
      return;
    }
    if (role === 'act') {
      markActionUsedToday(STATE.currentRoomId, idx);
    }

    const effectMsgs = [];

    if (role === 'flee') {
      if (!canPayCombatActionCost('flee')) return;
      const fleeEnergyDelta = applyStatusAndGetRealDelta('energia', -FLEE_ENERGY_COST);
      const fleeSanityDelta = applyStatusAndGetRealDelta('sanidade', -FLEE_SANITY_COST);
      if (fleeEnergyDelta !== 0) effectMsgs.push(formatStatusDeltaMessage('Energia', fleeEnergyDelta));
      if (fleeSanityDelta !== 0) effectMsgs.push(formatStatusDeltaMessage('Sanidade', fleeSanityDelta));

      const success = nextRandom() < FLEE_SUCCESS_CHANCE;
      if (success) {
        const summaryMsgs = [t('combat.flee_success', 'Fuga bem-sucedida')];
        moveToNextRoomAfterCombat(summaryMsgs);
        appendActionLogSections(eventLabel, [effectMsgs, summaryMsgs]);
        renderHUD();
        renderLog(getLogLastNTexts(4));
        return;
      } else {
        effectMsgs.push(t('combat.flee_fail', 'Fuga falhou'));
        appendActionLog(eventLabel, effectMsgs);
        renderHUD();
        renderLog(getLogLastNTexts(4));
        const enemyPhaseResolved = await resolveCombatEnemyPhaseWithDelay();
        if (enemyPhaseResolved && checkGameOver()) {
          renderHUD();
          renderLog(getLogLastNTexts(4));
          return;
        }
        renderHUD();
        renderLog(getLogLastNTexts(4));
        return;
      }
    } else {
      const combatActionType = getCombatActionTypeFromRole(role);
      if (combatActionType) {
        if (!canPayCombatActionCost(role)) return;
        const primaryMsgs = [];
        if (role === 'combat_attack') {
          const energyDelta = applyStatusAndGetRealDelta('energia', -COMBAT_ATTACK_ENERGY_COST);
          if (energyDelta !== 0) primaryMsgs.push(formatStatusDeltaMessage('Energia', energyDelta));
        } else if (role === 'combat_defend') {
          const energyDelta = applyStatusAndGetRealDelta('energia', -COMBAT_DEFEND_ENERGY_COST);
          if (energyDelta !== 0) primaryMsgs.push(formatStatusDeltaMessage('Energia', energyDelta));
        }
        const combatStep = queueCombatPlayerAction(combatActionType);
        if (!combatStep.ok) return;
        primaryMsgs.push(...(Array.isArray(combatStep.playerMsgs) ? combatStep.playerMsgs.slice() : []));
        const outcomeResolution = resolveCombatOutcome(combatStep.outcome);
        appendActionLogSections(eventLabel, [primaryMsgs, outcomeResolution.summaryMsgs]);
        renderHUD();
        renderLog(getLogLastNTexts(4));
        if (!outcomeResolution.terminal && !isPlayerCombatTurn()) {
          const enemyPhaseResolved = await resolveCombatEnemyPhaseWithDelay();
          if (enemyPhaseResolved && checkGameOver()) {
            renderHUD();
            renderLog(getLogLastNTexts(4));
            return;
          }
        }
        renderHUD();
        renderLog(getLogLastNTexts(4));
        return;
      }

      if (isTrapRoom(STATE.currentRoomId) && role === 'act' && typeof action.trapKind === 'string') {
        effectMsgs.push(...runTrapAction(action.trapKind, room));
      } else {
        effectMsgs.push(...runEffectsCollectMessages(action.effects || []));
      }
    }

    if ((isTrapRoom(STATE.currentRoomId) || room.singleChoiceActs) && role === 'act') {
      for (let j = 0; j < 4; j++) {
        const aj = room.actions?.[j];
        const rj = aj ? (aj.role || 'act') : 'act';
        if (aj && rj === 'act') markActionUsedToday(STATE.currentRoomId, j);
      }
      renderRoom();
    }

    if (role === 'explore') {
      const exploreEnergyDelta = applyStatusAndGetRealDelta('energia', -EXPLORE_ENERGY_COST);
      if (exploreEnergyDelta !== 0) effectMsgs.push(`${exploreEnergyDelta >= 0 ? '+' : ''}${exploreEnergyDelta} Energia`);

      addDay(1);
      setRunlineDay(getDay());
      resetActionUsageForToday();

      clearCombatEnemy();
      STATE.currentRoomId = pickNextRoomId();
      renderRoom();
    }

    if (checkGameOver()) {
      renderHUD();
      appendActionLog(eventLabel, effectMsgs);
      renderLog(getLogLastNTexts(4));
      return;
    }

    renderHUD();
    appendActionLog(eventLabel, effectMsgs);
    renderLog(getLogLastNTexts(4));
  });
}
/* =====================[ FIM TRECHO 8 ]===================== */
