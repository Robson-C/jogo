/* =====================[ TRECHO 1: Cabeçalho, Imports e Constantes ]===================== */
/**
 * [DOC]
 * Núcleo de fluxo do jogo: render de sala, execução de ações e transições.
 * Mantém compatibilidade com state/ui/i18n/rooms e não inicia rede (offline).
 * [CHANGE] Política de log MINIMALISTA (mantida):
 *  - NÃO logar descrição de sala.
 *  - 1 linha por ação: "<Evento>:" (sempre) + efeitos agregados se houver.
 *  - Efeitos "noop" não geram mensagens de efeito.
 * [CHANGE] Runner ampliado com tipos:
 *  - statusDeltaPctOfMax { key:'energia', pct:0.8 }
 *  - xpDeltaRange { min:5, max:10 }
 * [CHANGE] Explorar: **remove XP**; mantém apenas **-10 Energia**.
 */
import {
  STATE, nextRandom, getLogLastNTexts, appendLog,
  PlayerAPI, addModifier,
  removeModifierById, removeModifiersBySource, removeModifiersByTag,
  addDay, getDay, setDay, initPlayerDefaults, clearAllModifiers,
  getEffectiveStatus, getEffectiveStatusMax // [CHANGE] novo import para pct do máximo
} from './state.js';
import { setRoomTitle, setActionLabel, enableAction, getActionLabel, renderLog, setRunlineDay, renderHUD, setRoomDesc, setRoomBackground, renderEnemyCard, clearEnemyCard } from './ui.js';
import { ROOMS, ROOM_IDS } from './rooms.js';
import { t } from './i18n.js';
import { pickEnemyForFloor } from './enemies.js';

/* [STATE] Lock para anti multi-input (desbloqueado no próximo rAF) */
let inputLocked = false;

/* ID canônico de sala especial */
const GAME_OVER_ROOM_ID = 'fim_de_jogo';
const COMBAT_ROOM_ID = 'sala_combate';
const COMBAT_ENEMY_FLOOR = 1;
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


/* =====================[ TRECHO 4: Utilitários de Sala (flags, transições) ]===================== */
/** [DOC] Predicados de tipo de sala */
function isTrapRoom(roomId)    { return String(roomId) === 'sala_armadilha'; }
function isCombatRoom(roomId)  { return String(roomId) === COMBAT_ROOM_ID; }
function isGameOverRoom(roomId){ return String(roomId) === GAME_OVER_ROOM_ID; }

/**
 * [DOC][CHANGE] Antes registrava a descrição da sala no log. Agora **NÃO LOGA NADA**.
 * A descrição é exibida somente na UI via `renderRoom()`.
 */
function logRoomEntry(/* roomId */) {
  /* intencionalmente vazio (política minimalista de log) */
}

function clearCombatEnemy() {
  STATE.currentCombatEnemy = null;
}

function ensureCombatEnemy() {
  if (!isCombatRoom(STATE.currentRoomId)) {
    clearCombatEnemy();
    return null;
  }
  if (STATE.currentCombatEnemy && typeof STATE.currentCombatEnemy === 'object') {
    return STATE.currentCombatEnemy;
  }
  const enemy = pickEnemyForFloor(COMBAT_ENEMY_FLOOR, nextRandom);
  STATE.currentCombatEnemy = enemy || null;
  return STATE.currentCombatEnemy;
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
  renderRoom();
  renderHUD();
}

