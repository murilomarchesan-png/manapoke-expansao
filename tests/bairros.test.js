const test = require('node:test');
const assert = require('node:assert');
global.window = {}; global.MP_DATA = (window.MP_DATA = {});
require('../data/bairros.js');
const B = MP_DATA.bairros;
const mk = (a) => { const m = new Map(); for (let k = 0; k < a.length; k += 3) m.set(a[k] * 100000 + a[k + 1], a[k + 2]); return m; };
const F = mk(B.fcel);
const nome = (lat, lng) => { const p = F.get(Math.floor((lat - B.lat0) / B.dlat) * 100000 + Math.floor((lng - B.lng0) / B.dlng)); return p == null ? null : B.fpares[p]; };

test('bairro de pontos conhecidos de São Paulo', () => {
  assert.deepStrictEqual(nome(-23.5357, -46.6762), ['São Paulo', 'Perdizes']);
  assert.strictEqual(nome(-23.5614, -46.6559)[1], 'Bela Vista');
});
test('índice de bairros: sem nome vazio, com acento nos casos comuns, coordenadas no Brasil', () => {
  assert.ok(B.fidx.length > 12000);
  for (const [mun, b, lat, lng, n] of B.fidx) { assert.ok(mun && b && n > 0); assert.ok(lat < -19 && lat > -30 && lng < -44 && lng > -54); }
  assert.ok(B.fidx.some((x) => x[1] === 'Vila Olímpia'));
  assert.ok(!B.fidx.some((x) => /^Agua /.test(x[1])));
});
