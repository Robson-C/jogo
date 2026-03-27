/* =====================[ TRECHO 1: ui.js - UI/DOM ]===================== */
/**
 * [DOC] Responsável por acessar e atualizar o DOM com segurança:
 *  - Nunca usa innerHTML para textos (somente textContent).
 *  - Garante 4 linhas de log visíveis (log compacto com auto-fit 4→3→2→1).
 *  - Faz o bind único dos 4 botões de ação.
 *  - renderHUD(): atualiza barras/atributos/XP/level com snapshot efetivo.
 *  - Modal do histórico de logs (clique no bloco .log).
 *  - setRoomDesc() e setRoomBackground() para descrição e fundo de sala.
 * Não possui estado próprio do jogo (STATE fica em state.js).
 */
import { getDay, getEffectivePlayerSnapshot, getLogLastN, getLogLastNTexts, getPlayerSnapshot, getAttributeUpgradeCost, PlayerAPI, appendLog } from './state.js'; // [DOC]

let els = {
  roomTitle: null,
  roomDesc: null,
  roomSection: null,
  actions: [],
  logView: null,
  enemyCard: null,
  enemyName: null,
  enemyHpBar: null,
  enemyHpFill: null,
  enemyStatAtk: null,
  enemyStatDef: null,
  enemyStatAcc: null,
  enemyStatAgi: null
};

// [STATE-UI] cache leve para modal
let _modal = {
  bound: false,
  overlay: null,
  dialog: null,
  body: null,
  closeBtn: null,
  prevFocus: null
};


const ATTR_KEYS = ['ataque', 'defesa', 'precisao', 'agilidade'];
const ATTR_LABELS = { ataque: 'Ataque', defesa: 'Defesa', precisao: 'Precisão', agilidade: 'Agilidade' };
const ATTR_DESCRIPTIONS = {
  ataque: 'Aumenta o dano base causado nos golpes.',
  defesa: 'Reduz parte do dano recebido em combate.',
  precisao: 'Ajuda a acertar ataques e reduz falhas.',
  agilidade: 'Ajuda na evasão e em ações ligadas à velocidade.'
};

let _attrModal = {
  bound: false,
  overlay: null,
  dialog: null,
  body: null,
  points: null,
  cancelBtn: null,
  applyBtn: null,
  prevFocus: null,
  base: null,
  draft: null
};

const STATUS_ALLOC_KEYS = ['vida', 'energia', 'mana', 'sanidade'];
const STATUS_LABELS = { vida: 'Vida', energia: 'Energia', mana: 'Mana', sanidade: 'Sanidade' };
const STATUS_DESCRIPTIONS = {
  vida: 'Aumenta Vida máxima e recupera +10 de Vida atual por ponto.',
  energia: 'Aumenta Energia máxima e recupera +10 de Energia atual por ponto.',
  mana: 'Aumenta Mana máxima e recupera +10 de Mana atual por ponto.',
  sanidade: 'Aumenta Sanidade máxima e recupera +10 de Sanidade atual por ponto.'
};
const STATUS_MAX_MAP = { vida: 'maxVida', energia: 'maxEnergia', mana: 'maxMana', sanidade: 'maxSanidade' };

let _statusModal = {
  bound: false,
  overlay: null,
  dialog: null,
  body: null,
  points: null,
  cancelBtn: null,
  applyBtn: null,
  prevFocus: null,
  base: null,
  draft: null
};

/* ---------------------- [STATE-UI] Log compacto: auto-fit 4→3→2→1 ---------------------- */
let _lastLogStrings = [];
let _fitRAF = 0;
let _fitting = false;

export function initUI() {
  els.roomTitle   = document.querySelector('.room-title');
  els.roomDesc    = document.querySelector('.room-desc');
  els.roomSection = document.querySelector('.room');
  els.actions = [
    document.getElementById('act-1'),
    document.getElementById('act-2'),
    document.getElementById('act-3'),
    document.getElementById('act-4')
  ].filter(Boolean);
  els.logView = document.querySelector('.log-view');
  els.enemyCard = document.querySelector('.enemy-card');
  els.enemyName = els.enemyCard ? els.enemyCard.querySelector('.enemy-name') : null;
  els.enemyHpBar = els.enemyCard ? els.enemyCard.querySelector('.enemy-hp') : null;
  els.enemyHpFill = els.enemyHpBar ? els.enemyHpBar.querySelector('.fill') : null;
  const enemyChips = els.enemyCard ? els.enemyCard.querySelectorAll('.enemy-stats .stat-chip') : [];
  els.enemyStatAtk = enemyChips[0] || null;
  els.enemyStatDef = enemyChips[1] || null;
  els.enemyStatAcc = enemyChips[2] || null;
  els.enemyStatAgi = enemyChips[3] || null;
  ensureLogLines();

  // Modal de histórico
  _bindLogModalHandlers();
  _bindAttrModalHandlers();
  _bindStatusModalHandlers();

  // Re-ajuste responsivo do log compacto
  window.addEventListener('resize', () => {
    if (!els.logView || !_lastLogStrings) return;
    _renderLogStringsToDOM(_lastLogStrings);
    _scheduleAutoFit();
  }, { passive: true });
}

function ensureLogLines() {
  if (!els.logView) return;
  const lines = els.logView.querySelectorAll('.log-line');
  for (let i = lines.length; i < 4; i++) {
    const d = document.createElement('div');
    d.className = 'log-line';
    d.textContent = '';
    els.logView.appendChild(d);
  }
  // Remove ocultações residuais (o auto-fit cuidará do visível)
  const fixed = els.logView.querySelectorAll('.log-line');
  for (let i = 0; i < fixed.length; i++) fixed[i].style.display = '';
}

export function setRoomTitle(text) {
  if (els.roomTitle) els.roomTitle.textContent = String(text || '');
}

