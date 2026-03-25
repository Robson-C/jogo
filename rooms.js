/* =====================[ TRECHO 1: rooms.js - Catálogo de Salas (i18n por chave) ]===================== */
/**
 * [DOC]
 * Salas com efeitos declarativos por ação.
 * - sala_vazia: sustain físico e mental leve; sem XP fora de combate.
 * - sala_fonte: sustain mental/mágico; sem cura de Vida.
 * - [CHANGE] sala_vazia e sala_fonte usam `singleChoiceActs:true`:
 *   o jogador pode explorar sem usar nada, mas só pode escolher 1 ação local por sala.
 * - [TODO] Sala armadilha será revisada depois para dano por Vida/Energia/Sanidade
 *   comparando Precisão/Agilidade/Defesa contra a severidade da sala por andar.
 */
export const ROOMS = {
  'sala_vazia': {
    id: 'sala_vazia',
    sceneMode: 'room',
    titleKey: 'room.sala_vazia.title',
    descKey:  'room.sala_vazia.desc',
    bg: 'assets/bg/sala_vazia.jpg',
    singleChoiceActs: true,
    actions: [
      // Descansar: sustain físico básico (Vida + Energia)
      { labelKey: 'action.descansar', role: 'act',
        effects: [
          { type: 'statusDeltaPctOfMax', key: 'vida',    pct: 0.2 },
          { type: 'statusDeltaPctOfMax', key: 'energia', pct: 0.45 }
        ] },

      // Meditar: sustain mental/mágico leve
      { labelKey: 'action.meditar', role: 'act',
        effects: [
          { type: 'statusDeltaPctOfMax', key: 'mana',     pct: 0.2 },
          { type: 'statusDeltaPctOfMax', key: 'sanidade', pct: 0.45 }
        ]},

      // Tratar feridas: cura forte de Vida; valor inicial sujeito a revisão fina após testes.
      { labelKey: 'action.tratar_feridas', role: 'act',
        effects: [{ type: 'statusDeltaPctOfMax', key: 'vida', pct: 0.4 }] },

      // Explorar: custo de -10 Energia é aplicado no engine (sem XP)
      { labelKey: 'action.explorar', role: 'explore', effects: [] }
    ]
  },

  'sala_fonte': {
    id: 'sala_fonte',
    sceneMode: 'room',
    titleKey: 'room.sala_fonte.title',
    descKey:  'room.sala_fonte.desc',
    bg: 'assets/bg/sala_fonte.jpg',
    singleChoiceActs: true,
    actions: [
      // Beber água: recuperação forte de Mana
      { labelKey: 'action.beber_agua', role: 'act',
        effects: [{ type: 'statusDeltaPctOfMax', key: 'mana', pct: 0.7 }] },

      // Lavar o rosto: recuperação mista de Energia e Sanidade
      { labelKey: 'action.lavar_rosto', role: 'act',
        effects: [
          { type: 'statusDeltaPctOfMax', key: 'energia',  pct: 0.35 },
          { type: 'statusDeltaPctOfMax', key: 'sanidade', pct: 0.35 }
        ]},

      // Contemplar: foco mental forte com um pequeno respiro de Mana
      { labelKey: 'action.contemplar', role: 'act',
        effects: [
          { type: 'statusDeltaPctOfMax', key: 'sanidade', pct: 0.6 },
          { type: 'statusDeltaPctOfMax', key: 'mana',     pct: 0.1 }
        ] },

      // Explorar: engine aplica -10 Energia
      { labelKey: 'action.explorar', role: 'explore', effects: [] }
    ]
  },

  'sala_armadilha': {
    id: 'sala_armadilha',
    sceneMode: 'room',
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

  'sala_combate': {
    id: 'sala_combate',
    sceneMode: 'enemy',
    encounterType: 'combat',
    encounterFloor: 1,
    bg: 'assets/bg/sala_vazia.jpg',
    actions: [
      { label: 'Atacar', role: 'combat_attack', effects: [] },
      null,
      null,
      { labelKey: 'action.fugir', role: 'flee', effects: [] }
    ]
  },

  'fim_de_jogo': {
    id: 'fim_de_jogo',
    sceneMode: 'room',
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
