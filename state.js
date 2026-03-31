/* =====================[ TRECHO 1: state.js - Estado & RNG + Jogador + Modificadores ]===================== */
/**
 * [DOC]
 * Fonte única de verdade do jogo.
 * - Status com limites 0..max (base).
 * - Modificadores (não-mutantes) aplicados na leitura efetiva.
 * - API para set/add base e para adicionar/remover modificadores.
 * - Log estruturado (sem console no build final).
 * [CHANGE]
 * - STORAGE_KEYS dinâmico por slot (saveSlot${STATE.slot}.*).
 * - Log estruturado {ts, sev, msg, ctx?} + util getLogLastNTexts(n) para UI.
 * - [CHANGE] Sistema de XP/Nível/Atributos:
 *   - player.level inicia em 1 e vai até 99.
 *   - XP por nível usa curva quadrática leve própria para cap 99.
 *   - XP continua sendo total acumulado.
 *   - Cada nível ganho concede +2 pontos de atributo livres.
 *   - Cada nível ganho concede +1 ponto de status livre (Vida/Energia/Mana/Sanidade).
 *   - Backend expõe custo escalonado por atributo e alocação fixa de status (+10 por ponto).
 * - [NEW] Flag volátil de sessão `bootInitLogged` para evitar relogar as mensagens iniciais.
 */
export const VERSION = '0.8.2-floor-boss-progression';

export const STATE = {
  version: VERSION,
  slot: 1,            // [STATE] Slot atual de save (1..3 no futuro)
  seed: '',
  rngIndex: 0,
  currentRoomId: 'sala_vazia',
  log: [],           // Agora: array de objetos {ts, sev, msg, ctx?}

  // [STATE] Dia atual da run (1..∞). UI: .runline-day
  day: 1,

  // [STATE] Andar atual da run e progressão do boss do andar.
  currentFloor: 1,
  floorBossState: 'pending', // 'pending' | 'active' | 'defeated'
  floorBossCountdown: 0,     // salas restantes até o próximo boss aparecer

  // [STATE] Motivo do último fim de jogo ('death' | 'insanity' | 'exhaustion' | '')
  gameOverCause: '',

  // [STATE] Sinalizador de sessão para logs introdutórios
  bootInitLogged: false, // [NEW] evita duplicar mensagens de abertura no mesmo boot

  // [STATE] Bônus volátil: o próximo sorteio de sala usa 50% de chance real para sala_vazia.
  nextRoomEmptyChanceRealBoost: false,

  // [STATE] Sala vazia especial após desmaio ao explorar com energia zerada.
  emptyRoomFaintRecoveryRoomId: '',

  // [STATE] Encontro atual da cena (volátil; null fora de salas com encontro).
  encounter: null,

  // [STATE] Controle central de ações de sala usadas no dia atual.
  actionsUsed: new Set(),
  actionsLastResetDay: 1,

  // [STATE] Sala de combate limpa atual (usa o roomId canônico enquanto o jogador ainda está nela).
  clearedCombatRoomId: '',

  // [STATE] Tipo da última sala de combate limpa ('normal' | 'boss').
  clearedCombatRoomType: '',

  // [STATE] Jogador (BASE)
  player: {
    // Status atuais (BASE)
    vida: 0,
    energia: 0,
    mana: 0,
    sanidade: 0,
    // Limites máximos (BASE)
    maxVida: 0,
    maxEnergia: 0,
    maxMana: 0,
    maxSanidade: 0,
    // Atributos (BASE)
    ataque: 0,
    defesa: 0,
    precisao: 0,
    agilidade: 0,
    // Progressão
    level: 1,                 // nível atual (1..99)
    xp: 0,                    // total acumulado
    pontosAtributoLivres: 0,  // +2 por nível acima do 1.
    pontosAtributoGastos: 0,
    pontosStatusLivres: 0,    // +1 por nível acima do 1.
    pontosStatusGastos: 0,
    activeCombatSkillId: '',
    activeCombatSkillName: ''
  },

  // [STATE] Modificadores ativos (não alteram base; aplicados na leitura efetiva)
  // Cada item: { id, src?, kind:'status'|'atributo'|'statusMax', key, delta, tags?:string[] }
  modifiers: [],
  _modSeq: 0 // gerador simples de IDs
};
/* =====================[ FIM TRECHO 1 ]===================== */

/* =====================[ TRECHO 2: RNG determinístico ]===================== */
function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function newSeedString() {
  try {
    const arr = new Uint32Array(2);
    crypto.getRandomValues(arr);
    return arr[0].toString(36) + '-' + arr[1].toString(36);
  } catch (_) {
    const t = Date.now().toString(36);
    const ua = (navigator.userAgent || '').slice(0, 12);
    return 't' + t + '-' + hash32(ua + t).toString(36);
  }
}
export function initSeed() {
  const KEYS = storageKeys(); // [CHANGE] dinâmico por slot
  try {
    const savedSeed = localStorage.getItem(KEYS.seed);
    const savedIdx  = localStorage.getItem(KEYS.rngIndex);
    STATE.seed = (savedSeed && typeof savedSeed === 'string') ? savedSeed : newSeedString();
    if (!savedSeed) localStorage.setItem(KEYS.seed, STATE.seed);
    STATE.rngIndex = savedIdx ? (parseInt(savedIdx, 10) || 0) : 0;
  } catch (_) {
    if (!STATE.seed) STATE.seed = newSeedString();
    if (!STATE.rngIndex) STATE.rngIndex = 0;
  }
}
export function nextRandom() {
  const KEYS = storageKeys(); // [CHANGE]
  const base = hash32(STATE.seed);
  const rng = mulberry32((base + STATE.rngIndex) >>> 0);
  const r = rng();
  STATE.rngIndex++;
  try { localStorage.setItem(KEYS.rngIndex, String(STATE.rngIndex)); } catch (_) {}
  return r;
}
/* =====================[ FIM TRECHO 2 ]===================== */

