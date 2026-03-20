/* =====================[ TRECHO 1: scene_panel.js - Painel isolado da cena ]===================== */
/**
 * [DOC]
 * Responsável apenas pela área central da cena.
 * - Um slot visual único com modos exclusivos: sala OU inimigo.
 * - Sem dependência de HUD, ações, log ou engine.
 * - Atualizações textuais usam apenas textContent.
 * - O visual do inimigo é tratado aqui para manter o módulo de cena desacoplado.
 */
let els = {
  root: null,
  roomPanel: null,
  roomTitle: null,
  roomDesc: null,
  enemyPanel: null,
  enemyName: null,
  enemyGlyph: null,
  enemyHpBar: null,
  enemyHpFill: null,
  enemyHpValue: null,
  enemyStatAtk: null,
  enemyStatDef: null,
  enemyStatAcc: null,
  enemyStatAgi: null
};

function ensureElements() {
  if (els.root) return true;
  initScenePanel();
  return !!els.root;
}

function setSceneBackground(urlOrNull) {
  if (!ensureElements()) return;
  const val = (urlOrNull && typeof urlOrNull === 'string' && urlOrNull.trim())
    ? `url("${urlOrNull}")` : 'none';
  try { els.root.style.setProperty('--room-bg', val); } catch (_) {}
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveEnemyVisual(enemy) {
  const name = normalizeText(enemy?.name);

  const rules = [
    { test: /(slime|gelatina|cubo)/, glyph: '🧪', theme: 'verdant' },
    { test: /(planta|cogumelo|fada)/, glyph: '🌿', theme: 'verdant' },
    { test: /(livro|orbe|olho)/, glyph: '🔮', theme: 'arcane' },
    { test: /(gárgula|gargula|golem|pedra)/, glyph: '🗿', theme: 'stone' },
    { test: /(salamandra|cobra|aranha|lobo|rato|morcego|sapo|coruja|urso|tatu)/, glyph: '🐾', theme: 'beast' },
    { test: /(espectro|fantasma|noiva|vampiro|súcubo|sucubo|zumbi|sombra|sem rosto|sem boca|abismo|vazio)/, glyph: '👁️', theme: 'spectral' },
    { test: /(anjo|padre|socorrista|médico|medico|enfermeira|vigia|guia|resgate|perdão|perdao|guardião|guardiao)/, glyph: '✴️', theme: 'holy' },
    { test: /(globin|goblin|orc|ogro|minotauro|troll|harpia|esqueleto|marionete)/, glyph: '⚔️', theme: 'hostile' },
    { test: /(ceifeiro|fim|destino|macabro|distorcida|sombria|eclipse)/, glyph: '☠️', theme: 'void' }
  ];

  for (const rule of rules) {
    if (rule.test.test(name)) return { glyph: rule.glyph, theme: rule.theme };
  }

  return { glyph: '☠️', theme: 'hostile' };
}

function resetEnemyPanel() {
  if (!ensureElements()) return;
  if (els.enemyPanel) els.enemyPanel.dataset.theme = 'hostile';
  if (els.enemyName) els.enemyName.textContent = 'Inimigo';
  if (els.enemyGlyph) els.enemyGlyph.textContent = '☠️';
  if (els.enemyHpValue) els.enemyHpValue.textContent = '0/0';
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
}

export function initScenePanel() {
  els.root = document.querySelector('.scene-slot');
  els.roomPanel = document.querySelector('.scene-panel--room');
  els.roomTitle = document.querySelector('.room-title');
  els.roomDesc = document.querySelector('.room-desc');
  els.enemyPanel = document.querySelector('.scene-panel--enemy');
  els.enemyName = document.querySelector('.enemy-panel__name');
  els.enemyGlyph = document.querySelector('.enemy-panel__glyph');
  els.enemyHpBar = document.querySelector('.enemy-panel__hp');
  els.enemyHpFill = document.querySelector('.enemy-panel__hp-fill');
  els.enemyHpValue = document.querySelector('.enemy-panel__hp-value');
  els.enemyStatAtk = document.querySelector('.enemy-stat--atk .enemy-stat__value');
  els.enemyStatDef = document.querySelector('.enemy-stat--def .enemy-stat__value');
  els.enemyStatAcc = document.querySelector('.enemy-stat--acc .enemy-stat__value');
  els.enemyStatAgi = document.querySelector('.enemy-stat--agi .enemy-stat__value');
}

export function setSceneMode(mode) {
  if (!ensureElements()) return;
  const safeMode = mode === 'enemy' ? 'enemy' : 'room';
  if (els.root) els.root.dataset.sceneMode = safeMode;
  if (els.roomPanel) els.roomPanel.hidden = safeMode !== 'room';
  if (els.enemyPanel) els.enemyPanel.hidden = safeMode !== 'enemy';
}

export function showRoomPanel({ title = '', desc = '', backgroundUrl = null } = {}) {
  if (!ensureElements()) return;
  if (els.roomTitle) els.roomTitle.textContent = String(title || '');
  if (els.roomDesc) els.roomDesc.textContent = String(desc || '');
  resetEnemyPanel();
  setSceneBackground(backgroundUrl);
  setSceneMode('room');
}

export function showEnemyPanel(enemy, { backgroundUrl = null } = {}) {
  if (!ensureElements()) return;

  const maxVida = Math.max(1, Math.floor(Number(enemy?.maxVida) || 1));
  const vida = Math.max(0, Math.min(maxVida, Math.floor(Number(enemy?.vida) || 0)));
  const pct = Math.round((vida / maxVida) * 100);
  const ataque = Math.max(0, Math.floor(Number(enemy?.ataque ?? enemy?.forca) || 0));
  const defesa = Math.max(0, Math.floor(Number(enemy?.defesa) || 0));
  const precisao = Math.max(0, Math.floor(Number(enemy?.precisao) || 0));
  const agilidade = Math.max(0, Math.floor(Number(enemy?.agilidade) || 0));
  const nome = String(enemy?.name || 'Inimigo');
  const visual = resolveEnemyVisual(enemy);

  if (els.enemyPanel) els.enemyPanel.dataset.theme = visual.theme;
  if (els.enemyGlyph) els.enemyGlyph.textContent = visual.glyph;
  if (els.enemyName) els.enemyName.textContent = nome;
  if (els.enemyHpValue) els.enemyHpValue.textContent = `${vida}/${maxVida}`;
  if (els.enemyHpBar) {
    els.enemyHpBar.setAttribute('aria-valuemin', '0');
    els.enemyHpBar.setAttribute('aria-valuemax', String(maxVida));
    els.enemyHpBar.setAttribute('aria-valuenow', String(vida));
  }
  if (els.enemyHpFill) els.enemyHpFill.style.width = `${pct}%`;
  if (els.enemyStatAtk) els.enemyStatAtk.textContent = String(ataque);
  if (els.enemyStatDef) els.enemyStatDef.textContent = String(defesa);
  if (els.enemyStatAcc) els.enemyStatAcc.textContent = String(precisao);
  if (els.enemyStatAgi) els.enemyStatAgi.textContent = String(agilidade);

  setSceneBackground(backgroundUrl);
  setSceneMode('enemy');
}

export function clearScenePanel() {
  if (!ensureElements()) return;
  if (els.roomTitle) els.roomTitle.textContent = '';
  if (els.roomDesc) els.roomDesc.textContent = '';
  resetEnemyPanel();
  setSceneBackground(null);
  setSceneMode('room');
}
/* =====================[ FIM TRECHO 1 ]===================== */
