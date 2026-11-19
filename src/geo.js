/* Motor geoespacial Mana Poke: distância em linha reta, círculos geodésicos, união/interseção/diferença de áreas.
 * Módulo puro (sem DOM). Funciona no navegador (usa window.polygonClipping) e no Node (require('polygon-clipping')).
 * Regras do PRD: distância em linha reta (Haversine); km² calculado em esfera (nunca em graus); sobreposição sem contar área em dobro.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('polygon-clipping'));
  else root.MPGeo = factory(root.polygonClipping);
})(typeof self !== 'undefined' ? self : this, function (pc) {
  'use strict';
  const R_TERRA = 6371.0088; // km (raio médio)
  const rad = (g) => (g * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;

  /** Distância em linha reta (km) entre dois pontos [lat, lng]. */
  function haversineKm(a, b) {
    const dLat = rad(b[0] - a[0]);
    const dLng = rad(b[1] - a[1]);
    const q = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R_TERRA * Math.asin(Math.min(1, Math.sqrt(q)));
  }

  /** Anel (GeoJSON, [lng,lat]) de um círculo geodésico de raio rKm ao redor de center [lat,lng]. */
  function circleRing(center, rKm, n) {
    n = n || 240;
    const lat1 = rad(center[0]);
    const lng1 = rad(center[1]);
    const d = rKm / R_TERRA;
    const ring = [];
    for (let i = 0; i < n; i++) {
      const brg = (2 * Math.PI * i) / n;
      const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
      const lng2 = lng1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
      ring.push([deg(lng2), deg(lat2)]);
    }
    ring.push(ring[0]);
    return ring;
  }

  const circlePoly = (center, rKm, n) => [circleRing(center, rKm, n)];

  /** Área (km²) de um anel em esfera (mesma fórmula do Turf/GeoJSON). */
  function ringAreaKm2(ring) {
    let total = 0;
    const n = ring.length - 1; // anel fechado
    if (n < 3) return 0;
    for (let i = 0; i < n; i++) {
      const lower = ring[i];
      const middle = ring[(i + 1) % n];
      const upper = ring[(i + 2) % n];
      total += (rad(upper[0]) - rad(lower[0])) * Math.sin(rad(middle[1]));
    }
    return Math.abs((total * R_TERRA * R_TERRA) / 2);
  }

  /** Área (km²) de um MultiPolygon [[outer, ...buracos], ...]. */
  function multiAreaKm2(mp) {
    let s = 0;
    for (const poly of mp || []) {
      s += ringAreaKm2(poly[0]);
      for (let i = 1; i < poly.length; i++) s -= ringAreaKm2(poly[i]);
    }
    return s;
  }

  /** Área de interseção de dois círculos planos (fórmula analítica), para teste. d, r1, r2 em km. */
  function lensAreaKm2(d, r1, r2) {
    if (d >= r1 + r2) return 0;
    if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
    const a = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
    const b = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
    const c = 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
    return a + b - c;
  }

  /** Filtra lojas conforme as opções da tela. Lojas sem ponto NÃO entram nos cálculos e são contadas como "não avaliadas". */
  function filtrarLojas(lojas, op) {
    op = op || {};
    const incShop = !!op.incluirShopping;
    const so = op.soQualidade; // lista de qualidades aceitas (ou vazio = todas)
    const ignorar = new Set(op.ignorarIds || []);
    const lojasOk = [];
    const naoAvaliadas = [];
    let excluidasShopping = 0;
    let excluidasOutras = 0;
    for (const l of lojas) {
      if (ignorar.has(l.id)) { excluidasOutras++; continue; }
      if (!incShop && l.shopping === true) { excluidasShopping++; continue; }
      if (op.ocultarGrupos && op.ocultarGrupos.includes(l.grupo)) { excluidasOutras++; continue; }
      if (op.ocultarDuplicatas && l.duplicata_de) { excluidasOutras++; continue; }
      if (l.lat == null || l.lng == null) { naoAvaliadas.push(l); continue; }
      if (so && so.length && !so.includes(l.geo_qualidade)) { excluidasOutras++; continue; }
      lojasOk.push(l);
    }
    return { lojas: lojasOk, naoAvaliadas, excluidasShopping, excluidasOutras };
  }

  const unionAll = (polys) => (polys.length ? pc.union(...polys) : []);

  /**
   * Análise de um ponto candidato.
   * cand: [lat,lng]; R: raio do candidato (km); lojas: [{id,nome,lat,lng}] já filtradas; Rloja: raio dos círculos das lojas (padrão = R).
   * Distingue (a) lojas DENTRO do raio do candidato de (b) círculos que se SOBREPÕEM ao do candidato (distância < R + Rloja).
   */
  function analisarPonto(cand, R, lojas, Rloja) {
    Rloja = Rloja == null ? R : Rloja;
    const dist = lojas.map((l) => ({ id: l.id, nome: l.nome, d: haversineKm(cand, [l.lat, l.lng]) })).sort((a, b) => a.d - b.d);
    const dentro = dist.filter((x) => x.d <= R);
    const sobrepostas = dist.filter((x) => x.d < R + Rloja);
    const candPoly = circlePoly(cand, R);
    const areaCand = multiAreaKm2([candPoly]);
    let coberta = [];
    if (sobrepostas.length) {
      const circ = sobrepostas.map((x) => {
        const l = lojas.find((y) => y.id === x.id);
        return circlePoly([l.lat, l.lng], Rloja);
      });
      coberta = pc.intersection(candPoly, unionAll(circ));
    }
    const nova = sobrepostas.length ? pc.difference(candPoly, ...sobrepostas.map((x) => { const l = lojas.find((y) => y.id === x.id); return circlePoly([l.lat, l.lng], Rloja); })) : [candPoly];
    const areaCob = multiAreaKm2(coberta);
    const areaNova = multiAreaKm2(nova);
    return {
      raio_km: R, raio_loja_km: Rloja,
      area_candidato_km2: areaCand,
      area_coberta_km2: areaCob, area_nova_km2: areaNova,
      pct_coberta: (100 * areaCob) / areaCand, pct_nova: (100 * areaNova) / areaCand,
      lojas_dentro: dentro, lojas_sobrepostas: sobrepostas, mais_proxima: dist[0] || null,
      geo_nova: nova, geo_coberta: coberta, n_lojas_avaliadas: lojas.length,
    };
  }

  /**
   * Cenário com 2+ candidatas abertas ao mesmo tempo: ganho de cada uma sozinha, ganho conjunto e canibalização entre elas.
   * canibalização = soma dos ganhos individuais - ganho conjunto (área nova que uma "rouba" da outra).
   */
  function cenario(cands, R, lojas, Rloja) {
    Rloja = Rloja == null ? R : Rloja;
    const lojaPolys = lojas.map((l) => circlePoly([l.lat, l.lng], Rloja));
    const uniLojas = unionAll(lojaPolys);
    const individuais = cands.map((c) => {
      const p = circlePoly(c.p, R);
      const nova = uniLojas.length ? pc.difference(p, uniLojas) : [p];
      return { id: c.id, nome: c.nome, area_nova_km2: multiAreaKm2(nova) };
    });
    const candPolys = cands.map((c) => circlePoly(c.p, R));
    const uniCands = unionAll(candPolys);
    const conj = uniLojas.length ? pc.difference(uniCands, uniLojas) : uniCands;
    const conjunta = multiAreaKm2(conj);
    const soma = individuais.reduce((s, x) => s + x.area_nova_km2, 0);
    return { individuais, ganho_conjunto_km2: conjunta, soma_individual_km2: soma, canibalizacao_km2: soma - conjunta, geo_conjunto: conj, geo_uniao_candidatas: uniCands };
  }

  /** Escapa HTML (nomes/endereços vindos de planilha NUNCA vão cru para innerHTML nem para tooltips). */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Referência independente (amostragem em grade) usada só nos testes: fração do círculo coberta pela união dos círculos das lojas. */
  function fracaoCobertaPorGrade(cand, R, lojas, Rloja, passoKm) {
    passoKm = passoKm || 0.05;
    const kx = (Math.PI / 180) * R_TERRA * Math.cos(rad(cand[0]));
    const ky = (Math.PI / 180) * R_TERRA;
    let n = 0;
    let c = 0;
    for (let x = -R; x <= R; x += passoKm) {
      for (let y = -R; y <= R; y += passoKm) {
        if (x * x + y * y > R * R) continue;
        n++;
        const p = [cand[0] + y / ky, cand[1] + x / kx];
        if (lojas.some((l) => haversineKm(p, [l.lat, l.lng]) <= Rloja)) c++;
      }
    }
    return c / n;
  }

  return { R_TERRA, haversineKm, circleRing, circlePoly, ringAreaKm2, multiAreaKm2, lensAreaKm2, filtrarLojas, analisarPonto, cenario, esc, fracaoCobertaPorGrade };
});
