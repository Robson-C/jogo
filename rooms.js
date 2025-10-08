/* =====================[ TRECHO 1: rooms.js - Catálogo de Salas (i18n por chave) ]===================== */
/**
 * [DOC]
 * Agora as salas usam chaves de i18n:
 *  - titleKey: chave para o título (fallback: title se presente)
 *  - descKey:  chave para a descrição simples (fallback: desc se presente)  // [CHANGE]
 *  - bg: caminho local da imagem de fundo (url relativa ao app)             // [CHANGE]
 * Roles:
 *   - "explore" → sorteia nova sala
 *   - "act"     → ação local (permanece)
 * [CHANGE] Adicionada sala especial de Game Over ('fim_de_jogo'); excluída do sorteio.
 */
export const ROOMS = {
  'sala_vazia': {
    id: 'sala_vazia',
    titleKey: 'room.sala_vazia.title',
    descKey:  'room.sala_vazia.desc',                 // [NEW]
    bg: 'assets/bg/sala_vazia.jpg',                   // [NEW] (coloque o arquivo localmente)
    actions: [
      { labelKey: 'action.descansar', role: 'act',     effects: [{ type: 'noop' }] },
      { labelKey: 'action.meditar',   role: 'act',     effects: [{ type: 'noop' }] },
      { labelKey: 'action.treinar',   role: 'act',     effects: [{ type: 'noop' }] },
      { labelKey: 'action.explorar',  role: 'explore', effects: [{ type: 'noop' }] }
    ]
  },

  'sala_fonte': {
    id: 'sala_fonte',
    titleKey: 'room.sala_fonte.title',
    descKey:  'room.sala_fonte.desc',                 // [NEW]
    bg: 'assets/bg/sala_fonte.jpg',                   // [NEW]
    actions: [
      { labelKey: 'action.beber_agua',  role: 'act',     effects: [{ type: 'noop' }] },
      { labelKey: 'action.lavar_rosto', role: 'act',     effects: [{ type: 'noop' }] },
      { labelKey: 'action.contemplar',  role: 'act',     effects: [{ type: 'noop' }] },
      { labelKey: 'action.explorar',    role: 'explore', effects: [{ type: 'noop' }] }
    ]
  },

  /* =====================[ NEW ]===================== */
  'sala_armadilha': {
    id: 'sala_armadilha',
    titleKey: 'room.sala_armadilha.title',
    descKey:  'room.sala_armadilha.desc',             // [NEW]
    bg: 'assets/bg/sala_armadilha.jpg',               // [NEW]
    /* [DOC][CHANGE] Nesta sala, “Explorar” só é liberado após usar UMA ação 'act' (idx 0..2) neste dia. */
    exploreRequiresActFirst: true,
    actions: [
      { labelKey: 'action.desarmar', role: 'act',     effects: [{ type: 'noop' }] },
      { labelKey: 'action.forcar',   role: 'act',     effects: [{ type: 'noop' }] },
      { labelKey: 'action.analisar', role: 'act',     effects: [{ type: 'noop' }] },
      { labelKey: 'action.explorar', role: 'explore', effects: [{ type: 'noop' }] }
    ]
  },

  /* =====================[ NEW - Sala Especial: Fim de Jogo ]===================== */
  'fim_de_jogo': {
    id: 'fim_de_jogo',
    titleKey: 'room.fim_de_jogo.title',
    descKey:  'room.fim_de_jogo.desc',                // [NEW]
    bg: 'assets/bg/fim_de_jogo.jpg',                  // [NEW]
    /* [DOC] Ações são tratadas no engine como:
       - 0..2 desativados (sem rótulo)
       - 3 = "Jogar Novamente" (reinicia a run)
       O catálogo mantém estrutura mínima apenas por consistência. */
    actions: [
      { role: 'act', effects: [{ type: 'noop' }] },
      { role: 'act', effects: [{ type: 'noop' }] },
      { role: 'act', effects: [{ type: 'noop' }] },
      { labelKey: 'action.jogar_novamente', role: 'act', effects: [{ type: 'noop' }] }
    ]
  }
};

/** [DOC] Lista de IDs válidos para sorteio uniforme (exclui salas especiais como Game Over) */
export const ROOM_IDS = Object.keys(ROOMS).filter(id => id !== 'fim_de_jogo');
/* =====================[ FIM TRECHO 1 ]===================== */
