/* =====================[ TRECHO 1: encounter.js - Estado isolado de encontros ]===================== */
/**
 * [DOC]
 * Subsistema isolado para encontros da cena.
 * - Cria e limpa o encontro atual sem acoplar renderização ou HUD.
 * - Hoje suporta combate normal e boss por andar.
 * - Mantém compatibilidade transitória com STATE.currentCombatEnemy.
 */
import { STATE, nextRandom, getDay, getCurrentFloor } from './state.js';
import { ROOMS } from './rooms.js';
import { pickEnemyForFloor, getBossForFloor } from './enemies.js';

function getRoom(roomId) {
  return ROOMS[String(roomId)] || null;
}

function cloneEnemy(enemy) {
  return enemy && typeof enemy === 'object' ? { ...enemy } : null;
}

function isBossEncounterForCurrentRoom(room) {
  if (!room || room.encounterType !== 'combat') return false;
  return String(STATE.floorBossState || '') === 'active';
}

export function isEncounterRoom(roomId) {
  const room = getRoom(roomId);
  return !!(room && typeof room.encounterType === 'string' && room.encounterType.length > 0);
}

export function isCombatEncounterRoom(roomId) {
  const room = getRoom(roomId);
  return !!(room && room.encounterType === 'combat');
}

export function getCurrentEncounter() {
  return STATE.encounter && typeof STATE.encounter === 'object' ? STATE.encounter : null;
}

export function hasActiveEncounter() {
  const encounter = getCurrentEncounter();
  return !!(encounter && encounter.enemy);
}

export function clearCurrentEncounter() {
  STATE.encounter = null;
  STATE.currentCombatEnemy = null;
}

export function ensureEncounterForCurrentRoom() {
  const roomId = String(STATE.currentRoomId || '');
  const room = getRoom(roomId);

  if (!room || !isEncounterRoom(roomId)) {
    clearCurrentEncounter();
    return null;
  }

  const current = getCurrentEncounter();
  if (current && current.roomId === roomId && current.type === room.encounterType && current.enemy) {
    STATE.currentCombatEnemy = current.enemy;
    return current;
  }

  const floor = getCurrentFloor();
  const isBoss = isBossEncounterForCurrentRoom(room);
  let enemy = null;

  if (room.encounterType === 'combat') {
    enemy = cloneEnemy(isBoss ? getBossForFloor(floor) : pickEnemyForFloor(floor, nextRandom));
  }

  STATE.encounter = {
    type: String(room.encounterType),
    roomId,
    floor,
    isBoss,
    startedAtDay: getDay(),
    enemy,
    combat: room.encounterType === 'combat' ? { round: 1, turn: 'player' } : null
  };
  STATE.currentCombatEnemy = enemy;
  return STATE.encounter;
}
/* =====================[ FIM TRECHO 1 ]===================== */