/* Descrição textual simples da sala */
export function setRoomDesc(text) {
  if (els.roomDesc) els.roomDesc.textContent = String(text || '');
}

/* Background declarativo por sala (CSS var) */
export function setRoomBackground(urlOrNull) {
  if (!els.roomSection) els.roomSection = document.querySelector('.room');
  if (!els.roomSection) return;
  const val = (urlOrNull && typeof urlOrNull === 'string' && urlOrNull.trim())
    ? `url("${urlOrNull}")` : 'none';
  try { els.roomSection.style.setProperty('--room-bg', val); } catch (_) {}
}


/* Cartão de inimigo: exibe nome, vida e atributos quando houver combate ativo */
export function renderEnemyCard(enemy) {
  if (!els.enemyCard) els.enemyCard = document.querySelector('.enemy-card');
  if (!els.enemyCard) return;

  if (!enemy || typeof enemy !== 'object') {
    clearEnemyCard();
    return;
  }

  if (!els.enemyName) els.enemyName = els.enemyCard.querySelector('.enemy-name');
  if (!els.enemyHpBar) els.enemyHpBar = els.enemyCard.querySelector('.enemy-hp');
  if (!els.enemyHpFill && els.enemyHpBar) els.enemyHpFill = els.enemyHpBar.querySelector('.fill');
  if (!els.enemyStatAtk || !els.enemyStatDef || !els.enemyStatAcc || !els.enemyStatAgi) {
    const enemyChips = els.enemyCard.querySelectorAll('.enemy-stats .stat-chip');
    els.enemyStatAtk = enemyChips[0] || null;
    els.enemyStatDef = enemyChips[1] || null;
    els.enemyStatAcc = enemyChips[2] || null;
    els.enemyStatAgi = enemyChips[3] || null;
  }

  const maxVida = Math.max(1, Math.floor(Number(enemy.maxVida) || 1));
  const vida = Math.max(0, Math.min(maxVida, Math.floor(Number(enemy.vida) || 0)));
  const pct = Math.round((vida / maxVida) * 100);

  if (els.enemyName) els.enemyName.textContent = `${String(enemy.name || 'Inimigo')} — ${vida}/${maxVida}`;
  if (els.enemyHpBar) {
    els.enemyHpBar.setAttribute('aria-valuemin', '0');
    els.enemyHpBar.setAttribute('aria-valuemax', String(maxVida));
    els.enemyHpBar.setAttribute('aria-valuenow', String(vida));
  }
  if (els.enemyHpFill) els.enemyHpFill.style.width = `${pct}%`;

  if (els.enemyStatAtk) els.enemyStatAtk.textContent = String(Math.max(0, Math.floor(Number(enemy.ataque ?? enemy.forca) || 0)));
  if (els.enemyStatDef) els.enemyStatDef.textContent = String(Math.max(0, Math.floor(Number(enemy.defesa) || 0)));
  if (els.enemyStatAcc) els.enemyStatAcc.textContent = String(Math.max(0, Math.floor(Number(enemy.precisao) || 0)));
  if (els.enemyStatAgi) els.enemyStatAgi.textContent = String(Math.max(0, Math.floor(Number(enemy.agilidade) || 0)));

  try { els.enemyCard.hidden = false; } catch (_) {}
}

export function clearEnemyCard() {
  if (!els.enemyCard) els.enemyCard = document.querySelector('.enemy-card');
  if (!els.enemyCard) return;

  if (!els.enemyName) els.enemyName = els.enemyCard.querySelector('.enemy-name');
  if (!els.enemyHpBar) els.enemyHpBar = els.enemyCard.querySelector('.enemy-hp');
  if (!els.enemyHpFill && els.enemyHpBar) els.enemyHpFill = els.enemyHpBar.querySelector('.fill');
  if (!els.enemyStatAtk || !els.enemyStatDef || !els.enemyStatAcc || !els.enemyStatAgi) {
    const enemyChips = els.enemyCard.querySelectorAll('.enemy-stats .stat-chip');
    els.enemyStatAtk = enemyChips[0] || null;
    els.enemyStatDef = enemyChips[1] || null;
    els.enemyStatAcc = enemyChips[2] || null;
    els.enemyStatAgi = enemyChips[3] || null;
  }

  if (els.enemyName) els.enemyName.textContent = 'Inimigo';
  if (els.enemyHpBar) {
    els.enemyHpBar.setAttribute('aria-valuemin', '0');
    els.enemyHpBar.setAttribute('aria-valuemax', '100');
    els.enemyHpBar.setAttribute('aria-valuenow', '100');
  }
  if (els.enemyHpFill) els.enemyHpFill.style.width = '100%';
  if (els.enemyStatAtk) els.enemyStatAtk.textContent = '0';
  if (els.enemyStatDef) els.enemyStatDef.textContent = '0';
  if (els.enemyStatAcc) els.enemyStatAcc.textContent = '0';
  if (els.enemyStatAgi) els.enemyStatAgi.textContent = '0';

  try { els.enemyCard.hidden = true; } catch (_) {}
}

export function setActionLabel(index, text) {
  const btn = els.actions[index];
  if (btn) btn.textContent = String(text || '');
}

export function getActionLabel(index) {
  const btn = els.actions[index];
  return btn ? String(btn.textContent || '') : '';
}

export function enableAction(index, enabled) {
  const btn = els.actions[index];
  if (btn) btn.disabled = !enabled;
}

/** [DOC] Bind único dos 4 botões de ação; callback recebe índice 0..3. */
export function bindActions(onAction) {
  for (let i = 0; i < 4; i++) {
    const btn = els.actions[i];
    if (!btn) continue;
    btn.addEventListener('click', () => onAction(i), { passive: true });
  }
}