/* =====================[ TRECHO 3: Log central (estruturado) ]===================== */
/**
 * [DOC] appendLog
 * - Aceita string ou objeto parcial {msg, sev?, ctx?}; enriquece com ts (Date.now()).
 * - Mantém até 100 entradas.  // [CHANGE] 64 → 100 para suportar o modal de histórico
 * [WHY] Permite filtros/telemetria local no futuro, mantendo compat com UI via getLogLastNTexts().
 */
export function appendLog(entry) {
  let obj = null;
  if (typeof entry === 'string') {
    obj = { ts: Date.now(), sev: 'info', msg: entry };
  } else if (entry && typeof entry === 'object' && typeof entry.msg === 'string') {
    obj = {
      ts: Date.now(),
      sev: (typeof entry.sev === 'string' && entry.sev) || 'info',
      msg: entry.msg,
      ctx: (entry.ctx && typeof entry.ctx === 'object') ? entry.ctx : undefined
    };
  }
  if (!obj) return;

  STATE.log.push(obj);
  if (STATE.log.length > 100) STATE.log.shift(); // [CHANGE]
}

/** [DOC] Retorna os últimos N textos do log (apenas .msg) para a UI curta */
export function getLogLastNTexts(n = 4) {
  const len = STATE.log.length;
  const start = Math.max(0, len - n);
  const out = [];
  for (let i = start; i < len; i++) {
    const it = STATE.log[i];
    out.push((it && typeof it.msg === 'string') ? it.msg : '');
  }
  return out;
}

/** [DOC] Retorna os últimos N itens completos do log (objeto {ts, sev, msg, ctx?}).
 *  [WHY] Necessário para o modal com cores por severidade e ordenação consistente.
 */
export function getLogLastN(n = 100) {
  const len = STATE.log.length;
  const start = Math.max(0, len - Math.max(1, Math.floor(Number(n) || 0)));
  const out = [];
  for (let i = start; i < len; i++) {
    const it = STATE.log[i];
    if (it && typeof it.msg === 'string') {
      out.push({ ts: it.ts, sev: it.sev || 'info', msg: it.msg, ctx: it.ctx });
    }
  }
  return out;
}
/* =====================[ FIM TRECHO 3 ]===================== */

/* =====================[ TRECHO 4: Chaves e utilidades ]===================== */
const STATUS_KEYS = ['vida', 'energia', 'mana', 'sanidade'];
const STATUS_MAX_KEYS = ['maxVida', 'maxEnergia', 'maxMana', 'maxSanidade'];
const ATRIB_KEYS  = ['ataque', 'defesa', 'precisao', 'agilidade'];
const XP_KEY = 'xp';
const ATTR_FREE_KEY = 'pontosAtributoLivres';
const ATTR_SPENT_KEY = 'pontosAtributoGastos';
const STATUS_FREE_KEY = 'pontosStatusLivres';
const STATUS_SPENT_KEY = 'pontosStatusGastos';

const LEVEL_MIN = 1;
const LEVEL_MAX = 99;
const ATTRIBUTE_POINTS_PER_LEVEL = 2;
const STATUS_POINTS_PER_LEVEL = 1;
const STATUS_POINT_BONUS = 10;
const ATTRIBUTE_MAX = 99;
const FLOOR_MIN = 1;
const FLOOR_MAX = 50;

/**
 * [DOC][XP DE COMBATE]
 * Regras atuais de XP real em combate:
 * - base por andar: (14 + floor * 3)
 * - multiplicador por tipo: normal=1.0 / boss=4.0
 * - multiplicador por poder real do inimigo: derivado dos próprios status
 * - redutor por overlevel do jogador em relação ao andar esperado
 *
 * [TODO][REVISÃO FUTURA]
 * - Quando existir sistema real de progressão de andares/capítulos na run, alimentar estas
 *   funções com o andar atual da run, e não apenas com `encounterFloor` da sala.
 * - Quando existirem elites/outros tipos, revisar o multiplicador por tipo.
 * - Quando precisão/agilidade entrarem no acerto/esquiva reais, reavaliar a fórmula de poder.
 */
function clampFloorNumber(rawFloor) {
  const floor = Math.floor(Number(rawFloor) || FLOOR_MIN);
  if (floor < FLOOR_MIN) return FLOOR_MIN;
  if (floor > FLOOR_MAX) return FLOOR_MAX;
  return floor;
}

/** [DOC] Nível esperado para o andar da run. Conteúdo principal fecha perto de lv 75–80. */
export function getExpectedLevelForFloor(rawFloor) {
  const floor = clampFloorNumber(rawFloor);
  return Math.min(80, Math.round(1 + ((floor - 1) * 1.6)));
}

/** [DOC] Poder implícito do inimigo, usado apenas para calibrar recompensa de XP. */
export function getEnemyPower(enemy) {
  if (!enemy || typeof enemy !== 'object') return 0;
  const maxVida = Math.max(1, Math.floor(Number(enemy.maxVida ?? enemy.vida) || 1));
  const ataque = Math.max(0, Math.floor(Number(enemy.ataque ?? enemy.forca) || 0));
  const defesa = Math.max(0, Math.floor(Number(enemy.defesa) || 0));
  const precisao = Math.max(0, Math.floor(Number(enemy.precisao) || 0));
  const agilidade = Math.max(0, Math.floor(Number(enemy.agilidade) || 0));

  let power =
    (maxVida * 0.45) +
    (ataque * 1.4) +
    (defesa * 1.0) +
    (precisao * 0.6) +
    (agilidade * 0.6);

  if (String(enemy.tipo || '') === 'boss') power *= 1.25;
  return Math.max(1, power);
}

function getFloorReferencePower(rawFloor) {
  const floor = clampFloorNumber(rawFloor);
  return 28 + (floor * 1.9);
}

