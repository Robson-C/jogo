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
  getEffectiveStatus, getEffectiveStatusMax, getEffectiveAtributo, getActiveCombatSkill,
  getCurrentFloor, setCurrentFloor, setSaveSlot, createFreshSeedForCurrentSlot, clearLogEntries
} from './state.js';
import { setActionLabel, enableAction, getActionLabel, renderLog, setRunlineDay, setRunlineFloor, renderHUD } from './ui.js';
import { showRoomPanel, showEnemyPanel } from './scene_panel.js';
import { ROOMS, ROOM_IDS } from './rooms.js';
import { t } from './i18n.js';
import { ensureEncounterForCurrentRoom, clearCurrentEncounter, isCombatEncounterRoom, getCurrentEncounter } from './encounter.js';
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
 * Estado centralizado em STATE; aqui só normalizamos compatibilidade de runtime.
 */
if (!(STATE.actionsUsed instanceof Set)) {
  STATE.actionsUsed = new Set(Array.isArray(STATE.actionsUsed) ? STATE.actionsUsed : []);
}
if (!Number.isFinite(Number(STATE.actionsLastResetDay))) {
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

function getClearedCombatRoomId() {
  return typeof STATE.clearedCombatRoomId === 'string' ? STATE.clearedCombatRoomId : '';
}

function getClearedCombatRoomType() {
  return typeof STATE.clearedCombatRoomType === 'string' ? STATE.clearedCombatRoomType : '';
}

function isClearedCombatRoom(roomId = STATE.currentRoomId) {
  return isCombatRoom(roomId) && getClearedCombatRoomId() === String(roomId || '');
}

function isClearedBossCombatRoom(roomId = STATE.currentRoomId) {
  return isClearedCombatRoom(roomId) && getClearedCombatRoomType() === 'boss';
}

function markCurrentCombatRoomCleared(kind = 'normal') {
  STATE.clearedCombatRoomId = String(STATE.currentRoomId || '');
  STATE.clearedCombatRoomType = kind === 'boss' ? 'boss' : 'normal';
}

function clearClearedCombatRoom() {
  STATE.clearedCombatRoomId = '';
  STATE.clearedCombatRoomType = '';
}

function getEmptyRoomFaintRecoveryRoomId() {
  return typeof STATE.emptyRoomFaintRecoveryRoomId === 'string' ? STATE.emptyRoomFaintRecoveryRoomId : '';
}

function isEmptyRoomFaintRecovery(roomId = STATE.currentRoomId) {
  return String(roomId || '') === 'sala_vazia' && getEmptyRoomFaintRecoveryRoomId() === String(roomId || '');
}

function markCurrentRoomAsEmptyRoomFaintRecovery() {
  STATE.emptyRoomFaintRecoveryRoomId = String(STATE.currentRoomId || '');
}

function clearEmptyRoomFaintRecovery() {
  STATE.emptyRoomFaintRecoveryRoomId = '';
}

function rollIntInclusive(min, max) {
  const lo = Math.floor(Number(min) || 0);
  const hi = Math.floor(Number(max) || 0);
  if (hi <= lo) return lo;
  return lo + Math.floor(nextRandom() * (hi - lo + 1));
}

function ensureFloorBossProgressInitialized() {
  const state = String(STATE.floorBossState || 'pending');
  const countdown = Math.floor(Number(STATE.floorBossCountdown) || 0);
  if (state !== 'pending' || countdown > 0) return;
  STATE.floorBossState = 'pending';
  STATE.floorBossCountdown = rollIntInclusive(FLOOR_BOSS_INITIAL_MIN_ROOMS, FLOOR_BOSS_INITIAL_MAX_ROOMS);
}

function resetFloorBossProgressInitial() {
  STATE.floorBossState = 'pending';
  STATE.floorBossCountdown = rollIntInclusive(FLOOR_BOSS_INITIAL_MIN_ROOMS, FLOOR_BOSS_INITIAL_MAX_ROOMS);
}

function resetFloorBossProgressAfterBossFlee() {
  STATE.floorBossState = 'pending';
  STATE.floorBossCountdown = rollIntInclusive(FLOOR_BOSS_RESET_MIN_ROOMS, FLOOR_BOSS_RESET_MAX_ROOMS);
}

function markFloorBossEncounterActive() {
  STATE.floorBossState = 'active';
  STATE.floorBossCountdown = 0;
}

function markFloorBossDefeated() {
  STATE.floorBossState = 'defeated';
  STATE.floorBossCountdown = 0;
}

function isCurrentEncounterBoss() {
  const encounter = getCurrentEncounter();
  return !!(encounter && (encounter.isBoss || String(encounter?.enemy?.tipo || '') === 'boss'));
}

function shouldEnterBossRoomOnNextExplore(options = {}) {
  const consumeBossProgress = options && options.consumeBossProgress !== false;
  ensureFloorBossProgressInitialized();
  if (!consumeBossProgress) return false;
  if (String(STATE.floorBossState || 'pending') !== 'pending') return false;

  const countdown = Math.max(1, Math.floor(Number(STATE.floorBossCountdown) || 1));
  if (countdown <= 1) {
    markFloorBossEncounterActive();
    return true;
  }

  STATE.floorBossCountdown = countdown - 1;
  return false;
}

function advanceToNextFloor() {
  const nextFloor = setCurrentFloor(getCurrentFloor() + 1);
  resetFloorBossProgressInitial();
  setRunlineFloor(nextFloor);
  return nextFloor;
}

function getEmptyRoomFaintRecoveryEffects() {
  const emptyRoom = ROOMS['sala_vazia'];
  const restAction = emptyRoom && Array.isArray(emptyRoom.actions) ? emptyRoom.actions[0] : null;
  const effects = restAction && Array.isArray(restAction.effects) ? restAction.effects : [];
  const out = [];

  for (let i = 0; i < effects.length; i++) {
    const eff = effects[i];
    if (!eff || typeof eff.type !== 'string') continue;

    if (eff.type === 'statusDeltaPctOfMax' && typeof eff.key === 'string' && Number.isFinite(eff.pct)) {
      out.push({ ...eff, pct: Math.max(0, Number(eff.pct) * 0.5) });
      continue;
    }

    if (eff.type === 'statusDelta' && typeof eff.key === 'string' && Number.isFinite(eff.delta)) {
      out.push({ ...eff, delta: Math.trunc(Number(eff.delta) / 2) });
    }
  }

  return out;
}

function tryResolveEmptyRoomFaintRecovery(nextRoomId) {
  if (String(nextRoomId || '') !== 'sala_vazia') {
    clearEmptyRoomFaintRecovery();
    return { triggered: false, recoveryMsgs: [], summaryMsgs: [] };
  }

  if (getRuntimeStatusValue('energia') > 0) {
    clearEmptyRoomFaintRecovery();
    return { triggered: false, recoveryMsgs: [], summaryMsgs: [] };
  }

  const recoveryMsgs = runEffectsCollectMessages(getEmptyRoomFaintRecoveryEffects());
  if (getRuntimeStatusValue('energia') <= 0) {
    clearEmptyRoomFaintRecovery();
    return { triggered: false, recoveryMsgs: [], summaryMsgs: [] };
  }

  markCurrentRoomAsEmptyRoomFaintRecovery();
  return {
    triggered: true,
    recoveryMsgs,
    summaryMsgs: [t('explore.empty_room_faint_recovery', 'Você desmaiou ao entrar na nova sala. Por sorte, ela estava vazia e você conseguiu descansar um pouco.')]
  };
}

function clearTransientRoomState() {
  clearEmptyRoomFaintRecovery();
  clearClearedCombatRoom();
  clearCombatEnemy();
}

function resetRunStateToFirstRoom() {
  clearAllModifiers();
  initPlayerDefaults();
  setDay(1);
  setCurrentFloor(1);
  STATE.gameOverCause = '';
  resetFloorBossProgressInitial();
  resetActionUsageForToday();
  STATE.nextRoomEmptyChanceRealBoost = false;
  clearTransientRoomState();
  STATE.currentRoomId = 'sala_vazia';
  setRunlineDay(getDay());
  setRunlineFloor(getCurrentFloor());
}

/** [DOC] Reinicia a run (mantém seed/RNG); limpa mods; reseta jogador e Dia; volta à sala inicial. */
export function restartRun() {
  resetRunStateToFirstRoom();
  renderRoom();
  renderHUD();
}

export function startNewGameForSlot(slot) {
  // [ALERTA DE MUDANÇA] Novo Jogo agora escolhe slot, gera seed nova do slot e cria a run inicial limpa antes do primeiro save.
  setSaveSlot(slot);
  createFreshSeedForCurrentSlot();
  clearLogEntries();
  STATE.bootInitLogged = false;
  inputLocked = false;
  resetRunStateToFirstRoom();
  renderRoom();
  renderHUD();
  renderLog(getLogLastNTexts(4));
  return true;
}

/* [CHANGE] Unifica as leituras críticas de status com a mesma fonte efetiva usada por HUD e combate. */
function getRuntimeStatusValue(key) {
  return Math.max(0, Math.floor(Number(getEffectiveStatus(key)) || 0));
}

function getFatalStatusCause() {
  if (getRuntimeStatusValue('vida') <= 0) return 'death';
  if (getRuntimeStatusValue('sanidade') <= 0) return 'insanity';
  if (getRuntimeStatusValue('energia') <= 0) return 'exhaustion';
  return '';
}

function getGameOverDescriptionByCause() {
  switch (String(STATE.gameOverCause || '')) {
    case 'death':
      return t('room.fim_de_jogo.desc.death', 'Seus ferimentos foram demais. Você morre antes de seguir adiante.');
    case 'insanity':
      return t('room.fim_de_jogo.desc.insanity', 'Sua mente cede ao horror. Você enlouquece antes de continuar.');
    case 'exhaustion':
      return t('room.fim_de_jogo.desc.exhaustion', 'Seu corpo não responde mais. Você cai por exaustão.');
    default:
      return t('room.fim_de_jogo.desc', 'Sua jornada termina aqui — por enquanto.');
  }
}

function goToGameOver(cause = '') {
  STATE.gameOverCause = typeof cause === 'string' ? cause : '';
  if (isGameOverRoom(STATE.currentRoomId)) return true;
  clearTransientRoomState();
  STATE.currentRoomId = GAME_OVER_ROOM_ID;
  renderRoom();
  return true;
}

/** [DOC] Fim de jogo centralizado por status efetivo zerado. */
function checkGameOver() {
  const cause = getFatalStatusCause();
  if (cause && !isGameOverRoom(STATE.currentRoomId)) {
    return goToGameOver(cause);
  }
  return false;
}

function hasAnyUsableCombatAction() {
  if (!isCombatRoom(STATE.currentRoomId) || isClearedCombatRoom(STATE.currentRoomId) || isGameOverRoom(STATE.currentRoomId)) return true;
  if (!isPlayerCombatTurn()) return true;

  const room = ROOMS[STATE.currentRoomId] || ROOMS['sala_vazia'];
  const availability = getCombatActionAvailability();
  const skill = getActiveCombatSkill();

  const canAttack = !!room.actions?.[0] && !!availability.attack && canPayCombatActionCost('combat_attack');
  const canDefend = !!room.actions?.[1] && !!availability.defend && canPayCombatActionCost('combat_defend');
  const canSkill = !!room.actions?.[2] && !!availability.skill && !!skill && hasUsableActiveCombatSkill();
  const canFlee = !!room.actions?.[3] && !!availability.flee && canPayCombatActionCost('flee');

  return canAttack || canDefend || canSkill || canFlee;
}

function checkCombatDeadendGameOver() {
  if (!hasAnyUsableCombatAction() && !isGameOverRoom(STATE.currentRoomId)) {
    return goToGameOver('exhaustion');
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
const FLEE_BASE_SUCCESS_CHANCE = 0.7;
const FLEE_AGILITY_DIFF_STEP = 0.025;
const FLOOR_BOSS_INITIAL_MIN_ROOMS = 30;
const FLOOR_BOSS_INITIAL_MAX_ROOMS = 45;
const FLOOR_BOSS_RESET_MIN_ROOMS = 6;
const FLOOR_BOSS_RESET_MAX_ROOMS = 10;

const TRAP_RULES_BY_FLOOR = Object.freeze({
  1: Object.freeze({ difficulty: 8, disarmFailLife: 4, disarmFailSanity: 6, forceEnergy: 6, forceFailLife: 5, analyzeSanity: 10 }),
  2: Object.freeze({ difficulty: 9, disarmFailLife: 5, disarmFailSanity: 7, forceEnergy: 7, forceFailLife: 6, analyzeSanity: 11 }),
  3: Object.freeze({ difficulty: 10, disarmFailLife: 6, disarmFailSanity: 8, forceEnergy: 8, forceFailLife: 7, analyzeSanity: 12 }),
  4: Object.freeze({ difficulty: 11, disarmFailLife: 7, disarmFailSanity: 9, forceEnergy: 9, forceFailLife: 8, analyzeSanity: 13 }),
  5: Object.freeze({ difficulty: 12, disarmFailLife: 8, disarmFailSanity: 10, forceEnergy: 10, forceFailLife: 9, analyzeSanity: 14 })
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
  const floor = clampTrapFloor(getCurrentFloor());
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
  const energy = getRuntimeStatusValue('energia');
  const sanity = getRuntimeStatusValue('sanidade');
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

function getFleeSuccessChance(enemy) {
  const playerAgility = Math.max(0, Math.floor(Number(getEffectiveAtributo('agilidade')) || 0));
  const enemyAgility = Math.max(0, Math.floor(Number(enemy?.agilidade) || 0));
  const agilityDiff = playerAgility - enemyAgility;
  const chance = FLEE_BASE_SUCCESS_CHANCE + (agilityDiff * FLEE_AGILITY_DIFF_STEP);
  return Math.max(0, Math.min(1, chance));
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

function pickNextRoomId(options = {}) {
  const ids = Array.isArray(ROOM_IDS) ? ROOM_IDS.slice() : [];
  if (!ids.length) return STATE.currentRoomId;

  const boosted = !!STATE.nextRoomEmptyChanceRealBoost;
  STATE.nextRoomEmptyChanceRealBoost = false;

  if (shouldEnterBossRoomOnNextExplore(options)) {
    return 'sala_combate';
  }


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

function setActionState(index, label, enabled) {
  setActionLabel(index, label);
  enableAction(index, enabled);
}

function setExploreOnlyActions(room) {
  setActionState(0, '', false);
  setActionState(1, '', false);
  setActionState(2, '', false);

  const exploreLabel = t('action.explorar', 'Explorar');
  const exploreSuffix = _formatEffectsForButton({ role: 'explore', effects: [] }, 'explore', room);
  setActionState(3, exploreSuffix ? `${exploreLabel} ${exploreSuffix}` : exploreLabel, true);
}

function getRoomDisplayTitle(room, { isGO = false, bossCombatCleared = false, combatCleared = false, faintRecovery = false } = {}) {
  if (isGO) {
    const base = room.titleKey ? t(room.titleKey, room.title || '') : (room.title || 'Fim de Jogo');
    return `${base} — Pontuação: 0`;
  }
  if (bossCombatCleared) return t('room.sala_combate_boss_cleared.title', 'Sala do Boss');
  if (combatCleared) return t('room.sala_combate_cleared.title', 'Sala de Combate');
  if (faintRecovery) return t('room.sala_vazia_faint_recovery.title', 'Sala Vazia');
  return room.titleKey ? t(room.titleKey, room.title || '') : (room.title || '');
}

function getRoomDisplayDescription(room, { roomId = STATE.currentRoomId, isGO = false, bossCombatCleared = false, combatCleared = false, faintRecovery = false } = {}) {
  if (isGO) return getGameOverDescriptionByCause();
  if (bossCombatCleared) {
    return t('room.sala_combate_boss_cleared.desc', 'O boss caiu. A passagem para o próximo andar está livre. Você pode se preparar antes de seguir.');
  }
  if (combatCleared) {
    return t('room.sala_combate_cleared.desc', 'O inimigo caiu. A sala está vazia por enquanto. Você pode se preparar antes de seguir.');
  }
  if (faintRecovery) {
    return t('room.sala_vazia_faint_recovery.desc', 'Você desperta no chão frio. Ao entrar na nova sala, acabou desmaiando — por sorte, ela estava vazia e você conseguiu descansar um pouco. Ainda está fraco demais para qualquer coisa além de seguir em frente.');
  }

  const altDesc = pickRoomDescVariant(roomId);
  if (altDesc != null) return altDesc;
  return room.descKey ? t(room.descKey, room.desc || '') : (room.desc || '');
}

function renderScenePanelForCurrentRoom(room, flags) {
  const sceneMode = flags && flags.sceneMode === 'enemy' ? 'enemy' : 'room';
  if (sceneMode === 'enemy') {
    const encounter = ensureEncounterForCurrentRoom();
    showEnemyPanel(encounter && encounter.enemy ? encounter.enemy : null, { backgroundUrl: room.bg || null });
    return;
  }

  clearCombatEnemy();
  const title = getRoomDisplayTitle(room, flags);
  const desc = getRoomDisplayDescription(room, { ...flags, roomId: STATE.currentRoomId });
  showRoomPanel({ title, desc: desc || '', backgroundUrl: room.bg || null });
}

function renderGameOverActions() {
  setActionState(0, '', false);
  setActionState(1, '', false);
  setActionState(2, '', false);
  setActionState(3, t('action.jogar_novamente', 'Jogar Novamente'), true);
}

function renderCombatActions(room) {
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

  const attackEnabled = !!attackAction && !!availability.attack && playerTurn && canPayCombatActionCost('combat_attack');
  const defendEnabled = !!defendAction && !!availability.defend && playerTurn && canPayCombatActionCost('combat_defend');
  const skillEnabled = !!skillAction && !!availability.skill && playerTurn && !!skill && hasUsableActiveCombatSkill();
  const fleeEnabled = !!fleeAction && !!availability.flee && playerTurn && canPayCombatActionCost('flee');

  setActionState(0, attackSuffix ? `${attackLabel} ${attackSuffix}` : attackLabel, attackEnabled);
  setActionState(1, defendSuffix ? `${defendLabel} ${defendSuffix}` : defendLabel, defendEnabled);
  setActionState(2, skillBaseLabel, skillEnabled);
  setActionState(3, fleeSuffix ? `${fleeBaseLabel} ${fleeSuffix}` : fleeBaseLabel, fleeEnabled);

  if (playerTurn && !(attackEnabled || defendEnabled || skillEnabled || fleeEnabled)) {
    goToGameOver('exhaustion');
  }
}

function hasAnyNonExploreActionUsed(room, trap) {
  const singleChoiceActs = !!room.singleChoiceActs;
  if (!(trap || singleChoiceActs)) return false;

  for (let j = 0; j < 4; j++) {
    const action = room.actions?.[j];
    const role = action ? (action.role || 'act') : 'act';
    if (action && role !== 'explore' && isActionUsedToday(STATE.currentRoomId, j)) {
      return true;
    }
  }
  return false;
}

function renderStandardRoomActions(room, trap) {
  const anyNonExploreUsed = hasAnyNonExploreActionUsed(room, trap);
  const singleChoiceActs = !!room.singleChoiceActs;

  for (let i = 0; i < 4; i++) {
    const action = room.actions?.[i];
    if (!action) {
      setActionState(i, '???', false);
      continue;
    }

    const baseLabel = action.labelKey ? t(action.labelKey, action.label || '') : (action.label || '');
    const role = action.role || 'act';
    const suffix = _formatEffectsForButton(action, role, room);
    const finalLabel = suffix ? `${baseLabel} ${suffix}` : baseLabel;

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

    setActionState(i, finalLabel, enabled);
  }
}

export function renderRoom() {
  const room = ROOMS[STATE.currentRoomId] || ROOMS['sala_vazia'];
  const trap = isTrapRoom(STATE.currentRoomId);
  const combat = isCombatRoom(STATE.currentRoomId);
  const isGO = isGameOverRoom(STATE.currentRoomId);
  const combatCleared = combat && isClearedCombatRoom(STATE.currentRoomId);
  const bossCombatCleared = combat && isClearedBossCombatRoom(STATE.currentRoomId);
  const faintRecovery = isEmptyRoomFaintRecovery(STATE.currentRoomId);
  const sceneMode = (!combatCleared && room.sceneMode === 'enemy') ? 'enemy' : 'room';

  renderScenePanelForCurrentRoom(room, { isGO, bossCombatCleared, combatCleared, faintRecovery, sceneMode });

  if (isGO) {
    renderGameOverActions();
    return;
  }

  if (combat) {
    if (combatCleared) {
      setExploreOnlyActions(room);
      return;
    }
    renderCombatActions(room);
    return;
  }

  if (faintRecovery) {
    setExploreOnlyActions(room);
    return;
  }

  renderStandardRoomActions(room, trap);
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

function moveToNextRoomAfterCombat(options = {}) {
  addDay(1);
  setRunlineDay(getDay());
  resetActionUsageForToday();
  clearTransientRoomState();
  STATE.currentRoomId = pickNextRoomId(options);
  renderRoom();
}

function resolveCombatOutcome(outcome) {
  const safeOutcome = outcome && typeof outcome === 'object' ? outcome : { kind: 'none' };
  const summaryMsgs = [];
  switch (safeOutcome.kind) {
    case 'victory': {
      const wonBossEncounter = isCurrentEncounterBoss();
      const xpReward = Math.max(0, Math.floor(Number(safeOutcome.xpReward) || 0));
      if (xpReward > 0) {
        PlayerAPI.addXP(xpReward);
        summaryMsgs.push(`+${xpReward} XP`);
      }
      summaryMsgs.unshift(t('combat.victory', 'Vitória'));
      if (wonBossEncounter) {
        markFloorBossDefeated();
      }
      STATE.nextRoomEmptyChanceRealBoost = true;
      markCurrentCombatRoomCleared(wonBossEncounter ? 'boss' : 'normal');
      clearCombatEnemy();
      renderRoom();
      return { terminal: true, summaryMsgs };
    }
    case 'defeat': {
      goToGameOver(getFatalStatusCause() || 'death');
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
  const outcomeResolution = resolveCombatOutcome(enemyStep.outcome);
  if (outcomeResolution.terminal) return true;
  if (checkGameOver()) return true;
  renderRoom();
  checkCombatDeadendGameOver();
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

function refreshHUDAndLog() {
  renderHUD();
  renderLog(getLogLastNTexts(4));
}

function appendActionOutcomeLog(eventLabel, effectMsgs, summaryMsgs = []) {
  if (Array.isArray(summaryMsgs) && summaryMsgs.length) {
    appendActionLogSections(eventLabel, [effectMsgs, summaryMsgs]);
    return;
  }
  appendActionLog(eventLabel, effectMsgs);
}

function refreshHUDLogAndActionOutcome(eventLabel, effectMsgs, summaryMsgs = []) {
  renderHUD();
  appendActionOutcomeLog(eventLabel, effectMsgs, summaryMsgs);
  renderLog(getLogLastNTexts(4));
}

function logActionOutcomeAndRefresh(eventLabel, effectMsgs, summaryMsgs = []) {
  appendActionOutcomeLog(eventLabel, effectMsgs, summaryMsgs);
  renderHUD();
  renderLog(getLogLastNTexts(4));
}

function createActionContext(idx) {
  const room = ROOMS[STATE.currentRoomId] || ROOMS['sala_vazia'];
  const action = room.actions?.[idx];
  if (!action) return null;

  const combatCleared = isClearedCombatRoom(STATE.currentRoomId);
  const faintRecoveryRoom = isEmptyRoomFaintRecovery(STATE.currentRoomId);
  if ((combatCleared || faintRecoveryRoom) && idx !== 3) return null;

  const forcedExplore = (combatCleared || faintRecoveryRoom) && idx === 3;
  const role = forcedExplore ? 'explore' : (action.role || 'act');
  const eventLabel = forcedExplore
    ? t('action.explorar', 'Explorar')
    : (action.labelKey
      ? t(action.labelKey, '')
      : _stripButtonSuffix(getActionLabel(idx)));

  return {
    idx,
    room,
    action,
    role,
    eventLabel,
    effectMsgs: []
  };
}

function beginActionExecution(ctx) {
  if (!ctx || typeof ctx !== 'object') return false;
  if (ctx.role === 'act' && isActionUsedToday(STATE.currentRoomId, ctx.idx)) {
    return false;
  }
  if (ctx.role === 'act') {
    markActionUsedToday(STATE.currentRoomId, ctx.idx);
  }
  return true;
}

function handleGameOverAction(idx) {
  if (!isGameOverRoom(STATE.currentRoomId)) return false;
  if (idx === 3) {
    restartRun();
    renderLog(getLogLastNTexts(4));
  }
  return true;
}

async function resolveFleeActionFlow(ctx) {
  if (!canPayCombatActionCost('flee')) return;

  const fleeEnergyDelta = applyStatusAndGetRealDelta('energia', -FLEE_ENERGY_COST);
  const fleeSanityDelta = applyStatusAndGetRealDelta('sanidade', -FLEE_SANITY_COST);
  if (fleeEnergyDelta !== 0) ctx.effectMsgs.push(formatStatusDeltaMessage('Energia', fleeEnergyDelta));
  if (fleeSanityDelta !== 0) ctx.effectMsgs.push(formatStatusDeltaMessage('Sanidade', fleeSanityDelta));

  if (checkGameOver()) {
    refreshHUDLogAndActionOutcome(ctx.eventLabel, ctx.effectMsgs);
    return;
  }

  const encounter = getCurrentEncounter();
  const enemy = encounter && encounter.enemy ? encounter.enemy : null;
  const success = nextRandom() < getFleeSuccessChance(enemy);
  if (success) {
    const fleeingBossEncounter = isCurrentEncounterBoss();
    const summaryMsgs = [t('combat.flee_success', 'Fuga bem-sucedida')];
    let moveOptions = {};
    if (fleeingBossEncounter) {
      resetFloorBossProgressAfterBossFlee();
      summaryMsgs.push(t('combat.boss_flee_reset', 'O boss recuou. Ele pode reaparecer em 6 a 10 salas.'));
      moveOptions = { consumeBossProgress: false };
    }
    moveToNextRoomAfterCombat(moveOptions);
    appendActionLogSections(ctx.eventLabel, [ctx.effectMsgs, summaryMsgs]);
    refreshHUDAndLog();
    return;
  }

  ctx.effectMsgs.push(t('combat.flee_fail', 'Fuga falhou'));
  logActionOutcomeAndRefresh(ctx.eventLabel, ctx.effectMsgs);

  const enemyPhaseResolved = await resolveCombatEnemyPhaseWithDelay();
  if (enemyPhaseResolved && checkGameOver()) {
    refreshHUDAndLog();
    return;
  }

  refreshHUDAndLog();
}

function applyCombatActionPrimaryCost(role, primaryMsgs) {
  if (!Array.isArray(primaryMsgs)) return;
  if (role === 'combat_attack') {
    const energyDelta = applyStatusAndGetRealDelta('energia', -COMBAT_ATTACK_ENERGY_COST);
    if (energyDelta !== 0) primaryMsgs.push(formatStatusDeltaMessage('Energia', energyDelta));
    return;
  }
  if (role === 'combat_defend') {
    const energyDelta = applyStatusAndGetRealDelta('energia', -COMBAT_DEFEND_ENERGY_COST);
    if (energyDelta !== 0) primaryMsgs.push(formatStatusDeltaMessage('Energia', energyDelta));
  }
}

async function resolveCombatActionFlow(ctx) {
  const combatActionType = getCombatActionTypeFromRole(ctx.role);
  if (!combatActionType) return false;
  if (!canPayCombatActionCost(ctx.role)) return true;

  const primaryMsgs = [];
  applyCombatActionPrimaryCost(ctx.role, primaryMsgs);

  if (checkGameOver()) {
    logActionOutcomeAndRefresh(ctx.eventLabel, primaryMsgs);
    return true;
  }

  const combatStep = queueCombatPlayerAction(combatActionType);
  if (!combatStep.ok) return true;

  primaryMsgs.push(...(Array.isArray(combatStep.playerMsgs) ? combatStep.playerMsgs.slice() : []));
  const outcomeResolution = resolveCombatOutcome(combatStep.outcome);
  logActionOutcomeAndRefresh(ctx.eventLabel, primaryMsgs, outcomeResolution.summaryMsgs);

  if (!outcomeResolution.terminal) {
    if (checkGameOver()) {
      refreshHUDAndLog();
      return true;
    }
    renderRoom();
    if (checkCombatDeadendGameOver()) {
      refreshHUDAndLog();
      return true;
    }
  }

  refreshHUDAndLog();
  if (!outcomeResolution.terminal && !isPlayerCombatTurn()) {
    const enemyPhaseResolved = await resolveCombatEnemyPhaseWithDelay();
    if (enemyPhaseResolved && checkGameOver()) {
      refreshHUDAndLog();
      return true;
    }
  }

  refreshHUDAndLog();
  return true;
}

function runRoomActEffects(ctx) {
  if (!ctx || typeof ctx !== 'object') return;
  if (isTrapRoom(STATE.currentRoomId) && ctx.role === 'act' && typeof ctx.action?.trapKind === 'string') {
    ctx.effectMsgs.push(...runTrapAction(ctx.action.trapKind, ctx.room));
    return;
  }
  ctx.effectMsgs.push(...runEffectsCollectMessages(ctx.action?.effects || []));
}

function applyRoomActionUsageLock(ctx) {
  if (!ctx || typeof ctx !== 'object') return;
  if ((isTrapRoom(STATE.currentRoomId) || ctx.room.singleChoiceActs) && ctx.role === 'act') {
    for (let j = 0; j < 4; j++) {
      const aj = ctx.room.actions?.[j];
      const rj = aj ? (aj.role || 'act') : 'act';
      if (aj && rj === 'act') markActionUsedToday(STATE.currentRoomId, j);
    }
    renderRoom();
  }
}

function resolveExploreActionFlow(ctx) {
  const exploreSummaryMsgs = [];
  if (!ctx || ctx.role !== 'explore') return exploreSummaryMsgs;

  const leavingBossCombatRoom = isClearedBossCombatRoom(STATE.currentRoomId);
  const exploreEnergyDelta = applyStatusAndGetRealDelta('energia', -EXPLORE_ENERGY_COST);
  if (exploreEnergyDelta !== 0) ctx.effectMsgs.push(`${exploreEnergyDelta >= 0 ? '+' : ''}${exploreEnergyDelta} Energia`);

  addDay(1);
  setRunlineDay(getDay());
  resetActionUsageForToday();

  clearTransientRoomState();

  if (leavingBossCombatRoom) {
    const nextFloor = advanceToNextFloor();
    exploreSummaryMsgs.push(`Você desce para o andar ${nextFloor}.`);
    // [CHANGE][WHY] Reforça limpeza do estado de combate ao trocar de andar para evitar
    // herdar a marca de sala de combate limpa na primeira sala do próximo andar.
    clearTransientRoomState();
  }

  const nextRoomId = pickNextRoomId();
  STATE.currentRoomId = nextRoomId;
  if (String(nextRoomId || '') !== 'sala_combate') {
    clearClearedCombatRoom();
  }

  const faintRecovery = tryResolveEmptyRoomFaintRecovery(nextRoomId);
  if (faintRecovery.triggered) {
    ctx.effectMsgs.push(...faintRecovery.recoveryMsgs);
    exploreSummaryMsgs.push(...faintRecovery.summaryMsgs);
  }

  renderRoom();
  return exploreSummaryMsgs;
}

function finalizeRoomActionFlow(ctx, exploreSummaryMsgs = []) {
  const summaryMsgs = Array.isArray(exploreSummaryMsgs) ? exploreSummaryMsgs : [];

  if (checkGameOver()) {
    refreshHUDLogAndActionOutcome(ctx.eventLabel, ctx.effectMsgs, summaryMsgs);
    return true;
  }

  if (checkCombatDeadendGameOver()) {
    refreshHUDLogAndActionOutcome(ctx.eventLabel, ctx.effectMsgs, summaryMsgs);
    return true;
  }

  refreshHUDLogAndActionOutcome(ctx.eventLabel, ctx.effectMsgs, summaryMsgs);
  return true;
}

export function handleAction(idx) {
  return withInputLock(async () => {
    ensureActionUsageDaySync();

    if (handleGameOverAction(idx)) return;

    const ctx = createActionContext(idx);
    if (!ctx) return;
    if (!beginActionExecution(ctx)) return;

    if (ctx.role === 'flee') {
      await resolveFleeActionFlow(ctx);
      return;
    }

    if (await resolveCombatActionFlow(ctx)) {
      return;
    }

    runRoomActEffects(ctx);
    applyRoomActionUsageLock(ctx);

    const exploreSummaryMsgs = resolveExploreActionFlow(ctx);
    finalizeRoomActionFlow(ctx, exploreSummaryMsgs);
  });
}
/* =====================[ FIM TRECHO 8 ]===================== */