/** [DOC] Renderiza o log curto com auto-fit (4→3→2→1). */
export function renderLog(linesArr) {
  if (!els.logView) return;
  ensureLogLines();

  // Cache para re-fit em resize
  _lastLogStrings = Array.isArray(linesArr) ? linesArr.slice() : [];

  // Escreve as últimas até 4 mensagens (ordem ascendente)
  _renderLogStringsToDOM(_lastLogStrings);

  // Começa mostrando 4; o fit decide se reduz
  _applyVisibleLines(4);

  // Agenda auto-fit para o próximo frame
  _scheduleAutoFit();
}

/* ---------------------- Helpers do log compacto (privados) ---------------------- */
function _renderLogStringsToDOM(strings) {
  if (!els.logView) return;
  ensureLogLines();
  const lines = els.logView.querySelectorAll('.log-line');
  const total = Array.isArray(strings) ? strings.length : 0;
  const start = Math.max(0, total - 4);
  for (let i = 0; i < 4; i++) {
    const msg = strings[start + i] || '';
    lines[i].textContent = msg;
  }
}
function _applyVisibleLines(n) {
  if (!els.logView) return;
  const vis = Math.max(1, Math.min(4, Math.floor(Number(n) || 4)));
  const toHide = 4 - vis; // esconde as mais antigas (início)
  const lines = els.logView.querySelectorAll('.log-line');
  for (let i = 0; i < 4; i++) {
    lines[i].style.display = (i < toHide) ? 'none' : '';
  }
  els.logView.setAttribute('data-lines', String(vis));
}
function _hasOverflow() {
  if (!els.logView) return false;
  return (els.logView.scrollHeight - els.logView.clientHeight) > 0.5; // tolerância
}
function _scheduleAutoFit() {
  if (_fitRAF) cancelAnimationFrame(_fitRAF);
  _fitRAF = requestAnimationFrame(() => { _fitRAF = 0; _autoFitNow(); });
}
function _autoFitNow() {
  if (_fitting || !els.logView) return;
  _fitting = true;
  try {
    let n = 4;
    _applyVisibleLines(n);
    for (; n > 1 && _hasOverflow(); n--) {
      _applyVisibleLines(n - 1);
    }
  } catch (_) {
    // silencioso (sem console no build final)
  } finally {
    _fitting = false;
  }
}

/* ---------------------- HUD: barras, chips, XP e Level ---------------------- */
export function renderHUD() {
  const snap = getEffectivePlayerSnapshot();
  _updateStatBar('vida',     snap.vida,     snap.maxVida);
  _updateStatBar('mana',     snap.mana,     snap.maxMana);
  _updateStatBar('energia',  snap.energia,  snap.maxEnergia);
  _updateStatBar('sanidade', snap.sanidade, snap.maxSanidade);
  _setChipValue('.stat-chip--atk', snap.ataque);
  _setChipValue('.stat-chip--def', snap.defesa);
  _setChipValue('.stat-chip--acc', snap.precisao);
  _setChipValue('.stat-chip--agi', snap.agilidade);
  _updateLevel(snap.level, snap.pontosAtributoLivres);
  _updateXP(snap.xpProgress, snap.xpNeeded, !!snap.atMaxLevel);
  _updateAttributeUpgradeAvailability(snap.pontosAtributoLivres);
  _updateStatusUpgradeAvailability(snap.pontosStatusLivres);
}