function clampNumber(min, max, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/** [DOC] Redutor de farm: compara nível do jogador com a faixa esperada do andar. */
export function getOverlevelMultiplier(playerLevel, rawFloor) {
  const level = Math.max(LEVEL_MIN, Math.floor(Number(playerLevel) || LEVEL_MIN));
  const expected = getExpectedLevelForFloor(rawFloor);
  const diff = level - expected;

  if (diff >= 16) return 0.15;
  if (diff >= 8) return 0.40;
  if (diff >= 3) return 0.70;
  if (diff <= -5) return 1.15;
  return 1.0;
}

/** [DOC] XP de combate por inimigo: andar + tipo + poder real + overlevel do jogador. */
export function getCombatXPReward(enemy, rawFloor, playerLevel = LEVEL_MIN) {
  const floor = clampFloorNumber(rawFloor);
  const level = Math.max(LEVEL_MIN, Math.floor(Number(playerLevel) || LEVEL_MIN));
  const baseXP = 14 + (floor * 3);
  const typeMult = String(enemy?.tipo || '') === 'boss' ? 4.0 : 1.0;
  const enemyPower = getEnemyPower(enemy);
  const statMult = clampNumber(0.85, 1.25, enemyPower / getFloorReferencePower(floor));
  const overlevelMult = getOverlevelMultiplier(level, floor);

  return Math.max(1, Math.round(baseXP * typeMult * statMult * overlevelMult));
}

function isFiniteNumber(n) {
  return typeof n === 'number' && isFinite(n);
}
function clampStatusBase(key) {
  const maxKey = STATUS_MAX_KEY[key];
  let max = STATE.player[maxKey];
  if (!isFiniteNumber(max) || max < 0) max = 0;
  let v = STATE.player[key];
  if (!isFiniteNumber(v)) v = 0;
  if (v < 0) v = 0;
  if (v > max) v = max;
  STATE.player[key] = v;
}
/* [DOC] Mapeia status → seu campo max correspondente */
const STATUS_MAX_KEY = { vida: 'maxVida', energia: 'maxEnergia', mana: 'maxMana', sanidade: 'maxSanidade' };

/* [DOC] Gera nomes de chaves de persistência por slot atual.
   [CHANGE] Adicionado para suportar RNG determinístico por slot e evitar erro "storageKeys is not defined". */
function storageKeys(slot = STATE.slot) {
  const s = Number.isInteger(slot) && slot > 0 ? slot : 1;
  const base = `saveSlot${s}`;
  return {
    seed: `${base}.seed`,
    rngIndex: `${base}.rngIndex`,
    meta: `${base}.meta`,
    data: `${base}.data`
  };
}

function normalizeSaveSlotNumber(slot) {
  const n = Math.floor(Number(slot) || 1);
  if (n < 1) return 1;
  if (n > 3) return 3;
  return n;
}

function cloneSerializable(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fallback;
  }
}

function parseStoredJSON(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function isValidSaveSnapshot(data, expectedSlot) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (typeof data.version !== 'string' || !data.version) return false;
  if (normalizeSaveSlotNumber(data.slot) !== normalizeSaveSlotNumber(expectedSlot)) return false;
  if (typeof data.seed !== 'string' || !data.seed) return false;
  if (!Number.isFinite(Number(data.rngIndex)) || Number(data.rngIndex) < 0) return false;
  if (typeof data.currentRoomId !== 'string' || !data.currentRoomId) return false;
  if (!data.player || typeof data.player !== 'object' || Array.isArray(data.player)) return false;
  return true;
}

function buildSaveSnapshot(slot = STATE.slot) {
  return {
    version: VERSION,
    savedAt: Date.now(),
    slot: normalizeSaveSlotNumber(slot),
    seed: String(STATE.seed || ''),
    rngIndex: Math.max(0, Math.floor(Number(STATE.rngIndex) || 0)),
    currentRoomId: String(STATE.currentRoomId || 'sala_vazia'),
    day: Math.max(1, Math.floor(Number(STATE.day) || 1)),
    currentFloor: Math.max(1, Math.floor(Number(STATE.currentFloor) || 1)),
    floorBossState: String(STATE.floorBossState || 'pending'),
    floorBossCountdown: Math.max(0, Math.floor(Number(STATE.floorBossCountdown) || 0)),
    gameOverCause: String(STATE.gameOverCause || ''),
    bootInitLogged: !!STATE.bootInitLogged,
    nextRoomEmptyChanceRealBoost: !!STATE.nextRoomEmptyChanceRealBoost,
    emptyRoomFaintRecoveryRoomId: String(STATE.emptyRoomFaintRecoveryRoomId || ''),
    encounter: cloneSerializable(STATE.encounter, null),
    clearedCombatRoomId: String(STATE.clearedCombatRoomId || ''),
    clearedCombatRoomType: String(STATE.clearedCombatRoomType || ''),
    actionsUsed: Array.from(STATE.actionsUsed instanceof Set ? STATE.actionsUsed : []),
    actionsLastResetDay: Math.max(1, Math.floor(Number(STATE.actionsLastResetDay) || 1)),
    player: cloneSerializable(STATE.player, {}),
    modifiers: cloneSerializable(STATE.modifiers, [])
  };
}

function buildSaveMetaFromSnapshot(snapshot) {
  return {
    version: String(snapshot.version || VERSION),
    savedAt: Math.max(0, Math.floor(Number(snapshot.savedAt) || Date.now())),
    slot: normalizeSaveSlotNumber(snapshot.slot),
    hasData: true,
    day: Math.max(1, Math.floor(Number(snapshot.day) || 1)),
    currentFloor: Math.max(1, Math.floor(Number(snapshot.currentFloor) || 1)),
    level: Math.max(1, Math.floor(Number(snapshot?.player?.level) || 1)),
    currentRoomId: String(snapshot.currentRoomId || 'sala_vazia')
  };
}

