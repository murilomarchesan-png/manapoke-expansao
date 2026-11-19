const test = require('node:test');
const assert = require('node:assert');
global.window = {}; global.MP_DATA = (window.MP_DATA = {});
require('../data/municipios.js');
const M = MP_DATA.municipios;
const col = (n) => M.colunas.indexOf(n);
const por = (nome) => M.linhas.find((r) => r[col('nome')] === nome);
test('totais oficiais por município', () => {
  assert.strictEqual(M.linhas.length, 645);
  assert.strictEqual(M.linhas.reduce((s, r) => s + r[col('pop')], 0), 44411238); // total oficial do estado (Censo 2022)
  assert.strictEqual(por('Suzano')[col('pop')], 307429);
  assert.strictEqual(por('São Paulo')[col('pop')], 11451999);
});
test('campos coerentes', () => {
  for (const r of M.linhas) {
    assert.ok(r[col('pop')] > 0 && r[col('dom')] > 0 && r[col('area_km2')] > 0, r[1]);
    assert.ok(r[col('pop_0_14')] + r[col('pop_60_mais')] < r[col('pop')], r[1]);
  }
});
test('potencial de consumo: renda x domicílios coerente com a renda média da cidade', () => {
  for (const r of M.linhas) {
    const m = r[col('massa_renda')];
    assert.ok(m >= 0, r[1]);
    if (r[col('renda')]) assert.ok(m / r[col("dom")] <= r[col("renda")] * 1.05 + 1, r[1]); // por domicílio não passa muito da renda média
  }
  assert.ok(por('São Paulo')[col('massa_renda')] > por('Suzano')[col('massa_renda')]);
});