function _updateStatBar(statKey, cur, max) {
  const card = document.querySelector(`.stats-grid .stat-card[data-stat="${statKey}"]`);
  if (!card) return;
  const valEl  = card.querySelector('.stat-head .stat-val');
  const barEl  = card.querySelector('.bar');
  const fillEl = barEl ? barEl.querySelector('.fill') : null;

  const safeMax = Math.max(0, Math.floor(Number(max) || 0));
  const safeCur = Math.max(0, Math.min(safeMax, Math.floor(Number(cur) || 0)));

  if (valEl) valEl.textContent = `${safeCur}/${safeMax}`;

  if (barEl) {
    barEl.setAttribute('aria-valuemin', '0');
    barEl.setAttribute('aria-valuemax', String(safeMax));
    barEl.setAttribute('aria-valuenow', String(safeCur));
  }
  if (fillEl) {
    const pct = safeMax > 0 ? Math.round((safeCur / safeMax) * 100) : 0;
    fillEl.style.width = `${pct}%`;
  }
}
function _setChipValue(selector, value) {
  const el = document.querySelector(selector);
  if (!el) return;
  const n = Math.floor(Number(value) || 0);
  el.textContent = String(n);
}
function _updateLevel(level, freePoints = 0) {
  const levelEl = document.querySelector('.toprow .level');
  const strong = levelEl ? levelEl.querySelector('strong') : null;
  const badge = levelEl ? levelEl.querySelector('.level-points-badge') : null;
  const n = Math.max(1, Math.floor(Number(level) || 1));
  const safeFree = Math.max(0, Math.floor(Number(freePoints) || 0));
  if (strong) strong.textContent = String(n);
  if (levelEl) levelEl.setAttribute('data-has-points', safeFree > 0 ? 'true' : 'false');
  if (badge) {
    if (safeFree > 0) {
      badge.hidden = false;
      badge.textContent = `+${safeFree}`;
      badge.setAttribute('aria-label', `${safeFree} pontos de atributo livres`);
    } else {
      badge.hidden = true;
      badge.textContent = '+0';
      badge.setAttribute('aria-label', 'Nenhum ponto de atributo livre');
    }
  }
}
function _updateAttributeUpgradeAvailability(freePoints) {
  const safeFree = Math.max(0, Math.floor(Number(freePoints) || 0));
  const chips = document.querySelectorAll('.secstats .stat-chip');
  const chipKeys = ['ataque', 'defesa', 'precisao', 'agilidade'];
  for (let i = 0; i < chips.length; i++) {
    const chip = chips[i];
    const key = chipKeys[i] || '';
    const label = ATTR_LABELS[key] || 'Atributo';
    const desc = ATTR_DESCRIPTIONS[key] || '';
    chip.disabled = !(safeFree > 0);
    chip.setAttribute('data-can-upgrade', safeFree > 0 ? 'true' : 'false');
    chip.setAttribute('title', safeFree > 0 ? `${label}: ${desc} Toque para distribuir pontos.` : `${label}: ${desc}`);
    chip.setAttribute('aria-label', safeFree > 0 ? `${label}. ${desc} Você tem ${safeFree} pontos de atributo livres.` : `${label}. ${desc}`);
  }
}
function _updateStatusUpgradeAvailability(freePoints) {
  const safeFree = Math.max(0, Math.floor(Number(freePoints) || 0));
  const cards = document.querySelectorAll('.stats-grid .stat-card');
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const key = String(card.getAttribute('data-stat') || '');
    if (!STATUS_ALLOC_KEYS.includes(key)) continue;
    const label = STATUS_LABELS[key] || 'Status';
    const desc = STATUS_DESCRIPTIONS[key] || '';
    const canUpgrade = safeFree > 0;
    card.setAttribute('data-can-upgrade', canUpgrade ? 'true' : 'false');
    card.setAttribute('data-status-points', canUpgrade ? String(safeFree) : '');
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', canUpgrade ? '0' : '-1');
    card.setAttribute('title', canUpgrade ? `${label}: ${desc} Toque para distribuir pontos.` : `${label}: ${desc}`);
    card.setAttribute('aria-label', canUpgrade ? `${label}. ${desc} Você tem ${safeFree} pontos de status livres.` : `${label}. ${desc}`);
  }
}
function _updateXP(progress, needed, atMax) {
  const label = document.querySelector('.xp-stack .xp-label');
  const bar   = document.querySelector('.xp-stack .xp-bar');
  const fill  = bar ? bar.querySelector('.xp-fill') : null;

  const safeNeeded  = Math.max(1, Math.floor(Number(needed) || 100));
  const safeProg    = Math.max(0, Math.min(safeNeeded, Math.floor(Number(progress) || 0)));
  const nowValue    = atMax ? safeNeeded : safeProg;

  if (label) {
    if (atMax) label.textContent = 'MAX';
    else label.textContent = `${nowValue}/${safeNeeded}`;
  }
  if (bar) {
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(safeNeeded));
    bar.setAttribute('aria-valuenow', String(nowValue));
  }
  if (fill) {
    const pct = atMax ? 100 : Math.round((nowValue / safeNeeded) * 100);
    fill.style.width = `${pct}%`;
  }
}
/* =====================[ FIM TRECHO 1 ]===================== */


/* =====================[ TRECHO 2: ui.js - Runline (Dia e Andar) ]===================== */
/**
 * [DOC] Atualiza o texto do "Dia" e do "Andar" na runline com segurança (textContent).
 * Pesquisa preguiçosa dos elementos.
 */
let _runlineDayEl = null;
let _runlineFloorEl = null;
function _ensureRunlineEls() {
  if (!_runlineDayEl) {
    _runlineDayEl = document.querySelector('.runline .runline-day');
  }
  if (!_runlineFloorEl) {
    _runlineFloorEl = document.querySelector('.runline .runline-floor');
  }
}

/** Exibe "Dia <n>" (n mínimo 1) */
export function setRunlineDay(n) {
  _ensureRunlineEls();
  if (!_runlineDayEl) return;
  const num = Math.max(1, Math.floor(Number(n) || 1));
  _runlineDayEl.textContent = 'Dia ' + num;
}

/** Exibe "Andar <n>" (n mínimo 1) */
export function setRunlineFloor(n) {
  _ensureRunlineEls();
  if (!_runlineFloorEl) return;
  const num = Math.max(1, Math.floor(Number(n) || 1));
  _runlineFloorEl.textContent = 'Andar ' + num;
}
/* =====================[ FIM TRECHO 2 ]===================== */

/* =====================[ TRECHO 3: ui.js - Log Modal (abrir/fechar/render) ]===================== */
/**
 * [DOC]
 * - Clique no bloco .log abre modal (#log-modal) com as **últimas 100 entradas**.
 * - Corpo rolável; largura do dialog casa com a largura do bloco .log.
 * - Fechamento por botão ✕, backdrop e ESC.
 * - Acessibilidade: foco vai para o corpo do modal e é restaurado ao fechar.
 * [CHANGE] Prefixo apenas no modal: se o item tiver ctx.day, mostra "[Dia N] " antes da mensagem.
 */
function _ensureModalEls() {
  if (!_modal.overlay)   _modal.overlay  = document.getElementById('log-modal');
  if (!_modal.dialog)    _modal.dialog   = _modal.overlay ? _modal.overlay.querySelector('.modal-dialog') : null;
  if (!_modal.body)      _modal.body     = _modal.overlay ? _modal.overlay.querySelector('#log-modal-body') : null;
  if (!_modal.closeBtn)  _modal.closeBtn = _modal.overlay ? _modal.overlay.querySelector('.modal-close') : null;
}

function _setDialogWidthToLog() {
  _ensureModalEls();
  if (!_modal.dialog) return;
  const logBox = document.querySelector('.log');
  if (logBox) {
    const w = logBox.offsetWidth;
    _modal.dialog.style.width = (w > 0 ? (w + 'px') : 'auto');
  } else {
    _modal.dialog.style.width = 'auto';
  }
}