/** [DOC] Game Over por energia efetiva 0 → entra na sala de Fim de Jogo; retorna true se entrou. */
function checkGameOverByEnergy() {
  const energyEff = getEffectiveStatus('energia');
  if (energyEff <= 0 && !isGameOverRoom(STATE.currentRoomId)) {
    clearCombatEnemy();
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
 *
 * [CHANGE][WHY] Botões agora exibem custo/benefício no texto:
 *   Ex.: "Explorar [-10 ⚡]", "Meditar [+20% ⚡ +60% 🧠]", "Treinar [+5–10 ⭐]"
 */
const STAT_EMOJI = { vida:'❤️', energia:'⚡', mana:'💧', sanidade:'🧠' };
const ATR_EMOJI  = { ataque:'⚔️', defesa:'🛡️', precisao:'🎯', agilidade:'💨' };
const XP_EMOJI   = '⭐';
const EXPLORE_ENERGY_COST = 10; // [WHY] custo padrão do explorar (engine aplica -10 energia)
const FLEE_ENERGY_COST = 5;
const FLEE_SANITY_COST = 5;
const FLEE_SUCCESS_CHANCE = 0.5;

function _pctToInt(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return null;
  const p = Math.round(n * 100);
  return Number.isFinite(p) ? p : null;
}

function _formatEffectsForButton(action, role) {
  // Explorar: custo padrão sempre visível
  if (role === 'explore') return `[-${EXPLORE_ENERGY_COST} ${STAT_EMOJI.energia}]`;
  if (role === 'flee') return `[-${FLEE_ENERGY_COST} ${STAT_EMOJI.energia} -${FLEE_SANITY_COST} ${STAT_EMOJI.sanidade}]`;

  const effs = action && Array.isArray(action.effects) ? action.effects : [];
  if (!effs.length) return '';

  const parts = [];

  for (let i = 0; i < effs.length; i++) {
    const eff = effs[i];
    if (!eff || typeof eff.type !== 'string') continue;

    switch (eff.type) {
      case 'noop': {
        break;
      }
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
      // addMod/removeMod* propositalmente não entram no texto do botão (evita poluição)
      default: {
        break;
      }
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
  const combatEnemy = combat ? ensureCombatEnemy() : null;

  if (combat) renderEnemyCard(combatEnemy);
  else {
    clearCombatEnemy();
    clearEnemyCard();
  }

  // Título
  if (isGO) {
    const base = room.titleKey ? t(room.titleKey, room.title || '') : (room.title || 'Fim de Jogo');
    setRoomTitle(`${base} — Pontuação: 0`); // [TODO] pontuação futura
  } else {
    const title = room.titleKey ? t(room.titleKey, room.title || '') : (room.title || '');
    setRoomTitle(title);
  }

  // Descrição (UI apenas; sem log)
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

  // Sala de combate: apenas fuga no slot 4
  if (combat) {
    for (let i = 0; i < 3; i++) { setActionLabel(i, ''); enableAction(i, false); }
    const fleeAction = room.actions?.[3];
    const baseLabel = fleeAction?.labelKey ? t(fleeAction.labelKey, fleeAction.label || '') : (fleeAction?.label || '');
    const suffix = _formatEffectsForButton(fleeAction, 'flee');
    setActionLabel(3, suffix ? `${baseLabel} ${suffix}` : baseLabel);
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
      const baseLabel = a.labelKey ? t(a.labelKey, a.label || '') : (a.label || '');
      const role = a.role || 'act';
      const suffix = _formatEffectsForButton(a, role);
      const finalLabel = suffix ? `${baseLabel} ${suffix}` : baseLabel;

      setActionLabel(i, finalLabel);

      let enabled = true;
      if (trap) {
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


/* =====================[ TRECHO 6: Effect Runner (execução + coleta de mensagens) ]===================== */
/**
 * [DOC]
 * Interpreta efeitos declarativos e aplica no estado.
 * Retorna lista de mensagens de efeito para agregação (1 linha por ação).
 * [CHANGE] Suporta:
 *  - statusDeltaPctOfMax { key, pct }   → floor(pct * maxEfetivo(key)) aplicado em status
 *  - xpDeltaRange { min, max }          → inteiro uniforme [min..max]
 * Mantidos:
 *  - noop, statusDelta, atributoDelta, statusMaxDelta, xpDelta, addMod, removeMod*
 */
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
      case 'noop': {
        // não gera mensagem
        break;
      }
      case 'statusDelta': {
        const { key, delta } = eff;
        if (typeof key === 'string' && Number.isFinite(delta)) {
          PlayerAPI.addStatus(key, delta);
          const label = STAT_LABEL[key] || key;
          msgs.push(`${delta >= 0 ? '+' : ''}${toInt(delta)} ${label}`);
        }
        break;
      }
      case 'statusDeltaPctOfMax': { // [CHANGE] novo tipo
        const { key, pct } = eff;
        if (typeof key === 'string' && Number.isFinite(pct)) {
          const maxEff = getEffectiveStatusMax(key);
          const delta = Math.floor(Math.max(0, pct) * Math.max(0, maxEff));
          if (delta !== 0) {
            PlayerAPI.addStatus(key, delta);
            const label = STAT_LABEL[key] || key;
            msgs.push(`+${toInt(delta)} ${label}`);
          } else {
            // delta 0 → sem mensagem (mantém política minimalista)
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
      case 'xpDeltaRange': { // [CHANGE] novo tipo
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
      default: { break; }
    }
  }
  return msgs;
}
/* =====================[ FIM TRECHO 6 ]===================== */


/* =====================[ TRECHO 7: Input Lock e Dispatcher de Ações (log minimalista) ]===================== */
/**
 * [DOC]
 * - `withInputLock` evita múltiplos cliques simultâneos.
 * - `handleAction` executa a ação (0..3), aplica custos/efeitos,
 *   sorteia próxima sala em "explore", atualiza HUD e log curto.
 * [CHANGE] Explorar: apenas -10 Energia (sem XP).
 * [CHANGE][WHY] O texto do botão pode conter sufixo de efeitos "[...]";
 *               o log deve usar o label base quando não houver labelKey.
 */
function withInputLock(fn) {
  if (inputLocked) return;
  inputLocked = true;
  try { fn(); } finally { requestAnimationFrame(() => { inputLocked = false; }); }
}

function _stripButtonSuffix(label) {
  const s = String(label || '');
  const cut = s.indexOf(' [');
  return cut > 0 ? s.slice(0, cut) : s;
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

    const role = action.role || 'act';

    // [CHANGE] label base para log: preferir i18n; fallback remove sufixo do botão
    const eventLabel = action.labelKey
      ? t(action.labelKey, '')
      : _stripButtonSuffix(getActionLabel(idx));

    if (role === 'act' && isActionUsedToday(STATE.currentRoomId, idx)) {
      return; // 1x/dia por ação 'act'
    }
    if (role === 'act') {
      markActionUsedToday(STATE.currentRoomId, idx);
    }

    // 1) Executa efeitos declarados e coleta mensagens
    const effectMsgs = [];

    if (role === 'flee') {
      PlayerAPI.addStatus('energia', -FLEE_ENERGY_COST);
      PlayerAPI.addStatus('sanidade', -FLEE_SANITY_COST);
      effectMsgs.push(`-${FLEE_ENERGY_COST} Energia`, `-${FLEE_SANITY_COST} Sanidade`);

      const success = nextRandom() < FLEE_SUCCESS_CHANCE;
      if (success) {
        STATE.nextRoomEmptyChanceRealBoost = true;
        addDay(1);
        setRunlineDay(getDay());
        resetActionUsageForToday();
        clearCombatEnemy();
        STATE.currentRoomId = pickNextRoomId();
        effectMsgs.push(t('combat.flee_success', 'Fuga bem-sucedida'));
        renderRoom();
      } else {
        effectMsgs.push(t('combat.flee_fail', 'Fuga falhou'));
        renderRoom();
      }
    } else {
      effectMsgs.push(...runEffectsCollectMessages(action.effects || []));
    }

    // Sala armadilha: após qualquer 'act', todas as 'act' contam como usadas
    if (isTrapRoom(STATE.currentRoomId) && role === 'act') {
      for (let j = 0; j < 4; j++) {
        const aj = room.actions?.[j];
        const rj = aj ? (aj.role || 'act') : 'act';
        if (aj && rj === 'act') markActionUsedToday(STATE.currentRoomId, j);
      }
      renderRoom();
    }

    // 2) Papel especial: explorar (aplica custo/ganho padrão e transita de sala)
    if (role === 'explore') {
      // [CHANGE] Custo padrão: -10 energia (sem XP)
      PlayerAPI.addStatus('energia', -10);
      effectMsgs.push('-10 Energia');

      // Avança o dia, reseta uso de ações
      addDay(1);
      setRunlineDay(getDay());
      resetActionUsageForToday();

      // Sorteio da próxima sala
      clearCombatEnemy();
      STATE.currentRoomId = pickNextRoomId();

      // (sem log de descrição)
      renderRoom();
    }

    // 3) Checa Game Over (energia 0) após aplicar efeitos/custos
    if (checkGameOverByEnergy()) {
      renderHUD();
      // **Sempre** loga o evento; efeitos se houver.
      if (eventLabel) {
        const tail = effectMsgs.length ? ` ${effectMsgs.join(', ')}` : '';
        appendLog({ sev: 'mod', msg: `${String(eventLabel)}:${tail}`, ctx: { day: getDay() } });
      }
      renderLog(getLogLastNTexts(4));
      return;
    }

    // 4) Atualiza HUD e Log (**sempre** loga o evento)
    renderHUD();
    if (eventLabel) {
      const tail = effectMsgs.length ? ` ${effectMsgs.join(', ')}` : '';
      appendLog({ sev: 'mod', msg: `${String(eventLabel)}:${tail}`, ctx: { day: getDay() } });
    }
    renderLog(getLogLastNTexts(4));
  });
}
/* =====================[ FIM TRECHO 7 ]===================== */
