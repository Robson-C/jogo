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
 * - [CHANGE] Sistema de XP/Nível:
 *   - player.level adicionado (inicia em 1).
 *   - Requisito por nível: ceil(100 * 1.2^(level-1)).
 *   - Cap = 50; barra cheia no cap; XP total continua acumulando (sem efeito prático).
 * - [NEW] Flag volátil de sessão `bootInitLogged` para evitar relogar as mensagens iniciais.
 */
export const VERSION = '0.8.0-scene-encounter-split';

export const STATE = {
  version: VERSION,
  slot: 1,            // [STATE] Slot atual de save (1..3 no futuro)
  seed: '',
  rngIndex: 0,
  currentRoomId: 'sala_vazia',
  log: [],           // Agora: array de objetos {ts, sev, msg, ctx?}

  // [STATE] Dia atual da run (1..∞). UI: .runline-day
  day: 1,

  // [STATE] Sinalizador de sessão para logs introdutórios
  bootInitLogged: false, // [NEW] evita duplicar mensagens de abertura no mesmo boot

  // [STATE] Bônus volátil: o próximo sorteio de sala usa 50% de chance real para sala_vazia.
  nextRoomEmptyChanceRealBoost: false,

  // [STATE] Encontro atual da cena (volátil; null fora de salas com encontro).
  encounter: null,

  // [STATE][LEGACY] Mantido apenas por compatibilidade transitória com versões anteriores.
  currentCombatEnemy: null,

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
    level: 1, // [CHANGE] novo campo — nível atual (1..50)
    xp: 0     // total acumulado; no cap continua subindo sem efeito prático
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

const LEVEL_MIN = 1;
const LEVEL_MAX = 50;

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
  };
}

/* ---------------------- XP/Nível (Opção A) ---------------------- */
/** [DOC] Requisito para subir do nível `lv` para `lv+1`: ceil(100 * 1.2^(lv-1)) */
export function xpNeededFor(lv) {
  const level = Math.max(LEVEL_MIN, Math.min(LEVEL_MAX, Math.floor(Number(lv) || LEVEL_MIN)));
  return Math.ceil(100 * Math.pow(1.2, level - 1));
}
/** [DOC] XP acumulado para estar no início de `lv` (soma de requisitos 1→2 ... (lv-1)→lv). */
function totalXPForLevelStart(lv) {
  const level = Math.max(LEVEL_MIN, Math.min(LEVEL_MAX, Math.floor(Number(lv) || LEVEL_MIN)));
  let sum = 0;
  for (let i = LEVEL_MIN; i < level; i++) sum += xpNeededFor(i);
  return sum;
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
  STATE.player.level = lv;
  STATE.player.xp = total; // mantém total acumulado monotônico (pode ser reduzido se setXP assim definir)
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
  if (ATRIB_KEYS.includes(key) || key === XP_KEY) {
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
  if (ATRIB_KEYS.includes(key) || key === XP_KEY) {
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
  // XP/Level (opção A)
  /** [DOC] Define XP total (clamp ≥0), recalcula nível; respeita cap 50. */
  setXP: (v) => {
    const val = Math.max(0, Math.floor(Number(v) || 0));
    STATE.player.xp = val;
    recalcLevelFromTotalXP();
    return true;
  },
  /** [DOC] Soma ao XP total (pode ser negativo); recalcula nível.
   *  [WHY] Carrega sobra e suporta múltiplos ups. No cap (50), XP segue acumulando sem efeito prático. */
  addXP: (d) => {
    const delta = Math.floor(Number(d) || 0);
    let total = Math.max(0, Math.floor(Number(STATE.player.xp) || 0)) + delta;
    if (total < 0) total = 0;
    STATE.player.xp = total;
    recalcLevelFromTotalXP();
    return true;
  }
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
 * - XP: sem mods neste esqueleto (mas expõe nível e progresso do nível para UI).
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
    atMaxLevel:  xpView.atMaxLevel
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

/* =====================[ TRECHO 9: state.js - Defaults do jogador (runtime) ]===================== */
/**
 * [DOC] initPlayerDefaults()
 * - Define valores iniciais de runtime (sem persistência) para o jogador:
 *   Status (Vida/Mana/Energia/Sanidade): max = 100; atual = max.
 *   Atributos (ATK/DEF/ACC/AGI): 5.
 *   Progressão: level=1; xp=0.
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
  STATE.player.level = 1; // [CHANGE] novo
  STATE.player.xp = 0;    // total acumulado
}
/* =====================[ FIM TRECHO 9 ]===================== */
