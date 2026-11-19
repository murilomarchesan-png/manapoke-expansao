/* Mana Poke · Expansão — interface. Dados públicos; nada é enviado a servidor (só os mapas de fundo são baixados). */
(function () {
  'use strict';
  const G = window.MPGeo, DM = window.MPDemanda, D = window.MP_DATA;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = G.esc;
  const fmt = (n, d) => (n == null || isNaN(n) ? '—' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }));
  const STORE_KEY = 'mp_expansao_v1';
  const ROT_Q = {
    cnefe_numero_exato: 'Endereço (número exato, CNEFE/IBGE)', cnefe_numero_proximo: 'Endereço (número vizinho, CNEFE/IBGE)',
    osm_ponto_shopping: 'Ponto do shopping (OpenStreetMap)', manual: 'Ponto marcado por você', pendente: 'Sem ponto no mapa',
  };
  const ROT_P = { area_aproximada: 'ponto aproximado da área', trecho_aproximado: 'ponto aproximado do trecho da rua', bairro_aproximado: 'centro aproximado do bairro', pino_manual: 'pino posicionado por você', coordenada: 'coordenada informada' };
  const COR_GRUPO = { rmsp: '#14724f', entorno: '#2a6fb0', outros: '#8a8f98' };
  const COR_R = { 3: '#14724f', 5: '#2a6fb0' };

  // ---------- estado e armazenamento ----------
  const PADRAO = () => ({ raio: 'ambos', shopping: true, dup: true, grupos: { rmsp: true, entorno: true, outros: true }, rotulos: false, circulos: true, uniao: true, demanda: 'off', base: 'osm', pesos: Object.assign({}, DM.PESOS_PADRAO), ordem: 'nota' });
  const S = { cfg: PADRAO(), cand: [], ajLojas: {}, ignorar: [], cen: [], sel: null, detR: 3, aba: 'cand', nova: null, modo: null };
  let F = null; // lojas filtradas
  const cache = new Map();
  let uniao = {};

  function lerArmazenado() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { return null; } }
  function salvar() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, cfg: S.cfg, cand: S.cand, ajLojas: S.ajLojas, ignorar: S.ignorar, cen: S.cen })); } catch (e) { /* navegador sem armazenamento: segue sem salvar */ }
  }
  function sementeCand() { return D.candidatas.candidatas.map((c) => Object.assign({ aluguel: '' }, c)); }

  const dem = DM.criar(D.demanda_grid);
  const REFS = D.referencias.raios;
  const radii = () => (S.cfg.raio === 'ambos' ? [3, 5] : [Number(S.cfg.raio)]);

  // ---------- util ----------
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3800); }
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const toLL = (ring) => ring.map(([x, y]) => [y, x]);
  const multiLL = (mp) => mp.map((poly) => poly.map(toLL));
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const clsNota = (n) => (n == null ? 'x' : n >= 60 ? 'a' : n >= 40 ? 'm' : 'b');
  const badge = (n, parcial) => `<span class="nota ${clsNota(n)}" title="${n == null ? 'sem dados' : parcial ? 'nota parcial (faltam componentes)' : 'nota completa'}">${n == null ? '—' : Math.round(n)}${parcial && n != null ? '*' : ''}</span>`;
  const brasilOk = (lat, lng) => isFinite(lat) && isFinite(lng) && lat > -34 && lat < 6 && lng > -74 && lng < -34;

  // ---------- filtros e análise ----------
  function lojasEf() {
    return D.lojas.lojas.map((l) => { const a = S.ajLojas[l.id]; return a ? Object.assign({}, l, { lat: a.lat, lng: a.lng, geo_qualidade: 'manual', geo_fonte: 'Ponto marcado por você no mapa', geo_obs: null }) : l; });
  }
  function filtrar() {
    const ocultar = Object.keys(S.cfg.grupos).filter((g) => !S.cfg.grupos[g]);
    F = G.filtrarLojas(lojasEf(), { incluirShopping: S.cfg.shopping, ocultarGrupos: ocultar, ocultarDuplicatas: S.cfg.dup, ignorarIds: S.ignorar });
    F.total = F.lojas.length + F.naoAvaliadas.length;
    cache.clear(); uniao = {};
  }
  function analisar(c, R) {
    const k = [c.id, R, c.lat, c.lng, c.imovel].join('|');
    if (cache.has(k)) return cache.get(k);
    const r = G.analisarPonto([c.lat, c.lng], R, F.lojas, R);
    const agg = dem.agregar(c.lat, c.lng, R);
    const n = DM.nota(agg, REFS[R], r.pct_nova, c.imovel, S.cfg.pesos);
    const v = { r, agg, n };
    cache.set(k, v);
    return v;
  }
  function uniaoLojas(R) {
    if (!uniao[R]) {
      const polys = F.lojas.map((l) => G.circlePoly([l.lat, l.lng], R, 120));
      uniao[R] = polys.length ? window.polygonClipping.union(...polys) : [];
    }
    return uniao[R];
  }
  const mediaNota = (c) => { const v = radii().map((R) => analisar(c, R).n.nota).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : -1; };

  // ---------- mapa ----------
  const map = L.map('mapa', { preferCanvas: true, zoomControl: true }).setView([-23.58, -46.65], 11);
  const bases = {
    osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© colaboradores do OpenStreetMap' }),
    carto: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 19, attribution: '© OpenStreetMap, © CARTO' }),
    sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Esri, Maxar, Earthstar Geographics' }),
  };
  let baseAtual = null; let erros = 0;
  function trocarBase(nome, aviso) {
    if (baseAtual) map.removeLayer(bases[baseAtual]);
    baseAtual = nome; S.cfg.base = nome; bases[nome].addTo(map); erros = 0; $('#selBase').value = nome;
    if (aviso) toast(aviso);
  }
  Object.keys(bases).forEach((k) => bases[k].on('tileerror', () => {
    if (k !== baseAtual) return;
    if (++erros === 8) {
      const prox = k === 'osm' ? 'carto' : k === 'carto' ? 'sat' : null;
      if (prox) { trocarBase(prox, 'O fundo do mapa não carregou; troquei automaticamente.'); salvar(); }
    }
  }));
  const gDem = L.layerGroup().addTo(map); const gUniao = L.layerGroup().addTo(map); const gCirc = L.layerGroup().addTo(map);
  const gLojas = L.layerGroup().addTo(map); const gSel = L.layerGroup().addTo(map); const gCand = L.layerGroup().addTo(map); const gBusca = L.layerGroup().addTo(map);

  function popupLoja(l) {
    const q = ROT_Q[l.geo_qualidade] || l.geo_qualidade;
    const ign = S.ignorar.includes(l.id);
    return `<div class="popup"><h4>${esc(l.nome)}</h4>
      <p>${esc([l.logradouro, l.numero].filter(Boolean).join(', '))}${l.complemento ? ' · ' + esc(l.complemento) : ''}<br>${esc([l.bairro, l.cidade].filter(Boolean).join(' · '))}${l.cep ? ' · CEP ' + esc(l.cep) : ''}</p>
      <p><span class="tag">${l.shopping ? 'shopping' : 'shopping: não classificado'}</span> <span class="tag lar">não verificada como aberta</span></p>
      <p class="mut">Ponto: ${esc(q)}${l.geo_obs ? '. ' + esc(l.geo_obs) : ''}</p>
      <p class="mut">Fonte do cadastro: ${esc(l.evidencia || '—')}</p>
      <p><button class="btn sec" data-act="ign" data-id="${esc(l.id)}">${ign ? 'Voltar a considerar nos cálculos' : 'Tirar dos cálculos'}</button></p></div>`;
  }
  function renderLojasMapa() {
    gLojas.clearLayers(); gCirc.clearLayers(); gUniao.clearLayers();
    for (const R of radii()) {
      if (S.cfg.uniao) {
        const u = uniaoLojas(R);
        if (u.length) L.polygon(multiLL(u), { color: COR_R[R], weight: 1.5, fillColor: COR_R[R], fillOpacity: R === 3 ? 0.18 : 0.09, interactive: false }).addTo(gUniao);
      }
      if (S.cfg.circulos) F.lojas.forEach((l) => L.polygon(toLL(G.circleRing([l.lat, l.lng], R, 90)), { color: COR_R[R], weight: 1, fill: false, dashArray: R === 5 ? '5 4' : null, interactive: false }).addTo(gCirc));
    }
    F.lojas.forEach((l) => {
      const m = L.circleMarker([l.lat, l.lng], { radius: 7, color: l.shopping ? '#b83a2e' : '#fff', weight: l.shopping ? 3 : 2, dashArray: l.shopping ? '3 2' : null, fillColor: COR_GRUPO[l.grupo] || '#888', fillOpacity: 1 });
      m.bindPopup(() => popupLoja(l), { maxWidth: 300 });
      if (S.cfg.rotulos) m.bindTooltip(esc(l.nome), { permanent: true, direction: 'right', offset: [8, 0], className: 'rotulo' });
      m.addTo(gLojas);
    });
  }
  map.on('popupopen', (e) => {
    const el = e.popup.getElement(); if (!el) return;
    $$('[data-act]', el).forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.act === 'ign') { const id = b.dataset.id; const i = S.ignorar.indexOf(id); if (i >= 0) S.ignorar.splice(i, 1); else S.ignorar.push(id); map.closePopup(); atualizarTudo(); }
      if (b.dataset.act === 'ver') { selecionar(b.dataset.id, true); map.closePopup(); }
    }));
  });

  const iconeCand = (n, sel) => L.divIcon({ className: '', html: `<div class="pin-cand${sel ? ' sel' : ''}"><span>${n}</span></div>`, iconSize: [22, 22], iconAnchor: [11, 22] });
  function renderCandMapa() {
    gCand.clearLayers();
    S.cand.forEach((c, i) => {
      const a = radii().map((R) => analisar(c, R).n);
      const m = L.marker([c.lat, c.lng], { icon: iconeCand(i + 1, c.id === S.sel), draggable: true, title: c.nome, zIndexOffset: c.id === S.sel ? 1000 : 0 });
      m.bindPopup(() => `<div class="popup"><h4>${i + 1}. ${esc(c.nome)}</h4><p>${a.map((n, k) => `${radii()[k]} km: nota ${n.nota == null ? '—' : Math.round(n.nota)}`).join(' · ')}</p><p class="mut">${esc(ROT_P[c.precisao] || '')}</p><p><button class="btn" data-act="ver" data-id="${esc(c.id)}">Ver detalhe</button></p></div>`);
      m.on('click', () => { if (S.sel !== c.id) selecionar(c.id, false); });
      m.on('dragend', () => { const p = m.getLatLng(); c.lat = +p.lat.toFixed(6); c.lng = +p.lng.toFixed(6); c.precisao = 'pino_manual'; salvar(); atualizarTudo(); toast('Candidata movida: cálculos refeitos.'); });
      m.addTo(gCand);
    });
  }
  function renderSelMapa() {
    gSel.clearLayers();
    const c = S.cand.find((x) => x.id === S.sel);
    if (S.aba === 'cen' && S.cen.length >= 2) {
      for (const R of radii()) {
        const cs = S.cand.filter((x) => S.cen.includes(x.id));
        const cn = G.cenario(cs.map((x) => ({ id: x.id, nome: x.nome, p: [x.lat, x.lng] })), R, F.lojas, R);
        cs.forEach((x) => L.polygon(toLL(G.circleRing([x.lat, x.lng], R, 120)), { color: '#d9822b', weight: 2, fill: false, interactive: false }).addTo(gSel));
        if (cn.geo_conjunto.length) L.polygon(multiLL(cn.geo_conjunto), { color: '#0e8c8c', weight: 1, fillColor: '#16b5b5', fillOpacity: 0.35, interactive: false }).addTo(gSel);
      }
      return;
    }
    if (!c) return;
    const R = radii().includes(S.detR) ? S.detR : radii()[0];
    const a = analisar(c, R);
    L.polygon(toLL(G.circleRing([c.lat, c.lng], R, 160)), { color: '#d9822b', weight: 2.5, fill: false, interactive: false }).addTo(gSel);
    if (a.r.geo_coberta.length) L.polygon(multiLL(a.r.geo_coberta), { color: '#777', weight: 1, fillColor: '#666', fillOpacity: 0.35, interactive: false }).addTo(gSel);
    if (a.r.geo_nova.length) L.polygon(multiLL(a.r.geo_nova), { color: '#14724f', weight: 1, fillColor: '#2cc58a', fillOpacity: 0.3, interactive: false }).addTo(gSel);
  }

  // camada de demanda (retângulos da grade, só na janela visível)
  const rendCanvas = L.canvas({ padding: 0.3 });
  const METR = {
    pop: { rot: 'moradores/km²', f: (r, c) => r[c.pop] },
    renda: { rot: 'R$ renda média do responsável', f: (r, c) => (r[c.dom_com_renda] > 0 ? r[c.renda_media_x_dom] / r[c.dom_com_renda] : null), semArea: true },
    emp: { rot: 'empregos/km²', f: (r, c) => r[c.empregos] },
    acad: { rot: 'academias/km²', f: (r, c) => r[c.academias] },
    rest: { rot: 'restaurantes/km²', f: (r, c) => r[c.restaurantes] },
  };
  const PALETA = ['#fff3b0', '#fdcc5d', '#f59a3a', '#d85a2a', '#8c1d1d'];
  let limites = null;
  function limitesMetrica(k) {
    if (limites && limites.k === k) return limites;
    const m = METR[k]; const g = D.demanda_grid; const col = {}; g.colunas.forEach((n, i) => (col[n] = i));
    const area = (g.dlat * 111.195) * (g.dlng * 111.195 * Math.cos((23.5 * Math.PI) / 180));
    const v = []; for (const r of g.celulas) { let x = m.f(r, col); if (x == null || x <= 0) continue; if (!m.semArea) x /= area; v.push(x); }
    v.sort((a, b) => a - b);
    const q = [0.2, 0.4, 0.6, 0.8].map((p) => v[Math.floor(p * (v.length - 1))]);
    limites = { k, q, col, area };
    return limites;
  }
  function renderDemanda() {
    gDem.clearLayers(); const k = S.cfg.demanda;
    if (k === 'off') { atualizarLegenda(); return; }
    if (map.getZoom() < 11) { atualizarLegenda('Aproxime o mapa (zoom 11 ou mais) para ver a camada de demanda.'); return; }
    const m = METR[k]; const g = D.demanda_grid; const lim = limitesMetrica(k); const b = map.getBounds();
    for (const r of g.celulas) {
      const lat = g.lat0 + r[1] * g.dlat; const lng = g.lng0 + r[0] * g.dlng;
      if (lat > b.getNorth() || lat + g.dlat < b.getSouth() || lng > b.getEast() || lng + g.dlng < b.getWest()) continue;
      let x = m.f(r, lim.col); if (x == null || x <= 0) continue; if (!m.semArea) x /= lim.area;
      const cl = x < lim.q[0] ? 0 : x < lim.q[1] ? 1 : x < lim.q[2] ? 2 : x < lim.q[3] ? 3 : 4;
      L.rectangle([[lat, lng], [lat + g.dlat, lng + g.dlng]], { renderer: rendCanvas, stroke: false, fillColor: PALETA[cl], fillOpacity: 0.5, interactive: false }).addTo(gDem);
    }
    atualizarLegenda();
  }
  function atualizarLegenda(msg) {
    const k = S.cfg.demanda;
    let h = `<div><i style="background:${COR_GRUPO.rmsp}"></i>Grande SP <i style="background:${COR_GRUPO.entorno}"></i>Entorno <i style="background:${COR_GRUPO.outros}"></i>Só LinkedIn</div>
      <div><i style="background:#fff;border:3px dashed #b83a2e;width:8px;height:8px"></i>Shopping · <i style="background:#7a3fb5"></i>Candidata</div>
      <div><span style="color:${COR_R[3]}">━</span> 3 km · <span style="color:${COR_R[5]}">╍</span> 5 km · cinza = já coberto · verde = área nova</div>`;
    if (k !== 'off') {
      const lim = limitesMetrica(k); const r = (x) => fmt(x, METR[k].semArea ? 0 : 0);
      h += `<div style="margin-top:4px"><b>${esc(METR[k].rot)}</b> (Censo/RAIS/CNPJ)</div>` + PALETA.map((c, i) => `<i class="q" style="background:${c}"></i>${i === 0 ? '< ' + r(lim.q[0]) : i === 4 ? '≥ ' + r(lim.q[3]) : r(lim.q[i - 1]) + '–' + r(lim.q[i])} `).join('<br>');
    }
    if (msg) h += `<div>${esc(msg)}</div>`;
    const abertoAntes = $('#legDet') ? $('#legDet').open : window.innerWidth > 860;
    $('#legenda').innerHTML = `<details id="legDet"${abertoAntes ? ' open' : ''}><summary>Legenda</summary>${h}</details>`;
  }
  map.on('moveend', debounce(() => { if (S.cfg.demanda !== 'off') renderDemanda(); }, 150));

  // ---------- cabeçalho ----------
  function renderTopo() {
    const nSh = D.lojas.lojas.filter((l) => l.shopping === true).length;
    $('#nShopping').textContent = `(${nSh})`;
    let h = `<b>${F.lojas.length}</b> de ${F.total} lojas avaliadas`;
    if (F.excluidasShopping) h += ` · ${F.excluidasShopping} de shopping fora`;
    if (F.excluidasOutras) h += ` · ${F.excluidasOutras} ocultas`;
    if (F.naoAvaliadas.length) h += ` · <b>cobertura parcial</b>: ${F.naoAvaliadas.length} sem ponto no mapa (${F.naoAvaliadas.map((l) => esc(l.nome)).join(', ')})`;
    $('#cobertura').innerHTML = h;
  }

  // ---------- ranking ----------
  const ORDENS = { nota: 'Nota', nova: 'Área nova', dist: 'Mais longe de uma loja', nome: 'Nome' };
  function ordenar(lista) {
    const o = S.cfg.ordem; const R0 = radii()[0];
    const key = { nota: (c) => -mediaNota(c), nova: (c) => -analisar(c, R0).r.pct_nova, dist: (c) => -((analisar(c, R0).r.mais_proxima || { d: 1e9 }).d), nome: (c) => c.nome };
    return lista.slice().sort((a, b) => { const x = key[o](a), y = key[o](b); return typeof x === 'string' ? x.localeCompare(y, 'pt-BR') : x - y; });
  }
  function renderTabela() {
    $('#nCand').textContent = `(${S.cand.length})`;
    if (!S.cand.length) { $('#tabelaCand').innerHTML = '<p class="mut">Nenhuma candidata. Busque um endereço ou marque um ponto no mapa.</p>'; return; }
    const rs = radii();
    const linhas = ordenar(S.cand).map((c) => {
      const prox = analisar(c, rs[0]).r.mais_proxima;
      const cel = rs.map((R) => { const a = analisar(c, R); return `<td>${badge(a.n.nota, a.n.parcial)}<br><span class="mut peq">nova ${fmt(a.r.pct_nova)}%</span></td>`; }).join('');
      const ap = c.precisao !== 'pino_manual' && c.precisao !== 'coordenada';
      return `<tr class="cand${c.id === S.sel ? ' sel' : ''}" data-id="${esc(c.id)}"><td>${S.cand.indexOf(c) + 1}. ${esc(c.nome)}${ap ? '<span class="tag lar" title="Ponto aproximado: arraste o pino até o imóvel">aprox.</span>' : ''}</td>
        <td>${prox ? fmt(prox.d, 1) + ' km<br><span class="mut peq">' + esc(prox.nome) + '</span>' : '—'}</td>${cel}
        <td><input type="checkbox" class="cenChk" data-id="${esc(c.id)}" ${S.cen.includes(c.id) ? 'checked' : ''} aria-label="Incluir no cenário"></td></tr>`;
    }).join('');
    $('#tabelaCand').innerHTML = `<table><thead><tr><th>Candidata</th><th>Loja + próxima</th>${rs.map((R) => `<th>${R} km</th>`).join('')}<th title="Cenário de abertura conjunta">Cen.</th></tr></thead><tbody>${linhas}</tbody></table>`;
  }

  // ---------- detalhe ----------
  function avisos(c, R, a) {
    const v = [];
    if (c.precisao !== 'pino_manual' && c.precisao !== 'coordenada') v.push(['', `O ponto é ${ROT_P[c.precisao] || 'aproximado'}. Arraste o pino até o imóvel antes de decidir: a sobreposição muda com algumas centenas de metros.`]);
    if (F.naoAvaliadas.length) v.push(['verm', `Cobertura parcial: ${F.lojas.length} de ${F.total} lojas avaliadas. ${F.naoAvaliadas.length} sem ponto no mapa (${F.naoAvaliadas.map((l) => esc(l.nome)).join(', ')}) podem sobrepor esta área e não entraram no cálculo.`]);
    if (a.agg.cobertura < 0.5) v.push(['verm', 'Este ponto está fora da área com dados de demanda (Grande SP, Baixada Santista e eixo Campinas). Sem nota de demanda; só a geometria foi calculada.']);
    else if (a.agg.cobertura < 0.9) v.push(['', `Só ${fmt(a.agg.cobertura * 100)}% do círculo está na área com dados de demanda; os números de moradores, renda e emprego estão subestimados.`]);
    if (a.r.pct_nova < 25 && F.lojas.length) v.push(['verm', `Só ${fmt(a.r.pct_nova)}% da área do círculo é nova: ${fmt(a.r.pct_coberta)}% já está dentro do raio de lojas existentes. A nota considera a demanda do entorno, mas abrir aqui tende a dividir clientes com essas lojas (canibalização).`]);
    if (c.imovel == null) v.push(['', `Viabilidade do imóvel não informada: a nota é parcial (o peso de ${S.cfg.pesos.imovel} é redistribuído).`]);
    if (a.r.lojas_dentro.length || a.r.lojas_sobrepostas.length) v.push(['', 'As lojas vizinhas estão como "não verificada como aberta". Confirme se estão operando antes de contar essa sobreposição.']);
    return v;
  }
  function blocoRaio(c, R) {
    const a = analisar(c, R); const { r, agg, n } = a;
    const pesoTotal = n.peso_total;
    const comps = n.componentes.map((k) => `<div class="comp${k.disponivel ? '' : ' off'}"><div class="cab"><span>${esc(k.rotulo)} <span class="mut peq">(peso ${k.peso})</span></span><b>${k.disponivel ? fmt(k.valor) : 'indisponível'}</b></div>
      <div class="barra"><i style="width:${k.disponivel ? Math.max(1, k.valor) : 0}%"></i></div>
      <div class="mut peq">${k.disponivel ? (k.chave === 'nova_area' ? `${fmt(k.bruto, 1)}% da área do círculo` : k.chave === 'imovel' ? `nota ${fmt(k.bruto, 1)} de 10` : `${fmt(k.bruto, k.chave === 'saudavel' ? 1 : 0)} ${esc(k.unidade)}; melhor que ${fmt(k.valor)}% dos pontos urbanos da área coberta`) : 'sem dado para este ponto'} · fonte: ${esc(k.fonte)}</div></div>`).join('');
    const dentro = r.lojas_dentro.map((x) => `${esc(x.nome)} (${fmt(x.d, 1)} km)`).join('; ') || 'nenhuma';
    const fora = r.lojas_sobrepostas.filter((x) => x.d > R).map((x) => `${esc(x.nome)} (${fmt(x.d, 1)} km)`).join('; ') || 'nenhuma';
    return `<div class="caixa"><h3>Raio de ${R} km ${badge(n.nota, n.parcial)} ${n.parcial ? '<span class="tag lar">nota parcial</span>' : ''}</h3>
      <div class="kpi"><div><b>${fmt(agg.pop)}</b><span>moradores (Censo 2022)</span></div><div><b>${agg.renda_media_resp == null ? '—' : 'R$ ' + fmt(agg.renda_media_resp)}</b><span>renda média do responsável</span></div><div><b>${fmt(agg.empregos)}</b><span>empregos formais (RAIS)</span></div>
      <div><b>${fmt(agg.academias)}</b><span>academias ativas (CNPJ)</span></div><div><b>${fmt(agg.restaurantes)}</b><span>restaurantes e lanchonetes (CNPJ)</span></div><div><b>${fmt(agg.densidade_km2)}</b><span>moradores por km²</span></div></div>
      <p><b>Sobreposição:</b> círculo de ${fmt(r.area_candidato_km2, 1)} km², dos quais <b>${fmt(r.area_coberta_km2, 1)} km² (${fmt(r.pct_coberta)}%)</b> já estão dentro do raio de outras lojas e <b>${fmt(r.area_nova_km2, 1)} km² (${fmt(r.pct_nova)}%)</b> são área nova. Área contada uma vez só, mesmo quando várias lojas se sobrepõem.</p>
      <p class="peq"><b>Lojas dentro do raio:</b> ${dentro}<br><b>Mais longe, mas com círculo sobreposto:</b> ${fora}</p>
      <h3 style="margin-top:10px">Como a nota foi calculada</h3>${comps}
      <p class="mut peq">Nota = média ponderada dos componentes disponíveis (pesos em Ajustes). Mede potencial de demanda e cobertura; não é previsão de faturamento. Fatos do público saudável usam academias como indicador indireto.</p>
      ${avisos(c, R, a).map(([k, t]) => `<div class="alerta ${k}">${t}</div>`).join('')}</div>`;
  }
  function renderDetalhe() {
    const c = S.cand.find((x) => x.id === S.sel); const el = $('#detalhe');
    if (!c) { el.innerHTML = '<div class="caixa"><p class="mut">Selecione uma candidata no ranking ou no mapa.</p></div>'; return; }
    const rs = radii();
    if (!rs.includes(S.detR)) S.detR = rs[0];
    const toggle = rs.length > 1 ? `<div class="linha"><span class="mut peq">Desenhar no mapa:</span> ${rs.map((R) => `<button class="btn ${R === S.detR ? '' : 'sec'}" data-detr="${R}">${R} km</button>`).join('')}</div>` : '';
    el.innerHTML = `<div class="caixa"><div class="linha"><button class="btn sec" id="btnVoltar">← Ranking</button><button class="btn sec" id="btnCentrar">Centralizar no mapa</button></div>
      <h3>${S.cand.indexOf(c) + 1}. ${esc(c.nome)}</h3>
      <p class="mut peq">${esc(c.referencia || '')} · ${fmt(c.lat, 5)}, ${fmt(c.lng, 5)} · ${esc(ROT_P[c.precisao] || '')}</p>
      <label>Nome <input id="dNome" maxlength="80" value="${esc(c.nome)}"></label>
      <label>Viabilidade do imóvel (0 a 10; deixe vazio se ainda não avaliou) <input id="dImovel" type="number" min="0" max="10" step="0.5" value="${c.imovel == null ? '' : esc(c.imovel)}"></label>
      <label>Aluguel / condições (anotação sua) <input id="dAluguel" maxlength="120" value="${esc(c.aluguel || '')}"></label>
      <label>Observações <input id="dObs" maxlength="200" value="${esc(c.obs || '')}"></label>
      <div class="linha"><button class="btn perigo" id="btnRemover">Remover candidata</button></div></div>${toggle}${rs.map((R) => blocoRaio(c, R)).join('')}`;
    $('#btnVoltar').onclick = () => setAba('cand');
    $('#btnCentrar').onclick = () => map.setView([c.lat, c.lng], 14);
    $('#dNome').onchange = (e) => { c.nome = e.target.value.trim().slice(0, 80) || c.nome; salvar(); atualizarTudo(); };
    $('#dImovel').onchange = (e) => { const v = e.target.value === '' ? null : Math.min(10, Math.max(0, parseFloat(e.target.value))); c.imovel = isFinite(v) ? v : null; salvar(); atualizarTudo(); };
    $('#dAluguel').onchange = (e) => { c.aluguel = e.target.value.slice(0, 120); salvar(); };
    $('#dObs').onchange = (e) => { c.obs = e.target.value.slice(0, 200); salvar(); };
    $('#btnRemover').onclick = () => { if (confirm('Remover a candidata "' + c.nome + '"?')) { S.cand = S.cand.filter((x) => x !== c); S.cen = S.cen.filter((x) => x !== c.id); S.sel = null; salvar(); setAba('cand'); atualizarTudo(); } };
    $$('[data-detr]', el).forEach((b) => (b.onclick = () => { S.detR = Number(b.dataset.detr); renderDetalhe(); renderSelMapa(); }));
  }

  // ---------- cenário ----------
  function renderCenario() {
    const el = $('#cenario'); const cs = S.cand.filter((c) => S.cen.includes(c.id));
    let h = `<div class="caixa"><h3>Cenário de abertura conjunta</h3><p class="mut peq">Marque 2 ou 3 candidatas na coluna "Cen." do ranking. O cálculo mostra quanto de área nova o conjunto realmente traz e quanto uma candidata "rouba" da outra (canibalização).</p>`;
    h += cs.length ? '<ul>' + cs.map((c) => `<li>${esc(c.nome)} <button class="btn sec" data-rm="${esc(c.id)}">tirar</button></li>`).join('') + '</ul>' : '<p class="mut">Nenhuma candidata marcada.</p>';
    h += '</div>';
    if (cs.length >= 2) {
      if (cs.length > 3) h += '<div class="alerta">Cenários com mais de 3 aberturas simultâneas ficam pouco realistas; confira os números com cuidado.</div>';
      for (const R of radii()) {
        const cn = G.cenario(cs.map((c) => ({ id: c.id, nome: c.nome, p: [c.lat, c.lng] })), R, F.lojas, R);
        const ref = G.multiAreaKm2(uniaoLojas(R));
        const pares = []; for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) { const d = G.haversineKm([cs[i].lat, cs[i].lng], [cs[j].lat, cs[j].lng]); pares.push(`${esc(cs[i].nome)} ↔ ${esc(cs[j].nome)}: ${fmt(d, 1)} km${d < R ? ' <span class="tag verm">uma está dentro do raio da outra</span>' : d < 2 * R ? ' <span class="tag lar">círculos se sobrepõem</span>' : ''}`); }
        h += `<div class="caixa"><h3>Raio de ${R} km</h3><table><thead><tr><th>Candidata</th><th>Área nova sozinha (km²)</th></tr></thead><tbody>${cn.individuais.map((x) => `<tr><td>${esc(x.nome)}</td><td>${fmt(x.area_nova_km2, 1)}</td></tr>`).join('')}</tbody></table>
          <div class="kpi"><div><b>${fmt(cn.soma_individual_km2, 1)}</b><span>soma isolada (km²)</span></div><div><b>${fmt(cn.ganho_conjunto_km2, 1)}</b><span>ganho conjunto (km²)</span></div><div><b>${fmt(cn.canibalizacao_km2, 1)}</b><span>canibalização (${fmt(cn.soma_individual_km2 ? (100 * cn.canibalizacao_km2) / cn.soma_individual_km2 : 0)}%)</span></div></div>
          <p class="peq">Hoje as lojas avaliadas cobrem ${fmt(ref, 0)} km²; com este cenário passariam a ${fmt(ref + cn.ganho_conjunto_km2, 0)} km².</p><p class="peq">${pares.join('<br>')}</p></div>`;
      }
    }
    el.innerHTML = h;
    $$('[data-rm]', el).forEach((b) => (b.onclick = () => { S.cen = S.cen.filter((x) => x !== b.dataset.rm); salvar(); renderTabela(); renderCenario(); renderSelMapa(); }));
  }

  // ---------- lojas ----------
  function renderListaLojas() {
    const ef = lojasEf();
    const linhas = ef.map((l) => {
      const ign = S.ignorar.includes(l.id); const sem = l.lat == null;
      return `<tr><td><input type="checkbox" class="lojaChk" data-id="${esc(l.id)}" ${ign ? '' : 'checked'} aria-label="Considerar ${esc(l.nome)}"></td>
        <td><a href="#" class="lojaIr" data-id="${esc(l.id)}">${esc(l.nome)}</a><br><span class="mut peq">${esc([l.logradouro, l.numero].filter(Boolean).join(', '))} · ${esc(l.cidade)}</span></td>
        <td>${l.shopping ? '<span class="tag verm">shopping</span>' : ''}${l.duplicata_de ? '<span class="tag">duplicata</span>' : ''}${l.grupo === 'outros' ? '<span class="tag">só LinkedIn</span>' : ''}${l.grupo === 'entorno' ? '<span class="tag az">entorno</span>' : ''}</td>
        <td class="peq">${sem ? `<button class="btn sec lojaMarcar" data-id="${esc(l.id)}">Marcar no mapa</button>` : esc(ROT_Q[l.geo_qualidade] || '')}</td></tr>`;
    }).join('');
    $('#listaLojas').innerHTML = `<table><thead><tr><th></th><th>Loja</th><th></th><th>Ponto</th></tr></thead><tbody>${linhas}</tbody></table>`;
  }

  // ---------- ajustes ----------
  function renderPesos() {
    $('#pesos').innerHTML = Object.keys(DM.PESOS_PADRAO).map((k) => `<div class="rangeLinha"><label for="p_${k}">${esc(DM.ROTULOS[k])}<input id="p_${k}" type="range" min="0" max="40" step="1" value="${S.cfg.pesos[k]}" data-k="${k}"></label><b id="pv_${k}">${S.cfg.pesos[k]}</b></div>`).join('');
    $$('#pesos input').forEach((i) => i.addEventListener('input', () => { S.cfg.pesos[i.dataset.k] = Number(i.value); $('#pv_' + i.dataset.k).textContent = i.value; cache.clear(); refrescarPesos(); }));
  }
  const refrescarPesos = debounce(() => { salvar(); renderTabela(); renderCandMapa(); if (S.aba === 'det') renderDetalhe(); }, 150);

  const SOBRE = () => `<h3>Sobre esta ferramenta</h3>
    <p><b>Para que serve:</b> comparar pontos candidatos para novas lojas Mana Poke considerando o raio de 3 e de 5 km, a sobreposição com as lojas existentes e a demanda ao redor.</p>
    <h3>Como as distâncias e áreas são calculadas</h3>
    <p>Distância em linha reta (fórmula de Haversine), círculos geodésicos reais de 3 e 5 km (área teórica de 28,27 km² e 78,54 km²) e união/diferença de polígonos, de modo que a área de várias lojas sobrepostas é contada uma vez só. A conferência independente com PostGIS deu diferença de 0,2% na área de interseção.</p>
    <h3>Dados de demanda (grade de 500 m)</h3>
    <ul><li>${esc(D.demanda_grid.fontes.moradores_domicilios_renda)}</li><li>${esc(D.demanda_grid.fontes.empregos)}</li><li>${esc(D.demanda_grid.fontes.restaurantes)}</li><li>${esc(D.demanda_grid.fontes.academias)}</li></ul>
    <p>Validação contra o cálculo exato por interseção de setores, em 20 pontos e dois raios: erro mediano de 0,3% em moradores, 0,9% em empregos e 0,2% em renda (máximo de 11% em empregos de um ponto). Detalhes em <code>data/VALIDACAO_DEMANDA.md</code>.</p>
    <p>Cobertura dos dados de demanda: Grande São Paulo, Baixada Santista, Jundiaí e o eixo Campinas–Valinhos–Vinhedo. Fora disso o app avisa e não calcula nota de demanda.</p>
    <h3>Lojas</h3>
    <p>Base de ${D.lojas.n} registros do levantamento de 19/11/2026 (planilhas e LinkedIn), geocodificados no CNEFE do IBGE. <b>Nenhuma loja está confirmada como aberta.</b> Duplicatas prováveis: Campinas Cambuí (Galizia) e Vinhedo (incompleto). Endereços com número divergente entre fontes aparecem no arquivo <code>data/RELATORIO_QUALIDADE.md</code>.</p>
    <h3>O que a nota não é</h3>
    <p>É um índice de 0 a 100 do potencial de demanda e da cobertura, com pesos ajustáveis. Não prevê faturamento. Aluguel por bairro e fluxo de pessoas não entram porque não há fonte gratuita confiável para o Brasil; a viabilidade do imóvel é uma nota que você informa.</p>
    <h3>Privacidade</h3><p>Tudo roda no seu navegador. Suas candidatas ficam salvas só neste navegador (ou no arquivo que você exportar). Os mapas de fundo são baixados do OpenStreetMap, CARTO ou Esri.</p>`;

  // ---------- busca offline ----------
  const mun = D.ruas_index.municipios.slice().sort((a, b) => a.mun.localeCompare(b.mun, 'pt-BR'));
  $('#selMun').innerHTML = mun.map((m) => `<option value="${esc(m.cd)}"${m.cd === '3550308' ? ' selected' : ''}>${esc(m.mun)}</option>`).join('');
  const carregando = {};
  function carregarRuas(cd) {
    if (D.ruas && D.ruas[cd]) return Promise.resolve(D.ruas[cd]);
    if (carregando[cd]) return carregando[cd];
    carregando[cd] = new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'data/ruas/' + encodeURIComponent(cd) + '.js'; s.onload = () => { const d = D.ruas[cd]; d.n = d.trechos.map((t) => ({ r: norm(t[0]), b: norm(t[1]) })); ok(d); }; s.onerror = () => { delete carregando[cd]; no(new Error('falha ao carregar ruas')); }; document.head.appendChild(s); });
    return carregando[cd];
  }
  const TIPOS = new Set(['rua', 'r', 'avenida', 'av', 'alameda', 'al', 'travessa', 'tv', 'praca', 'estrada', 'rodovia', 'largo', 'viela', 'beco', 'via']);
  function interpretar(q) {
    let m = q.match(/^\s*(-?\d{1,2}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)\s*$/) || q.match(/^\s*(-?\d{1,2},\d+)\s*;\s*(-?\d{1,3},\d+)\s*$/);
    if (m) return { coord: [parseFloat(m[1].replace(',', '.')), parseFloat(m[2].replace(',', '.'))] };
    const t = norm(q).split(' ').filter(Boolean); let num = null;
    if (t.length > 1 && /^\d+$/.test(t[t.length - 1])) num = parseInt(t.pop(), 10);
    if (t.length > 1 && TIPOS.has(t[0])) t.shift();
    return { tokens: t, num };
  }
  async function buscar() {
    const q = $('#busca').value.trim(); const ul = $('#resBusca'); ul.innerHTML = '';
    if (!q) return;
    const it = interpretar(q);
    if (it.coord) { if (!brasilOk(...it.coord)) { toast('Coordenada fora do Brasil.'); return; } return escolher({ lat: it.coord[0], lng: it.coord[1], nome: 'Ponto ' + fmt(it.coord[0], 4) + ', ' + fmt(it.coord[1], 4), ref: 'coordenada informada', precisao: 'coordenada' }); }
    if (!it.tokens.length) return;
    let d; try { d = await carregarRuas($('#selMun').value); } catch (e) { toast('Não consegui carregar o índice de ruas.'); return; }
    const casa = (nome, tk) => tk.every((w, i) => (i === tk.length - 1 ? nome.split(' ').some((p) => p.startsWith(w)) : (' ' + nome + ' ').includes(' ' + w + ' ')));
    const ruas = [];
    d.trechos.forEach((t, i) => { if (casa(d.n[i].r, it.tokens)) ruas.push(i); });
    const alvo = it.tokens.join(' ');
    const tipoCasa = (i) => { const r = d.n[i].r; return r === alvo ? 0 : r.startsWith(alvo) ? 1 : 2; };
    const score = (i) => { const t = d.trechos[i]; if (it.num == null) return 0; if (it.num >= t[3] && it.num <= t[4]) return 0; return Math.min(Math.abs(it.num - t[3]), Math.abs(it.num - t[4])) + 1; };
    ruas.sort((a, b) => tipoCasa(a) - tipoCasa(b) || score(a) - score(b));
    const out = ruas.slice(0, 8).map((i) => { const t = d.trechos[i]; const dentro = it.num != null && it.num >= t[3] && it.num <= t[4]; return { lat: t[5], lng: t[6], nome: t[0] + (it.num != null ? ', ' + it.num : ''), ref: `${t[0]}${t[1] ? ', ' + t[1] : ''}, ${d.mun}`, linha: `${t[0]}${t[1] ? ' · ' + t[1] : ''}`, sub: `CEP ${t[2]} · nºs ${t[3]}–${t[4]}${it.num != null ? (dentro ? ' · trecho contém o nº ' + it.num : ' · nº fora da faixa conhecida') : ''}`, precisao: 'trecho_aproximado' }; });
    const bairros = {}; d.trechos.forEach((t, i) => { if (t[1] && casa(d.n[i].b, it.tokens)) { const b = bairros[t[1]] || (bairros[t[1]] = { s: 0, la: 0, ln: 0 }); b.s++; b.la += t[5]; b.ln += t[6]; } });
    Object.keys(bairros).slice(0, 3).forEach((k) => { const b = bairros[k]; out.push({ lat: b.la / b.s, lng: b.ln / b.s, nome: k, ref: `${k}, ${d.mun}`, linha: `Bairro ${k}`, sub: 'centro aproximado do bairro (média dos trechos de rua)', precisao: 'bairro_aproximado' }); });
    if (!out.length) { ul.innerHTML = '<li class="mut peq" style="padding:6px">Nada encontrado neste município. Confira o município selecionado, tente só o nome da rua ou cole coordenadas.</li>'; return; }
    out.forEach((o, k) => { const li = document.createElement('li'); li.innerHTML = `<button data-k="${k}">${esc(o.linha || o.nome)}<small>${esc(o.sub || '')}</small></button>`; li.firstChild.onclick = () => escolher(o); ul.appendChild(li); });
  }
  function escolher(o) {
    $('#resBusca').innerHTML = '';
    S.nova = { lat: +o.lat.toFixed(6), lng: +o.lng.toFixed(6), precisao: o.precisao, ref: o.ref };
    $('#novaNome').value = (o.nome || '').slice(0, 80);
    colocarPinoBusca(); map.setView([S.nova.lat, S.nova.lng], 16); atualizarForm();
  }
  function colocarPinoBusca() {
    gBusca.clearLayers(); if (!S.nova) return;
    const m = L.marker([S.nova.lat, S.nova.lng], { icon: L.divIcon({ className: '', html: '<div class="pin-busca"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), draggable: true, title: 'Arraste até o imóvel' }).addTo(gBusca);
    m.on('dragend', () => { const p = m.getLatLng(); S.nova.lat = +p.lat.toFixed(6); S.nova.lng = +p.lng.toFixed(6); S.nova.precisao = 'pino_manual'; atualizarForm(); });
  }
  function atualizarForm() {
    const f = $('#formNova'); f.hidden = !S.nova; if (!S.nova) return;
    $('#novaPos').textContent = `${fmt(S.nova.lat, 5)}, ${fmt(S.nova.lng, 5)} · ${ROT_P[S.nova.precisao] || ''}. Arraste o pino preto até o imóvel para mais precisão.`;
  }
  function salvarNova() {
    if (!S.nova) return;
    const nome = $('#novaNome').value.trim().slice(0, 80) || 'Nova candidata';
    const c = { id: 'u-' + Date.now().toString(36), nome, referencia: S.nova.ref || '', lat: S.nova.lat, lng: S.nova.lng, precisao: S.nova.precisao, origem: 'usuario', imovel: null, aluguel: '', obs: '' };
    S.cand.push(c); S.nova = null; gBusca.clearLayers(); atualizarForm(); $('#novaNome').value = ''; $('#busca').value = '';
    salvar(); atualizarTudo(); selecionar(c.id, true); toast('Candidata salva.');
  }
  function iniciarModo(m, texto) {
    S.modo = m; const b = $('#modoBanner'); b.hidden = false; b.innerHTML = `${esc(texto)} <button id="btnCancModo">Cancelar (Esc)</button>`; $('#btnCancModo').onclick = fimModo; map.getContainer().style.cursor = 'crosshair';
  }
  function fimModo() { S.modo = null; $('#modoBanner').hidden = true; map.getContainer().style.cursor = ''; }
  map.on('click', (e) => {
    if (!S.modo) return;
    const lat = +e.latlng.lat.toFixed(6), lng = +e.latlng.lng.toFixed(6);
    if (S.modo.tipo === 'nova') { S.nova = { lat, lng, precisao: 'pino_manual', ref: 'ponto marcado no mapa' }; if (!$('#novaNome').value) $('#novaNome').value = 'Ponto marcado'; colocarPinoBusca(); atualizarForm(); }
    if (S.modo.tipo === 'loja') { S.ajLojas[S.modo.id] = { lat, lng }; salvar(); atualizarTudo(); toast('Ponto da loja salvo (marcado por você).'); }
    fimModo();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.modo) fimModo(); });

  // ---------- seleção e abas ----------
  function selecionar(id, abrir) {
    S.sel = id; renderTabela(); renderCandMapa(); renderSelMapa();
    const c = S.cand.find((x) => x.id === id);
    if (abrir) { setAba('det'); if (c) map.setView([c.lat, c.lng], Math.max(map.getZoom(), 13)); } else if (S.aba === 'det') renderDetalhe();
  }
  function setAba(a) {
    S.aba = a;
    $$('#abas button').forEach((b) => b.setAttribute('aria-selected', b.dataset.aba === a ? 'true' : 'false'));
    $$('.aba').forEach((s) => (s.hidden = s.id !== 'aba-' + a));
    if (a === 'det') renderDetalhe(); if (a === 'cen') renderCenario(); if (a === 'lojas') renderListaLojas(); if (a === 'sobre') $('#sobre').innerHTML = SOBRE();
    renderSelMapa();
  }

  // ---------- exportações ----------
  function baixar(nome, texto, tipo) { const b = new Blob([texto], { type: tipo }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = nome; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  const hoje = () => new Date().toISOString().slice(0, 10);
  const cel = (v) => { let s = v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v); if (/^[=+\-@\t\r]/.test(s) && typeof v !== 'number') s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  function exportarCsv() {
    const rs = radii(); const cab = ['Nº', 'Candidata', 'Referência', 'Latitude', 'Longitude', 'Precisão do ponto', 'Loja mais próxima', 'Distância (km)'];
    rs.forEach((R) => cab.push(`Lojas no raio ${R} km`, `Círculos sobrepostos ${R} km`, `% já coberto ${R} km`, `% área nova ${R} km`, `Área nova ${R} km (km²)`, `Moradores ${R} km`, `Renda média ${R} km (R$)`, `Empregos ${R} km`, `Academias ${R} km`, `Restaurantes ${R} km`, `Nota ${R} km`, `Nota parcial ${R} km`));
    cab.push('Viabilidade do imóvel (0-10)', 'Aluguel/condições', 'Observações', 'Lojas avaliadas', 'Shopping incluído', 'Data');
    const linhas = [cab.map(cel).join(';')];
    ordenar(S.cand).forEach((c) => {
      const p = analisar(c, rs[0]).r.mais_proxima; const l = [S.cand.indexOf(c) + 1, c.nome, c.referencia, c.lat, c.lng, ROT_P[c.precisao] || c.precisao, p ? p.nome : '', p ? +p.d.toFixed(2) : ''];
      rs.forEach((R) => { const a = analisar(c, R); l.push(a.r.lojas_dentro.length, a.r.lojas_sobrepostas.length, +a.r.pct_coberta.toFixed(1), +a.r.pct_nova.toFixed(1), +a.r.area_nova_km2.toFixed(2), Math.round(a.agg.pop), a.agg.renda_media_resp == null ? '' : Math.round(a.agg.renda_media_resp), Math.round(a.agg.empregos), +a.agg.academias.toFixed(1), +a.agg.restaurantes.toFixed(1), a.n.nota == null ? '' : +a.n.nota.toFixed(1), a.n.parcial ? 'sim' : 'não'); });
      l.push(c.imovel == null ? '' : c.imovel, c.aluguel || '', c.obs || '', `${F.lojas.length} de ${F.total}`, S.cfg.shopping ? 'sim' : 'não', hoje());
      linhas.push(l.map(cel).join(';'));
    });
    baixar(`manapoke-candidatas-${hoje()}.csv`, '﻿' + linhas.join('\r\n'), 'text/csv;charset=utf-8');
  }
  function exportarGeo() {
    const feats = [];
    lojasEf().forEach((l) => { if (l.lat != null) feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [l.lng, l.lat] }, properties: { tipo: 'loja', id: l.id, nome: l.nome, cidade: l.cidade, shopping: l.shopping === true, qualidade_ponto: l.geo_qualidade, considerada_nos_calculos: F.lojas.some((x) => x.id === l.id) } }); });
    S.cand.forEach((c) => feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] }, properties: { tipo: 'candidata', id: c.id, nome: c.nome, precisao: c.precisao, nota: radii().map((R) => { const n = analisar(c, R).n.nota; return n == null ? null : +n.toFixed(1); }) } }));
    baixar(`manapoke-mapa-${hoje()}.geojson`, JSON.stringify({ type: 'FeatureCollection', features: feats }), 'application/geo+json');
  }
  function exportarJson() { baixar(`manapoke-expansao-${hoje()}.json`, JSON.stringify({ tipo: 'manapoke-expansao', v: 1, exportado: new Date().toISOString(), cfg: S.cfg, cand: S.cand, ajLojas: S.ajLojas, ignorar: S.ignorar, cen: S.cen }, null, 1), 'application/json'); }
  function importarJson(txt) {
    let d; try { d = JSON.parse(txt); } catch (e) { toast('Arquivo inválido.'); return; }
    if (!d || d.tipo !== 'manapoke-expansao' || !Array.isArray(d.cand)) { toast('Este arquivo não é uma exportação desta ferramenta.'); return; }
    const str = (v, n) => String(v == null ? '' : v).slice(0, n);
    const cand = d.cand.filter((c) => c && brasilOk(+c.lat, +c.lng)).slice(0, 300).map((c, i) => ({ id: str(c.id || 'i-' + i, 40), nome: str(c.nome, 80) || 'Candidata', referencia: str(c.referencia, 160), lat: +c.lat, lng: +c.lng, precisao: ROT_P[c.precisao] ? c.precisao : 'pino_manual', origem: str(c.origem, 20), imovel: c.imovel == null || !isFinite(+c.imovel) ? null : Math.min(10, Math.max(0, +c.imovel)), aluguel: str(c.aluguel, 120), obs: str(c.obs, 200) }));
    const ids = new Set(D.lojas.lojas.map((l) => l.id)); const aj = {};
    Object.keys(d.ajLojas || {}).forEach((k) => { const a = d.ajLojas[k]; if (ids.has(k) && a && brasilOk(+a.lat, +a.lng)) aj[k] = { lat: +a.lat, lng: +a.lng }; });
    if (!confirm(`Importar ${cand.length} candidatas e ${Object.keys(aj).length} pontos de loja? Isso substitui o que está salvo neste navegador.`)) return;
    S.cand = cand; S.ajLojas = aj; S.ignorar = (d.ignorar || []).filter((x) => ids.has(x)); S.cen = (d.cen || []).filter((x) => cand.some((c) => c.id === x));
    if (d.cfg && d.cfg.pesos) Object.keys(DM.PESOS_PADRAO).forEach((k) => { const v = +d.cfg.pesos[k]; if (isFinite(v) && v >= 0 && v <= 100) S.cfg.pesos[k] = v; });
    S.sel = null; salvar(); aplicarCfgNaTela(); atualizarTudo(); toast('Importação concluída.');
  }
  function imprimir() {
    const rs = radii(); const c = S.cand.find((x) => x.id === S.sel);
    const linhas = ordenar(S.cand).map((x) => `<tr><td>${S.cand.indexOf(x) + 1}. ${esc(x.nome)}${x.precisao !== 'pino_manual' && x.precisao !== 'coordenada' ? ' (ponto aproximado)' : ''}</td>${rs.map((R) => { const a = analisar(x, R); return `<td>${fmt(a.n.nota)}${a.n.parcial ? '*' : ''}</td><td>${fmt(a.r.pct_nova)}%</td><td>${fmt(a.agg.pop)}</td><td>${a.agg.renda_media_resp == null ? '—' : fmt(a.agg.renda_media_resp)}</td><td>${fmt(a.agg.empregos)}</td>`; }).join('')}</tr>`).join('');
    $('#relatorio').innerHTML = `<h1>Mana Poke · Relatório de expansão</h1><p>Gerado em ${new Date().toLocaleDateString('pt-BR')}. Lojas avaliadas: ${F.lojas.length} de ${F.total}${S.cfg.shopping ? '' : ' (lojas de shopping excluídas)'}${F.naoAvaliadas.length ? '; cobertura parcial: ' + F.naoAvaliadas.map((l) => esc(l.nome)).join(', ') + ' sem ponto no mapa' : ''}. Raio(s): ${rs.join(' e ')} km.</p>
      <h2>Ranking das candidatas</h2><table><thead><tr><th>Candidata</th>${rs.map((R) => `<th>Nota ${R} km</th><th>% nova</th><th>Moradores</th><th>Renda (R$)</th><th>Empregos</th>`).join('')}</tr></thead><tbody>${linhas}</tbody></table>
      <p>* nota parcial: falta algum componente (por exemplo, a viabilidade do imóvel). Pontos marcados como aproximados devem ser confirmados no local.</p>
      ${c ? `<h2>Detalhe: ${esc(c.nome)}</h2>${rs.map((R) => { const a = analisar(c, R); return `<section><h3>${R} km — nota ${fmt(a.n.nota)}</h3><ul>${a.n.componentes.map((k) => `<li>${esc(k.rotulo)} (peso ${k.peso}): ${k.disponivel ? fmt(k.valor) + ' de 100' : 'indisponível'} — fonte: ${esc(k.fonte)}</li>`).join('')}</ul><p>Área nova ${fmt(a.r.area_nova_km2, 1)} km² (${fmt(a.r.pct_nova)}%); já coberta ${fmt(a.r.area_coberta_km2, 1)} km². Lojas dentro do raio: ${a.r.lojas_dentro.map((x) => esc(x.nome) + ' (' + fmt(x.d, 1) + ' km)').join('; ') || 'nenhuma'}.</p></section>`; }).join('')}` : ''}
      <h2>Fontes e limites</h2><p>Moradores, domicílios e renda: IBGE, Censo 2022. Empregos: RAIS (MTE). Restaurantes e academias: CNPJ (Receita Federal, ativos). Lojas: levantamento de 19/11/2026, geocodificado no CNEFE do IBGE; nenhuma confirmada como aberta. A nota mede potencial de demanda e cobertura, não prevê faturamento. Distâncias em linha reta.</p>`;
    window.print();
  }

  // ---------- coordenação ----------
  function atualizarTudo() { filtrar(); renderTopo(); renderLojasMapa(); renderTabela(); renderCandMapa(); renderSelMapa(); if (S.aba === 'det') renderDetalhe(); if (S.aba === 'cen') renderCenario(); if (S.aba === 'lojas') renderListaLojas(); }
  function aplicarCfgNaTela() {
    $$('input[name=raio]').forEach((i) => (i.checked = i.value === S.cfg.raio)); $('#chkShopping').checked = S.cfg.shopping; $('#chkDup').checked = S.cfg.dup; $('#chkRotulos').checked = S.cfg.rotulos;
    $$('.fGrupo').forEach((i) => (i.checked = !!S.cfg.grupos[i.value])); $('#chkCirculos').checked = S.cfg.circulos; $('#chkUniao').checked = S.cfg.uniao; $('#selDemanda').value = S.cfg.demanda; $('#selOrdem').value = S.cfg.ordem; renderPesos();
  }
  function ligar() {
    $$('input[name=raio]').forEach((i) => i.addEventListener('change', () => { S.cfg.raio = i.value; salvar(); atualizarTudo(); }));
    $('#chkShopping').onchange = (e) => { S.cfg.shopping = e.target.checked; salvar(); atualizarTudo(); };
    $('#chkDup').onchange = (e) => { S.cfg.dup = e.target.checked; salvar(); atualizarTudo(); };
    $('#chkRotulos').onchange = (e) => { S.cfg.rotulos = e.target.checked; salvar(); renderLojasMapa(); };
    $$('.fGrupo').forEach((i) => (i.onchange = () => { S.cfg.grupos[i.value] = i.checked; salvar(); atualizarTudo(); }));
    $('#chkCirculos').onchange = (e) => { S.cfg.circulos = e.target.checked; salvar(); renderLojasMapa(); };
    $('#chkUniao').onchange = (e) => { S.cfg.uniao = e.target.checked; salvar(); renderLojasMapa(); };
    $('#selDemanda').onchange = (e) => { S.cfg.demanda = e.target.value; limites = null; salvar(); renderDemanda(); };
    $('#selBase').onchange = (e) => { trocarBase(e.target.value); salvar(); };
    $('#selOrdem').innerHTML = Object.keys(ORDENS).map((k) => `<option value="${k}">${esc(ORDENS[k])}</option>`).join('');
    $('#selOrdem').onchange = (e) => { S.cfg.ordem = e.target.value; salvar(); renderTabela(); };
    $$('#abas button').forEach((b) => (b.onclick = () => setAba(b.dataset.aba)));
    $('#btnBuscar').onclick = buscar; $('#busca').onkeydown = (e) => { if (e.key === 'Enter') buscar(); };
    $('#btnMarcar').onclick = () => iniciarModo({ tipo: 'nova' }, 'Clique no mapa onde fica o ponto candidato.');
    $('#btnSalvarNova').onclick = salvarNova; $('#btnCancelarNova').onclick = () => { S.nova = null; gBusca.clearLayers(); atualizarForm(); };
    $('#tabelaCand').addEventListener('click', (e) => {
      const chk = e.target.closest('.cenChk');
      if (chk) { const id = chk.dataset.id; if (chk.checked) { if (!S.cen.includes(id)) S.cen.push(id); } else S.cen = S.cen.filter((x) => x !== id); salvar(); if (S.aba === 'cen') renderCenario(); renderSelMapa(); return; }
      const tr = e.target.closest('tr.cand'); if (tr) selecionar(tr.dataset.id, true);
    });
    $('#listaLojas').addEventListener('click', (e) => {
      const chk = e.target.closest('.lojaChk'); if (chk) { const id = chk.dataset.id; const i = S.ignorar.indexOf(id); if (!chk.checked && i < 0) S.ignorar.push(id); if (chk.checked && i >= 0) S.ignorar.splice(i, 1); salvar(); atualizarTudo(); return; }
      const ir = e.target.closest('.lojaIr'); if (ir) { e.preventDefault(); const l = lojasEf().find((x) => x.id === ir.dataset.id); if (l && l.lat != null) map.setView([l.lat, l.lng], 15); else toast('Esta loja ainda não tem ponto no mapa.'); return; }
      const mk = e.target.closest('.lojaMarcar'); if (mk) iniciarModo({ tipo: 'loja', id: mk.dataset.id }, 'Clique no mapa onde fica esta loja.');
    });
    $('#btnPesosPadrao').onclick = () => { S.cfg.pesos = Object.assign({}, DM.PESOS_PADRAO); cache.clear(); renderPesos(); refrescarPesos(); };
    $('#btnExpCsv').onclick = exportarCsv; $('#btnExpGeo').onclick = exportarGeo; $('#btnExpJson').onclick = exportarJson; $('#btnImprimir').onclick = imprimir;
    $('#btnImpJson').onclick = () => $('#fileImp').click();
    $('#fileImp').onchange = (e) => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => importarJson(String(r.result)); r.readAsText(f); e.target.value = ''; };
    $('#btnLimpar').onclick = () => { if (confirm('Apagar candidatas, ajustes e pesos salvos neste navegador?')) { try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ } S.cfg = PADRAO(); S.cand = sementeCand(); S.ajLojas = {}; S.ignorar = []; S.cen = []; S.sel = null; aplicarCfgNaTela(); atualizarTudo(); toast('Dados apagados; voltei às 39 áreas do V7.'); } };
  }

  // ---------- início ----------
  const salvo = lerArmazenado();
  if (salvo && salvo.v === 1) {
    if (salvo.cfg) { S.cfg = Object.assign(PADRAO(), salvo.cfg, { pesos: Object.assign({}, DM.PESOS_PADRAO, salvo.cfg.pesos || {}), grupos: Object.assign({ rmsp: true, entorno: true, outros: true }, salvo.cfg.grupos || {}) }); }
    S.cand = Array.isArray(salvo.cand) ? salvo.cand.filter((c) => c && brasilOk(+c.lat, +c.lng)) : sementeCand(); S.ajLojas = salvo.ajLojas || {}; S.ignorar = salvo.ignorar || []; S.cen = salvo.cen || [];
  } else S.cand = sementeCand();
  trocarBase(bases[S.cfg.base] ? S.cfg.base : 'osm');
  ligar(); aplicarCfgNaTela(); filtrar(); renderTopo(); renderLojasMapa(); renderTabela(); renderCandMapa(); renderDemanda(); atualizarForm(); atualizarLegenda();
  setTimeout(() => map.invalidateSize(), 200);
  if (window.ResizeObserver) new ResizeObserver(debounce(() => { map.invalidateSize(); if (S.cfg.demanda !== 'off') renderDemanda(); }, 120)).observe($('#mapaBox'));
  window.MPApp = { S, analisar, filtrar, map }; // útil para testes no navegador
})();