export function getSaveSlot() {
  return normalizeSaveSlotNumber(STATE.slot);
}

export function setSaveSlot(slot) {
  STATE.slot = normalizeSaveSlotNumber(slot);
  return STATE.slot;
}

export function clearLogEntries() {
  STATE.log = [];
  return 0;
}

export function createFreshSeedForCurrentSlot() {
  const KEYS = storageKeys();
  STATE.seed = newSeedString();
  STATE.rngIndex = 0;
  try {
    localStorage.setItem(KEYS.seed, STATE.seed);
    localStorage.setItem(KEYS.rngIndex, '0');
  } catch (_) {}
  return STATE.seed;
}

export function saveCurrentGameToSlot(slot = STATE.slot) {
  const safeSlot = setSaveSlot(slot);
  const KEYS = storageKeys(safeSlot);
  const snapshot = buildSaveSnapshot(safeSlot);
  const meta = buildSaveMetaFromSnapshot(snapshot);
  try {
    localStorage.setItem(KEYS.seed, String(snapshot.seed || ''));
    localStorage.setItem(KEYS.rngIndex, String(snapshot.rngIndex || 0));
    localStorage.setItem(KEYS.data, JSON.stringify(snapshot));
    localStorage.setItem(KEYS.meta, JSON.stringify(meta));
    return { ok: true, slot: safeSlot, meta };
  } catch (_) {
    return { ok: false, slot: safeSlot, meta: null };
  }
}

export function getSaveSlotMeta(slot) {
  const safeSlot = normalizeSaveSlotNumber(slot);
  const KEYS = storageKeys(safeSlot);
  let meta = null;
  let data = null;
  try {
    meta = parseStoredJSON(localStorage.getItem(KEYS.meta));
    data = parseStoredJSON(localStorage.getItem(KEYS.data));
  } catch (_) {
    return null;
  }
  if (!isValidSaveSnapshot(data, safeSlot)) return null;
  const safeMeta = meta && typeof meta === 'object' && !Array.isArray(meta)
    ? { ...meta, ...buildSaveMetaFromSnapshot(data), slot: safeSlot, hasData: true }
    : buildSaveMetaFromSnapshot(data);
  return safeMeta;
}

export function hasSavedGameInSlot(slot) {
  return !!getSaveSlotMeta(slot);
}

/* ---------------------- XP/Nível/Atributos ---------------------- */
/** [DOC] Requisito para subir do nível `lv` para `lv+1`: round(45 + lv*9 + lv^2*0.4) */
export function xpNeededFor(lv) {
  const level = Math.max(LEVEL_MIN, Math.min(LEVEL_MAX, Math.floor(Number(lv) || LEVEL_MIN)));
  return Math.max(1, Math.round(45 + (level * 9) + (level * level * 0.4)));
}
/** [DOC] XP acumulado para estar no início de `lv` (soma de requisitos 1→2 ... (lv-1)→lv). */
function totalXPForLevelStart(lv) {
  const level = Math.max(LEVEL_MIN, Math.min(LEVEL_MAX, Math.floor(Number(lv) || LEVEL_MIN)));
  let sum = 0;
  for (let i = LEVEL_MIN; i < level; i++) sum += xpNeededFor(i);
  return sum;
}
/** [DOC] Total de pontos de atributo ganhos até `lv` (nível 1 = 0). */
export function getEarnedAttributePointsForLevel(lv) {
  const level = Math.max(LEVEL_MIN, Math.min(LEVEL_MAX, Math.floor(Number(lv) || LEVEL_MIN)));
  return Math.max(0, (level - LEVEL_MIN) * ATTRIBUTE_POINTS_PER_LEVEL);
}
/** [DOC] Total de pontos de status ganhos até `lv` (nível 1 = 0). */
export function getEarnedStatusPointsForLevel(lv) {
  const level = Math.max(LEVEL_MIN, Math.min(LEVEL_MAX, Math.floor(Number(lv) || LEVEL_MIN)));
  return Math.max(0, (level - LEVEL_MIN) * STATUS_POINTS_PER_LEVEL);
}
/** [DOC] Custo para subir +1 no atributo, conforme o valor base atual dele.
 * Faixas atuais para frear explosão cedo: 0..7=1 / 8..10=2 / 11..13=3 / 14..16=4 / 17+=5. */
