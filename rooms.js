/* =====================[ TRECHO 1: rooms.js - Catálogo de Salas (i18n por chave) ]===================== */
/**
 * [DOC]
 * Salas com efeitos declarativos por ação.
 * - sala_vazia: já com efeitos (energia/sanidade/xp).
 * - sala_fonte: **ATUALIZADO** (mana/energia/sanidade).
 */
export const ROOMS = {
  'sala_vazia': {
    id: 'sala_vazia',
    titleKey: 'room.sala_vazia.title',
    descKey:  'room.sala_vazia.desc',
    bg: 'assets/bg/sala_vazia.jpg',
    actions: [
      // Descansar: +80% do máximo de Energia (inteiro)
      { labelKey: 'action.descansar', role: 'act',
        effects: [{ type: 'statusDeltaPctOfMax', key: 'energia', pct: 0.8 }] },

      // Meditar: +20% Energia e +60% Sanidade (inteiros)
      { labelKey: 'action.meditar', role: 'act',
        effects: [
          { type: 'statusDeltaPctOfMax', key: 'energia',  pct: 0.2 },
          { type: 'statusDeltaPctOfMax', key: 'sanidade', pct: 0.6 }
        ]},

      // Treinar: +XP aleatório 5..10
      { labelKey: 'action.treinar', role: 'act',
        effects: [{ type: 'xpDeltaRange', min: 5, max: 10 }] },

      // Explorar: custo de -10 Energia é aplicado no engine (sem XP)
      { labelKey: 'action.explorar', role: 'explore', effects: [] }
    ]
  },

  'sala_fonte': {
    id: 'sala_fonte',
    titleKey: 'room.sala_fonte.title',
    descKey:  'room.sala_fonte.desc',
    bg: 'assets/bg/sala_fonte.jpg',
    actions: [
      // Beber água: +80% de Mana
      { labelKey: 'action.beber_agua', role: 'act',
        effects: [{ type: 'statusDeltaPctOfMax', key: 'mana', pct: 0.8 }] },

      // Lavar o rosto: +30% Energia, +50% Sanidade
      { labelKey: 'action.lavar_rosto', role: 'act',
        effects: [
          { type: 'statusDeltaPctOfMax', key: 'energia',  pct: 0.3 },
          { type: 'statusDeltaPctOfMax', key: 'sanidade', pct: 0.5 }
        ]},

      // Contemplar: +80% Sanidade
      { labelKey: 'action.contemplar', role: 'act',
        effects: [{ type: 'statusDeltaPctOfMax', key: 'sanidade', pct: 0.8 }] },

      // Explorar: engine aplica -10 Energia
      { labelKey: 'action.explorar', role: 'explore', effects: [] }
    ]
  },

  'sala_armadilha': {
    id: 'sala_armadilha',
    titleKey: 'room.sala_armadilha.title',
    descKey:  'room.sala_armadilha.desc',
    bg: 'assets/bg/sala_armadilha.jpg',
    exploreRequiresActFirst: true,
    actions: [
      { labelKey: 'action.desarmar', role: 'act',     effects: [{ type: 'noop' }] },
      { labelKey: 'action.forcar',   role: 'act',     effects: [{ type: 'noop' }] },
      { labelKey: 'action.analisar', role: 'act',     effects: [{ type: 'noop' }] },
      { labelKey: 'action.explorar', role: 'explore', effects: [] }
    ]
  },

  'fim_de_jogo': {
    id: 'fim_de_jogo',
    titleKey: 'room.fim_de_jogo.title',
    descKey:  'room.fim_de_jogo.desc',
    bg: 'assets/bg/fim_de_jogo.jpg',
    actions: [
      { role: 'act', effects: [{ type: 'noop' }] },
      { role: 'act', effects: [{ type: 'noop' }] },
      { role: 'act', effects: [{ type: 'noop' }] },
      { labelKey: 'action.jogar_novamente', role: 'act', effects: [{ type: 'noop' }] }
    ]
  }
};

/** [DOC] IDs para sorteio uniforme (exclui especiais) */
export const ROOM_IDS = Object.keys(ROOMS).filter(id => id !== 'fim_de_jogo');
/* =====================[ FIM TRECHO 1 ]===================== */
