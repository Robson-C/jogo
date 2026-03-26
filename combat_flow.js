/* =====================[ TRECHO 1: combat_flow.js - Núcleo robusto de turnos de combate ]===================== */
/**
 * [DOC]
 * Subsistema isolado do combate.
 * - Separa AÇÃO do jogador de DESFECHO do combate.
 * - Engine decide transição de sala, XP, Game Over e renderização.
 * - Estrutura preparada para novas ações: ataque, defesa e habilidade dinâmica.
 * - Habilidades usam registro por executor, sem depender de botão fixo no engine.
 */
import { getCurrentEncounter } from './encounter.js';
import {
  nextRandom,
  PlayerAPI,
  getEffectiveAtributo,
  getEffectiveStatus,
  getLevel,
  getCombatXPReward,
  getActiveCombatSkill
} from './state.js';

const DEFAULT_COMBAT_STATE = Object.freeze({
  round: 1,
  turn: 'player',
  playerGuardMultiplier: 1,
  lastPlayerAction: null
});

const COMBAT_OUTCOME_NONE = Object.freeze({ kind: 'none' });
const SKILL_EXECUTORS = new Map();

function normalizeTurn(value) {
  return value === 'enemy' ? 'enemy' : 'player';
}

function getDamageRollMultiplier() {
  return 0.8 + (nextRandom() * 0.4);
}

/** [DOC] Dano real desta etapa: max(1, round((atk*1.8) - (def*0.4) + 1)) com variação final 0.8..1.2 */
function calculateDamage(attackValue, defenseValue) {
  const atk = Math.max(0, Math.floor(Number(attackValue) || 0));
  const def = Math.max(0, Math.floor(Number(defenseValue) || 0));
  const baseDamage = Math.max(1, Math.round((atk * 1.8) - (def * 0.4) + 1));
  return Math.max(1, Math.round(baseDamage * getDamageRollMultiplier()));
}

function getCombatEncounter() {
  const encounter = getCurrentEncounter();
  return encounter && encounter.type === 'combat' ? encounter : null;
}

function getVictoryOutcome(enemy, encounter) {
  return {
    kind: 'victory',
    enemyName: String(enemy?.name || 'o inimigo'),
    floor: Math.max(1, Math.floor(Number(encounter?.floor) || 1)),
    xpReward: getCombatXPReward(enemy, encounter?.floor, getLevel()),
    enemyType: String(enemy?.tipo || 'normal')
  };
}

function getDefeatOutcome() {
  return { kind: 'defeat' };
}

function normalizePlayerActionResult(result) {
  if (!result || typeof result !== 'object') {
    return { ok: false, playerMsgs: [], outcome: COMBAT_OUTCOME_NONE, endTurn: false };
  }
  return {
    ok: result.ok !== false,
    playerMsgs: Array.isArray(result.playerMsgs) ? result.playerMsgs.slice(0, 8) : [],
    outcome: result.outcome && typeof result.outcome === 'object' ? result.outcome : COMBAT_OUTCOME_NONE,
    endTurn: result.endTurn !== false
  };
}

function getSkillExecutor(skillId) {
  if (typeof skillId !== 'string' || !skillId) return null;
  return SKILL_EXECUTORS.get(skillId) || null;
}

function clearCombatDefenseState(combat) {
  if (!combat || typeof combat !== 'object') return;
  combat.playerGuardMultiplier = 1;
}

export function ensureCombatFlowState() {
  const encounter = getCombatEncounter();
  if (!encounter) return null;

  const current = encounter.combat && typeof encounter.combat === 'object' ? encounter.combat : null;
  const round = Math.max(1, Math.floor(Number(current?.round) || DEFAULT_COMBAT_STATE.round));
  const turn = normalizeTurn(current?.turn);
  const playerGuardMultiplier = Number.isFinite(current?.playerGuardMultiplier)
    ? Math.max(0.1, Number(current.playerGuardMultiplier))
    : DEFAULT_COMBAT_STATE.playerGuardMultiplier;
  const lastPlayerAction = typeof current?.lastPlayerAction === 'string'
    ? current.lastPlayerAction
    : DEFAULT_COMBAT_STATE.lastPlayerAction;

  encounter.combat = { round, turn, playerGuardMultiplier, lastPlayerAction };
  return encounter.combat;
}

export function getCombatFlowState() {
  return ensureCombatFlowState();
}

export function isPlayerCombatTurn() {
  const combat = ensureCombatFlowState();
  return !!(combat && combat.turn === 'player');
}

export function registerCombatSkillExecutor(skillId, executor) {
  if (typeof skillId !== 'string' || !skillId || typeof executor !== 'function') return false;
  SKILL_EXECUTORS.set(skillId, executor);
  return true;
}

export function unregisterCombatSkillExecutor(skillId) {
  if (typeof skillId !== 'string' || !skillId) return false;
  return SKILL_EXECUTORS.delete(skillId);
}

export function hasUsableActiveCombatSkill() {
  const skill = getActiveCombatSkill();
  return !!(skill && getSkillExecutor(skill.id));
}

export function getCombatActionAvailability() {
  const encounter = getCombatEncounter();
  const combat = ensureCombatFlowState();
  const playerTurn = !!(encounter && combat && combat.turn === 'player');
  return {
    attack: playerTurn,
    defend: playerTurn,
    skill: playerTurn && hasUsableActiveCombatSkill(),
    flee: playerTurn
  };
}

