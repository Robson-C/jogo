/* =====================[ TRECHO 1: combat_flow.js - Turnos visuais de combate ]===================== */
/**
 * [DOC]
 * Subsistema isolado da ordem de turnos do combate.
 * - Agora aplica dano real em Vida para player e inimigo.
 * - A fórmula de dano usa apenas ATK x DEF por enquanto.
 * - Precisão/Agilidade ainda NÃO entram no acerto/esquiva reais nesta etapa.
 * - Quando o inimigo é derrotado, o retorno já traz os dados necessários para a engine
 *   conceder XP e encerrar o combate.
 */
import { getCurrentEncounter } from './encounter.js';
import { nextRandom, PlayerAPI, getEffectiveAtributo, getEffectiveStatus, getLevel, getCombatXPReward } from './state.js';

const DEFAULT_COMBAT_STATE = Object.freeze({ round: 1, turn: 'player' });

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

export function ensureCombatFlowState() {
  const encounter = getCurrentEncounter();
  if (!encounter || encounter.type !== 'combat') return null;

  const current = encounter.combat && typeof encounter.combat === 'object' ? encounter.combat : null;
  const round = Math.max(1, Math.floor(Number(current?.round) || DEFAULT_COMBAT_STATE.round));
  const turn = normalizeTurn(current?.turn);

  encounter.combat = { round, turn };
  return encounter.combat;
}

export function getCombatFlowState() {
  return ensureCombatFlowState();
}

export function isPlayerCombatTurn() {
  const combat = ensureCombatFlowState();
  return !!(combat && combat.turn === 'player');
}

export function queueCombatPlayerAction(actionType) {
  const encounter = getCurrentEncounter();
  const combat = ensureCombatFlowState();
  if (!encounter || !combat || combat.turn !== 'player') {
    return { ok: false, playerMsgs: [], victory: null };
  }

  const enemy = encounter.enemy && typeof encounter.enemy === 'object' ? encounter.enemy : null;
  if (!enemy) {
    return { ok: false, playerMsgs: [], victory: null };
  }

  const playerMsgs = [];

  if (actionType === 'attack') {
    const enemyName = String(enemy.name || 'o inimigo');
    const playerAtk = getEffectiveAtributo('ataque');
    const enemyDef = Math.max(0, Math.floor(Number(enemy.defesa) || 0));
    const damage = calculateDamage(playerAtk, enemyDef);
    const beforeHp = Math.max(0, Math.floor(Number(enemy.vida) || 0));
    const afterHp = Math.max(0, beforeHp - damage);

    enemy.vida = afterHp;
    playerMsgs.push(`${damage} de dano em ${enemyName}`);

    if (afterHp <= 0) {
      const xpReward = getCombatXPReward(enemy, encounter.floor, getLevel());
      combat.turn = 'player';
      return {
        ok: true,
        playerMsgs,
        victory: {
          enemyName,
          floor: encounter.floor,
          xpReward,
          enemyType: String(enemy.tipo || 'normal')
        }
      };
    }
  }

  combat.turn = 'enemy';
  return { ok: true, playerMsgs, victory: null };
}

export function resolvePendingEnemyTurn() {
  const encounter = getCurrentEncounter();
  const combat = ensureCombatFlowState();
  if (!encounter || !combat || combat.turn !== 'enemy') {
    return { ok: false, enemyLogs: [], playerDefeated: false };
  }

  const enemy = encounter.enemy && typeof encounter.enemy === 'object' ? encounter.enemy : null;
  if (!enemy) return { ok: false, enemyLogs: [], playerDefeated: false };

  const enemyName = String(enemy.name || 'O inimigo');
  const enemyAtk = Math.max(0, Math.floor(Number(enemy.ataque ?? enemy.forca) || 0));
  const playerDef = getEffectiveAtributo('defesa');
  const damage = calculateDamage(enemyAtk, playerDef);

  PlayerAPI.addStatus('vida', -damage);
  const playerDefeated = getEffectiveStatus('vida') <= 0;

  combat.turn = 'player';
  combat.round = Math.max(1, Math.floor(Number(combat.round) || 1)) + 1;

  const enemyLogs = [`${enemyName} atacou e causou ${damage} de dano`];
  if (playerDefeated) enemyLogs.push('Você foi derrotado.');

  return {
    ok: true,
    enemyLogs,
    playerDefeated
  };
}
/* =====================[ FIM TRECHO 1 ]===================== */
