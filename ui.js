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
import { getEffectivePlayerSnapshot, getLogLastN } from './state.js'; // [DOC]

let els = {
  roomTitle: null,
  roomDesc: null,
  roomSection: null,
  actions: [],
  logView: null
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
  ensureLogLines();

  // Modal de histórico
  _bindLogModalHandlers();

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
  _updateLevel(snap.level);
  _updateXP(snap.xpProgress, snap.xpNeeded, !!snap.atMaxLevel);
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
function _updateLevel(level) {
  const strong = document.querySelector('.toprow .level strong');
  const n = Math.max(1, Math.floor(Number(level) || 1));
  if (strong) strong.textContent = String(n);
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


/* =====================[ TRECHO 2: ui.js - Runline (Dia) ]===================== */
/**
 * [DOC] Atualiza o texto do "Dia" na runline com segurança (textContent).
 * Pesquisa preguiçosa do elemento.
 */
let _runlineDayEl = null;
function _ensureRunlineEls() {
  if (!_runlineDayEl) {
    _runlineDayEl = document.querySelector('.runline .runline-day');
  }
}

/** Exibe "Dia <n>" (n mínimo 1) */
export function setRunlineDay(n) {
  _ensureRunlineEls();
  if (!_runlineDayEl) return;
  const num = Math.max(1, Math.floor(Number(n) || 1));
  _runlineDayEl.textContent = 'Dia ' + num;
}
/* =====================[ FIM TRECHO 2 ]===================== */

/* =====================[ TRECHO 3: ui.js - Log Modal (abrir/fechar/render) ]===================== */
/**
 * [DOC]
 * - Clique no bloco .log abre modal (#log-modal) com as **últimas 100 entradas**.
 * - Corpo rolável (CSS já cobre); largura do dialog casa com a largura do bloco .log.
 * - Fechamento por botão ✕, clique no backdrop e tecla ESC.
 * - Acessibilidade: foco vai para o corpo do modal e é restaurado ao fechar; body sem scroll.
 * [WHY] Evita o warning "Blocked aria-hidden..." garantindo que o foco saia do overlay
 *       antes de aplicar aria-hidden/hidden, com reforço via `inert` e rAF.
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
    line.textContent = (it && typeof it.msg === 'string') ? it.msg : '';
    _modal.body.appendChild(line);
  }
  // Foco inicial no corpo para leitores de tela/teclado
  try { _modal.body.focus(); } catch (_) {}
}

function _openLogModal() {
  _ensureModalEls();
  if (!_modal.overlay) return;

  // Garantir que o overlay possa receber foco/teclas
  try { _modal.overlay.removeAttribute('inert'); } catch (_) {}

  _setDialogWidthToLog();
  _fillModalWithLogs();

  // Travar scroll do body e mostrar overlay
  _modal.prevFocus = document.activeElement || null;
  document.body.classList.add('no-scroll');
  _modal.overlay.removeAttribute('hidden');
  _modal.overlay.setAttribute('aria-hidden', 'false');

  // ESC fecha
  document.addEventListener('keydown', _onEscClose, { passive: true });
}

/**
 * [CHANGE][WHY] Para eliminar o warning "Blocked aria-hidden on an element because its descendant retained focus":
 * 1) Se o foco atual estiver dentro do overlay, aplicamos blur e restauramos foco fora.
 * 2) Marcamos o overlay como `inert` (previne foco imediato).
 * 3) Aplicamos aria-hidden/hidden no próximo frame (rAF), quando o foco já saiu do overlay.
 */
function _closeLogModal() {
  _ensureModalEls();
  if (!_modal.overlay) return;

  // 1) Se o foco estiver dentro do overlay, remover o foco e restaurar fora
  try {
    const active = document.activeElement;
    if (active && _modal.overlay.contains(active)) {
      try { active.blur(); } catch (_) {}
      let restored = false;
      if (_modal.prevFocus && typeof _modal.prevFocus.focus === 'function') {
        try {
          // Evita restaurar foco para algo DENTRO do overlay por engano
          if (!_modal.overlay.contains(_modal.prevFocus)) {
            _modal.prevFocus.focus();
            restored = true;
          }
        } catch (_) {}
      }
      if (!restored) {
        try {
          // Fallback seguro: body recebe foco temporariamente
          document.body.setAttribute('tabindex', '-1');
          document.body.focus();
        } catch (_) {}
        try { document.body.removeAttribute('tabindex'); } catch (_) {}
      }
    }
  } catch (_) {}

  // 2) Prevenir que o overlay ou seus filhos recuperem foco imediatamente
  try { _modal.overlay.setAttribute('inert', ''); } catch (_) {}

  // 3) Esconder e marcar aria-hidden no PRÓXIMO FRAME (após a movimentação de foco)
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

  // Click no bloco do log abre o modal
  const logBox = document.querySelector('.log');
  if (logBox) {
    logBox.addEventListener('click', () => _openLogModal(), { passive: true });
  }

  // Botão ✕
  if (_modal.closeBtn) {
    _modal.closeBtn.addEventListener('click', () => _closeLogModal(), { passive: true });
  }

  // Clique no backdrop fecha (ignora cliques dentro do dialog)
  if (_modal.overlay) {
    _modal.overlay.addEventListener('click', (ev) => {
      if (ev.target === _modal.overlay) _closeLogModal();
    }, { passive: true });
  }

  _modal.bound = true;
}
/* =====================[ FIM TRECHO 3 ]===================== */