function _fillModalWithLogs() {
  _ensureModalEls();
  if (!_modal.body) return;
  // Limpa conteúdo anterior
  while (_modal.body.firstChild) _modal.body.removeChild(_modal.body.firstChild);

  // Coleta as últimas 100 entradas (ordem cronológica ascendente, como o log curto)
  const entries = getLogLastN(100);
  for (let i = 0; i < entries.length; i++) {
    const it = entries[i];
    const line = document.createElement('div');
    line.className = 'modal-log-line';
    if (it && typeof it.sev === 'string') line.setAttribute('data-sev', it.sev);

    // [CHANGE] Prefixo de dia somente no modal
    let prefix = '';
    try {
      const d = it && it.ctx && Number.isFinite(it.ctx.day) ? Math.max(1, Math.floor(it.ctx.day)) : null;
      if (d !== null) prefix = `[Dia ${d}] `;
    } catch (_) {}

    const msgText = (it && typeof it.msg === 'string') ? it.msg : '';
    line.textContent = prefix + msgText;

    _modal.body.appendChild(line);
  }
  // Foco inicial no corpo
  try { _modal.body.focus(); } catch (_) {}
}

function _openLogModal() {
  _ensureModalEls();
  if (!_modal.overlay) return;

  try { _modal.overlay.removeAttribute('inert'); } catch (_) {}

  _setDialogWidthToLog();
  _fillModalWithLogs();

  _modal.prevFocus = document.activeElement || null;
  document.body.classList.add('no-scroll');
  _modal.overlay.removeAttribute('hidden');
  _modal.overlay.setAttribute('aria-hidden', 'false');

  document.addEventListener('keydown', _onEscClose, { passive: true });
}

/**
 * [WHY] Evita warning de focus ao ocultar overlay.
 */
function _closeLogModal() {
  _ensureModalEls();
  if (!_modal.overlay) return;

  try {
    const active = document.activeElement;
    if (active && _modal.overlay.contains(active)) {
      try { active.blur(); } catch (_) {}
      let restored = false;
      if (_modal.prevFocus && typeof _modal.prevFocus.focus === 'function') {
        try {
          if (!_modal.overlay.contains(_modal.prevFocus)) {
            _modal.prevFocus.focus();
            restored = true;
          }
        } catch (_) {}
      }
      if (!restored) {
        try { document.body.setAttribute('tabindex', '-1'); document.body.focus(); } catch (_) {}
        try { document.body.removeAttribute('tabindex'); } catch (_) {}
      }
    }
  } catch (_) {}

  try { _modal.overlay.setAttribute('inert', ''); } catch (_) {}

  requestAnimationFrame(() => {
    try {
      _modal.overlay.setAttribute('aria-hidden', 'true');
      _modal.overlay.setAttribute('hidden', '');
    } catch (_) {}
    document.body.classList.remove('no-scroll');

    _modal.prevFocus = null;
    document.removeEventListener('keydown', _onEscClose);
  });
}

function _onEscClose(e) {
  if (e && (e.key === 'Escape' || e.key === 'Esc')) _closeLogModal();
}

function _bindLogModalHandlers() {
  if (_modal.bound) return;
  _ensureModalEls();

  const logBox = document.querySelector('.log');
  if (logBox) {
    logBox.addEventListener('click', () => _openLogModal(), { passive: true });
  }

  if (_modal.closeBtn) {
    _modal.closeBtn.addEventListener('click', () => _closeLogModal(), { passive: true });
  }

  if (_modal.overlay) {
    _modal.overlay.addEventListener('click', (ev) => {
      if (ev.target === _modal.overlay) _closeLogModal();
    }, { passive: true });
  }

  _modal.bound = true;
}
/* =====================[ FIM TRECHO 3 ]===================== */


/* =====================[ TRECHO 4: ui.js - Modal de Atributos ]===================== */
function _ensureAttrModalEls() {
  if (!_attrModal.overlay)   _attrModal.overlay   = document.getElementById('attr-modal');
  if (!_attrModal.dialog)    _attrModal.dialog    = _attrModal.overlay ? _attrModal.overlay.querySelector('.modal-dialog--attr') : null;
  if (!_attrModal.body)      _attrModal.body      = _attrModal.overlay ? _attrModal.overlay.querySelector('#attr-modal-body') : null;
  if (!_attrModal.points)    _attrModal.points    = _attrModal.overlay ? _attrModal.overlay.querySelector('#attr-modal-points') : null;
  if (!_attrModal.cancelBtn) _attrModal.cancelBtn = _attrModal.overlay ? _attrModal.overlay.querySelector('#attr-modal-cancel') : null;
  if (!_attrModal.applyBtn)  _attrModal.applyBtn  = _attrModal.overlay ? _attrModal.overlay.querySelector('#attr-modal-apply') : null;
}

function _resetAttrDraft() {
  const base = getPlayerSnapshot();
  _attrModal.base = {
    ataque: Math.max(0, Math.floor(Number(base.ataque) || 0)),
    defesa: Math.max(0, Math.floor(Number(base.defesa) || 0)),
    precisao: Math.max(0, Math.floor(Number(base.precisao) || 0)),
    agilidade: Math.max(0, Math.floor(Number(base.agilidade) || 0))
  };
  _attrModal.draft = { ataque: 0, defesa: 0, precisao: 0, agilidade: 0 };
}

function _getDraftAttrValue(key) {
  if (!_attrModal.base || !_attrModal.draft || !ATTR_KEYS.includes(key)) return 0;
  return Math.max(0, Math.min(99, _attrModal.base[key] + _attrModal.draft[key]));
}

function _getDraftSpentCost() {
  if (!_attrModal.base || !_attrModal.draft) return 0;
  let total = 0;
  for (let i = 0; i < ATTR_KEYS.length; i++) {
    const key = ATTR_KEYS[i];
    let cur = _attrModal.base[key];
    const inc = Math.max(0, Math.floor(Number(_attrModal.draft[key]) || 0));
    for (let step = 0; step < inc; step++) {
      total += getAttributeUpgradeCost(cur);
      cur++;
    }
  }
  return total;
}

