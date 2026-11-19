const test = require('node:test');
const assert = require('node:assert');
global.window = {}; global.MP_DATA = (window.MP_DATA = {});
require('../data/municipios.js');
const M = MP_DATA.municipios;
const col = (n) => M.colunas.indexOf(n);
const por = (nome) => M.linhas.find((r) => r[col('nome')] === nome);
test('totais oficiais por município', () => {
  assert.strictEqual(M.linhas.length, 85);
  assert.strictEqual(por('Suzano')[col('pop')], 307429);
  assert.strictEqual(por('São Paulo')[col('pop')], 11451999);
});
test('campos coerentes', () => {
  for (const r of M.linhas) {
    assert.ok(r[col('pop')] > 0 && r[col('dom')] > 0 && r[col('area_km2')] > 0, r[1]);
    assert.ok(r[col('pop_0_14')] + r[col('pop_60_mais')] < r[col('pop')], r[1]);
  }
});
