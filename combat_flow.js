/* =====================[ TRECHO 1: combat_flow.js - Turnos visuais de combate ]===================== */
/**
 * [DOC]
 * Subsistema isolado da ordem de turnos do combate.
 * - Não aplica dano real nem altera HP nesta fase.
 * - Controla apenas round/turn e gera os textos necessários para o log.
 * - Mantém o fluxo preparado para evolução futura sem acoplar HUD, painel ou engine.
 */
import { getCurrentEncounter } from './encounter.js';

const DEFAULT_COMBAT_STATE = Object.freeze({ round: 1, turn: 'player' });

function normalizeTurn(value) {
  return value === 'enemy' ? 'enemy' : 'player';
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
    return { ok: false, playerMsgs: [] };
  }

  const playerMsgs = [];
  if (actionType === 'attack') {
    playerMsgs.push('ataque de teste, sem dano real');
  }

  combat.turn = 'enemy';
  return { ok: true, playerMsgs };
}

export function resolvePendingEnemyTurn() {
  const encounter = getCurrentEncounter();
  const combat = ensureCombatFlowState();
  if (!encounter || !combat || combat.turn !== 'enemy') {
    return { ok: false, enemyLogs: [] };
  }

  const enemy = encounter.enemy && typeof encounter.enemy === 'object' ? encounter.enemy : null;
  const enemyName = String(enemy?.name || 'O inimigo');
  const rawDamage = Math.floor(Number(enemy?.ataque ?? enemy?.forca) || 0);
  const visualDamage = Math.max(0, rawDamage);

  combat.turn = 'player';
  combat.round = Math.max(1, Math.floor(Number(combat.round) || 1)) + 1;

  return {
    ok: true,
    enemyLogs: [`${enemyName} atacou e causou ${visualDamage} de dano`]
  };
}
/* =====================[ FIM TRECHO 1 ]===================== */