export function getAttributeUpgradeCost(currentValue) {
  const value = Math.max(0, Math.floor(Number(currentValue) || 0));
  if (value >= 17) return 5;
  if (value >= 14) return 4;
  if (value >= 11) return 3;
  if (value >= 8) return 2;
  return 1;
}
/** [DOC] Custo atual para evoluir o atributo BASE informado. */
export function getAtributoUpgradeCost(key) {
  if (!ATRIB_KEYS.includes(key)) return 0;
  return getAttributeUpgradeCost(STATE.player[key]);
}
/** [DOC] Aplica uma distribuição de atributos em lote (all-or-nothing), consumindo apenas pontos livres. */
export function applyAttributeAllocation(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return { ok: false, reason: 'invalid_plan', applied: null, spentCost: 0, freeBefore: getFreeAttributePoints(), freeAfter: getFreeAttributePoints() };
  }

  const normalized = {};
  let requestedTotal = 0;
  for (let i = 0; i < ATRIB_KEYS.length; i++) {
    const key = ATRIB_KEYS[i];
    const amount = Math.max(0, Math.floor(Number(plan[key]) || 0));
    normalized[key] = amount;
    requestedTotal += amount;
  }

  const freeBefore = getFreeAttributePoints();
  if (requestedTotal <= 0) {
    return { ok: false, reason: 'empty_plan', applied: { ...normalized }, spentCost: 0, freeBefore, freeAfter: freeBefore };
  }

  let totalCost = 0;
  for (let i = 0; i < ATRIB_KEYS.length; i++) {
    const key = ATRIB_KEYS[i];
    let cur = Math.max(0, Math.floor(Number(STATE.player[key]) || 0));
    const amount = normalized[key];

    for (let step = 0; step < amount; step++) {
      if (cur >= ATTRIBUTE_MAX) {
        return { ok: false, reason: 'attribute_max_cap', key, applied: null, spentCost: 0, freeBefore, freeAfter: freeBefore };
      }
      totalCost += getAttributeUpgradeCost(cur);
      cur += 1;
    }
  }

  if (totalCost <= 0) {
    return { ok: false, reason: 'zero_cost', applied: { ...normalized }, spentCost: 0, freeBefore, freeAfter: freeBefore };
  }
  if (freeBefore < totalCost) {
    return { ok: false, reason: 'insufficient_points', applied: null, spentCost: totalCost, freeBefore, freeAfter: freeBefore };
  }

  for (let i = 0; i < ATRIB_KEYS.length; i++) {
    const key = ATRIB_KEYS[i];
    const cur = Math.max(0, Math.floor(Number(STATE.player[key]) || 0));
    const amount = normalized[key];
    STATE.player[key] = Math.max(0, Math.min(ATTRIBUTE_MAX, cur + amount));
  }

  const spentBefore = Math.max(0, Math.floor(Number(STATE.player[ATTR_SPENT_KEY]) || 0));
  STATE.player[ATTR_SPENT_KEY] = spentBefore + totalCost;
  STATE.player[ATTR_FREE_KEY] = Math.max(0, freeBefore - totalCost);

  return {
    ok: true,
    applied: { ...normalized },
    spentCost: totalCost,
    freeBefore,
    freeAfter: Math.max(0, freeBefore - totalCost)
  };
}
/** [DOC] Aplica uma distribuição de status em lote (+10 no máximo e +10 no atual por ponto). */
export function applyStatusAllocation(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return { ok: false, reason: 'invalid_plan', applied: null, spentCost: 0, freeBefore: getFreeStatusPoints(), freeAfter: getFreeStatusPoints() };
  }

  const normalized = {};
  let requestedTotal = 0;
  for (let i = 0; i < STATUS_KEYS.length; i++) {
    const key = STATUS_KEYS[i];
    const amount = Math.max(0, Math.floor(Number(plan[key]) || 0));
    normalized[key] = amount;
    requestedTotal += amount;
  }

  const freeBefore = getFreeStatusPoints();
  if (requestedTotal <= 0) {
    return { ok: false, reason: 'empty_plan', applied: { ...normalized }, spentCost: 0, freeBefore, freeAfter: freeBefore };
  }
  if (freeBefore < requestedTotal) {
    return { ok: false, reason: 'insufficient_points', applied: null, spentCost: requestedTotal, freeBefore, freeAfter: freeBefore };
  }

  for (let i = 0; i < STATUS_KEYS.length; i++) {
    const key = STATUS_KEYS[i];
    const amount = normalized[key];
    if (amount <= 0) continue;
    const delta = amount * STATUS_POINT_BONUS;
    addStatusMax(key, delta);
    addPlayerValue(key, delta);
  }

  const spentBefore = Math.max(0, Math.floor(Number(STATE.player[STATUS_SPENT_KEY]) || 0));
  STATE.player[STATUS_SPENT_KEY] = spentBefore + requestedTotal;
  STATE.player[STATUS_FREE_KEY] = Math.max(0, freeBefore - requestedTotal);

  return {
    ok: true,
    applied: { ...normalized },
    spentCost: requestedTotal,
    freeBefore,
    freeAfter: Math.max(0, freeBefore - requestedTotal)
  };
}
/** [DOC] Recalcula e aplica o nível correto com base em STATE.player.xp (suporta ganho/perda). */
function recalcLevelFromTotalXP() {
  let total = STATE.player.xp;
  if (!isFiniteNumber(total) || total < 0) total = 0;

  let lv = LEVEL_MIN;
  while (lv < LEVEL_MAX) {
    const base = totalXPForLevelStart(lv);
    const need = xpNeededFor(lv);
    if (total >= base + need) lv++;
    else break;
  }

  const earnedAttrPoints = getEarnedAttributePointsForLevel(lv);
  const spentAttrPoints = Math.max(0, Math.floor(Number(STATE.player[ATTR_SPENT_KEY]) || 0));
  const freeAttrPoints = Math.max(0, earnedAttrPoints - spentAttrPoints);
  const earnedStatusPoints = getEarnedStatusPointsForLevel(lv);
  const spentStatusPoints = Math.max(0, Math.floor(Number(STATE.player[STATUS_SPENT_KEY]) || 0));
  const freeStatusPoints = Math.max(0, earnedStatusPoints - spentStatusPoints);

  STATE.player.level = lv;
  STATE.player.xp = total;
  STATE.player[ATTR_SPENT_KEY] = spentAttrPoints;
  STATE.player[ATTR_FREE_KEY] = freeAttrPoints;
  STATE.player[STATUS_SPENT_KEY] = spentStatusPoints;
  STATE.player[STATUS_FREE_KEY] = freeStatusPoints;
}
/** [DOC] Snapshot do progresso dentro do nível atual. */
export function getXPProgress() {
  const lv = Math.max(LEVEL_MIN, Math.min(LEVEL_MAX, Math.floor(STATE.player.level || LEVEL_MIN)));
  const base = totalXPForLevelStart(lv);
  const need = xpNeededFor(lv);
  const total = Math.max(0, Math.floor(Number(STATE.player.xp) || 0));
  const atMax = (lv >= LEVEL_MAX);
  const progress = atMax ? need : Math.max(0, Math.min(need, total - base));
  return { level: lv, progress, needed: need, atMaxLevel: atMax };
}
export function getLevel() { return Math.max(LEVEL_MIN, Math.min(LEVEL_MAX, Math.floor(STATE.player.level || LEVEL_MIN))); }
export function isMaxLevel() { return getLevel() >= LEVEL_MAX; }
export function getXPForNextLevel() { return xpNeededFor(getLevel()); }
export function getFreeAttributePoints() {
  return Math.max(0, Math.floor(Number(STATE.player[ATTR_FREE_KEY]) || 0));
}
export function getFreeStatusPoints() {
  return Math.max(0, Math.floor(Number(STATE.player[STATUS_FREE_KEY]) || 0));
}
/* =====================[ FIM TRECHO 4 ]===================== */

