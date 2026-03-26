/* =====================[ TRECHO 1: rooms.js - Catálogo de Salas (i18n por chave) ]===================== */
/**
 * [DOC]
 * Salas com efeitos declarativos por ação.
 * - sala_vazia: sustain físico e mental leve; sem XP fora de combate.
 * - sala_fonte: sustain mental/mágico; sem cura de Vida.
 * - sala_vazia e sala_fonte usam `singleChoiceActs:true`.
 * - sala_armadilha e sala_combate usam o andar atual real da run.
 * - sala_combate agora expõe 4 slots estáveis: atacar, defender, habilidade e fugir.
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
      { labelKey: 'action.descansar', role: 'act', effects: [
        { type: 'statusDeltaPctOfMax', key: 'vida', pct: 0.2 },
        { type: 'statusDeltaPctOfMax', key: 'energia', pct: 0.45 }
      ] },
      { labelKey: 'action.meditar', role: 'act', effects: [
        { type: 'statusDeltaPctOfMax', key: 'mana', pct: 0.2 },
        { type: 'statusDeltaPctOfMax', key: 'sanidade', pct: 0.45 }
      ]},
      { labelKey: 'action.tratar_feridas', role: 'act', effects: [
        { type: 'statusDeltaPctOfMax', key: 'vida', pct: 0.4 }
      ] },
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
      { labelKey: 'action.beber_agua', role: 'act', effects: [
        { type: 'statusDeltaPctOfMax', key: 'mana', pct: 0.7 }
      ] },
      { labelKey: 'action.lavar_rosto', role: 'act', effects: [
        { type: 'statusDeltaPctOfMax', key: 'energia', pct: 0.35 },
        { type: 'statusDeltaPctOfMax', key: 'sanidade', pct: 0.35 }
      ]},
      { labelKey: 'action.contemplar', role: 'act', effects: [
        { type: 'statusDeltaPctOfMax', key: 'sanidade', pct: 0.6 },
        { type: 'statusDeltaPctOfMax', key: 'mana', pct: 0.1 }
      ] },
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
      { labelKey: 'action.desarmar', role: 'act', trapKind: 'desarmar', effects: [] },
      { labelKey: 'action.forcar', role: 'act', trapKind: 'forcar', effects: [] },
      { labelKey: 'action.analisar', role: 'act', trapKind: 'analisar', effects: [] },
      { labelKey: 'action.explorar', role: 'explore', effects: [] }
    ]
  },

  'sala_combate': {
    id: 'sala_combate',
    sceneMode: 'enemy',
    encounterType: 'combat',
    bg: 'assets/bg/sala_vazia.jpg',
    actions: [
      { labelKey: 'action.atacar', role: 'combat_attack', effects: [] },
      { labelKey: 'action.defender', role: 'combat_defend', effects: [] },
      { labelKey: 'action.habilidade', role: 'combat_skill', effects: [] },
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

export const ROOM_IDS = Object.keys(ROOMS).filter(id => id !== 'fim_de_jogo');
/* =====================[ FIM TRECHO 1 ]===================== */