function _getRemainingDraftPoints() {
  const snap = getEffectivePlayerSnapshot();
  const free = Math.max(0, Math.floor(Number(snap.pontosAtributoLivres) || 0));
  return Math.max(0, free - _getDraftSpentCost());
}

function _getNextDraftStepCost(key) {
  if (!_attrModal.base || !_attrModal.draft || !ATTR_KEYS.includes(key)) return 0;
  const cur = _getDraftAttrValue(key);
  if (cur >= 99) return 0;
  return getAttributeUpgradeCost(cur);
}

function _canIncreaseDraft(key) {
  if (!_attrModal.base || !_attrModal.draft || !ATTR_KEYS.includes(key)) return false;
  const nextCost = _getNextDraftStepCost(key);
  if (nextCost <= 0) return false;
  if (_getDraftAttrValue(key) >= 99) return false;
  return _getRemainingDraftPoints() >= nextCost;
}

function _renderAttrModal() {
  _ensureAttrModalEls();
  if (!_attrModal.overlay || !_attrModal.body) return;
  const pointsLeft = _getRemainingDraftPoints();
  if (_attrModal.points) _attrModal.points.textContent = String(pointsLeft);

  const rows = _attrModal.body.querySelectorAll('.attr-row');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const key = String(row.getAttribute('data-attr') || '');
    if (!ATTR_KEYS.includes(key)) continue;
    const base = _attrModal.base ? _attrModal.base[key] : 0;
    const draft = _attrModal.draft ? Math.max(0, Math.floor(Number(_attrModal.draft[key]) || 0)) : 0;
    const valueEl = row.querySelector('[data-role="value"]');
    const costEl = row.querySelector('[data-role="cost"]');
    const descEl = row.querySelector('[data-role="desc"]');
    const minusBtn = row.querySelector('[data-action="minus"]');
    const plusBtn = row.querySelector('[data-action="plus"]');
    const nextCost = _getNextDraftStepCost(key);
    const currentPreview = _getDraftAttrValue(key);

    if (valueEl) {
      valueEl.textContent = draft > 0 ? `${base} → ${currentPreview}` : String(base);
    }
    if (descEl) {
      descEl.textContent = ATTR_DESCRIPTIONS[key] || '';
    }
    if (costEl) {
      costEl.textContent = nextCost > 0 ? `Custo: ${nextCost}` : 'MAX';
    }
    if (minusBtn) minusBtn.disabled = draft <= 0;
    if (plusBtn) plusBtn.disabled = !_canIncreaseDraft(key);
  }

  const spent = _getDraftSpentCost();
  if (_attrModal.applyBtn) _attrModal.applyBtn.disabled = !(spent > 0);
}

function _openAttrModal() {
  const snap = getEffectivePlayerSnapshot();
  const free = Math.max(0, Math.floor(Number(snap.pontosAtributoLivres) || 0));
  if (free <= 0) return;

  _ensureAttrModalEls();
  if (!_attrModal.overlay) return;

  try { _attrModal.overlay.removeAttribute('inert'); } catch (_) {}
  _resetAttrDraft();
  _renderAttrModal();

  _attrModal.prevFocus = document.activeElement || null;
  document.body.classList.add('no-scroll');
  _attrModal.overlay.removeAttribute('hidden');
  _attrModal.overlay.setAttribute('aria-hidden', 'false');

  try { if (_attrModal.body) _attrModal.body.focus(); } catch (_) {}
  document.addEventListener('keydown', _onEscCloseAttr, { passive: true });
}

function _closeAttrModal() {
  _ensureAttrModalEls();
  if (!_attrModal.overlay) return;

  try {
    const active = document.activeElement;
    if (active && _attrModal.overlay.contains(active)) {
      try { active.blur(); } catch (_) {}
      let restored = false;
      if (_attrModal.prevFocus && typeof _attrModal.prevFocus.focus === 'function') {
        try {
          if (!_attrModal.overlay.contains(_attrModal.prevFocus)) {
            _attrModal.prevFocus.focus();
            restored = true;
          }
        } catch (_) {}
      }
      if (!restored) {
        try { document.body.setAttribute('tabindex', '-1'); document.body.focus(); } catch (_) {}
        try { document.body.removeAttribute('tabindex'); } catch (_) {}
      }
    }
  } catch (_) {}

  try { _attrModal.overlay.setAttribute('inert', ''); } catch (_) {}

  requestAnimationFrame(() => {
    try {
      _attrModal.overlay.setAttribute('aria-hidden', 'true');
      _attrModal.overlay.setAttribute('hidden', '');
    } catch (_) {}
    document.body.classList.remove('no-scroll');
    _attrModal.prevFocus = null;
    document.removeEventListener('keydown', _onEscCloseAttr);
  });
}

function _stepAttrDraft(key, dir) {
  if (!ATTR_KEYS.includes(key) || !_attrModal.draft) return;
  if (dir > 0) {
    if (_canIncreaseDraft(key)) _attrModal.draft[key] += 1;
  } else if (dir < 0) {
    if (_attrModal.draft[key] > 0) _attrModal.draft[key] -= 1;
  }
  _renderAttrModal();
}

