/* Camada de demanda + nota explicável. Módulo puro (navegador e Node).
 * Entrada: grade pré-calculada (data/demanda_grid.json) e tabelas de referência (data/referencias.json).
 * Nunca inventa: fora da área coberta devolve cobertura 0 e a nota marca os componentes como "indisponível".
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MPDemanda = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const KM_LAT = 111.195;
  const SUB = 4; // subamostras por lado em cada célula (fração de célula dentro do círculo)

  const PESOS_PADRAO = { renda: 25, populacao: 20, comercio: 15, saudavel: 15, nova_area: 15, imovel: 10 };
  const ROTULOS = {
    renda: 'Renda dos moradores', populacao: 'Moradores no raio', comercio: 'Comércio e emprego (vínculos RAIS)',
    saudavel: 'Aderência ao público saudável (proxy: academias)', nova_area: 'Nova área coberta (sem sobrepor lojas)', imovel: 'Viabilidade do imóvel (informada por você)',
  };

  function criar(grid) {
    const idx = {};
    const col = {};
    grid.colunas.forEach((c, k) => (col[c] = k));
    for (const r of grid.celulas) idx[r[0] * 100000 + r[1]] = r;
    const caixas = grid.caixas;
    const mascara = grid.mascara || null; // contorno real da área coberta: linha j (latitude) -> intervalos [i0, i1] de colunas (longitude)
    const dentroCaixa = (lat, lng) => {
      if (mascara) {
        const iv = mascara[Math.floor((lat - grid.lat0) / grid.dlat)];
        if (!iv) return false;
        const i = Math.floor((lng - grid.lng0) / grid.dlng);
        for (let k = 0; k < iv.length; k++) if (i >= iv[k][0] && i <= iv[k][1]) return true;
        return false;
      }
      return caixas.some((b) => lat >= b.lat_min && lat <= b.lat_max && lng >= b.lng_min && lng <= b.lng_max);
    };

    /** Soma da grade dentro do círculo (centro [lat,lng], raio em km), com fração de célula por subamostragem. */
    function agregar(lat, lng, Rkm) {
      const kmLng = KM_LAT * Math.cos((lat * Math.PI) / 180);
      const i0 = Math.floor((lng - Rkm / kmLng - grid.lng0) / grid.dlng);
      const i1 = Math.floor((lng + Rkm / kmLng - grid.lng0) / grid.dlng);
      const j0 = Math.floor((lat - Rkm / KM_LAT - grid.lat0) / grid.dlat);
      const j1 = Math.floor((lat + Rkm / KM_LAT - grid.lat0) / grid.dlat);
      const R2 = Rkm * Rkm;
      const s = { pop: 0, dom: 0, p1559: 0, emp: 0, rest: 0, acad: 0, rw_med: 0, rw_mean: 0, dom_r: 0, massa: 0 };
      let amostrasDentro = 0;
      let amostrasCobertas = 0;
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const r = idx[i * 100000 + j];
          let dentro = 0;
          for (let a = 0; a < SUB; a++) {
            for (let b = 0; b < SUB; b++) {
              const pl = grid.lat0 + (j + (b + 0.5) / SUB) * grid.dlat;
              const pg = grid.lng0 + (i + (a + 0.5) / SUB) * grid.dlng;
              const dx = (pg - lng) * kmLng;
              const dy = (pl - lat) * KM_LAT;
              if (dx * dx + dy * dy <= R2) {
                dentro++;
                if (dentroCaixa(pl, pg)) amostrasCobertas++;
              }
            }
          }
          amostrasDentro += dentro;
          if (!r || !dentro) continue;
          const f = dentro / (SUB * SUB);
          s.pop += r[col.pop] * f; s.dom += r[col.dom] * f; s.p1559 += r[col.p1559] * f;
          s.emp += r[col.empregos] * f; s.rest += r[col.restaurantes] * f; s.acad += r[col.academias] * f;
          s.rw_med += r[col.renda_med_x_dom] * f; s.rw_mean += r[col.renda_media_x_dom] * f; s.dom_r += r[col.dom_com_renda] * f; if (col.massa_renda != null) s.massa += r[col.massa_renda] * f;
        }
      }
      const cobertura = amostrasDentro ? amostrasCobertas / amostrasDentro : 0;
      return {
        raio_km: Rkm, cobertura,
        pop: s.pop, domicilios: s.dom, pop_15_59: s.p1559, empregos: s.emp, restaurantes: s.rest, academias: s.acad,
        renda_mediana_resp: s.dom_r > 0 ? s.rw_med / s.dom_r : null, renda_media_resp: s.dom_r > 0 ? s.rw_mean / s.dom_r : null,
        densidade_km2: s.pop / (Math.PI * Rkm * Rkm),
        // potencial de consumo (proxy): renda média do responsável x responsáveis com renda declarada, em R$ por mês (Censo 2022)
        massa_renda: col.massa_renda != null ? s.massa : null,
      };
    }
    return { agregar, dentroCaixa, grid, idx, col };
  }

  /** Percentil (0–100) de um valor numa tabela de 101 quantis ordenados. */
  function percentil(v, q) {
    if (v == null || !q || !q.length) return null;
    if (v <= q[0]) return 0;
    if (v >= q[q.length - 1]) return 100;
    let lo = 0;
    let hi = q.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (q[m] <= v) lo = m; else hi = m; }
    const span = q[hi] - q[lo];
    return lo + (span > 0 ? (v - q[lo]) / span : 0);
  }

  /**
   * Nota 0–100 explicável.
   * agg: resultado de agregar(); refs: referencias[raio]; novaPct: % de área nova (0–100) ou null; imovel: 0–10 ou null; pesos: ajustáveis.
   * Componente indisponível sai do cálculo e os pesos restantes são renormalizados (a tela mostra "nota parcial").
   */
  function nota(agg, refs, novaPct, imovel, pesos) {
    pesos = Object.assign({}, PESOS_PADRAO, pesos || {});
    const cobreOk = agg && agg.cobertura >= 0.5 && refs;
    const comp = [];
    const add = (k, bruto, valor, unidade, fonte) => comp.push({ chave: k, rotulo: ROTULOS[k], peso: pesos[k], bruto, valor, unidade, fonte, disponivel: valor != null });
    add('renda', cobreOk && agg.renda_media_resp != null ? agg.renda_media_resp : null, cobreOk ? percentil(agg.renda_media_resp, refs.renda) : null, 'R$/mês, renda média do responsável', 'IBGE Censo 2022');
    add('populacao', cobreOk ? agg.pop : null, cobreOk ? percentil(agg.pop, refs.pop) : null, 'moradores', 'IBGE Censo 2022');
    add('comercio', cobreOk ? agg.empregos : null, cobreOk ? percentil(agg.empregos, refs.emp) : null, 'vínculos formais', 'RAIS (MTE)');
    add('saudavel', cobreOk ? agg.academias : null, cobreOk ? percentil(agg.academias, refs.acad) : null, 'academias ativas', 'Receita Federal, CNPJ (CNAE 9313-1/00)');
    add('nova_area', novaPct, novaPct, '% da área do círculo sem loja Mana Poke', 'cálculo geométrico (esta ferramenta)');
    add('imovel', imovel == null ? null : imovel, imovel == null ? null : imovel * 10, 'nota 0–10 informada', 'sua avaliação do imóvel');
    let soma = 0;
    let pesoTot = 0;
    for (const c of comp) if (c.disponivel && c.peso > 0) { soma += c.peso * c.valor; pesoTot += c.peso; }
    const pesoTotal = comp.reduce((s, c) => s + (c.peso > 0 ? c.peso : 0), 0);
    return {
      nota: pesoTot > 0 ? soma / pesoTot : null,
      peso_usado: pesoTot, peso_total: pesoTotal, parcial: pesoTot < pesoTotal,
      indisponiveis: comp.filter((c) => !c.disponivel && c.peso > 0).map((c) => c.rotulo),
      componentes: comp.map((c) => ({ ...c, contribuicao: c.disponivel && pesoTot > 0 ? (c.peso * c.valor) / pesoTot : 0 })),
    };
  }

  return { criar, percentil, nota, PESOS_PADRAO, ROTULOS };
});