/* =====================[ TRECHO 5: API — Base (sem modificadores) ]===================== */
// Snapshot BASE (sem mods)
export function getPlayerSnapshot() {
  return JSON.parse(JSON.stringify(STATE.player));
}
// Define valor BASE (status com clamp 0..max; demais diretos)
export function setPlayerValue(key, value) {
  if (!isFiniteNumber(value)) return false;
  if (STATUS_KEYS.includes(key)) {
    STATE.player[key] = value;
    clampStatusBase(key);
    return true;
  }
  if (ATRIB_KEYS.includes(key)) {
    STATE.player[key] = Math.max(0, Math.min(ATTRIBUTE_MAX, Math.floor(Number(value) || 0)));
    return true;
  }
  if (key === XP_KEY || key === ATTR_FREE_KEY || key === ATTR_SPENT_KEY || key === STATUS_FREE_KEY || key === STATUS_SPENT_KEY) {
    STATE.player[key] = value;
    return true;
  }
  return false;
}
// Soma BASE
export function addPlayerValue(key, delta) {
  if (!isFiniteNumber(delta)) return false;
  if (STATUS_KEYS.includes(key)) {
    const cur = isFiniteNumber(STATE.player[key]) ? STATE.player[key] : 0;
    STATE.player[key] = cur + delta;
    clampStatusBase(key);
    return true;
  }
  if (ATRIB_KEYS.includes(key)) {
    const cur = isFiniteNumber(STATE.player[key]) ? STATE.player[key] : 0;
    STATE.player[key] = Math.max(0, Math.min(ATTRIBUTE_MAX, cur + delta));
    return true;
  }
  if (key === XP_KEY || key === ATTR_FREE_KEY || key === ATTR_SPENT_KEY || key === STATUS_FREE_KEY || key === STATUS_SPENT_KEY) {
    const cur = isFiniteNumber(STATE.player[key]) ? STATE.player[key] : 0;
    STATE.player[key] = cur + delta;
    return true;
  }
  return false;
}
// Max BASE dos status
export function setStatusMax(key, maxValue) {
  if (!STATUS_KEYS.includes(key) || !isFiniteNumber(maxValue)) return false;
  const maxKey = STATUS_MAX_KEY[key];
  STATE.player[maxKey] = Math.max(0, maxValue);
  clampStatusBase(key);
  return true;
}
export function addStatusMax(key, delta) {
  if (!STATUS_KEYS.includes(key) || !isFiniteNumber(delta)) return false;
  const maxKey = STATUS_MAX_KEY[key];
  const cur = isFiniteNumber(STATE.player[maxKey]) ? STATE.player[maxKey] : 0;
  STATE.player[maxKey] = Math.max(0, cur + delta);
  clampStatusBase(key);
  return true;
}
/** [DOC] API pública de jogador (BASE + Progressão) */
export const PlayerAPI = {
  // Status base
  setStatus:   (k, v) => STATUS_KEYS.includes(k) && setPlayerValue(k, v),
  addStatus:   (k, d) => STATUS_KEYS.includes(k) && addPlayerValue(k, d),
  // Max base
  setStatusMax:(k, v) => setStatusMax(k, v),
  addStatusMax:(k, d) => addStatusMax(k, d),
  // Atributos base
  setAtributo: (k, v) => ATRIB_KEYS.includes(k) && setPlayerValue(k, v),
  addAtributo: (k, d) => ATRIB_KEYS.includes(k) && addPlayerValue(k, d),
  // XP/Level/Atributos
  /** [DOC] Define XP total (clamp ≥0), recalcula nível; respeita cap 99. */
  setXP: (v) => {
    const val = Math.max(0, Math.floor(Number(v) || 0));
    STATE.player.xp = val;
    recalcLevelFromTotalXP();
    return true;
  },
  /** [DOC] Soma ao XP total (pode ser negativo); recalcula nível.
   *  [WHY] Carrega sobra e suporta múltiplos ups. No cap (99), XP segue acumulando sem efeito prático. */
  addXP: (d) => {
    const delta = Math.floor(Number(d) || 0);
    let total = Math.max(0, Math.floor(Number(STATE.player.xp) || 0)) + delta;
    if (total < 0) total = 0;
    STATE.player.xp = total;
    recalcLevelFromTotalXP();
    return true;
  },
  getPontosAtributoLivres: () => getFreeAttributePoints(),
  getPontosStatusLivres: () => getFreeStatusPoints(),
  getCustoAtributo: (k) => getAtributoUpgradeCost(k),
  trySpendAttributePointsOn: (k) => {
    if (!ATRIB_KEYS.includes(k)) return false;
    const cost = getAtributoUpgradeCost(k);
    const free = getFreeAttributePoints();
    if (cost <= 0 || free < cost) return false;
    const curAttr = Math.max(0, Math.floor(Number(STATE.player[k]) || 0));
    if (curAttr >= ATTRIBUTE_MAX) return false;
    STATE.player[k] = Math.min(ATTRIBUTE_MAX, curAttr + 1);
    STATE.player[ATTR_FREE_KEY] = free - cost;
    STATE.player[ATTR_SPENT_KEY] = Math.max(0, Math.floor(Number(STATE.player[ATTR_SPENT_KEY]) || 0)) + cost;
    return true;
  },
  applyAttributeAllocation: (plan) => applyAttributeAllocation(plan),
  applyStatusAllocation: (plan) => applyStatusAllocation(plan)
};
/* =====================[ FIM TRECHO 5 ]===================== */