function _applyAttrDraft() {
  if (!_attrModal.draft) return;
  const plan = {
    ataque: Math.max(0, Math.floor(Number(_attrModal.draft.ataque) || 0)),
    defesa: Math.max(0, Math.floor(Number(_attrModal.draft.defesa) || 0)),
    precisao: Math.max(0, Math.floor(Number(_attrModal.draft.precisao) || 0)),
    agilidade: Math.max(0, Math.floor(Number(_attrModal.draft.agilidade) || 0))
  };
  const res = PlayerAPI.applyAttributeAllocation(plan);
  if (!res || !res.ok) return;

  const parts = [];
  for (let i = 0; i < ATTR_KEYS.length; i++) {
    const key = ATTR_KEYS[i];
    const amount = res.applied && Number(res.applied[key]) ? Math.floor(Number(res.applied[key])) : 0;
    if (amount > 0) parts.push(`${ATTR_LABELS[key]} +${amount}`);
  }
  const msg = parts.length ? `Você distribuiu atributos: ${parts.join(', ')}.` : 'Você distribuiu atributos.';
  appendLog({ sev: 'mod', msg, ctx: { day: getDay() } });
  renderHUD();
  renderLog(getLogLastNTexts(4));
  _closeAttrModal();
}

function _onEscCloseAttr(e) {
  if (e && (e.key === 'Escape' || e.key === 'Esc')) _closeAttrModal();
}

function _bindAttrModalHandlers() {
  if (_attrModal.bound) return;
  _ensureAttrModalEls();

  const chips = document.querySelectorAll('.secstats .stat-chip');
  for (let i = 0; i < chips.length; i++) {
    chips[i].addEventListener('click', () => _openAttrModal(), { passive: true });
  }

  if (_attrModal.body) {
    _attrModal.body.addEventListener('click', (ev) => {
      const btn = ev.target && typeof ev.target.closest === 'function' ? ev.target.closest('.attr-step') : null;
      if (!btn) return;
      const key = String(btn.getAttribute('data-attr') || '');
      const action = String(btn.getAttribute('data-action') || '');
      if (action === 'plus') _stepAttrDraft(key, +1);
      if (action === 'minus') _stepAttrDraft(key, -1);
    });
  }

  if (_attrModal.cancelBtn) {
    _attrModal.cancelBtn.addEventListener('click', () => _closeAttrModal(), { passive: true });
  }
  if (_attrModal.applyBtn) {
    _attrModal.applyBtn.addEventListener('click', () => _applyAttrDraft(), { passive: true });
  }
  if (_attrModal.overlay) {
    _attrModal.overlay.addEventListener('click', (ev) => {
      if (ev.target === _attrModal.overlay) _closeAttrModal();
    }, { passive: true });
  }

  _attrModal.bound = true;
}
/* =====================[ FIM TRECHO 4 ]===================== */

/* =====================[ TRECHO 5: ui.js - Modal de Status ]===================== */
function _ensureStatusModalEls() {
  if (!_statusModal.overlay)   _statusModal.overlay   = document.getElementById('status-modal');
  if (!_statusModal.dialog)    _statusModal.dialog    = _statusModal.overlay ? _statusModal.overlay.querySelector('.modal-dialog--status') : null;
  if (!_statusModal.body)      _statusModal.body      = _statusModal.overlay ? _statusModal.overlay.querySelector('#status-modal-body') : null;
  if (!_statusModal.points)    _statusModal.points    = _statusModal.overlay ? _statusModal.overlay.querySelector('#status-modal-points') : null;
  if (!_statusModal.cancelBtn) _statusModal.cancelBtn = _statusModal.overlay ? _statusModal.overlay.querySelector('#status-modal-cancel') : null;
  if (!_statusModal.applyBtn)  _statusModal.applyBtn  = _statusModal.overlay ? _statusModal.overlay.querySelector('#status-modal-apply') : null;
}

function _resetStatusDraft() {
  const base = getPlayerSnapshot();
  _statusModal.base = {};
  for (let i = 0; i < STATUS_ALLOC_KEYS.length; i++) {
    const key = STATUS_ALLOC_KEYS[i];
    const maxKey = STATUS_MAX_MAP[key];
    _statusModal.base[key] = {
      cur: Math.max(0, Math.floor(Number(base[key]) || 0)),
      max: Math.max(0, Math.floor(Number(base[maxKey]) || 0))
    };
  }
  _statusModal.draft = { vida: 0, energia: 0, mana: 0, sanidade: 0 };
}

function _getStatusDraftSpent() {
  if (!_statusModal.draft) return 0;
  let total = 0;
  for (let i = 0; i < STATUS_ALLOC_KEYS.length; i++) {
    total += Math.max(0, Math.floor(Number(_statusModal.draft[STATUS_ALLOC_KEYS[i]]) || 0));
  }
  return total;
}

function _getStatusDraftRemaining() {
  const snap = getEffectivePlayerSnapshot();
  const free = Math.max(0, Math.floor(Number(snap.pontosStatusLivres) || 0));
  return Math.max(0, free - _getStatusDraftSpent());
}

function _renderStatusModal() {
  _ensureStatusModalEls();
  if (!_statusModal.overlay || !_statusModal.body) return;
  const pointsLeft = _getStatusDraftRemaining();
  if (_statusModal.points) _statusModal.points.textContent = String(pointsLeft);

  const rows = _statusModal.body.querySelectorAll('.attr-row');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const key = String(row.getAttribute('data-status') || '');
    if (!STATUS_ALLOC_KEYS.includes(key)) continue;
    const base = _statusModal.base ? _statusModal.base[key] : { cur: 0, max: 0 };
    const draft = _statusModal.draft ? Math.max(0, Math.floor(Number(_statusModal.draft[key]) || 0)) : 0;
    const valueEl = row.querySelector('[data-role="value"]');
    const costEl = row.querySelector('[data-role="cost"]');
    const descEl = row.querySelector('[data-role="desc"]');
    const minusBtn = row.querySelector('[data-action="minus"]');
    const plusBtn = row.querySelector('[data-action="plus"]');
    const curPreview = base.cur + (draft * 10);
    const maxPreview = base.max + (draft * 10);

    if (valueEl) {
      valueEl.textContent = draft > 0 ? `${base.cur}/${base.max} → ${curPreview}/${maxPreview}` : `${base.cur}/${base.max}`;
    }
    if (descEl) descEl.textContent = STATUS_DESCRIPTIONS[key] || '';
    if (costEl) costEl.textContent = '+10';
    if (minusBtn) minusBtn.disabled = draft <= 0;
    if (plusBtn) plusBtn.disabled = _getStatusDraftRemaining() <= 0;
  }

  if (_statusModal.applyBtn) _statusModal.applyBtn.disabled = !(_getStatusDraftSpent() > 0);
}

