const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const R = (...p) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));
const G = require('../src/geo.js');

const lojas = R('data', 'lojas.json').lojas;
const cand = R('data', 'candidatas.json');
const grid = R('data', 'demanda_grid.json');
const refs = R('data', 'referencias.json');

test('Base de lojas: 62 registros, ids únicos, status conferido no Google Maps (19/11)', () => {
  assert.equal(lojas.length, 62);
  assert.equal(new Set(lojas.map((l) => l.id)).size, 62);
  assert.ok(lojas.every((l) => ['aberta_conferida', 'fechada', 'nao_encontrada', 'nao_verificado'].includes(l.status_operacional)));
  assert.deepEqual(lojas.filter((l) => l.status_operacional === 'fechada').map((l) => l.id), ['valinhos']);
  for (const id of ['atibaia', 'bauru', 'braganca-paulista', 'araraquara', 'paulinia', 'franca', 'catanduva']) { const l = lojas.find((x) => x.id === id); assert.ok(l && l.lat != null && l.status_operacional === 'aberta_conferida', id); }
});

test('Lojas: coordenadas só no estado de SP e nenhuma inventada para pendentes', () => {
  const comPonto = lojas.filter((l) => l.lat != null);
  assert.ok(comPonto.length >= 61);
  for (const l of comPonto) assert.ok(l.lat > -25.5 && l.lat < -19.5 && l.lng > -53.5 && l.lng < -44, `${l.id} fora de SP`);
  for (const l of lojas.filter((x) => x.lat == null)) assert.equal(l.geo_qualidade, 'pendente', `${l.id} sem ponto deve estar pendente`);
  assert.ok(comPonto.every((l) => ['cnefe_numero_exato', 'cnefe_numero_proximo', 'osm_ponto_shopping', 'google_maps'].includes(l.geo_qualidade)));
});

test('Shopping: só "true" ou null (nunca false/"rua"); as 6 lojas de shopping conhecidas', () => {
  assert.ok(lojas.every((l) => l.shopping === true || l.shopping === null));
  assert.deepEqual(lojas.filter((l) => l.shopping).map((l) => l.id).sort(), ['campinas-shopping-dom-pedro', 'shopping-eldorado', 'granja-viana', 'vila-prudente', 'jundiai-anhangabau', 'santos-aparecida'].sort());
});

test('Nenhum par de lojas a menos de 300 m (duplicata não detectada)', () => {
  const p = lojas.filter((l) => l.lat != null && !l.duplicata_de);
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) assert.ok(G.haversineKm([p[i].lat, p[i].lng], [p[j].lat, p[j].lng]) > 0.3, `${p[i].id} x ${p[j].id}`);
});

test('Candidatas: ids únicos, sem as duplicatas removidas, todas dentro da área de demanda', () => {
  const c = cand.candidatas;
  assert.equal(c.length, 39);
  assert.equal(new Set(c.map((x) => x.id)).size, c.length);
  for (const n of ['Cidade Dutra', 'Avenida Paulista', 'Suzano Centro', 'Barueri', 'Jardim Bonfiglioli', 'Brás', 'Belenzinho', 'Interlagos']) assert.ok(!c.some((x) => x.nome === n), n);
  const dentro = (x) => grid.caixas.some((b) => x.lat >= b.lat_min && x.lat <= b.lat_max && x.lng >= b.lng_min && x.lng <= b.lng_max);
  assert.ok(c.every(dentro));
  assert.ok(c.every((x) => x.precisao === 'area_aproximada'));
});

test('Grade de demanda: colunas coerentes, sem valores negativos, totais plausíveis', () => {
  assert.equal(grid.colunas.length, grid.celulas[0].length);
  assert.ok(grid.celulas.every((r) => r.slice(2).every((v) => v >= 0)));
  const pop = grid.celulas.reduce((s, r) => s + r[2], 0);
  assert.ok(pop > 51.9e6 && pop < 52.2e6, 'pop=' + pop); // SP (44.411.238) + SC (7.610.361), Censo 2022
});

test('Referências: 101 quantis ordenados para 3 e 5 km', () => {
  for (const R_ of ['3', '5']) for (const k of ['pop', 'renda', 'emp', 'acad', 'rest']) {
    const q = refs.raios[R_][k]; assert.equal(q.length, 101);
    for (let i = 1; i < 101; i++) assert.ok(q[i] >= q[i - 1]);
  }
});

test('Índice de ruas: cada município listado tem arquivo e contagem coerente', () => {
  const idx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'ruas', 'index.js'), 'utf8').replace(/^window\.MP_DATA=window\.MP_DATA\|\|\{\};MP_DATA\.ruas_index=/, '').replace(/;\s*$/, ''));
  assert.ok(idx.municipios.length > 50);
  const sp = idx.municipios.find((m) => m.cd === '3550308');
  assert.ok(sp && sp.n > 60000);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'data', 'ruas', '3550308.js')));
});

test('concorrentes (CNPJ): categorias validas, coordenadas no estado de SP, sem duplicata exata', () => {
  global.window = global.window || {}; global.MP_DATA = (window.MP_DATA = window.MP_DATA || {});
  require('../data/concorrentes.js');
  const C = MP_DATA.concorrentes;
  assert.ok(C.rows.length > 1500);
  const seen = new Set();
  for (const [lat, lng, cat, nome] of C.rows) {
    assert.ok(lat < -19 && lat > -26 && lng < -44 && lng > -54);
    assert.ok(C.cats[cat] && nome);
    const k = lat + '|' + lng + '|' + nome; assert.ok(!seen.has(k)); seen.add(k);
    assert.ok(!/mana poke/i.test(nome));
  }
});