/* =====================[ TRECHO 6: API — Modificadores ]===================== */
/**
 * [DOC] Modificadores não alteram a BASE; são aplicados na leitura "efetiva".
 * kind:
 *  - 'status'    → keys: STATUS_KEYS           (altera valor atual efetivo)
 *  - 'statusMax' → keys: STATUS_KEYS           (altera limite efetivo)
 *  - 'atributo'  → keys: ATRIB_KEYS            (altera atributo efetivo)
 * Campos:
 *  - key: string (conforme o kind)
 *  - delta: number
 *  - src?: string (identificador lógico, ex.: 'veneno', 'armadilha')
 *  - tags?: string[] (ex.: ['combate'])
 */
export function addModifier({ src, kind, key, delta, tags }) {
  if (typeof kind !== 'string' || typeof key !== 'string' || !isFiniteNumber(delta)) return null;
  if (kind === 'status' && !STATUS_KEYS.includes(key)) return null;
  if (kind === 'statusMax' && !STATUS_KEYS.includes(key)) return null;
  if (kind === 'atributo' && !ATRIB_KEYS.includes(key)) return null;

  const id = 'mod-' + (++STATE._modSeq);
  STATE.modifiers.push({
    id,
    src: (typeof src === 'string' && src) || undefined,
    kind,
    key,
    delta,
    tags: Array.isArray(tags) ? tags.slice(0, 8) : undefined
  });
  return id;
}

export function removeModifierById(id) {
  if (!id) return 0;
  const before = STATE.modifiers.length;
  STATE.modifiers = STATE.modifiers.filter(m => m.id !== id);
  return before - STATE.modifiers.length;
}
export function removeModifiersBySource(src) {
  if (!src) return 0;
  const before = STATE.modifiers.length;
  STATE.modifiers = STATE.modifiers.filter(m => m.src !== src);
  return before - STATE.modifiers.length;
}
export function removeModifiersByTag(tag) {
  if (!tag) return 0;
  const before = STATE.modifiers.length;
  STATE.modifiers = STATE.modifiers.filter(m => !(m.tags && m.tags.includes(tag)));
  return before - STATE.modifiers.length;
}
export function clearAllModifiers() {
  const n = STATE.modifiers.length;
  STATE.modifiers = [];
  return n;
}
export function listModifiers(filter = {}) {
  const { kind, key, src, tag } = filter;
  return STATE.modifiers.filter(m => {
    if (kind && m.kind !== kind) return false;
    if (key && m.key !== key) return false;
    if (src && m.src !== src) return false;
    if (tag && !(m.tags && m.tags.includes(tag))) return false;
    return true;
  }).map(m => ({ ...m })); // cópia defensiva
}
/* =====================[ FIM TRECHO 6 ]===================== */

/* =====================[ TRECHO 7: Leitura EFETIVA (base + mods) ]===================== */
/**
 * [DOC]
 * - Para status: valorEfetivo = clamp( base + soma(mods 'status' para key), 0, maxEfetivo )
 *   onde maxEfetivo = maxBase + soma(mods 'statusMax' para key)
 * - Para atributos: valorEfetivo = base + soma(mods 'atributo' para key)
 * - XP/Pontos de atributo: sem mods neste esqueleto (mas expõe nível, progresso e pontos livres para UI).
 */
function sumMods(kind, key) {
  let s = 0;
  for (let i = 0; i < STATE.modifiers.length; i++) {
    const m = STATE.modifiers[i];
    if (m.kind === kind && m.key === key && isFiniteNumber(m.delta)) s += m.delta;
  }
  return s;
}

export function getEffectiveStatusMax(key) {
  if (!STATUS_KEYS.includes(key)) return 0;
  const baseMaxKey = STATUS_MAX_KEY[key];
  const baseMax = isFiniteNumber(STATE.player[baseMaxKey]) ? STATE.player[baseMaxKey] : 0;
  const extra = sumMods('statusMax', key);
  const maxEff = Math.max(0, baseMax + extra);
  return maxEff;
}
export function getEffectiveStatus(key) {
  if (!STATUS_KEYS.includes(key)) return 0;
  const base = isFiniteNumber(STATE.player[key]) ? STATE.player[key] : 0;
  const extra = sumMods('status', key);
  const maxEff = getEffectiveStatusMax(key);
  let v = base + extra;
  if (v < 0) v = 0;
  if (v > maxEff) v = maxEff;
  return v;
}
export function getEffectiveAtributo(key) {
  if (!ATRIB_KEYS.includes(key)) return 0;
  const base = isFiniteNumber(STATE.player[key]) ? STATE.player[key] : 0;
  const extra = sumMods('atributo', key);
  return base + extra; // sem clamp por ora
}
export function getEffectivePlayerSnapshot() {
  const xpView = getXPProgress(); // {level, progress, needed, atMaxLevel}
  // Snapshot EFETIVO (com mods aplicados) + visão de XP/Nível para HUD
  return {
    // Status com clamp e seus máximos efetivos
    vida:        getEffectiveStatus('vida'),
    energia:     getEffectiveStatus('energia'),
    mana:        getEffectiveStatus('mana'),
    sanidade:    getEffectiveStatus('sanidade'),
    maxVida:     getEffectiveStatusMax('vida'),
    maxEnergia:  getEffectiveStatusMax('energia'),
    maxMana:     getEffectiveStatusMax('mana'),
    maxSanidade: getEffectiveStatusMax('sanidade'),
    // Atributos efetivos
    ataque:      getEffectiveAtributo('ataque'),
    defesa:      getEffectiveAtributo('defesa'),
    precisao:    getEffectiveAtributo('precisao'),
    agilidade:   getEffectiveAtributo('agilidade'),
    // Progressão (sem mods)
    level:       xpView.level,
    xp:          Math.max(0, Math.floor(Number(STATE.player.xp) || 0)), // total acumulado
    xpProgress:  xpView.progress,   // progresso dentro do nível
    xpNeeded:    xpView.needed,     // requisito do nível atual
    atMaxLevel:  xpView.atMaxLevel,
    pontosAtributoLivres: getFreeAttributePoints(),
    pontosStatusLivres: getFreeStatusPoints()
  };
}
/* =====================[ FIM TRECHO 7 ]===================== */