function _openStatusModal() {
  const snap = getEffectivePlayerSnapshot();
  const free = Math.max(0, Math.floor(Number(snap.pontosStatusLivres) || 0));
  if (free <= 0) return;

  _ensureStatusModalEls();
  if (!_statusModal.overlay) return;

  try { _statusModal.overlay.removeAttribute('inert'); } catch (_) {}
  _resetStatusDraft();
  _renderStatusModal();

  _statusModal.prevFocus = document.activeElement || null;
  document.body.classList.add('no-scroll');
  _statusModal.overlay.removeAttribute('hidden');
  _statusModal.overlay.setAttribute('aria-hidden', 'false');

  try { if (_statusModal.body) _statusModal.body.focus(); } catch (_) {}
  document.addEventListener('keydown', _onEscCloseStatus, { passive: true });
}

function _closeStatusModal() {
  _ensureStatusModalEls();
  if (!_statusModal.overlay) return;

  try {
    const active = document.activeElement;
    if (active && _statusModal.overlay.contains(active)) {
      try { active.blur(); } catch (_) {}
      let restored = false;
      if (_statusModal.prevFocus && typeof _statusModal.prevFocus.focus === 'function') {
        try {
          if (!_statusModal.overlay.contains(_statusModal.prevFocus)) {
            _statusModal.prevFocus.focus();
            restored = true;
          }
        } catch (_) {}
      }
      if (!restored) {
        try { document.body.setAttribute('tabindex', '-1'); document.body.focus(); } catch (_) {}
        try { document.body.removeAttribute('tabindex'); } catch (_) {}
      }
    }
  } catch (_) {}

  try { _statusModal.overlay.setAttribute('inert', ''); } catch (_) {}

  requestAnimationFrame(() => {
    try {
      _statusModal.overlay.setAttribute('aria-hidden', 'true');
      _statusModal.overlay.setAttribute('hidden', '');
    } catch (_) {}
    document.body.classList.remove('no-scroll');
    _statusModal.prevFocus = null;
    document.removeEventListener('keydown', _onEscCloseStatus);
  });
}

function _stepStatusDraft(key, dir) {
  if (!STATUS_ALLOC_KEYS.includes(key) || !_statusModal.draft) return;
  if (dir > 0) {
    if (_getStatusDraftRemaining() > 0) _statusModal.draft[key] += 1;
  } else if (dir < 0) {
    if (_statusModal.draft[key] > 0) _statusModal.draft[key] -= 1;
  }
  _renderStatusModal();
}

function _applyStatusDraft() {
  if (!_statusModal.draft) return;
  const plan = {
    vida: Math.max(0, Math.floor(Number(_statusModal.draft.vida) || 0)),
    energia: Math.max(0, Math.floor(Number(_statusModal.draft.energia) || 0)),
    mana: Math.max(0, Math.floor(Number(_statusModal.draft.mana) || 0)),
    sanidade: Math.max(0, Math.floor(Number(_statusModal.draft.sanidade) || 0))
  };
  const res = PlayerAPI.applyStatusAllocation(plan);
  if (!res || !res.ok) return;

  const parts = [];
  for (let i = 0; i < STATUS_ALLOC_KEYS.length; i++) {
    const key = STATUS_ALLOC_KEYS[i];
    const amount = res.applied && Number(res.applied[key]) ? Math.floor(Number(res.applied[key])) : 0;
    if (amount > 0) parts.push(`${STATUS_LABELS[key]} +${amount * 10}`);
  }
  const msg = parts.length ? `Você distribuiu status: ${parts.join(', ')}.` : 'Você distribuiu status.';
  appendLog({ sev: 'mod', msg, ctx: { day: getDay() } });
  renderHUD();
  renderLog(getLogLastNTexts(4));
  _closeStatusModal();
}

function _onEscCloseStatus(e) {
  if (e && (e.key === 'Escape' || e.key === 'Esc')) _closeStatusModal();
}

function _bindStatusModalHandlers() {
  if (_statusModal.bound) return;
  _ensureStatusModalEls();

  const cards = document.querySelectorAll('.stats-grid .stat-card');
  for (let i = 0; i < cards.length; i++) {
    cards[i].addEventListener('click', () => _openStatusModal(), { passive: true });
    cards[i].addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        _openStatusModal();
      }
    });
  }

  if (_statusModal.body) {
    _statusModal.body.addEventListener('click', (ev) => {
      const btn = ev.target && typeof ev.target.closest === 'function' ? ev.target.closest('.attr-step') : null;
      if (!btn) return;
      const key = String(btn.getAttribute('data-status') || '');
      const action = String(btn.getAttribute('data-action') || '');
      if (action === 'plus') _stepStatusDraft(key, +1);
      if (action === 'minus') _stepStatusDraft(key, -1);
    });
  }

  if (_statusModal.cancelBtn) {
    _statusModal.cancelBtn.addEventListener('click', () => _closeStatusModal(), { passive: true });
  }
  if (_statusModal.applyBtn) {
    _statusModal.applyBtn.addEventListener('click', () => _applyStatusDraft(), { passive: true });
  }
  if (_statusModal.overlay) {
    _statusModal.overlay.addEventListener('click', (ev) => {
      if (ev.target === _statusModal.overlay) _closeStatusModal();
    }, { passive: true });
  }

  _statusModal.bound = true;
}
/* =====================[ FIM TRECHO 5 ]===================== */
