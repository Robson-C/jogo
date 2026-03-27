/* =====================[ TRECHO 1: enemies.js - Catálogo de inimigos e pools por andar ]===================== */
/**
 * [DOC]
 * Base central de inimigos do projeto.
 *
 * Decisões desta versão:
 * - Mantém os nomes exatamente como enviados pelo projeto (sem corrigir grafia automaticamente).
 * - Converte nomes em IDs internos estáveis para evitar dependência frágil de string solta no engine.
 * - Separa catálogo (imutável) de instância de combate (mutável).
 * - Mantém compatibilidade com os nomes atuais dos pools e bosses por andar.
 * - Não depende do estado global do jogo; o sorteio recebe RNG por parâmetro.
 *
 * Campos derivados adicionados a cada inimigo:
 * - id        : slug estável derivado do nome
 * - capitulo  : 1..5
 * - tipo      : 'normal' | 'boss'
 * - ataque    : alias de `forca` para facilitar integração futura com o player
 * - descricao : string vazia por padrão (não foi fornecida base oficial ainda)
 */

export const ROOM_TYPES = Object.freeze({
  EMPTY: 'vazia',
  WATER: 'com fonte de água',
  TRAP: 'com armadilha',
  MONSTER: 'com monstro',
  BOSS: 'boss'
});

const ENEMY_KIND = Object.freeze({
  NORMAL: 'normal',
  BOSS: 'boss'
});

function slugifyEnemyName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'enemy';
}

function freezeDeepArray(arr) {
  for (let i = 0; i < arr.length; i++) Object.freeze(arr[i]);
  return Object.freeze(arr);
}

function cloneEnemyInstance(definition) {
  if (!definition) return null;
  return {
    ...definition,
    vida: definition.maxVida,
    maxVida: definition.maxVida
  };
}

function getFloorStepWithinChapter(rawFloor) {
  const floor = clampFloor(rawFloor);
  return (floor - 1) % 10;
}

function applyNormalEnemyFloorScaling(definition, rawFloor) {
  if (!definition || definition.tipo !== ENEMY_KIND.NORMAL) return cloneEnemyInstance(definition);

  const step = getFloorStepWithinChapter(rawFloor);
  if (step <= 0) return cloneEnemyInstance(definition);

  const scaledMaxVida = Math.max(1, definition.maxVida + (step * 3));
  const scaledForca = Math.max(0, definition.forca + step);
  const scaledDefesa = Math.max(0, definition.defesa + step);
  const scaledPrecisao = Math.max(0, definition.precisao + step);
  const scaledAgilidade = Math.max(0, definition.agilidade + step);

  return {
    ...definition,
    vida: scaledMaxVida,
    maxVida: scaledMaxVida,
    forca: scaledForca,
    ataque: scaledForca,
    defesa: scaledDefesa,
    precisao: scaledPrecisao,
    agilidade: scaledAgilidade
  };
}

function clampFloor(rawFloor) {
  const n = Math.floor(Number(rawFloor) || 1);
  if (n < 1) return 1;
  if (n > 50) return 50;
  return n;
}