/* =====================[ TRECHO 8: API — Dia (status básico, sem persistência) ]===================== */
/**
 * [DOC] getDay / setDay / addDay
 * - Usa STATE como fonte única (Regra 3B/6G).
 * - Não depende de armazenamento; somente runtime.
 * - Garante inteiro mínimo 1.
 * [STATE] Cria STATE.day dinamicamente se não existir.
 */
function _normDay(v) {
  const n = Math.floor(Number(v));
  return (isFinite(n) && n >= 1) ? n : 1;
}

export function getDay() {
  if (typeof STATE.day !== 'number' || !isFinite(STATE.day) || STATE.day < 1) {
    STATE.day = 1;
  }
  return STATE.day;
}

export function setDay(v) {
  STATE.day = _normDay(v);
  return STATE.day;
}

export function addDay(delta) {
  const d = Math.floor(Number(delta));
  if (!isFinite(d)) return getDay();
  return setDay(getDay() + d);
}
/* =====================[ FIM TRECHO 8 ]===================== */


const RUN_FLOOR_MIN = 1;
const RUN_FLOOR_MAX = 50;

function _normFloor(v) {
  const n = Math.floor(Number(v));
  if (!isFinite(n) || n < RUN_FLOOR_MIN) return RUN_FLOOR_MIN;
  if (n > RUN_FLOOR_MAX) return RUN_FLOOR_MAX;
  return n;
}

export function getCurrentFloor() {
  if (typeof STATE.currentFloor !== 'number' || !isFinite(STATE.currentFloor) || STATE.currentFloor < RUN_FLOOR_MIN) {
    STATE.currentFloor = RUN_FLOOR_MIN;
  }
  return _normFloor(STATE.currentFloor);
}

export function setCurrentFloor(v) {
  STATE.currentFloor = _normFloor(v);
  return STATE.currentFloor;
}

export function addCurrentFloor(delta = 1) {
  const d = Math.floor(Number(delta));
  if (!isFinite(d)) return getCurrentFloor();
  return setCurrentFloor(getCurrentFloor() + d);
}

/* =====================[ TRECHO 9: state.js - Defaults do jogador (runtime) ]===================== */
/**
 * [DOC] initPlayerDefaults()
 * - Define valores iniciais de runtime (sem persistência) para o jogador:
 *   Status (Vida/Mana/Energia/Sanidade): max = 100; atual = max.
 *   Atributos (ATK/DEF/ACC/AGI): 5.
 *   Progressão: level=1; xp=0; pontosAtributoLivres=0; pontosAtributoGastos=0; pontosStatusLivres=0; pontosStatusGastos=0.
 * [WHY] Garante HUD coerente desde o boot e permite ver o consumo de Energia ao explorar.
 */
export function initPlayerDefaults() {
  // Máximos
  STATE.player.maxVida = 100;
  STATE.player.maxEnergia = 100;
  STATE.player.maxMana = 100;
  STATE.player.maxSanidade = 100;
  // Atuais = máximos
  STATE.player.vida = STATE.player.maxVida;
  STATE.player.energia = STATE.player.maxEnergia;
  STATE.player.mana = STATE.player.maxMana;
  STATE.player.sanidade = STATE.player.maxSanidade;
  // Atributos
  STATE.player.ataque = 5;
  STATE.player.defesa = 5;
  STATE.player.precisao = 5;
  STATE.player.agilidade = 5;
  // Progressão
  STATE.player.level = 1;
  STATE.player.xp = 0;
  STATE.player.pontosAtributoLivres = 0;
  STATE.player.pontosAtributoGastos = 0;
  STATE.player.pontosStatusLivres = 0;
  STATE.player.pontosStatusGastos = 0;
  STATE.player.activeCombatSkillId = '';
  STATE.player.activeCombatSkillName = '';
  STATE.currentFloor = 1;
  STATE.gameOverCause = '';
  STATE.floorBossState = 'pending';
  STATE.floorBossCountdown = 0;
  STATE.emptyRoomFaintRecoveryRoomId = '';
  STATE.clearedCombatRoomId = '';
  STATE.clearedCombatRoomType = '';
}



/** [DOC] Habilidade ativa de combate equipada pelo jogador. */
export function setActiveCombatSkill(skillId, skillName = '') {
  STATE.player.activeCombatSkillId = (typeof skillId === 'string' && skillId) ? skillId : '';
  STATE.player.activeCombatSkillName = (typeof skillName === 'string' && skillName) ? skillName : '';
  return getActiveCombatSkill();
}

export function clearActiveCombatSkill() {
  STATE.player.activeCombatSkillId = '';
  STATE.player.activeCombatSkillName = '';
  return null;
}

export function getActiveCombatSkill() {
  const id = typeof STATE.player.activeCombatSkillId === 'string' ? STATE.player.activeCombatSkillId : '';
  if (!id) return null;
  const name = typeof STATE.player.activeCombatSkillName === 'string' && STATE.player.activeCombatSkillName
    ? STATE.player.activeCombatSkillName
    : id;
  return { id, name };
}
/* =====================[ FIM TRECHO 9 ]===================== */
