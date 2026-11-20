const test = require('node:test');
const assert = require('node:assert');
global.window = {}; global.MP_DATA = (window.MP_DATA = {});
require('../data/municipios.js');
const M = MP_DATA.municipios;
const col = (n) => M.colunas.indexOf(n);
const por = (nome) => M.linhas.find((r) => r[col('nome')] === nome);
test('totais oficiais por município', () => {
  assert.strictEqual(M.linhas.length, 940);
  const soma = (pre) => M.linhas.filter((r) => r[0].startsWith(pre)).reduce((s, r) => s + r[col('pop')], 0);
  assert.strictEqual(soma('35'), 44411238); // total oficial do estado de SP (Censo 2022)
  assert.strictEqual(soma('42'), 7610361); // total oficial do estado de SC (Censo 2022)
  assert.strictEqual(new Set(M.linhas.map((r) => r[1])).size, 940, 'nomes de município únicos (SC leva o sufixo)');
  assert.strictEqual(por('Joinville (SC)')[col('pop')], 616317);
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