function sanitizeChance(rawChance) {
  const n = Number(rawChance);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

function pickWeightedEntry(entries, rng = Math.random) {
  const valid = Array.isArray(entries)
    ? entries.filter((it) => it && sanitizeChance(it.chance) > 0)
    : [];

  if (!valid.length) return null;

  let total = 0;
  for (let i = 0; i < valid.length; i++) total += sanitizeChance(valid[i].chance);
  if (total <= 0) return null;

  const roll = Math.max(0, Math.min(0.999999999999, Number(rng?.()) || 0)) * total;
  let acc = 0;
  for (let i = 0; i < valid.length; i++) {
    acc += sanitizeChance(valid[i].chance);
    if (roll < acc) return valid[i];
  }
  return valid[valid.length - 1];
}

function normalizeEnemy(def, capitulo, tipo) {
  const name = String(def?.name || '').trim();
  const maxVida = Math.max(1, Math.floor(Number(def?.maxVida) || 0));
  const vidaBase = Math.max(1, Math.floor(Number(def?.vida) || maxVida || 1));
  const forca = Math.max(0, Math.floor(Number(def?.forca) || 0));
  const defesa = Math.max(0, Math.floor(Number(def?.defesa) || 0));
  const precisao = Math.max(0, Math.floor(Number(def?.precisao) || 0));
  const agilidade = Math.max(0, Math.floor(Number(def?.agilidade) || 0));

  return Object.freeze({
    id: slugifyEnemyName(name),
    name,
    descricao: '',
    vida: vidaBase,
    maxVida,
    forca,
    ataque: forca,
    defesa,
    precisao,
    agilidade,
    capitulo,
    tipo
  });
}

const RAW_CHAPTERS = freezeDeepArray([
  {
    capitulo: 1,
    normals: [
      { name: 'Slime Verde', vida: 22, maxVida: 22, forca: 6, defesa: 1, precisao: 9, agilidade: 8 },
      { name: 'Cogumelo Saltitante', vida: 22, maxVida: 22, forca: 6, defesa: 1, precisao: 10, agilidade: 9 },
      { name: 'Planta que ri', vida: 23, maxVida: 23, forca: 7, defesa: 2, precisao: 8, agilidade: 7 },
      { name: 'Fada Travessa', vida: 21, maxVida: 21, forca: 7, defesa: 2, precisao: 11, agilidade: 12 },
      { name: 'Cubo de Gelatina', vida: 28, maxVida: 28, forca: 6, defesa: 3, precisao: 8, agilidade: 6 },
      { name: 'Livro Falante', vida: 24, maxVida: 24, forca: 5, defesa: 1, precisao: 12, agilidade: 8 },
      { name: 'Salamandra de Néon', vida: 25, maxVida: 25, forca: 8, defesa: 2, precisao: 9, agilidade: 9 },
      { name: 'Olho Vigilante', vida: 23, maxVida: 23, forca: 7, defesa: 1, precisao: 13, agilidade: 10 },
      { name: 'Orbe Sombria', vida: 24, maxVida: 24, forca: 8, defesa: 1, precisao: 11, agilidade: 8 },
      { name: 'Gárgula de Pedra', vida: 30, maxVida: 30, forca: 9, defesa: 5, precisao: 10, agilidade: 5 }
    ],
    bosses: [
      { name: 'Slime Sábio', vida: 50, maxVida: 50, forca: 7, defesa: 3, precisao: 11, agilidade: 9 },
      { name: 'Cogumelo Ancestral', vida: 54, maxVida: 54, forca: 8, defesa: 3, precisao: 13, agilidade: 10 },
      { name: 'Planta Voraz', vida: 58, maxVida: 58, forca: 9, defesa: 4, precisao: 11, agilidade: 8 },
      { name: 'Fada Sombria', vida: 44, maxVida: 44, forca: 9, defesa: 4, precisao: 14, agilidade: 14 },
      { name: 'Cubo de Espinhos', vida: 62, maxVida: 62, forca: 8, defesa: 6, precisao: 12, agilidade: 8 },
      { name: 'Livro Proibido', vida: 42, maxVida: 42, forca: 8, defesa: 3, precisao: 15, agilidade: 9 },
      { name: 'Salamandra Radiante', vida: 51, maxVida: 51, forca: 9, defesa: 5, precisao: 12, agilidade: 12 },
      { name: 'Olho Onisciente', vida: 50, maxVida: 50, forca: 10, defesa: 4, precisao: 15, agilidade: 12 },
      { name: 'Orbe Abissal', vida: 56, maxVida: 56, forca: 10, defesa: 4, precisao: 14, agilidade: 11 },
      { name: 'Gárgula Ancestral', vida: 80, maxVida: 80, forca: 10, defesa: 8, precisao: 13, agilidade: 6 }
    ]
  },
  {
    capitulo: 2,
    normals: [
      { name: 'Sapo com chifres', vida: 40, maxVida: 40, forca: 18, defesa: 7, precisao: 14, agilidade: 11 },
      { name: 'Cobra Alada', vida: 36, maxVida: 36, forca: 17, defesa: 6, precisao: 16, agilidade: 16 },
      { name: 'Aranha Cinzenta', vida: 35, maxVida: 35, forca: 15, defesa: 8, precisao: 15, agilidade: 13 },
      { name: 'Coruja de 3 olhos', vida: 38, maxVida: 38, forca: 16, defesa: 8, precisao: 19, agilidade: 14 },
      { name: 'Lobo de 2 cabeças', vida: 42, maxVida: 42, forca: 20, defesa: 7, precisao: 15, agilidade: 17 },
      { name: 'Rato gigante', vida: 40, maxVida: 40, forca: 17, defesa: 8, precisao: 14, agilidade: 15 },
      { name: 'Morcego de vidro', vida: 36, maxVida: 36, forca: 15, defesa: 7, precisao: 19, agilidade: 19 },
      { name: 'Aranha Carniceira', vida: 37, maxVida: 37, forca: 17, defesa: 9, precisao: 16, agilidade: 14 },
      { name: 'Urso de boca gigante', vida: 45, maxVida: 45, forca: 22, defesa: 9, precisao: 14, agilidade: 11 },
      { name: 'Tatu com garras', vida: 41, maxVida: 41, forca: 19, defesa: 14, precisao: 12, agilidade: 10 }
    ],
    bosses: [
      { name: 'Sapo de Marfim', vida: 90, maxVida: 90, forca: 15, defesa: 14, precisao: 16, agilidade: 13 },
      { name: 'Cobra Espectral', vida: 85, maxVida: 85, forca: 20, defesa: 11, precisao: 19, agilidade: 18 },
      { name: 'Aranha Viúva Sombria', vida: 83, maxVida: 83, forca: 19, defesa: 15, precisao: 18, agilidade: 16 },
      { name: 'Coruja Vidente', vida: 86, maxVida: 86, forca: 17, defesa: 13, precisao: 25, agilidade: 16 },
      { name: 'Lobo Calamidade', vida: 88, maxVida: 88, forca: 23, defesa: 10, precisao: 18, agilidade: 22 },
      { name: 'Rato Rei', vida: 92, maxVida: 92, forca: 19, defesa: 15, precisao: 17, agilidade: 18 },
      { name: 'Morcego Prismático', vida: 80, maxVida: 80, forca: 18, defesa: 11, precisao: 24, agilidade: 26 },
      { name: 'Aranha da Peste', vida: 87, maxVida: 87, forca: 22, defesa: 18, precisao: 18, agilidade: 16 },
      { name: 'Urso Abissal', vida: 99, maxVida: 99, forca: 28, defesa: 16, precisao: 15, agilidade: 13 },
      { name: 'Tatu Demolidor', vida: 101, maxVida: 101, forca: 25, defesa: 22, precisao: 14, agilidade: 13 }
    ]
  },
  {
    capitulo: 3,
    normals: [
      { name: 'Globin pequeno', vida: 23, maxVida: 23, forca: 12, defesa: 4, precisao: 14, agilidade: 18 },
      { name: 'Marionete viva', vida: 24, maxVida: 24, forca: 12, defesa: 7, precisao: 13, agilidade: 12 },
      { name: 'Harpia', vida: 25, maxVida: 25, forca: 15, defesa: 6, precisao: 16, agilidade: 18 },
      { name: 'Esqueleto de armadura', vida: 27, maxVida: 27, forca: 13, defesa: 13, precisao: 12, agilidade: 8 },
      { name: 'Orc costurado', vida: 29, maxVida: 29, forca: 16, defesa: 8, precisao: 13, agilidade: 10 },
      { name: 'Anjo de barro', vida: 28, maxVida: 28, forca: 14, defesa: 9, precisao: 16, agilidade: 11 },
      { name: 'Troll', vida: 36, maxVida: 36, forca: 17, defesa: 9, precisao: 12, agilidade: 8 },
      { name: 'Ogro de Crista', vida: 32, maxVida: 32, forca: 18, defesa: 14, precisao: 13, agilidade: 7 },
      { name: 'Minotauro', vida: 35, maxVida: 35, forca: 21, defesa: 12, precisao: 14, agilidade: 13 },
      { name: 'Golem de Aço', vida: 39, maxVida: 39, forca: 14, defesa: 20, precisao: 12, agilidade: 6 }
    ],
    bosses: [
      { name: 'Globin Sanguinário', vida: 41, maxVida: 41, forca: 16, defesa: 7, precisao: 18, agilidade: 22 },
      { name: 'Marionete Possessa', vida: 43, maxVida: 43, forca: 16, defesa: 12, precisao: 17, agilidade: 16 },
      { name: 'Harpia Tempestuosa', vida: 45, maxVida: 45, forca: 20, defesa: 10, precisao: 20, agilidade: 22 },
      { name: 'Esqueleto Imortal', vida: 49, maxVida: 49, forca: 17, defesa: 21, precisao: 16, agilidade: 12 },
      { name: 'Orc Abominável', vida: 52, maxVida: 52, forca: 22, defesa: 13, precisao: 17, agilidade: 12 },
      { name: 'Anjo Maculado', vida: 51, maxVida: 51, forca: 19, defesa: 14, precisao: 22, agilidade: 13 },
      { name: 'Troll Voraz', vida: 61, maxVida: 61, forca: 23, defesa: 14, precisao: 16, agilidade: 11 },
      { name: 'Ogro Brutal', vida: 56, maxVida: 56, forca: 25, defesa: 22, precisao: 17, agilidade: 10 },
      { name: 'Minotauro Labiríntico', vida: 59, maxVida: 59, forca: 30, defesa: 16, precisao: 18, agilidade: 17 },
      { name: 'Golem Colossal', vida: 67, maxVida: 67, forca: 18, defesa: 32, precisao: 14, agilidade: 7 }
    ]
  },
  {
    capitulo: 4,
    normals: [
      { name: 'Espectro Errante', vida: 33, maxVida: 33, forca: 15, defesa: 10, precisao: 16, agilidade: 22 },
      { name: 'Fantasma Uivante', vida: 35, maxVida: 35, forca: 14, defesa: 10, precisao: 18, agilidade: 21 },
      { name: 'Dama da Névoa', vida: 37, maxVida: 37, forca: 14, defesa: 11, precisao: 19, agilidade: 20 },
      { name: 'Noiva Espectral', vida: 40, maxVida: 40, forca: 18, defesa: 12, precisao: 19, agilidade: 18 },
      { name: 'Cavaleiro Sem Cabeça', vida: 44, maxVida: 44, forca: 22, defesa: 19, precisao: 16, agilidade: 13 },
      { name: 'Homem de Fumaça', vida: 36, maxVida: 36, forca: 17, defesa: 12, precisao: 20, agilidade: 21 },
      { name: 'Zumbi Podre', vida: 48, maxVida: 48, forca: 19, defesa: 16, precisao: 14, agilidade: 9 },
      { name: 'Sucubos Sedutora', vida: 39, maxVida: 39, forca: 21, defesa: 13, precisao: 22, agilidade: 19 },
      { name: 'Vampiro Sedento', vida: 41, maxVida: 41, forca: 23, defesa: 16, precisao: 22, agilidade: 18 },
      { name: 'Mulher sem Rosto', vida: 47, maxVida: 47, forca: 25, defesa: 19, precisao: 22, agilidade: 18 }
    ],
    bosses: [
      { name: 'Espectro Arcano', vida: 62, maxVida: 62, forca: 21, defesa: 18, precisao: 23, agilidade: 28 },
      { name: 'Fantasma Ancestral', vida: 64, maxVida: 64, forca: 20, defesa: 18, precisao: 25, agilidade: 27 },
      { name: 'Senhora dos Suspiros', vida: 68, maxVida: 68, forca: 20, defesa: 21, precisao: 27, agilidade: 24 },
      { name: 'Noiva do Abismo', vida: 73, maxVida: 73, forca: 27, defesa: 25, precisao: 26, agilidade: 20 },
      { name: 'Cavaleiro do Eclipse', vida: 78, maxVida: 78, forca: 32, defesa: 31, precisao: 23, agilidade: 16 },
      { name: 'Arauto Etéreo', vida: 70, maxVida: 70, forca: 25, defesa: 21, precisao: 30, agilidade: 27 },
      { name: 'Zumbi Corrompido', vida: 84, maxVida: 84, forca: 28, defesa: 28, precisao: 19, agilidade: 12 },
      { name: 'Súcubo Rainha', vida: 75, maxVida: 75, forca: 29, defesa: 21, precisao: 32, agilidade: 26 },
      { name: 'Lord Vampiro', vida: 82, maxVida: 82, forca: 34, defesa: 26, precisao: 30, agilidade: 25 },
      { name: 'Matriarca do Vazio', vida: 92, maxVida: 92, forca: 37, defesa: 32, precisao: 33, agilidade: 28 }
    ]
  },
  {
    capitulo: 5,
    normals: [
      { name: 'Policial Fantasma', vida: 38, maxVida: 38, forca: 17, defesa: 15, precisao: 16, agilidade: 16 },
      { name: 'Socorrista Cego', vida: 40, maxVida: 40, forca: 18, defesa: 14, precisao: 15, agilidade: 18 },
      { name: 'Médico Macabro', vida: 44, maxVida: 44, forca: 21, defesa: 16, precisao: 18, agilidade: 15 },
      { name: 'Padre sem Boca', vida: 41, maxVida: 41, forca: 18, defesa: 15, precisao: 20, agilidade: 13 },
      { name: 'Enfermeira dos Sussurros', vida: 39, maxVida: 39, forca: 17, defesa: 15, precisao: 19, agilidade: 16 },
      { name: 'Visitante Sem Rosto', vida: 37, maxVida: 37, forca: 16, defesa: 15, precisao: 17, agilidade: 17 },
      { name: 'Mensageiro do Fim', vida: 48, maxVida: 48, forca: 24, defesa: 18, precisao: 18, agilidade: 14 },
      { name: 'Bebê Espectral', vida: 33, maxVida: 33, forca: 13, defesa: 12, precisao: 20, agilidade: 23 },
      { name: 'Noiva em Chamas', vida: 46, maxVida: 46, forca: 22, defesa: 17, precisao: 22, agilidade: 17 },
      { name: 'Sombra Distorcida', vida: 50, maxVida: 50, forca: 25, defesa: 19, precisao: 23, agilidade: 20 }
    ],
    bosses: [
      { name: 'O Vigia', vida: 68, maxVida: 68, forca: 22, defesa: 22, precisao: 25, agilidade: 20 },
      { name: 'Anjo do Resgate', vida: 71, maxVida: 71, forca: 24, defesa: 21, precisao: 27, agilidade: 22 },
      { name: 'Cirurgião do Destino', vida: 76, maxVida: 76, forca: 28, defesa: 26, precisao: 28, agilidade: 18 },
      { name: 'Guia do Perdão', vida: 74, maxVida: 74, forca: 23, defesa: 24, precisao: 31, agilidade: 16 },
      { name: 'Enfermeira do Zelo', vida: 72, maxVida: 72, forca: 24, defesa: 22, precisao: 28, agilidade: 19 },
      { name: 'Amparo Esquecido', vida: 69, maxVida: 69, forca: 21, defesa: 21, precisao: 26, agilidade: 21 },
      { name: 'Ceifeiro', vida: 83, maxVida: 83, forca: 32, defesa: 27, precisao: 26, agilidade: 22 },
      { name: 'Pequeno Guardião', vida: 62, maxVida: 62, forca: 18, defesa: 19, precisao: 28, agilidade: 29 },
      { name: 'Noiva Amada', vida: 78, maxVida: 78, forca: 29, defesa: 25, precisao: 31, agilidade: 23 },
      { name: 'Sombra de Alex', vida: 94, maxVida: 94, forca: 37, defesa: 33, precisao: 35, agilidade: 29 }
    ]
  }
]);

export const ENEMIES = Object.freeze(
  RAW_CHAPTERS.flatMap(({ capitulo, normals, bosses }) => [
    ...normals.map((enemy) => normalizeEnemy(enemy, capitulo, ENEMY_KIND.NORMAL)),
    ...bosses.map((enemy) => normalizeEnemy(enemy, capitulo, ENEMY_KIND.BOSS))
  ])
);

export const ENEMIES_BY_ID = Object.freeze(
  Object.fromEntries(ENEMIES.map((enemy) => [enemy.id, enemy]))
);

export const ENEMIES_BY_NAME = Object.freeze(
  Object.fromEntries(ENEMIES.map((enemy) => [enemy.name, enemy]))
);
/* =====================[ FIM TRECHO 1 ]===================== */

/* =====================[ TRECHO 2: Pools por andar ]===================== */
const ENEMY_POOLS_RAW = Object.freeze({
  1: [
    { enemy: 'Slime Verde', chance: 50 },
    { enemy: 'Planta que ri', chance: 30 },
    { enemy: 'Cogumelo Saltitante', chance: 20 }
  ],
  2: [
    { enemy: 'Planta que ri', chance: 40 },
    { enemy: 'Slime Verde', chance: 30 },
    { enemy: 'Cogumelo Saltitante', chance: 30 }
  ],
  3: [
    { enemy: 'Cogumelo Saltitante', chance: 45 },
    { enemy: 'Planta que ri', chance: 30 },
    { enemy: 'Fada Travessa', chance: 25 }
  ],
  4: [
    { enemy: 'Fada Travessa', chance: 45 },
    { enemy: 'Cubo de Gelatina', chance: 30 },
    { enemy: 'Cogumelo Saltitante', chance: 25 }
  ],
  5: [
    { enemy: 'Cubo de Gelatina', chance: 40 },
    { enemy: 'Fada Travessa', chance: 35 },
    { enemy: 'Livro Falante', chance: 25 }
  ],
  6: [
    { enemy: 'Livro Falante', chance: 45 },
    { enemy: 'Cubo de Gelatina', chance: 30 },
    { enemy: 'Salamandra de Néon', chance: 25 }
  ],
  7: [
    { enemy: 'Salamandra de Néon', chance: 50 },
    { enemy: 'Livro Falante', chance: 30 },
    { enemy: 'Olho Vigilante', chance: 20 }
  ],
  8: [
    { enemy: 'Olho Vigilante', chance: 50 },
    { enemy: 'Salamandra de Néon', chance: 30 },
    { enemy: 'Orbe Sombria', chance: 20 }
  ],
  9: [
    { enemy: 'Orbe Sombria', chance: 45 },
    { enemy: 'Olho Vigilante', chance: 35 },
    { enemy: 'Gárgula de Pedra', chance: 20 }
  ],
  10: [
    { enemy: 'Gárgula de Pedra', chance: 50 },
    { enemy: 'Orbe Sombria', chance: 30 },
    { enemy: 'Olho Vigilante', chance: 20 }
  ],
  11: [
    { enemy: 'Sapo com chifres', chance: 60 },
    { enemy: 'Cobra Alada', chance: 25 },
    { enemy: 'Aranha Cinzenta', chance: 15 }
  ],
  12: [
    { enemy: 'Cobra Alada', chance: 50 },
    { enemy: 'Aranha Cinzenta', chance: 30 },
    { enemy: 'Coruja de 3 olhos', chance: 20 }
  ],
  13: [
    { enemy: 'Aranha Cinzenta', chance: 45 },
    { enemy: 'Coruja de 3 olhos', chance: 30 },
    { enemy: 'Lobo de 2 cabeças', chance: 25 }
  ],
  14: [
    { enemy: 'Coruja de 3 olhos', chance: 45 },
    { enemy: 'Lobo de 2 cabeças', chance: 30 },
    { enemy: 'Rato gigante', chance: 25 }
  ],
  15: [
    { enemy: 'Lobo de 2 cabeças', chance: 50 },
    { enemy: 'Rato gigante', chance: 25 },
    { enemy: 'Morcego de vidro', chance: 25 }
  ],
  16: [
    { enemy: 'Rato gigante', chance: 45 },
    { enemy: 'Morcego de vidro', chance: 35 },
    { enemy: 'Aranha Carniceira', chance: 20 }
  ],
  17: [
    { enemy: 'Morcego de vidro', chance: 45 },
    { enemy: 'Aranha Carniceira', chance: 30 },
    { enemy: 'Urso de boca gigante', chance: 25 }
  ],
  18: [
    { enemy: 'Aranha Carniceira', chance: 45 },
    { enemy: 'Urso de boca gigante', chance: 30 },
    { enemy: 'Tatu com garras', chance: 25 }
  ],
  19: [
    { enemy: 'Urso de boca gigante', chance: 50 },
    { enemy: 'Tatu com garras', chance: 30 },
    { enemy: 'Aranha Carniceira', chance: 20 }
  ],
  20: [
    { enemy: 'Tatu com garras', chance: 45 },
    { enemy: 'Urso de boca gigante', chance: 35 },
    { enemy: 'Aranha Carniceira', chance: 20 }
  ],
  21: [
    { enemy: 'Globin pequeno', chance: 60 },
    { enemy: 'Marionete viva', chance: 25 },
    { enemy: 'Harpia', chance: 15 }
  ],
  22: [
    { enemy: 'Marionete viva', chance: 45 },
    { enemy: 'Harpia', chance: 30 },
    { enemy: 'Esqueleto de armadura', chance: 25 }
  ],
  23: [
    { enemy: 'Harpia', chance: 40 },
    { enemy: 'Esqueleto de armadura', chance: 35 },
    { enemy: 'Orc costurado', chance: 25 }
  ],
  24: [
    { enemy: 'Esqueleto de armadura', chance: 40 },
    { enemy: 'Orc costurado', chance: 35 },
    { enemy: 'Anjo de barro', chance: 25 }
  ],
  25: [
    { enemy: 'Orc costurado', chance: 45 },
    { enemy: 'Anjo de barro', chance: 30 },
    { enemy: 'Troll', chance: 25 }
  ],
  26: [
    { enemy: 'Anjo de barro', chance: 35 },
    { enemy: 'Troll', chance: 35 },
    { enemy: 'Ogro de Crista', chance: 30 }
  ],
  27: [
    { enemy: 'Troll', chance: 45 },
    { enemy: 'Ogro de Crista', chance: 30 },
    { enemy: 'Minotauro', chance: 25 }
  ],
  28: [
    { enemy: 'Ogro de Crista', chance: 40 },
    { enemy: 'Minotauro', chance: 30 },
    { enemy: 'Golem de Aço', chance: 30 }
  ],
  29: [
    { enemy: 'Minotauro', chance: 50 },
    { enemy: 'Golem de Aço', chance: 35 },
    { enemy: 'Ogro de Crista', chance: 15 }
  ],
  30: [
    { enemy: 'Golem de Aço', chance: 50 },
    { enemy: 'Minotauro', chance: 30 },
    { enemy: 'Troll', chance: 20 }
  ],
  31: [
    { enemy: 'Espectro Errante', chance: 60 },
    { enemy: 'Fantasma Uivante', chance: 25 },
    { enemy: 'Dama da Névoa', chance: 15 }
  ],
  32: [
    { enemy: 'Fantasma Uivante', chance: 45 },
    { enemy: 'Dama da Névoa', chance: 30 },
    { enemy: 'Noiva Espectral', chance: 25 }
  ],
  33: [
    { enemy: 'Dama da Névoa', chance: 40 },
    { enemy: 'Noiva Espectral', chance: 35 },
    { enemy: 'Cavaleiro Sem Cabeça', chance: 25 }
  ],
  34: [
    { enemy: 'Noiva Espectral', chance: 45 },
    { enemy: 'Cavaleiro Sem Cabeça', chance: 30 },
    { enemy: 'Homem de Fumaça', chance: 25 }
  ],
  35: [
    { enemy: 'Cavaleiro Sem Cabeça', chance: 40 },
    { enemy: 'Homem de Fumaça', chance: 35 },
    { enemy: 'Zumbi Podre', chance: 25 }
  ],
  36: [
    { enemy: 'Homem de Fumaça', chance: 45 },
    { enemy: 'Zumbi Podre', chance: 30 },
    { enemy: 'Sucubos Sedutora', chance: 25 }
  ],
  37: [
    { enemy: 'Zumbi Podre', chance: 40 },
    { enemy: 'Sucubos Sedutora', chance: 35 },
    { enemy: 'Vampiro Sedento', chance: 25 }
  ],
  38: [
    { enemy: 'Sucubos Sedutora', chance: 45 },
    { enemy: 'Vampiro Sedento', chance: 30 },
    { enemy: 'Mulher sem Rosto', chance: 25 }
  ],
  39: [
    { enemy: 'Vampiro Sedento', chance: 50 },
    { enemy: 'Mulher sem Rosto', chance: 35 },
    { enemy: 'Sucubos Sedutora', chance: 15 }
  ],
  40: [
    { enemy: 'Mulher sem Rosto', chance: 60 },
    { enemy: 'Vampiro Sedento', chance: 25 },
    { enemy: 'Fantasma Uivante', chance: 15 }
  ],
  41: [
    { enemy: 'Policial Fantasma', chance: 60 },
    { enemy: 'Socorrista Cego', chance: 25 },
    { enemy: 'Médico Macabro', chance: 15 }
  ],
  42: [
    { enemy: 'Socorrista Cego', chance: 45 },
    { enemy: 'Médico Macabro', chance: 30 },
    { enemy: 'Padre sem Boca', chance: 25 }
  ],
  43: [
    { enemy: 'Médico Macabro', chance: 40 },
    { enemy: 'Padre sem Boca', chance: 35 },
    { enemy: 'Enfermeira dos Sussurros', chance: 25 }
  ],
  44: [
    { enemy: 'Padre sem Boca', chance: 45 },
    { enemy: 'Enfermeira dos Sussurros', chance: 30 },
    { enemy: 'Visitante Sem Rosto', chance: 25 }
  ],
  45: [
    { enemy: 'Enfermeira dos Sussurros', chance: 40 },
    { enemy: 'Visitante Sem Rosto', chance: 35 },
    { enemy: 'Mensageiro do Fim', chance: 25 }
  ],
  46: [
    { enemy: 'Visitante Sem Rosto', chance: 45 },
    { enemy: 'Mensageiro do Fim', chance: 30 },
    { enemy: 'Bebê Espectral', chance: 25 }
  ],
  47: [
    { enemy: 'Mensageiro do Fim', chance: 50 },
    { enemy: 'Bebê Espectral', chance: 30 },
    { enemy: 'Noiva em Chamas', chance: 20 }
  ],
  48: [
    { enemy: 'Bebê Espectral', chance: 40 },
    { enemy: 'Noiva em Chamas', chance: 35 },
    { enemy: 'Sombra Distorcida', chance: 25 }
  ],
  49: [
    { enemy: 'Noiva em Chamas', chance: 60 },
    { enemy: 'Sombra Distorcida', chance: 30 },
    { enemy: 'Bebê Espectral', chance: 10 }
  ],
  50: [
    { enemy: 'Sombra Distorcida', chance: 60 },
    { enemy: 'Noiva em Chamas', chance: 25 },
    { enemy: 'Médico Macabro', chance: 15 }
  ]
});

export const ENEMY_POOLS = Object.freeze(
  Object.fromEntries(
    Object.entries(ENEMY_POOLS_RAW).map(([floor, entries]) => [
      Number(floor),
      Object.freeze(
        entries.map((entry) => Object.freeze({
          enemy: entry.enemy,
          enemyId: ENEMIES_BY_NAME[entry.enemy]?.id || '',
          chance: sanitizeChance(entry.chance)
        }))
      )
    ])
  )
);
/* =====================[ FIM TRECHO 2 ]===================== */

/* =====================[ TRECHO 3: Boss por andar ]===================== */
const MINI_BOSSES_BY_FLOOR_RAW = Object.freeze({
  1: 'Slime Sábio',
  2: 'Cogumelo Ancestral',
  3: 'Planta Voraz',
  4: 'Fada Sombria',
  5: 'Cubo de Espinhos',
  6: 'Livro Proibido',
  7: 'Salamandra Radiante',
  8: 'Olho Onisciente',
  9: 'Orbe Abissal',
  10: 'Gárgula Ancestral',
  11: 'Sapo de Marfim',
  12: 'Cobra Espectral',
  13: 'Aranha Viúva Sombria',
  14: 'Coruja Vidente',
  15: 'Lobo Calamidade',
  16: 'Rato Rei',
  17: 'Morcego Prismático',
  18: 'Aranha da Peste',
  19: 'Urso Abissal',
  20: 'Tatu Demolidor',
  21: 'Globin Sanguinário',
  22: 'Marionete Possessa',
  23: 'Harpia Tempestuosa',
  24: 'Esqueleto Imortal',
  25: 'Orc Abominável',
  26: 'Anjo Maculado',
  27: 'Troll Voraz',
  28: 'Ogro Brutal',
  29: 'Minotauro Labiríntico',
  30: 'Golem Colossal',
  31: 'Espectro Arcano',
  32: 'Fantasma Ancestral',
  33: 'Senhora dos Suspiros',
  34: 'Noiva do Abismo',
  35: 'Cavaleiro do Eclipse',
  36: 'Arauto Etéreo',
  37: 'Zumbi Corrompido',
  38: 'Súcubo Rainha',
  39: 'Lord Vampiro',
  40: 'Matriarca do Vazio',
  41: 'O Vigia',
  42: 'Anjo do Resgate',
  43: 'Cirurgião do Destino',
  44: 'Guia do Perdão',
  45: 'Enfermeira do Zelo',
  46: 'Amparo Esquecido',
  47: 'Ceifeiro',
  48: 'Pequeno Guardião',
  49: 'Noiva Amada',
  50: 'Sombra de Alex'
});

export const MINI_BOSSES_BY_FLOOR = Object.freeze(
  Object.fromEntries(
    Object.entries(MINI_BOSSES_BY_FLOOR_RAW).map(([floor, enemyName]) => [
      Number(floor),
      Object.freeze({
        enemy: enemyName,
        enemyId: ENEMIES_BY_NAME[enemyName]?.id || ''
      })
    ])
  )
);
/* =====================[ FIM TRECHO 3 ]===================== */

/* =====================[ TRECHO 4: API pública ]===================== */
export function getEnemyById(id) {
  const key = String(id || '').trim();
  return ENEMIES_BY_ID[key] || null;
}

export function getEnemyByName(name) {
  const key = String(name || '').trim();
  return ENEMIES_BY_NAME[key] || null;
}

export function getEnemyDefinition(ref) {
  if (!ref) return null;
  if (typeof ref === 'string') return getEnemyById(ref) || getEnemyByName(ref);
  if (typeof ref === 'object') {
    if (typeof ref.id === 'string') return getEnemyById(ref.id);
    if (typeof ref.enemyId === 'string') return getEnemyById(ref.enemyId);
    if (typeof ref.name === 'string') return getEnemyByName(ref.name);
    if (typeof ref.enemy === 'string') return getEnemyByName(ref.enemy);
  }
  return null;
}

export function createEnemyInstance(ref, options = null) {
  const definition = getEnemyDefinition(ref);
  if (!definition) return null;

  const floor = options && Number.isFinite(Number(options.floor))
    ? clampFloor(options.floor)
    : null;

  if (floor != null && definition.tipo === ENEMY_KIND.NORMAL) {
    return applyNormalEnemyFloorScaling(definition, floor);
  }

  return cloneEnemyInstance(definition);
}

export function getEnemyPoolForFloor(rawFloor) {
  const floor = clampFloor(rawFloor);
  return ENEMY_POOLS[floor] || Object.freeze([]);
}

export function pickEnemyForFloor(rawFloor, rng = Math.random) {
  const floor = clampFloor(rawFloor);
  const pool = getEnemyPoolForFloor(floor);
  const picked = pickWeightedEntry(pool, rng);
  if (!picked) return null;
  return createEnemyInstance(picked.enemyId || picked.enemy, { floor });
}

export function getBossForFloor(rawFloor) {
  const floor = clampFloor(rawFloor);
  const bossRef = MINI_BOSSES_BY_FLOOR[floor];
  if (!bossRef) return null;
  return createEnemyInstance(bossRef.enemyId || bossRef.enemy);
}

export function listEnemiesByChapter(rawChapter, tipo = null) {
  const chapter = Math.max(1, Math.min(5, Math.floor(Number(rawChapter) || 1)));
  const kind = tipo ? String(tipo) : null;
  return ENEMIES.filter((enemy) => {
    if (enemy.capitulo !== chapter) return false;
    if (kind && enemy.tipo !== kind) return false;
    return true;
  });
}
/* =====================[ FIM TRECHO 4 ]===================== */

/* =====================[ TRECHO 5: Validação do catálogo ]===================== */
function buildCatalogIssues() {
  const issues = [];

  const seenIds = new Set();
  const seenNames = new Set();
  for (let i = 0; i < ENEMIES.length; i++) {
    const enemy = ENEMIES[i];
    if (!enemy.name) issues.push(`Inimigo sem nome na posição ${i}.`);
    if (seenIds.has(enemy.id)) issues.push(`ID duplicado: ${enemy.id}.`);
    if (seenNames.has(enemy.name)) issues.push(`Nome duplicado: ${enemy.name}.`);
    seenIds.add(enemy.id);
    seenNames.add(enemy.name);
  }

  for (let floor = 1; floor <= 50; floor++) {
    const pool = ENEMY_POOLS[floor];
    if (!Array.isArray(pool) || !pool.length) {
      issues.push(`Andar ${floor} sem pool de inimigos.`);
    } else {
      for (let i = 0; i < pool.length; i++) {
        const entry = pool[i];
        if (!entry.enemyId) issues.push(`Pool do andar ${floor} referencia inimigo inexistente: ${entry.enemy}.`);
      }
    }

    const boss = MINI_BOSSES_BY_FLOOR[floor];
    if (!boss) {
      issues.push(`Andar ${floor} sem boss definido.`);
    } else if (!boss.enemyId) {
      issues.push(`Boss do andar ${floor} referencia inimigo inexistente: ${boss.enemy}.`);
    }
  }

  return Object.freeze(issues);
}

export const ENEMY_CATALOG_ISSUES = buildCatalogIssues();
export const ENEMY_CATALOG_IS_VALID = ENEMY_CATALOG_ISSUES.length === 0;
export const ENEMY_STATS_KEYS = Object.freeze(['vida', 'maxVida', 'forca', 'ataque', 'defesa', 'precisao', 'agilidade']);
export const ENEMY_KIND_KEYS = ENEMY_KIND;
/* =====================[ FIM TRECHO 5 ]===================== */
