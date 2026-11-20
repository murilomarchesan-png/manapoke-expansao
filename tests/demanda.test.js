const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/demanda.js');

// grade sintética: 1 célula de 0,5 km com 1000 moradores, 10 acad, no centro (lat -23.5, lng -46.6)
const grid = {
  lat0: -24.1, lng0: -47.5, dlat: 0.0045, dlng: 0.0049,
  caixas: [{ lat_min: -24.1, lat_max: -23.1, lng_min: -47.0, lng_max: -45.95 }],
  colunas: ['i', 'j', 'pop', 'dom', 'p1559', 'renda_med_x_dom', 'renda_media_x_dom', 'dom_com_renda', 'empregos', 'restaurantes', 'academias'],
  celulas: [],
};
const ci = Math.floor((-46.6 - grid.lng0) / grid.dlng), cj = Math.floor((-23.5 - grid.lat0) / grid.dlat);
grid.celulas.push([ci, cj, 1000, 400, 600, 400 * 5000, 400 * 6000, 400, 200, 7, 10]);
const clat = grid.lat0 + (cj + 0.5) * grid.dlat, clng = grid.lng0 + (ci + 0.5) * grid.dlng;

test('Círculo grande contém a célula inteira: soma exata e renda ponderada', () => {
  const d = D.criar(grid);
  const a = d.agregar(clat, clng, 3);
  assert.ok(Math.abs(a.pop - 1000) < 1e-9);
  assert.ok(Math.abs(a.empregos - 200) < 1e-9);
  assert.ok(Math.abs(a.academias - 10) < 1e-9);
  assert.ok(Math.abs(a.renda_media_resp - 6000) < 1e-9);
  assert.ok(Math.abs(a.renda_mediana_resp - 5000) < 1e-9);
  assert.equal(a.cobertura, 1);
});

test('Círculo que não alcança a célula soma zero; renda fica indisponível (null), nunca zero', () => {
  const d = D.criar(grid);
  const a = d.agregar(clat + 0.1, clng, 3);
  assert.equal(a.pop, 0);
  assert.equal(a.renda_media_resp, null);
});

test('Fração de célula: círculo pequeno cobre parte proporcional (aprox. área)', () => {
  const d = D.criar(grid);
  // raio 0,15 km no centro da célula: área = pi*0,0225 = 0,0707 km² de ~0,2724 km² da célula (0,5 km x ~0,545 km)
  const a = d.agregar(clat, clng, 0.15);
  const esperado = (Math.PI * 0.15 * 0.15) / (0.0045 * 111.195 * 0.0049 * 111.195 * Math.cos((23.5 * Math.PI) / 180)) * 1000;
  assert.ok(Math.abs(a.pop - esperado) / esperado < 0.12, `pop=${a.pop} esperado≈${esperado}`);
});

test('Fora da área coberta: cobertura 0 e a nota marca componentes indisponíveis (não inventa)', () => {
  const d = D.criar(grid);
  const a = d.agregar(-20.0, -49.0, 3);
  assert.equal(a.cobertura, 0);
  const n = D.nota(a, { renda: [0, 1], pop: [0, 1], emp: [0, 1], acad: [0, 1] }, 80, null);
  assert.equal(n.parcial, true);
  assert.equal(n.nota, null); // sem dado de demanda não existe nota (a área nova sozinha enganaria)
  assert.ok(n.indisponiveis.length >= 4);
});

test('Percentil: extremos, meio e interpolação', () => {
  const q = Array.from({ length: 101 }, (_, k) => k * 10); // 0..1000
  assert.equal(D.percentil(-5, q), 0);
  assert.equal(D.percentil(5000, q), 100);
  assert.equal(D.percentil(500, q), 50);
  assert.ok(Math.abs(D.percentil(505, q) - 50.5) < 1e-9);
  assert.equal(D.percentil(null, q), null);
});

test('Nota: pesos ajustáveis e renormalização quando falta o imóvel', () => {
  const agg = { cobertura: 1, renda_media_resp: 500, pop: 500, empregos: 500, academias: 500 };
  const q = Array.from({ length: 101 }, (_, k) => k * 10);
  const refs = { renda: q, pop: q, emp: q, acad: q };
  const n1 = D.nota(agg, refs, 100, null); // percentis = 50, nova=100, imóvel indisponível
  const esperado = (25 * 50 + 20 * 50 + 15 * 50 + 15 * 50 + 15 * 100) / 90;
  assert.ok(Math.abs(n1.nota - esperado) < 1e-9);
  assert.equal(n1.parcial, true);
  assert.deepEqual(n1.indisponiveis, ['Viabilidade do imóvel (informada por você)']);
  const n2 = D.nota(agg, refs, 100, 10); // imóvel 10/10 = 100
  assert.ok(Math.abs(n2.nota - (25 * 50 + 20 * 50 + 15 * 50 + 15 * 50 + 15 * 100 + 10 * 100) / 100) < 1e-9);
  assert.equal(n2.parcial, false);
  const n3 = D.nota(agg, refs, 100, 10, { renda: 0, populacao: 0, comercio: 0, saudavel: 0, nova_area: 50, imovel: 50 });
  assert.ok(Math.abs(n3.nota - 100) < 1e-9);
  const soma = n2.componentes.reduce((s, c) => s + c.contribuicao, 0);
  assert.ok(Math.abs(soma - n2.nota) < 1e-9, 'contribuições somam a nota');
});

test('Dados reais: moradores de um círculo enorme sobre a Grande SP ≈ total do Censo (conferência de sanidade)', () => {
  const real = require('../data/demanda_grid.json');
  const d = D.criar(real);
  const a = d.agregar(-23.55, -46.63, 50);
  assert.ok(a.pop > 15e6 && a.pop < 24e6, 'pop=' + a.pop); // RMSP tem ~21 milhões (Censo 2022)
});

test('agregarPoligono: polígono que cobre a célula = célula inteira; metade da célula = metade', () => {
  const d = D.criar(grid);
  const x0 = grid.lng0 + ci * grid.dlng, y0 = grid.lat0 + cj * grid.dlat;
  const quad = (x1, x2) => [[[[x0 + x1, y0 - 0.001], [x0 + x2, y0 - 0.001], [x0 + x2, y0 + grid.dlat + 0.001], [x0 + x1, y0 + grid.dlat + 0.001], [x0 + x1, y0 - 0.001]]]];
  const inteira = d.agregarPoligono(quad(-0.001, grid.dlng + 0.001));
  assert.ok(Math.abs(inteira.pop - 1000) < 1e-6 && Math.abs(inteira.empregos - 200) < 1e-6);
  const metade = d.agregarPoligono(quad(-0.001, grid.dlng / 2));
  assert.ok(Math.abs(metade.pop - 500) < 1e-6, 'metade=' + metade.pop);
  assert.equal(d.agregarPoligono([]).pop, 0);
});

test('agregarPoligono sobre dados reais: círculo de 3 km como polígono ≈ agregar() (diferença < 1%)', () => {
  const real = require('../data/demanda_grid.json');
  const G = require('../src/geo.js');
  const d = D.criar(real);
  const a = d.agregar(-23.55, -46.63, 3);
  const p = d.agregarPoligono([[G.circleRing([-23.55, -46.63], 3, 180)]]);
  assert.ok(Math.abs(p.pop - a.pop) / a.pop < 0.01, `${p.pop} vs ${a.pop}`);
  assert.ok(Math.abs(p.massa_renda - a.massa_renda) / a.massa_renda < 0.01);
});
