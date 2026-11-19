const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/geo.js');

const perto = (a, b, tolRel, msg) => assert.ok(Math.abs(a - b) <= Math.abs(b) * tolRel + 1e-9, `${msg || ''} obtido=${a} esperado=${b} (tol ${tolRel * 100}%)`);

test('Haversine: 1 grau de meridiano ≈ 111,195 km', () => {
  perto(G.haversineKm([0, 0], [1, 0]), 111.195, 0.0005);
  perto(G.haversineKm([-23.5, -46.6], [-22.5, -46.6]), 111.195, 0.0005);
});

test('Haversine: ponto igual = 0 e simetria', () => {
  assert.equal(G.haversineKm([-23.5, -46.6], [-23.5, -46.6]), 0);
  const a = [-23.587, -46.635], b = [-23.603, -46.664];
  assert.equal(G.haversineKm(a, b), G.haversineKm(b, a));
});

test('Área do círculo: 3 km ≈ 28,27 km² e 5 km ≈ 78,54 km² (PRD)', () => {
  const c = [-23.55, -46.65];
  perto(G.multiAreaKm2([G.circlePoly(c, 3)]), Math.PI * 9, 0.002);
  perto(G.multiAreaKm2([G.circlePoly(c, 5)]), Math.PI * 25, 0.002);
});

test('Círculo tem raio real em metros (todos os vértices a R km do centro)', () => {
  const c = [-23.55, -46.65];
  for (const R of [3, 5]) {
    for (const [lng, lat] of G.circleRing(c, R).slice(0, -1)) perto(G.haversineKm(c, [lat, lng]), R, 1e-6, `R=${R}`);
  }
});

test('Duas lojas próximas: interseção bate com a fórmula analítica (sem contar área em dobro)', () => {
  const a = [-23.55, -46.65];
  // loja a ~2,9 km a leste (dentro do raio, longe do limite exato de 3 km)
  const b = [-23.55, -46.65 + 2.9 / (111.195 * Math.cos((23.55 * Math.PI) / 180))];
  const d = G.haversineKm(a, b);
  const r = G.analisarPonto(a, 3, [{ id: 'b', nome: 'B', lat: b[0], lng: b[1] }], 3);
  perto(r.area_coberta_km2, G.lensAreaKm2(d, 3, 3), 0.004, 'lente');
  perto(r.area_coberta_km2 + r.area_nova_km2, r.area_candidato_km2, 1e-6, 'coberta + nova = total');
  assert.equal(r.lojas_dentro.length, 1);
});

test('Loja sobreposta mas FORA do raio (distingue "dentro" de "círculos sobrepostos")', () => {
  const a = [-23.55, -46.65];
  const b = [-23.55, -46.65 + 5 / (111.195 * Math.cos((23.55 * Math.PI) / 180))]; // 5 km: fora de 3 km, mas círculos 3+3=6 se sobrepõem
  const r = G.analisarPonto(a, 3, [{ id: 'b', nome: 'B', lat: b[0], lng: b[1] }], 3);
  assert.equal(r.lojas_dentro.length, 0);
  assert.equal(r.lojas_sobrepostas.length, 1);
  assert.ok(r.pct_coberta > 0 && r.pct_coberta < 25);
});

test('Sem lojas: 100% de área nova; loja no mesmo ponto: 0% de área nova', () => {
  const a = [-23.55, -46.65];
  assert.equal(G.analisarPonto(a, 5, [], 5).pct_nova, 100);
  const r = G.analisarPonto(a, 5, [{ id: 'x', nome: 'X', lat: a[0], lng: a[1] }], 5);
  perto(r.pct_coberta, 100, 0.001);
});

test('União de 3 lojas sobrepostas: bate com referência independente por grade (±1 ponto percentual)', () => {
  const cand = [-23.5, -46.69];
  const lojas = [
    { id: 'a', nome: 'A', lat: -23.528, lng: -46.735 },
    { id: 'b', nome: 'B', lat: -23.556, lng: -46.691 },
    { id: 'c', nome: 'C', lat: -23.572, lng: -46.695 },
    { id: 'd', nome: 'D', lat: -23.503, lng: -46.626 },
  ];
  for (const R of [3, 5]) {
    const r = G.analisarPonto(cand, R, lojas, R);
    const ref = G.fracaoCobertaPorGrade(cand, R, lojas, R, 0.05) * 100;
    assert.ok(Math.abs(r.pct_coberta - ref) < 1, `R=${R}: motor=${r.pct_coberta.toFixed(2)} grade=${ref.toFixed(2)}`);
  }
});

test('Filtro de shopping: desmarcado EXCLUI da lista; lojas sem ponto viram "não avaliadas"', () => {
  const lojas = [
    { id: '1', lat: -23.5, lng: -46.6, shopping: null, grupo: 'rmsp' },
    { id: '2', lat: -23.6, lng: -46.7, shopping: true, grupo: 'rmsp' },
    { id: '3', lat: null, lng: null, shopping: null, grupo: 'outros' },
  ];
  const sem = G.filtrarLojas(lojas, { incluirShopping: false });
  assert.deepEqual(sem.lojas.map((l) => l.id), ['1']);
  assert.equal(sem.excluidasShopping, 1);
  assert.deepEqual(sem.naoAvaliadas.map((l) => l.id), ['3']);
  const com = G.filtrarLojas(lojas, { incluirShopping: true });
  assert.deepEqual(com.lojas.map((l) => l.id), ['1', '2']);
});

test('Shopping desmarcado muda a sobreposição (a loja de shopping some do cálculo)', () => {
  const cand = [-23.55, -46.65];
  const lojas = [{ id: 's', nome: 'S', lat: -23.55, lng: -46.65, shopping: true, grupo: 'rmsp' }];
  const com = G.analisarPonto(cand, 3, G.filtrarLojas(lojas, { incluirShopping: true }).lojas, 3);
  const sem = G.analisarPonto(cand, 3, G.filtrarLojas(lojas, { incluirShopping: false }).lojas, 3);
  assert.ok(com.pct_coberta > 99);
  assert.equal(sem.pct_coberta, 0);
});

test('Cenário com 2 candidatas: canibalização = soma individual - ganho conjunto', () => {
  const lojas = [{ id: 'a', nome: 'A', lat: -23.55, lng: -46.65 }];
  const c1 = { id: 'c1', nome: 'C1', p: [-23.50, -46.75] };
  const c2 = { id: 'c2', nome: 'C2', p: [-23.50, -46.74] }; // quase colada na c1
  const r = G.cenario([c1, c2], 3, lojas, 3);
  assert.ok(r.canibalizacao_km2 > 15, 'candidatas coladas devem canibalizar muito: ' + r.canibalizacao_km2);
  assert.ok(r.ganho_conjunto_km2 < r.soma_individual_km2);
  const longe = G.cenario([c1, { id: 'c3', nome: 'C3', p: [-23.70, -46.50] }], 3, lojas, 3);
  perto(longe.canibalizacao_km2, 0, 0.0001);
});

test('Escape de HTML (nome malicioso nunca vira tag)', () => {
  assert.equal(G.esc('<img src=x onerror=alert(1)>"\''), '&lt;img src=x onerror=alert(1)&gt;&quot;&#39;');
  assert.equal(G.esc(null), '');
});