function runAttackAction(enemy, encounter) {
  const enemyName = String(enemy.name || 'o inimigo');
  const playerAtk = getEffectiveAtributo('ataque');
  const enemyDef = Math.max(0, Math.floor(Number(enemy.defesa) || 0));
  const damage = calculateDamage(playerAtk, enemyDef);
  const beforeHp = Math.max(0, Math.floor(Number(enemy.vida) || 0));
  const afterHp = Math.max(0, beforeHp - damage);

  enemy.vida = afterHp;

  return {
    ok: true,
    playerMsgs: [`${damage} de dano em ${enemyName}`],
    outcome: afterHp <= 0 ? getVictoryOutcome(enemy, encounter) : COMBAT_OUTCOME_NONE,
    endTurn: afterHp > 0
  };
}

function runDefendAction() {
  return {
    ok: true,
    playerMsgs: ['Você assume postura defensiva'],
    outcome: COMBAT_OUTCOME_NONE,
    endTurn: true,
    guardMultiplier: 0.5
  };
}

function runSkillAction(encounter, combat, enemy) {
  const skill = getActiveCombatSkill();
  const executor = skill ? getSkillExecutor(skill.id) : null;
  if (!skill || !executor) {
    return { ok: false, playerMsgs: [], outcome: COMBAT_OUTCOME_NONE, endTurn: false };
  }

  const result = normalizePlayerActionResult(executor({ encounter, combat, enemy, skill }));
  return result.ok ? result : { ok: false, playerMsgs: [], outcome: COMBAT_OUTCOME_NONE, endTurn: false };
}

export function queueCombatPlayerAction(actionType) {
  const encounter = getCombatEncounter();
  const combat = ensureCombatFlowState();
  if (!encounter || !combat || combat.turn !== 'player') {
    return { ok: false, playerMsgs: [], outcome: COMBAT_OUTCOME_NONE };
  }

  const enemy = encounter.enemy && typeof encounter.enemy === 'object' ? encounter.enemy : null;
  if (!enemy) {
    return { ok: false, playerMsgs: [], outcome: COMBAT_OUTCOME_NONE };
  }

  clearCombatDefenseState(combat);

  let actionResult = null;
  switch (actionType) {
    case 'attack':
      actionResult = runAttackAction(enemy, encounter);
      break;
    case 'defend':
      actionResult = runDefendAction();
      break;
    case 'skill':
      actionResult = runSkillAction(encounter, combat, enemy);
      break;
    default:
      return { ok: false, playerMsgs: [], outcome: COMBAT_OUTCOME_NONE };
  }

  if (!actionResult.ok) {
    clearCombatDefenseState(combat);
    return { ok: false, playerMsgs: [], outcome: COMBAT_OUTCOME_NONE };
  }

  combat.lastPlayerAction = String(actionType);
  if (Number.isFinite(actionResult.guardMultiplier) && actionResult.guardMultiplier > 0) {
    combat.playerGuardMultiplier = Number(actionResult.guardMultiplier);
  }

  if (actionResult.outcome?.kind === 'victory') {
    combat.turn = 'player';
    return {
      ok: true,
      playerMsgs: actionResult.playerMsgs,
      outcome: actionResult.outcome
    };
  }

  combat.turn = actionResult.endTurn === false ? 'player' : 'enemy';
  return {
    ok: true,
    playerMsgs: actionResult.playerMsgs,
    outcome: COMBAT_OUTCOME_NONE
  };
}

export function resolvePendingEnemyTurn() {
  const encounter = getCombatEncounter();
  const combat = ensureCombatFlowState();
  if (!encounter || !combat || combat.turn !== 'enemy') {
    return { ok: false, enemyLogs: [], outcome: COMBAT_OUTCOME_NONE };
  }

  const enemy = encounter.enemy && typeof encounter.enemy === 'object' ? encounter.enemy : null;
  if (!enemy) return { ok: false, enemyLogs: [], outcome: COMBAT_OUTCOME_NONE };

  const enemyName = String(enemy.name || 'O inimigo');
  const enemyAtk = Math.max(0, Math.floor(Number(enemy.ataque ?? enemy.forca) || 0));
  const playerDef = getEffectiveAtributo('defesa');
  const guardMultiplier = Number.isFinite(combat.playerGuardMultiplier)
    ? Math.max(0.1, Number(combat.playerGuardMultiplier))
    : 1;
  const damage = Math.max(1, Math.round(calculateDamage(enemyAtk, playerDef) * guardMultiplier));

  PlayerAPI.addStatus('vida', -damage);
  const playerDefeated = getEffectiveStatus('vida') <= 0;

  clearCombatDefenseState(combat);
  combat.turn = 'player';
  combat.round = Math.max(1, Math.floor(Number(combat.round) || 1)) + 1;

  const enemyLogs = [`${enemyName} atacou e causou ${damage} de dano`];
  if (playerDefeated) enemyLogs.push('Você foi derrotado.');

  return {
    ok: true,
    enemyLogs,
    outcome: playerDefeated ? getDefeatOutcome() : COMBAT_OUTCOME_NONE
  };
}
/* =====================[ FIM TRECHO 1 ]===================== */
