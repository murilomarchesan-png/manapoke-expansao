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
    osm_ponto_shopping: 'Ponto do shopping (OpenStreetMap)', google_maps: 'Ponto da ficha do Google Maps', manual: 'Ponto marcado por você', pendente: 'Sem ponto no mapa',
  };
  const ROT_P = { area_aproximada: 'ponto aproximado da área', trecho_aproximado: 'ponto aproximado do trecho da rua', bairro_aproximado: 'centro aproximado do bairro', pino_manual: 'pino posicionado por você', coordenada: 'coordenada informada' };
  const COR_GRUPO = { rmsp: '#14724f', entorno: '#2a6fb0', outros: '#8a8f98' };
  const COR_R = { 3: '#14724f', 5: '#2a6fb0' };

  // ---------- estado e armazenamento ----------
  const PADRAO = () => ({ raio: 'ambos', shopping: true, dup: true, grupos: { rmsp: true, entorno: true, outros: true }, rotLoja: true, rotCand: true, conc: { poke: true, saudavel: false, acai: false, japones: false }, circulos: true, uniao: true, demanda: 'off', base: 'osm', pesos: Object.assign({}, DM.PESOS_PADRAO), ordem: 'nota' });
  const S = { cfg: PADRAO(), cand: [], ajLojas: {}, ignorar: [], cen: [], sel: null, detR: 3, aba: 'cand', nova: null, modo: null, compR: 3, compOrd: 'consumo', compDesc: true };
  let F = null; // lojas filtradas
  const cache = new Map();
  let uniao = {};

  function lerArmazenado() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { return null; } }
  function salvar() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, semV2: true, cfg: S.cfg, cand: S.cand, ajLojas: S.ajLojas, ignorar: S.ignorar, cen: S.cen })); } catch (e) { /* navegador sem armazenamento: segue sem salvar */ }
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

  // ---------- bairro de um ponto (CNPJ ativo + CEP/CNEFE, offline) ----------
  const BR = D.bairros ? (() => { const mk = (a) => { const m = new Map(); for (let k = 0; k < a.length; k += 3) m.set(a[k] * 100000 + a[k + 1], a[k + 2]); return m; }; return { B: D.bairros, fino: mk(D.bairros.fcel), grosso: mk(D.bairros.cel) }; })() : null;
  const bairroMemo = new Map();
  function celMaisProxima(mapa, lat, lng) {
    const B = BR.B; const i = Math.floor((lat - B.lat0) / B.dlat), j = Math.floor((lng - B.lng0) / B.dlng);
    for (let r = 0; r <= 3; r++) {
      let best = null, bd = 1e9;
      for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
        if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue;
        const p = mapa.get((i + a) * 100000 + j + b); if (p == null) continue;
        const d = Math.hypot((B.lat0 + (i + a + 0.5) * B.dlat - lat) * 111.2, (B.lng0 + (j + b + 0.5) * B.dlng - lng) * 102);
        if (d < bd) { bd = d; best = p; }
      }
      if (best != null) return { p: best, d: bd };
    }
    return null;
  }
  /** Bairro de um ponto: { bairro, mun, local, dist } ou null se fora da área coberta. */
  function bairroDe(lat, lng) {
    if (!BR || lat == null) return null;
    const k = lat.toFixed(4) + '|' + lng.toFixed(4); if (bairroMemo.has(k)) return bairroMemo.get(k);
    const f = celMaisProxima(BR.fino, lat, lng), g = celMaisProxima(BR.grosso, lat, lng);
    let out = null;
    if (f || g) out = { bairro: f ? BR.B.fpares[f.p][1] : null, mun: f ? BR.B.fpares[f.p][0] : BR.B.pares[g.p][0], dist: f ? f.d : null, local: g ? BR.B.pares[g.p][1] : null };
    bairroMemo.set(k, out); return out;
  }
  const bairroNome = (b) => (b ? b.bairro || b.local || '' : '');
  const bairroLinha = (b) => (b ? [bairroNome(b), b.mun].filter(Boolean).join(' · ') : 'fora da área com bairros mapeados');
  const contem = (a, b) => !!b && norm(a).includes(norm(b));
  /** Nome da loja com o bairro (quando o nome ainda não o traz). */
  function rotuloLoja(l) {
    const b2 = l.bairro && !contem(l.nome, l.bairro) ? `<br><span class="sub">${esc(l.bairro)}</span>` : '';
    return `<b>${esc(l.nome)}</b>${b2}`;
  }
  function rotuloCand(c, i) {
    const b = bairroNome(bairroDe(c.lat, c.lng));
    const b2 = b && !contem(c.nome, b) ? `<br><span class="sub">${esc(b)}</span>` : '';
    return `<b>${i + 1}. ${esc(c.nome)}</b>${b2}`;
  }

  // ---------- a cidade como um todo (totais do município) ----------
  const MUN = D.municipios ? (() => {
    const cols = D.municipios.colunas;
    const rows = D.municipios.linhas.map((r) => { const o = {}; cols.forEach((c, i) => (o[c] = r[i])); o.key = norm(o.nome); o.dens = o.pop / (o.area_urb_km2 > 0 ? o.area_urb_km2 : o.area_km2); o.rest10k = (o.restaurantes / o.pop) * 10000; o.acad100k = (o.academias / o.pop) * 100000; o.consumo = o.massa_renda || null; return o; });
    const pr = (campo) => { const v = rows.map((r) => r[campo]).filter((x) => x != null).sort((a, b) => a - b); return (x) => (x == null ? null : (100 * v.filter((y) => y < x).length) / Math.max(1, v.length - 1)); };
    const pCons = pr('consumo'), pRenda = pr('renda'), pEmp = pr('empregos'), pRest = pr('rest10k');
    const rank = (campo) => { const v = rows.slice().sort((a, b) => (b[campo] || 0) - (a[campo] || 0)); const m = new Map(); v.forEach((r, i) => m.set(r.cd, i + 1)); return m; };
    const rkPop = rank('pop'), rkRenda = rank('renda'), rkEmp = rank('empregos'), rkCons = rank('consumo');
    rows.forEach((r) => { const xs = [pCons(r.consumo), pRenda(r.renda), pEmp(r.empregos), pRest(r.rest10k)].filter((x) => x != null); r.indice = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; r.rkPop = rkPop.get(r.cd); r.rkRenda = rkRenda.get(r.cd); r.rkEmp = rkEmp.get(r.cd); r.rkCons = rkCons.get(r.cd); });
    return { rows, by: new Map(rows.map((r) => [r.key, r])), n: rows.length };
  })() : null;
  const cidadeDe = (lat, lng) => { const b = bairroDe(lat, lng); return b && MUN ? MUN.by.get(norm(b.mun)) || null : null; };
  const lojasNaCidade = (m) => (F ? F.lojas.filter((l) => norm(l.cidade) === m.key) : []);
  // potencial de consumo = renda média do responsável x domicílios (Censo 2022), em R$ por mês: proxy de poder de compra, não gasto medido
  const reais = (n) => (n == null ? '—' : n >= 1e9 ? 'R$ ' + fmt(n / 1e9, 2) + ' bi' : n >= 1e7 ? 'R$ ' + fmt(n / 1e6, 0) + ' mi' : 'R$ ' + fmt(n / 1e6, 1) + ' mi');
  const mil = (n) => (n == null ? '—' : n >= 1e6 ? fmt(n / 1e6, 2) + ' mi' : n >= 1e4 ? fmt(n / 1e3, 0) + ' mil' : fmt(n));

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
  // o ponto em foco no detalhe pode ser uma candidata ou uma loja da rede (id 'loja:<id>')
  function lojaComoPonto(l) {
    return { id: 'loja:' + l.id, nome: l.nome, lat: l.lat, lng: l.lng, imovel: null, precisao: l.geo_qualidade, _loja: l,
      referencia: [[l.logradouro, l.numero].filter(Boolean).join(', '), l.bairro, l.cidade].filter(Boolean).join(' · ') };
  }
  function pontoSel() {
    if (typeof S.sel === 'string' && S.sel.startsWith('loja:')) { const l = lojasEf().find((x) => 'loja:' + x.id === S.sel); return l && l.lat != null ? lojaComoPonto(l) : null; }
    return S.cand.find((x) => x.id === S.sel);
  }
  function verLoja(l, mover) {
    if (l.lat == null) { toast('Esta loja ainda não tem ponto no mapa.'); return; }
    S.sel = 'loja:' + l.id; renderTabela(); renderCandMapa(); renderSelMapa(); setAba('det');
    if (mover) map.setView([l.lat, l.lng], Math.max(map.getZoom(), 13));
  }
  function analisar(c, R) {
    const k = [c.id, R, c.lat, c.lng, c.imovel].join('|');
    if (cache.has(k)) return cache.get(k);
    const r = G.analisarPonto([c.lat, c.lng], R, c._loja ? F.lojas.filter((x) => x.id !== c._loja.id) : F.lojas, R);
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
  const gConc = L.layerGroup().addTo(map); const gLojas = L.layerGroup().addTo(map); const gSel = L.layerGroup().addTo(map); const gCand = L.layerGroup().addTo(map); const gBusca = L.layerGroup().addTo(map);

  // ---------- concorrentes (CNPJ ativo: nome fantasia indica poke, saudável/fit, açaí ou japonês) ----------
  const CONC_CATS = [['poke', 'Poke', '#e5484d'], ['saudavel', 'Saudável/fit', '#d99a00'], ['acai', 'Açaí', '#b0287a'], ['japones', 'Japonês', '#0e8c8c']];
  const CONC = D.concorrentes ? D.concorrentes.rows.map((r) => ({ lat: r[0], lng: r[1], cat: D.concorrentes.cats[r[2]], nome: r[3] })) : [];
  const concMemo = new Map();
  /** Contagem de concorrentes por categoria a até R km de um ponto. */
  function concPerto(lat, lng, R) {
    const k = lat.toFixed(5) + '|' + lng.toFixed(5) + '|' + R; if (concMemo.has(k)) return concMemo.get(k);
    const out = { poke: 0, saudavel: 0, acai: 0, japones: 0, total: 0 };
    const dl = R / 111, dg = R / 102;
    for (const c of CONC) { if (Math.abs(c.lat - lat) > dl || Math.abs(c.lng - lng) > dg) continue; if (G.haversineKm([lat, lng], [c.lat, c.lng]) <= R) { out[c.cat]++; out.total++; } }
    concMemo.set(k, out); return out;
  }
  const concTexto = (n) => CONC_CATS.map(([k, r]) => `${r.toLowerCase()} ${n[k]}`).join(' · ');
  const rendConc = L.canvas({ padding: 0.3 });
  function renderConc() {
    gConc.clearLayers();
    const on = CONC_CATS.filter(([k]) => S.cfg.conc[k]);
    if (!on.length || !CONC.length) return;
    const vis = new Set(on.map(([k]) => k)); const cor = Object.fromEntries(CONC_CATS.map(([k, , c]) => [k, c])); const rot = Object.fromEntries(CONC_CATS.map(([k, r]) => [k, r]));
    for (const c of CONC) {
      if (!vis.has(c.cat)) continue;
      L.circleMarker([c.lat, c.lng], { renderer: rendConc, radius: 4, weight: 1, color: '#fff', fillColor: cor[c.cat], fillOpacity: 0.9 }).bindTooltip(`${esc(c.nome)} · ${rot[c.cat]} (CNPJ ativo)`, { direction: 'top' }).addTo(gConc);
    }
  }
  function blocoConc(c, R) {
    if (!CONC.length) return '';
    const n = concPerto(c.lat, c.lng, R);
    return `<div class="caixa"><h3>Concorrentes parecidos · ${R} km</h3><p><b>${fmt(n.poke)}</b> de poke · <b>${fmt(n.saudavel)}</b> saudável/fit · <b>${fmt(n.acai)}</b> açaí · <b>${fmt(n.japones)}</b> japonês</p><p class="mut peq">Contagem de CNPJs ativos (Receita, 11/10/2026) de restaurante ou lanchonete cujo nome fantasia indica a categoria. Quem não tem essas palavras no nome não aparece, e uma loja em endereço aproximado pode cair em outro raio. Ative as categorias na aba Lojas para ver no mapa.</p></div>`;
  }
  function resumoLoja(l) {
    if (l.lat == null) return '';
    const a = dem.agregar(l.lat, l.lng, 3);
    if (a.cobertura < 0.5) return '';
    return `<p><b>Raio de 3 km:</b> ${fmt(a.pop)} moradores · renda média R$ ${a.renda_media_resp == null ? '—' : fmt(a.renda_media_resp)}<br>Potencial de consumo ${reais(a.massa_renda)} por mês · ${fmt(a.empregos)} empregos</p>${CONC.length ? `<p class="peq">Concorrentes a 3 km (nome parecido): ${concTexto(concPerto(l.lat, l.lng, 3))}</p>` : ''}`;
  }
  const STATUS_TXT = { aberta_conferida: ['aberta no Google Maps em 19/11/2026', 'tag az'], fechada: ['fechada (Google Maps, 19/11/2026)', 'tag verm'], nao_encontrada: ['sem ficha no Google Maps', 'tag lar'], nao_verificado: ['não verificada como aberta', 'tag lar'] };
  const tagStatus = (l) => { const t = STATUS_TXT[l.status_operacional] || STATUS_TXT.nao_verificado; return `<span class="${t[1]}">${t[0]}</span>`; };
  function popupLoja(l) {
    const q = ROT_Q[l.geo_qualidade] || l.geo_qualidade;
    const ign = S.ignorar.includes(l.id);
    return `<div class="popup"><h4>${esc(l.nome)}</h4>
      <p>${esc([l.logradouro, l.numero].filter(Boolean).join(', '))}${l.complemento ? ' · ' + esc(l.complemento) : ''}<br>${esc([l.bairro, l.cidade].filter(Boolean).join(' · '))}${l.cep ? ' · CEP ' + esc(l.cep) : ''}</p>
      <p><span class="tag">${l.shopping ? 'shopping' : 'shopping: não classificado'}</span> ${tagStatus(l)}</p>${l.verificacao_obs ? `<p class="mut">${esc(l.verificacao_obs)}</p>` : ''}
      <p class="mut">Ponto: ${esc(q)}${l.geo_obs ? '. ' + esc(l.geo_obs) : ''}</p>
      <p class="mut">Fonte do cadastro: ${esc(l.evidencia || '—')}</p>
      ${resumoLoja(l)}
      <p><button class="btn" data-act="verloja" data-id="${esc(l.id)}">Ver dados da região</button> <button class="btn sec" data-act="ign" data-id="${esc(l.id)}">${ign ? 'Voltar a considerar nos cálculos' : 'Tirar dos cálculos'}</button></p></div>`;
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
      m.on('click', () => { if (S.sel !== 'loja:' + l.id) { S.sel = 'loja:' + l.id; renderTabela(); renderCandMapa(); renderSelMapa(); setAba('det'); } });
      if (S.cfg.rotLoja) m.bindTooltip(rotuloLoja(l), { permanent: true, direction: 'right', offset: [8, 0], className: 'rotulo' });
      m.addTo(gLojas);
    });
  }
  map.on('popupopen', (e) => {
    const el = e.popup.getElement(); if (!el) return;
    $$('[data-act]', el).forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.act === 'ign') { const id = b.dataset.id; const i = S.ignorar.indexOf(id); if (i >= 0) S.ignorar.splice(i, 1); else S.ignorar.push(id); map.closePopup(); atualizarTudo(); }
      if (b.dataset.act === 'verloja') { const l = lojasEf().find((x) => x.id === b.dataset.id); map.closePopup(); if (l) verLoja(l, false); }
      if (b.dataset.act === 'ver') { selecionar(b.dataset.id, true); map.closePopup(); }
    }));
  });

  const iconeCand = (n, sel) => L.divIcon({ className: '', html: `<div class="pin-cand${sel ? ' sel' : ''}"><span>${n}</span></div>`, iconSize: [22, 22], iconAnchor: [11, 22] });
  function renderCandMapa() {
    gCand.clearLayers();
    S.cand.forEach((c, i) => {
      const a = radii().map((R) => analisar(c, R).n);
      const m = L.marker([c.lat, c.lng], { icon: iconeCand(i + 1, c.id === S.sel), draggable: true, title: c.nome, zIndexOffset: c.id === S.sel ? 1000 : 0 });
      m.bindPopup(() => `<div class="popup"><h4>${i + 1}. ${esc(c.nome)}</h4><p class="mut">Bairro: ${esc(bairroLinha(bairroDe(c.lat, c.lng)))}</p><p>${a.map((n, k) => `${radii()[k]} km: nota ${n.nota == null ? '—' : Math.round(n.nota)}`).join(' · ')}</p><p class="mut">${esc(ROT_P[c.precisao] || '')}</p><p><button class="btn" data-act="ver" data-id="${esc(c.id)}">Ver detalhe</button></p></div>`);
      m.on('click', () => { if (S.sel !== c.id) selecionar(c.id, false); });
      m.on('dragend', () => { const p = m.getLatLng(); c.lat = +p.lat.toFixed(6); c.lng = +p.lng.toFixed(6); c.precisao = 'pino_manual'; salvar(); atualizarTudo(); toast('Candidata movida: cálculos refeitos.'); });
      if (S.cfg.rotCand && (map.getZoom() >= 14 || c.id === S.sel)) m.bindTooltip(rotuloCand(c, i), { permanent: true, direction: 'right', offset: [10, -10], className: 'rotulo cand' });
      m.addTo(gCand);
    });
    candZoomMostra = map.getZoom() >= 14;
  }
  let candZoomMostra = false;
  map.on('zoomend', () => { if (S.cfg.rotCand && (map.getZoom() >= 14) !== candZoomMostra) renderCandMapa(); });
  function renderSelMapa() {
    gSel.clearLayers();
    const c = pontoSel();
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
      ${CONC.length && CONC_CATS.some(([c]) => S.cfg.conc[c]) ? '<div>Concorrentes: ' + CONC_CATS.filter(([c]) => S.cfg.conc[c]).map(([, r, c]) => `<i style="background:${c}"></i>${r}`).join(' ') + '</div>' : ''}
      <div><span style="color:${COR_R[3]}">━</span> 3 km · <span style="color:${COR_R[5]}">╍</span> 5 km · cinza = já coberto · verde = área nova</div>`;
    if (k !== 'off') {
      const lim = limitesMetrica(k); const r = (x) => fmt(x, METR[k].semArea ? 0 : 0);
      h += `<div style="margin-top:4px"><b>${esc(METR[k].rot)}</b> (Censo/RAIS/CNPJ)</div>` + PALETA.map((c, i) => `<i class="q" style="background:${c}"></i>${i === 0 ? '< ' + r(lim.q[0]) : i === 4 ? '≥ ' + r(lim.q[3]) : r(lim.q[i - 1]) + '–' + r(lim.q[i])} `).join('<br>');
    }
    if (msg) h += `<div>${esc(msg)}</div>`;
    const abertoAntes = $('#legDet') ? $('#legDet').open : (window.innerWidth > 860 && window.innerHeight > 650);
    $('#legenda').innerHTML = `<details id="legDet"${abertoAntes ? ' open' : ''}><summary>Legenda</summary>${h}</details>`;
  }
  map.on('moveend', debounce(() => { if (S.cfg.demanda !== 'off') renderDemanda(); }, 150));

  // rótulos do mapa dependem do zoom: longe = só pontos; médio = nomes; perto = nomes com bairro
  function zoomRotulos() { const z = map.getZoom(); const c = map.getContainer(); const lim = window.innerWidth <= 860 ? 12 : 11; c.classList.toggle('z-longe', z < lim); c.classList.toggle('z-medio', z >= lim && z < 13 + (lim - 11)); }
  map.on('zoomend', zoomRotulos); zoomRotulos();

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
    const box = $('#tabelaCand');
    if (!S.cand.length) {
      box.innerHTML = '<p class="mut peq">Nenhum local ainda.</p>';
      return;
    }
    const rs = radii();
    const linhas = ordenar(S.cand).map((c) => {
      const notas = rs.map((R) => { const a = analisar(c, R); return `<span class="nt"><span class="mut">${R} km</span> ${badge(a.n.nota, a.n.parcial)}</span>`; }).join('');
      return `<div class="item cand${c.id === S.sel ? ' sel' : ''}" data-id="${esc(c.id)}" role="button" tabindex="0">
        <div class="txt"><b>${esc(c.nome)}</b><span class="mut peq">${esc(bairroLinha(bairroDe(c.lat, c.lng)))}</span></div>
        <div class="notas">${notas}</div>
        <label class="cen" title="Comparar em cenário de abertura conjunta"><input type="checkbox" class="cenChk" data-id="${esc(c.id)}" ${S.cen.includes(c.id) ? 'checked' : ''}> comparar</label>
        <button class="rm" data-id="${esc(c.id)}" title="Remover este local" aria-label="Remover ${esc(c.nome)}">Remover</button></div>`;
    }).join('');
    box.innerHTML = linhas + '<div class="linha" style="justify-content:flex-end"><button class="btn perigo" id="btnLimparLista" style="margin-top:6px">Limpar toda a lista</button></div>';
  }

  // ---------- detalhe ----------
  function avisos(c, R, a) {
    const v = [];
    if (c.precisao !== 'pino_manual' && c.precisao !== 'coordenada') v.push(['', `O ponto é ${ROT_P[c.precisao] || 'aproximado'}. Arraste o pino até o imóvel antes de decidir: a sobreposição muda com algumas centenas de metros.`]);
    if (F.naoAvaliadas.length) v.push(['verm', `Cobertura parcial: ${F.lojas.length} de ${F.total} lojas avaliadas. ${F.naoAvaliadas.length} sem ponto no mapa (${F.naoAvaliadas.map((l) => esc(l.nome)).join(', ')}) podem sobrepor esta área e não entraram no cálculo.`]);
    if (a.agg.cobertura < 0.5) v.push(['verm', 'Este ponto está fora do estado de São Paulo, que é a área com dados de demanda. Sem nota de demanda; só a geometria foi calculada.']);
    else if (a.agg.cobertura < 0.9) v.push(['', `Só ${fmt(a.agg.cobertura * 100)}% do círculo está na área com dados de demanda; os números de moradores, renda e emprego estão subestimados.`]);
    if (a.r.pct_nova < 25 && F.lojas.length && !c._loja) v.push(['verm', `Só ${fmt(a.r.pct_nova)}% da área do círculo é nova: ${fmt(a.r.pct_coberta)}% já está dentro do raio de lojas existentes. A nota considera a demanda do entorno, mas abrir aqui tende a dividir clientes com essas lojas (canibalização).`]);
    if (c.imovel == null && !c._loja) v.push(['', `Viabilidade do imóvel não informada: a nota é parcial (o peso de ${S.cfg.pesos.imovel} é redistribuído).`]);
    if (a.r.lojas_dentro.length || a.r.lojas_sobrepostas.length) v.push(['', 'A situação das lojas vizinhas foi conferida no Google Maps em 19/11/2026; confirme com a operação antes de decidir, porque a ficha do Google pode estar desatualizada.']);
    return v;
  }
  function blocoCidade(c, R) {
    const m = cidadeDe(c.lat, c.lng);
    if (!m) return '<div class="caixa"><h3>A cidade como um todo</h3><p class="mut">Este ponto está fora do estado de São Paulo, que é a área com totais na base.</p></div>';
    const { agg } = analisar(c, R); const lj = lojasNaCidade(m);
    const lin = (rot, a, b) => `<tr><td>${rot}</td><td>${a}</td><td>${b}</td></tr>`;
    const razao = lj.length ? `${fmt(m.pop / lj.length)} moradores por loja` : '';
    return `<div class="caixa"><h3>A cidade como um todo · ${esc(m.nome)}</h3>
      <table class="cmp"><thead><tr><th></th><th>Raio de ${R} km</th><th>${esc(m.nome)} inteira</th></tr></thead><tbody>
      ${lin('Moradores', fmt(agg.pop), fmt(m.pop))}
      ${lin('Renda média do responsável', agg.renda_media_resp == null ? '—' : 'R$ ' + fmt(agg.renda_media_resp), m.renda ? 'R$ ' + fmt(m.renda) : '—')}
      ${lin('Potencial de consumo por mês', reais(agg.massa_renda), reais(m.consumo))}
      ${lin('Empregos formais', fmt(agg.empregos), fmt(m.empregos))}
      ${lin('Restaurantes e lanchonetes', fmt(agg.restaurantes), fmt(m.restaurantes))}
      ${lin('Academias', fmt(agg.academias), fmt(m.academias))}
      ${lin('Moradores por km² (área urbana)', fmt(agg.densidade_km2), fmt(m.dens))}
      </tbody></table>
      <p class="mut peq">O raio pode pegar bairros de cidades vizinhas, por isso a coluna da esquerda nem sempre cabe dentro da coluna da direita. Fonte: Censo 2022, RAIS 2025 e CNPJ (ativos em 11/10/2026).</p>
      <div class="cidade-lista">
        <div><b>${m.rkPop}º</b> em população <span class="mut">entre ${MUN.n} cidades</span></div>
        <div><b>${m.rkRenda || '—'}º</b> em renda <span class="mut">do responsável</span></div>
        <div><b>${m.rkCons || '—'}º</b> em potencial de consumo <span class="mut">por mês</span></div>
        <div><b>${m.rkEmp}º</b> em empregos <span class="mut">formais</span></div>
        <div><b>${m.indice == null ? '—' : Math.round(m.indice)}</b> índice da cidade <span class="mut">(0 a 100)</span></div>
      </div>
      <p><b>Lojas Mana Poke na cidade:</b> ${lj.length ? `${lj.length} (${lj.map((l) => esc(l.nome)).join(', ')}) · ${razao}` : '<span class="tag lar">nenhuma loja avaliada</span> cidade ainda sem Mana Poke nos cálculos'}</p>
      <p class="mut peq">Índice da cidade = média simples de quatro posições (população, renda, empregos e restaurantes por 10 mil moradores) entre as ${MUN.n} cidades do app. É só uma referência para comparar cidades; não entra na nota do ponto.</p></div>`;
  }
  const veredito = (n) => (n == null ? 'sem dados' : n >= 60 ? 'potencial alto' : n >= 40 ? 'potencial médio' : 'potencial baixo');
  function blocoRaio(c, R) {
    const a = analisar(c, R); const { r, agg, n } = a;
    const comps = n.componentes.map((k) => `<div class="comp${k.disponivel ? '' : ' off'}"><div class="cab"><span>${esc(k.rotulo)} <span class="mut">(peso ${k.peso})</span></span><b>${k.disponivel ? fmt(k.valor) + '<small>/100</small>' : 'indisponível'}</b></div>
      <div class="barra"><i style="width:${k.disponivel ? Math.max(1, k.valor) : 0}%"></i></div>
      <div class="mut peq">${k.disponivel ? (k.chave === 'nova_area' ? `${fmt(k.bruto, 1)}% da área do círculo` : k.chave === 'imovel' ? `nota ${fmt(k.bruto, 1)} de 10` : `${fmt(k.bruto, k.chave === 'saudavel' ? 1 : 0)} ${esc(k.unidade)}; melhor que ${fmt(k.valor)}% dos pontos urbanos da área coberta`) : 'sem dado para este ponto'} · fonte: ${esc(k.fonte)}</div></div>`).join('');
    const dentro = r.lojas_dentro.map((x) => `<li>${esc(x.nome)} <span class="mut">${fmt(x.d, 1)} km</span></li>`).join('') || '<li class="mut">nenhuma</li>';
    const fora = r.lojas_sobrepostas.filter((x) => x.d > R).map((x) => `<li>${esc(x.nome)} <span class="mut">${fmt(x.d, 1)} km</span></li>`).join('') || '<li class="mut">nenhuma</li>';
    const tile = (v, rot) => `<div class="tile"><b>${v}</b><span>${rot}</span></div>`;
    return `<div class="caixa"><h3>Números em volta do ponto · raio de ${R} km</h3>
      <div class="kpi">${tile(fmt(agg.pop), 'moradores (Censo 2022)')}${tile(agg.renda_media_resp == null ? '—' : 'R$ ' + fmt(agg.renda_media_resp), 'renda média do responsável')}${tile(reais(agg.massa_renda), 'potencial de consumo por mês (renda somada dos responsáveis)')}${tile(fmt(agg.empregos), 'empregos formais (RAIS)')}${tile(fmt(agg.densidade_km2), 'moradores por km²')}${tile(fmt(agg.restaurantes), 'restaurantes e lanchonetes (CNPJ)')}${tile(fmt(agg.academias), 'academias ativas (CNPJ)')}</div></div>
      ${blocoConc(c, R)}
      <div class="caixa"><h3>Sobreposição com as lojas atuais · ${R} km</h3>
      <div class="barra2" role="img" aria-label="${fmt(r.pct_nova)}% área nova, ${fmt(r.pct_coberta)}% já coberta"><i class="nova" style="width:${Math.max(0, Math.min(100, r.pct_nova))}%"></i><i class="cob" style="width:${Math.max(0, Math.min(100, r.pct_coberta))}%"></i></div>
      <div class="dupla"><div><b class="grande verde">${fmt(r.pct_nova)}%</b><br><span class="mut">área nova (${fmt(r.area_nova_km2, 1)} km²)</span></div><div><b class="grande">${fmt(r.pct_coberta)}%</b><br><span class="mut">já coberta (${fmt(r.area_coberta_km2, 1)} km²)</span></div></div>
      <p class="mut peq">Círculo de ${fmt(r.area_candidato_km2, 1)} km². A área é contada uma vez só, mesmo quando várias lojas se sobrepõem.</p>
      <div class="duas"><div><b>Lojas dentro do raio</b><ul class="lst">${dentro}</ul></div><div><b>Mais longe, com círculo sobreposto</b><ul class="lst">${fora}</ul></div></div></div>
      <div class="caixa"><h3>Como a nota de ${R} km foi calculada ${badge(n.nota, n.parcial)}</h3>${comps}
      <p class="mut peq">Nota = média ponderada dos componentes disponíveis (pesos em Ajustes). Mede potencial de demanda e cobertura; não é previsão de faturamento. O público saudável usa academias como indicador indireto.</p></div>
      ${avisos(c, R, a).map(([k, t]) => `<div class="alerta ${k}">${t}</div>`).join('')}`;
  }
  function renderDetalhe() {
    const c = pontoSel(); const el = $('#detalhe');
    if (!c) { el.innerHTML = '<div class="caixa"><p class="mut">Selecione uma candidata no ranking ou uma loja no mapa.</p></div>'; return; }
    const eLoja = !!c._loja;
    const rs = radii();
    if (!rs.includes(S.detR)) S.detR = rs[0];
    const bd = bairroDe(c.lat, c.lng);
    const resumo = rs.map((R) => { const a = analisar(c, R); return `<button class="resumo${R === S.detR ? ' ativo' : ''}" data-detr="${R}" aria-pressed="${R === S.detR}"><span class="mut">Raio de ${R} km</span><span class="nota grande ${clsNota(a.n.nota)}">${a.n.nota == null ? '—' : Math.round(a.n.nota)}${a.n.parcial && a.n.nota != null ? '*' : ''}</span><span>${veredito(a.n.nota)}${a.n.parcial ? ' · parcial' : ''}</span><span class="mut peq">${fmt(a.r.pct_nova)}% área nova · ${fmt(a.agg.pop)} moradores</span></button>`; }).join('');
    el.innerHTML = `<div class="caixa"><div class="linha"><button class="btn sec" id="btnVoltar">← Ranking</button><button class="btn sec" id="btnCentrar">Centralizar no mapa</button></div>
      <h2 class="titulo">${eLoja ? 'Loja · ' : S.cand.indexOf(c) + 1 + '. '}${esc(c.nome)}</h2>${eLoja ? `<p class="mut peq">Loja do cadastro de 19/11/2026 (${(STATUS_TXT[c._loja.status_operacional] || STATUS_TXT.nao_verificado)[0]}). Os números abaixo são da região em volta dela; a sobreposição desconta a própria loja e conta só as outras.</p>` : ''}
      <p class="bairro-linha"><b>Bairro:</b> ${esc(bairroLinha(bd))}${bd && bd.local && bd.local !== bd.bairro ? `<br><span class="mut">Distrito/localidade pelos CEPs: ${esc(bd.local)}</span>` : ''}</p>
      <p class="mut peq">${esc(c.referencia || '')} · ${fmt(c.lat, 5)}, ${fmt(c.lng, 5)} · ${esc(ROT_P[c.precisao] || '')}</p></div>
      <div class="resumos${rs.length > 1 ? ' dois' : ''}">${resumo}</div>
      ${rs.length > 1 ? '<p class="mut peq" style="margin:-4px 2px 8px">Toque num raio para ver os números dele e desenhá-lo no mapa.</p>' : ''}
      ${blocoCidade(c, S.detR)}
      ${blocoRaio(c, S.detR)}
      ${eLoja ? '' : `<details class="caixa" open><summary><b>Nome, imóvel, aluguel e observações</b></summary>
      <label>Nome <input id="dNome" maxlength="80" value="${esc(c.nome)}"></label>
      <label>Viabilidade do imóvel (0 a 10; vazio = ainda não avaliou) <input id="dImovel" type="number" min="0" max="10" step="0.5" value="${c.imovel == null ? '' : esc(c.imovel)}"></label>
      <label>Aluguel / condições (anotação sua) <input id="dAluguel" maxlength="120" value="${esc(c.aluguel || '')}"></label>
      <label>Observações <input id="dObs" maxlength="200" value="${esc(c.obs || '')}"></label>
      <div class="linha"><button class="btn perigo" id="btnRemover">Remover candidata</button></div></details>`}`;
    $('#btnVoltar').onclick = () => setAba('cand');
    $('#btnCentrar').onclick = () => map.setView([c.lat, c.lng], 14);
    if (eLoja) return;
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

  // ---------- cidades ----------
  S.cid = { ord: 'consumo', desc: true, semLoja: false, q: '', abertas: new Set() };
  const CID_ORD = [['consumo', 'Potencial de consumo'], ['pop', 'Moradores'], ['renda', 'Renda média do responsável'], ['empregos', 'Empregos formais'], ['rest10k', 'Restaurantes por 10 mil moradores'], ['indice', 'Índice geral'], ['nome', 'Nome (A a Z)']];
  const bairrosDaCidade = (m) => { const t = D.cidades_bairros; if (!t) return []; const cols = t.colunas; return (t.cidades[m.cd] || []).map((r) => { const o = {}; cols.forEach((c, i) => (o[c] = r[i])); return o; }); };
  // loja Mana Poke mais próxima de um ponto (só entre as avaliadas), em linha reta
  function lojaPerto(lat, lng) {
    let b = null;
    for (const l of F.lojas) { const d = G.haversineKm([lat, lng], [l.lat, l.lng]); if (!b || d < b.d) b = { l, d }; }
    return b;
  }
  const textoPerto = (x, m) => { const b = x.lat != null ? lojaPerto(x.lat, x.lng) : null; if (!b) return '—'; if (b.d > 25) return '<span class="mut">nenhuma até 25 km</span>'; const nome = esc(b.l.nome) + (norm(b.l.cidade) !== m.key ? ' (' + esc(b.l.cidade) + ')' : ''); return b.d <= 5 ? `<b class="ok">${nome}</b> <span class="mut">${fmt(b.d, 1)} km · na região</span>` : `${nome} <span class="mut">${fmt(b.d, 1)} km</span>`; };
  // lojas de cidades vizinhas a até 5 km de um dos principais bairros (ex.: Alphaville fica entre Barueri e Santana de Parnaíba)
  function lojasVizinhas(m) { const out = new Map(); for (const x of bairrosDaCidade(m)) { if (x.lat == null) continue; const b = lojaPerto(x.lat, x.lng); if (b && b.d <= 5 && norm(b.l.cidade) !== m.key) out.set(b.l.id, b.l); } return [...out.values()]; }
  function corpoCidade(m) {
    const tl = (v, rot) => `<div class="tile"><b>${v}</b><span>${rot}</span></div>`;
    const lj = lojasNaCidade(m);
    const bs = bairrosDaCidade(m);
    const so1 = bs.length === 1 && norm(bs[0].bairro) === m.key;
    const tab = bs.length && !so1 ? `<table class="cmp bairros"><thead><tr><th>Bairro</th><th>Moradores</th><th>Renda média</th><th>Consumo por mês</th></tr></thead><tbody>${bs.map((x, k) => `<tr class="bi" data-cd="${esc(m.cd)}" data-k="${k}" tabindex="0" title="Ver no mapa"><td>${esc(x.bairro)}<div class="peq perto">Loja mais próxima: ${textoPerto(x, m)}</div></td><td>${fmt(x.pop)}</td><td>${x.renda ? 'R$ ' + fmt(x.renda) : '—'}</td><td>${reais(x.massa_renda)}</td></tr>`).join('')}</tbody></table>
      <p class="mut peq">Os ${bs.length} bairros com mais moradores, estimados pela grade de 500 m do Censo 2022 (o bairro vem dos endereços mais próximos, CNPJ e CEP). Clique numa linha para ir ao bairro no mapa.</p>`
      : '<p class="mut peq">A base de endereços só distingue um bairro ou localidade nesta cidade; não dá para listar os principais bairros sem inventar.</p>';
    return `<div class="kpi">${tl(reais(m.consumo), 'potencial de consumo por mês')}${tl(fmt(m.pop), 'moradores')}${tl(m.renda ? 'R$ ' + fmt(m.renda) : '—', 'renda média do responsável')}${tl(fmt(m.empregos), 'empregos formais')}${tl(fmt(m.restaurantes), 'restaurantes e lanchonetes')}${tl(fmt(m.academias), 'academias')}</div>
      <p class="mut peq">${m.rkCons || '—'}º em potencial de consumo, ${m.rkPop}º em moradores e ${m.rkRenda || '—'}º em renda entre ${MUN.n} cidades · ${fmt(m.dens)} moradores por km² urbano.</p>
      <h4>Principais bairros</h4>${tab}
      <p class="peq">${lj.length ? '<b>Lojas Mana Poke na lista:</b> ' + lj.map((l) => esc(l.nome)).join(', ') : (lojasVizinhas(m).length ? '<b>Sem loja dentro da cidade, mas há loja na região (a até 5 km de bairros daqui):</b> ' + lojasVizinhas(m).map((l) => esc(l.nome) + ' (' + esc(l.cidade) + ')').join(', ') : '<span class="mut">Nenhuma loja Mana Poke avaliada nesta cidade nem a até 5 km dos principais bairros.</span>')}</p>
      <button class="btn cidIr" data-cd="${esc(m.cd)}">Ver a cidade no mapa</button>`;
  }
  function renderCidades() {
    const el = $('#cidades'); if (!MUN) { el.innerHTML = '<p class="mut">Sem dados de cidades.</p>'; return; }
    const val = (m, k) => (k === 'nome' ? m.nome : m[k]);
    let lista = MUN.rows.filter((m) => (!S.cid.semLoja || !lojasNaCidade(m).length) && (!S.cid.q || m.key.includes(norm(S.cid.q))));
    lista.sort((a, b) => { const x = val(a, S.cid.ord), y = val(b, S.cid.ord); const r = typeof x === 'string' ? x.localeCompare(y, 'pt-BR') : (x == null ? -1 : x) - (y == null ? -1 : y); return S.cid.desc ? -r : r; });
    const card = (m) => { const aberta = S.cid.abertas.has(m.cd); const nl = lojasNaCidade(m).length;
      return `<details class="cidade" data-cd="${esc(m.cd)}"${aberta ? ' open' : ''}><summary><span class="mais" aria-hidden="true"></span><span class="nm">${esc(m.nome)}${!nl && lojasVizinhas(m).length ? ' <span class="chip viz">loja na região</span>' : ''}${nl ? ` <span class="chip">${nl} loja${nl > 1 ? 's' : ''}</span>` : ''}</span><span class="rs"><b>${reais(m.consumo)}</b> por mês · ${mil(m.pop)} moradores</span><span class="ix" title="Índice geral (0 a 100)">${m.indice == null ? '—' : Math.round(m.indice)}</span></summary><div class="corpo">${aberta ? corpoCidade(m) : ''}</div></details>`; };
    el.innerHTML = `<div class="caixa"><h3>Cidades do estado de São Paulo</h3>
      <p class="mut peq">Totais da cidade inteira (Censo 2022, RAIS 2025, CNPJ ativo em 11/10/2026). <b>Potencial de consumo</b> = renda média do responsável × responsáveis com renda declarada, em R$ por mês: mede poder de compra, não é gasto medido nem faturamento. O índice (0 a 100) é a média simples das posições em potencial de consumo, renda, empregos e restaurantes por 10 mil moradores. Abra uma cidade com o <b>+</b>.</p>
      <div class="filtros"><input id="cidBusca" type="search" placeholder="Filtrar cidade" value="${esc(S.cid.q)}" aria-label="Filtrar cidade">
        <label class="peq">Ordenar por <select id="cidOrd">${CID_ORD.map(([k, r]) => `<option value="${k}"${S.cid.ord === k ? ' selected' : ''}>${r}</option>`).join('')}</select></label>
        <button id="cidDir" class="btn" title="Inverter a ordem" aria-label="Inverter a ordem">${S.cid.desc ? '▼ maior primeiro' : '▲ menor primeiro'}</button>
        <label class="peq"><input type="checkbox" id="cidSem" ${S.cid.semLoja ? 'checked' : ''}> só cidades sem loja</label></div>
      <p class="mut peq">${lista.length} de ${MUN.n} cidades</p>
      <div class="lista-cid">${lista.map(card).join('') || '<p class="mut">Nenhuma cidade.</p>'}</div></div>`;
    $('#cidBusca').oninput = debounce((e) => { S.cid.q = e.target.value; const pos = e.target.selectionStart; renderCidades(); const n = $('#cidBusca'); n.focus(); n.setSelectionRange(pos, pos); }, 200);
    $('#cidSem').onchange = (e) => { S.cid.semLoja = e.target.checked; renderCidades(); };
    $('#cidOrd').onchange = (e) => { S.cid.ord = e.target.value; S.cid.desc = S.cid.ord !== 'nome'; renderCidades(); };
    $('#cidDir').onclick = () => { S.cid.desc = !S.cid.desc; renderCidades(); };
    const irCidade = (cd) => { const idx = D.ruas_index.municipios.find((x) => x.cd === cd); if (idx) { map.setView([idx.lat, idx.lng], 12); $('#selMun').value = idx.cd; } };
    $$('details.cidade', el).forEach((d) => d.addEventListener('toggle', () => {
      const cd = d.dataset.cd; const m = MUN.rows.find((x) => x.cd === cd);
      if (d.open) { S.cid.abertas.add(cd); const c = $('.corpo', d); if (!c.firstChild) { c.innerHTML = corpoCidade(m); ligar(c, m); } } else S.cid.abertas.delete(cd);
    }));
    function ligar(c, m) {
      $$('.cidIr', c).forEach((b) => (b.onclick = () => irCidade(b.dataset.cd)));
      $$('tr.bi', c).forEach((tr) => { const ir = () => { const bb = bairrosDaCidade(m)[Number(tr.dataset.k)]; if (bb && bb.lat != null) map.setView([bb.lat, bb.lng], 14); }; tr.onclick = ir; tr.onkeydown = (e) => { if (e.key === 'Enter') ir(); }; });
    }
    $$('details.cidade[open]', el).forEach((d) => ligar($('.corpo', d), MUN.rows.find((x) => x.cd === d.dataset.cd)));
  }

  // ---------- lojas ----------
  function verTodas() {
    const pts = F.lojas.map((l) => [l.lat, l.lng]); if (!pts.length) return;
    map.fitBounds(L.latLngBounds(pts).pad(0.12), { maxZoom: 9 });
    const on = CONC_CATS.some(([k]) => S.cfg.conc[k]);
    toast(on ? 'Visão ampla: lojas e concorrentes marcados.' : 'Visão ampla das lojas. Marque categorias de concorrentes na aba Lojas para vê-los.');
  }
  const COMP_COLS = [['nome', 'Loja'], ['pop', 'Moradores'], ['renda', 'Renda média (R$)'], ['consumo', 'Consumo por mês (R$)'], ['emp', 'Empregos'], ['cpoke', 'Poke por perto']];
  function renderCompLojas() {
    const R = S.compR || 3; $('#compRaio').value = String(R);
    const linhas = F.lojas.map((l) => {
      const a = dem.agregar(l.lat, l.lng, R); const cn = concPerto(l.lat, l.lng, R); const ok = a.cobertura >= 0.5;
      return { id: l.id, nome: l.nome, cidade: l.cidade, pop: ok ? a.pop : null, renda: ok ? a.renda_media_resp : null, consumo: ok ? a.massa_renda : null, emp: ok ? a.empregos : null, rest: ok ? a.restaurantes : null, cpoke: cn.poke, ctot: cn.total };
    });
    const k = S.compOrd; const dir = S.compDesc ? -1 : 1;
    linhas.sort((x, y) => { const a = x[k], b = y[k]; if (k === 'nome') return dir * String(a).localeCompare(String(b), 'pt-BR'); if (a == null && b == null) return 0; if (a == null) return 1; if (b == null) return -1; return dir * (a - b); });
    const sel = typeof S.sel === 'string' && S.sel.startsWith('loja:') ? S.sel.slice(5) : null;
    const th = COMP_COLS.map(([c, r]) => `<th data-ord="${c}" class="ord${S.compOrd === c ? ' on' : ''}" tabindex="0" title="Ordenar">${r}${S.compOrd === c ? (S.compDesc ? ' ▼' : ' ▲') : ''}</th>`).join('');
    const tr = linhas.map((x) => `<tr data-id="${esc(x.id)}" class="${x.id === sel ? 'sel' : ''}"><td>${esc(x.nome)}</td><td>${mil(x.pop)}</td><td>${x.renda == null ? '—' : fmt(x.renda)}</td><td>${reais(x.consumo).replace('R$ ', '')}</td><td>${mil(x.emp)}</td><td title="${fmt(x.ctot)} concorrentes parecidos no total">${fmt(x.cpoke)}</td></tr>`).join('');
    $('#compLojas').innerHTML = `<div class="rolagem alta"><table class="cmp comp"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
  }
  function renderListaLojas() {
    renderCompLojas();
    const ef = lojasEf();
    const linhas = ef.map((l) => {
      const ign = S.ignorar.includes(l.id); const sem = l.lat == null;
      const tags = `${l.shopping ? '<span class="tag verm">shopping</span>' : ''}${l.duplicata_de ? '<span class="tag">duplicata</span>' : ''}${l.status_operacional === 'fechada' ? '<span class="tag verm">fechada</span>' : ''}${l.status_operacional === 'aberta_conferida' ? '<span class="tag az">aberta</span>' : ''}${l.grupo === 'outros' ? '<span class="tag">só LinkedIn</span>' : ''}${l.grupo === 'entorno' ? '<span class="tag az">entorno</span>' : ''}`;
      const ponto = sem ? `<button class="btn sec lojaMarcar" data-id="${esc(l.id)}">Marcar no mapa</button>` : esc(ROT_Q[l.geo_qualidade] || '');
      return `<tr><td class="lj-c"><input type="checkbox" class="lojaChk" data-id="${esc(l.id)}" ${ign ? '' : 'checked'} aria-label="Considerar ${esc(l.nome)}"></td>
        <td><a href="#" class="lojaIr" data-id="${esc(l.id)}">${esc(l.nome)}</a>
          <div class="mut peq">${esc([l.logradouro, l.numero].filter(Boolean).join(', '))}${l.logradouro ? ' · ' : ''}${esc(l.cidade)}</div>
          <div class="lj-t">${tags}<span class="mut peq">${ponto}</span></div></td></tr>`;
    }).join('');
    $('#listaLojas').innerHTML = `<table class="lj"><tbody>${linhas}</tbody></table>`;
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
    <p>Cobertura dos dados de demanda: o estado de São Paulo inteiro (645 municípios). Fora dele o app avisa e não calcula nota de demanda.</p>
    <h3>Lojas</h3>
    <p>Base de ${D.lojas.n} registros: o levantamento de 19/11/2026 (planilhas e LinkedIn), geocodificado no CNEFE do IBGE, conferido uma a uma no Google Maps no mesmo dia (consulta manual). Resultado: ${D.lojas.lojas.filter((l) => l.status_operacional === 'aberta_conferida').length} com ficha aberta, Valinhos fechada, e 2 duplicatas prováveis sem ficha (Campinas Cambuí – Galizia e Vinhedo incompleto). A conferência achou 4 lojas que faltavam no cadastro (Araraquara, Paulínia, Franca e Catanduva) e pôs no mapa Atibaia, Bauru e Bragança Paulista, que existiam sem ponto. Ficha do Google aberta não prova faturamento nem que a loja seguirá aberta: confirme com a operação. Endereços com número divergente entre fontes aparecem no arquivo <code>data/RELATORIO_QUALIDADE.md</code>.</p>
    <h3>Concorrentes</h3>
    <p>Mapa e contagens usam CNPJs ativos da Receita Federal (base de 11/10/2026) de restaurante, lanchonete ou açaí cujo <b>nome fantasia</b> indica poke, saudável/fit, açaí ou japonês, no estado de SP e a até 6 km de alguma loja. É uma aproximação: não aparece concorrente sem essas palavras no nome, nem quem ainda não tem CNPJ ativo, e endereço aproximado pode deslocar o ponto. Não entra na nota; é contexto.</p>
    <h3>O que a nota não é</h3>
    <p><b>A cidade como um todo:</b> o detalhe de cada local compara o raio com a cidade inteira (Censo 2022, RAIS 2025 e CNPJ). O “índice da cidade” é a média simples de quatro posições entre as cidades do app (população, renda, empregos e restaurantes por 10 mil moradores); serve para comparar cidades e não entra na nota do ponto.</p>
    <p><b>Bairro de um ponto:</b> o app descobre o bairro pelos endereços mais próximos: o bairro escrito pelas empresas ativas no CNPJ (Receita Federal, base de 11/10/2026) e, ao lado, o distrito/localidade dos CEPs (IBGE, CNEFE/Censo 2022). É uma referência aproximada, em quadras de uns 280 m. Nomes populares de empreendimento ou de região podem não ser bairro oficial.</p>
    <p><b>Potencial de consumo:</b> renda média do responsável × responsáveis com renda declarada (IBGE, Censo 2022), em R$ por mês. É uma medida de poder de compra, não de gasto: não usa a POF e não prevê faturamento. Nos bairros, o valor vem da grade de 500 m e é estimativa.</p>
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
  /** Busca bairros em TODOS os municípios da base (CNPJ ativo e CEP), com o do município escolhido primeiro. */
  function achaBairros(it, munSel) {
    if (!BR || !it.tokens || !it.tokens.length) return [];
    const B = BR.B; const alvo = it.tokens.join(' ');
    const casa = (nome, tk) => tk.every((w, i) => (i === tk.length - 1 ? nome.split(' ').some((p) => p.startsWith(w)) : (' ' + nome + ' ').includes(' ' + w + ' ')));
    const vistos = new Map();
    const add = (mun, nome, lat, lng, n) => { const k = mun + '|' + norm(nome); const v = vistos.get(k); if (!v || n > v.n) vistos.set(k, { mun, nome, lat, lng, n }); };
    let tk = it.tokens; let parecido = false;
    const varre = () => { B.fidx.forEach((x) => { if (casa(norm(x[1]), tk)) add(x[0], x[1], x[2], x[3], x[4]); }); B.idx.forEach((x) => { if (casa(norm(x[1]), tk)) add(x[0], x[1], x[2], x[3], x[4] / 1000); }); };
    varre();
    if (!vistos.size && it.tokens.length > 1) { tk = [it.tokens.slice().sort((a, b) => b.length - a.length)[0]]; parecido = tk[0].length >= 5; if (parecido) varre(); }
    const lista = Array.from(vistos.values());
    const rank = (v) => (norm(v.nome) === alvo ? 0 : norm(v.nome).startsWith(alvo) ? 1 : 2) * 10 + (v.mun === munSel ? 0 : 5);
    lista.sort((a, b) => rank(a) - rank(b) || b.n - a.n);
    return lista.slice(0, 6).map((v) => ({ lat: v.lat, lng: v.lng, nome: 'Bairro ' + v.nome, ref: v.nome + ', ' + v.mun, linha: 'Bairro ' + v.nome + ' · ' + v.mun, sub: (parecido ? 'nome parecido, não é igual ao que você digitou · ' : '') + (v.mun !== munSel ? 'em outro município · ' : '') + 'centro aproximado (média dos endereços do bairro)', precisao: 'bairro_aproximado' }));
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
    achaBairros(it, d.mun).forEach((o) => out.push(o));
    if (!out.length) { ul.innerHTML = '<li class="mut peq" style="padding:6px">Não achei esse nome na base oficial (ruas e bairros do CEP e do CNPJ). Nomes populares de empreendimento ou de região (por exemplo, “Jardim das Perdizes” em São Paulo) muitas vezes não são bairro oficial. Tente a rua, ou use <b>Marcar no mapa</b>: o app diz em qual bairro oficial o pino caiu.</li>'; return; }
    out.forEach((o, k) => { const li = document.createElement('li'); li.innerHTML = `<button data-k="${k}">${esc(o.linha || o.nome)}<small>${esc(o.sub || '')}</small></button>`; li.firstChild.onclick = () => escolher(o); ul.appendChild(li); });
  }
  function escolher(o) {
    $('#resBusca').innerHTML = '';
    S.nova = { lat: +o.lat.toFixed(6), lng: +o.lng.toFixed(6), precisao: o.precisao, ref: o.ref };
    $('#novaNome').value = (o.nome || '').slice(0, 80); S.novaAuto = $('#novaNome').value;
    colocarPinoBusca(); map.setView([S.nova.lat, S.nova.lng], o.precisao === 'bairro_aproximado' ? 15 : 16); atualizarForm();
  }
  function colocarPinoBusca() {
    gBusca.clearLayers(); if (!S.nova) return;
    const m = L.marker([S.nova.lat, S.nova.lng], { icon: L.divIcon({ className: '', html: '<div class="pin-busca"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), draggable: true, title: 'Arraste até o imóvel' }).addTo(gBusca);
    m.on('dragend', () => { const p = m.getLatLng(); S.nova.lat = +p.lat.toFixed(6); S.nova.lng = +p.lng.toFixed(6); S.nova.precisao = 'pino_manual'; nomeAuto(); atualizarForm(); });
  }
  /** Mantém o nome sugerido (bairro do pino) enquanto o usuário não o trocou. */
  function nomeAuto() {
    const b = bairroNome(bairroDe(S.nova.lat, S.nova.lng)); const campo = $('#novaNome');
    if (b && (!campo.value || campo.value === S.novaAuto || campo.value === 'Ponto marcado')) { campo.value = b; S.novaAuto = b; }
  }
  function cidadeResumo(lat, lng) {
    const m = cidadeDe(lat, lng); if (!m) return '';
    const lj = lojasNaCidade(m);
    return `<div class="bairro-pin"><b>Cidade:</b> ${esc(m.nome)} · ${fmt(m.pop)} moradores · ${m.rkPop}ª em população entre ${MUN.n} cidades<br><span class="mut">Potencial de consumo ${reais(m.consumo)} por mês · renda média R$ ${fmt(m.renda)} · ${fmt(m.empregos)} empregos formais · ${lj.length ? lj.length + ' loja(s) Mana Poke' : 'sem loja Mana Poke avaliada'}</span></div>`;
  }
  function atualizarForm() {
    const f = $('#formNova'); f.hidden = !S.nova; if (!S.nova) return;
    const b = bairroDe(S.nova.lat, S.nova.lng);
    $('#novaPos').innerHTML = `<div class="bairro-pin"><b>Bairro:</b> ${esc(bairroLinha(b))}${b && b.local && b.local !== b.bairro ? `<br><span class="mut">Distrito/localidade pelos CEPs: ${esc(b.local)}</span>` : ''}${b && b.dist != null && b.dist > 0.6 ? '<br><span class="mut">Bairro do endereço mais próximo (a ' + fmt(b.dist, 1) + ' km).</span>' : ''}</div>${cidadeResumo(S.nova.lat, S.nova.lng)}<div class="mut peq">${fmt(S.nova.lat, 5)}, ${fmt(S.nova.lng, 5)} · ${esc(ROT_P[S.nova.precisao] || '')}. Arraste o pino preto até o imóvel para mais precisão.</div>`;
  }
  function salvarNova() {
    if (!S.nova) return;
    const nome = $('#novaNome').value.trim().slice(0, 80) || 'Nova candidata';
    const bb = bairroDe(S.nova.lat, S.nova.lng); const refer = S.nova.ref && S.nova.ref !== 'ponto marcado no mapa' ? S.nova.ref : (bb ? bairroLinha(bb) + ' (ponto marcado no mapa)' : 'ponto marcado no mapa');
    const c = { id: 'u-' + Date.now().toString(36), nome, referencia: refer, lat: S.nova.lat, lng: S.nova.lng, precisao: S.nova.precisao, origem: 'usuario', imovel: null, aluguel: '', obs: '' };
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
    if (S.modo.tipo === 'nova') { S.nova = { lat, lng, precisao: 'pino_manual', ref: 'ponto marcado no mapa' }; if (!$('#novaNome').value) $('#novaNome').value = 'Ponto marcado'; nomeAuto(); colocarPinoBusca(); atualizarForm(); }
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
    if (a === 'det') renderDetalhe(); if (a === 'cen') renderCenario(); if (a === 'lojas') renderListaLojas(); if (a === 'cid') renderCidades(); if (a === 'sobre') $('#sobre').innerHTML = SOBRE();
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
    $('#relatorio').innerHTML = `<h1><img src="assets/logo-mana-poke.png" alt="Mana Poke" style="height:48px;vertical-align:middle;margin-right:10px">Relatório de expansão</h1><p>Gerado em ${new Date().toLocaleDateString('pt-BR')}. Lojas avaliadas: ${F.lojas.length} de ${F.total}${S.cfg.shopping ? '' : ' (lojas de shopping excluídas)'}${F.naoAvaliadas.length ? '; cobertura parcial: ' + F.naoAvaliadas.map((l) => esc(l.nome)).join(', ') + ' sem ponto no mapa' : ''}. Raio(s): ${rs.join(' e ')} km.</p>
      <h2>Ranking das candidatas</h2><table><thead><tr><th>Candidata</th>${rs.map((R) => `<th>Nota ${R} km</th><th>% nova</th><th>Moradores</th><th>Renda (R$)</th><th>Empregos</th>`).join('')}</tr></thead><tbody>${linhas}</tbody></table>
      <p>* nota parcial: falta algum componente (por exemplo, a viabilidade do imóvel). Pontos marcados como aproximados devem ser confirmados no local.</p>
      ${c ? `<h2>Detalhe: ${esc(c.nome)}</h2>${rs.map((R) => { const a = analisar(c, R); return `<section><h3>${R} km — nota ${fmt(a.n.nota)}</h3><ul>${a.n.componentes.map((k) => `<li>${esc(k.rotulo)} (peso ${k.peso}): ${k.disponivel ? fmt(k.valor) + ' de 100' : 'indisponível'} — fonte: ${esc(k.fonte)}</li>`).join('')}</ul><p>Área nova ${fmt(a.r.area_nova_km2, 1)} km² (${fmt(a.r.pct_nova)}%); já coberta ${fmt(a.r.area_coberta_km2, 1)} km². Lojas dentro do raio: ${a.r.lojas_dentro.map((x) => esc(x.nome) + ' (' + fmt(x.d, 1) + ' km)').join('; ') || 'nenhuma'}.</p></section>`; }).join('')}` : ''}
      <h2>Fontes e limites</h2><p>Moradores, domicílios e renda: IBGE, Censo 2022. Empregos: RAIS (MTE). Restaurantes e academias: CNPJ (Receita Federal, ativos). Lojas: levantamento de 19/11/2026, geocodificado no CNEFE do IBGE; nenhuma confirmada como aberta. A nota mede potencial de demanda e cobertura, não prevê faturamento. Distâncias em linha reta.</p>`;
    window.print();
  }

  // ---------- coordenação ----------
  function atualizarTudo() { filtrar(); renderTopo(); renderLojasMapa(); renderConc(); renderTabela(); renderCandMapa(); renderSelMapa(); if (S.aba === 'det') renderDetalhe(); if (S.aba === 'cen') renderCenario(); if (S.aba === 'lojas') renderListaLojas(); if (S.aba === 'cid') renderCidades(); }
  function aplicarCfgNaTela() {
    $$('input[name=raio]').forEach((i) => (i.checked = i.value === S.cfg.raio)); $('#chkShopping').checked = S.cfg.shopping; $('#chkDup').checked = S.cfg.dup; $('#chkRotulos').checked = S.cfg.rotLoja; $('#chkRotCand').checked = S.cfg.rotCand;
    $$('.fGrupo').forEach((i) => (i.checked = !!S.cfg.grupos[i.value])); $$('.fConc').forEach((i) => (i.checked = !!S.cfg.conc[i.value])); $('#chkCirculos').checked = S.cfg.circulos; $('#chkUniao').checked = S.cfg.uniao; $('#selDemanda').value = S.cfg.demanda; $('#selOrdem').value = S.cfg.ordem; renderPesos();
  }
  function ligarDivisor() {
    const root = document.documentElement; const dv = $('#divisor'); const KEY = 'mp_painel_w';
    const limita = (w) => Math.max(380, Math.min(Math.round(window.innerWidth * 0.7), w));
    const atual = () => parseInt(getComputedStyle(root).getPropertyValue('--pw'), 10) || 520;
    try { const w = parseInt(localStorage.getItem(KEY), 10); if (w) root.style.setProperty('--pw', limita(w) + 'px'); } catch (e) { /* sem armazenamento */ }
    let arrasta = false;
    dv.addEventListener('pointerdown', (e) => { arrasta = true; dv.setPointerCapture(e.pointerId); e.preventDefault(); });
    dv.addEventListener('pointermove', (e) => { if (arrasta) root.style.setProperty('--pw', limita(window.innerWidth - e.clientX) + 'px'); });
    dv.addEventListener('pointerup', () => { arrasta = false; try { localStorage.setItem(KEY, String(atual())); } catch (e) { /* ignore */ } });
    dv.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); root.style.setProperty('--pw', limita(atual() + (e.key === 'ArrowLeft' ? 40 : -40)) + 'px'); } });
  }
  function ligar() {
    $$('input[name=raio]').forEach((i) => i.addEventListener('change', () => { S.cfg.raio = i.value; salvar(); atualizarTudo(); }));
    $('#chkShopping').onchange = (e) => { S.cfg.shopping = e.target.checked; salvar(); atualizarTudo(); };
    $('#chkDup').onchange = (e) => { S.cfg.dup = e.target.checked; salvar(); atualizarTudo(); };
    $('#chkRotulos').onchange = (e) => { S.cfg.rotLoja = e.target.checked; salvar(); renderLojasMapa(); };
    $('#chkRotCand').onchange = (e) => { S.cfg.rotCand = e.target.checked; salvar(); renderCandMapa(); };
    $$('.fGrupo').forEach((i) => (i.onchange = () => { S.cfg.grupos[i.value] = i.checked; salvar(); atualizarTudo(); }));
    $$('.fConc').forEach((i) => (i.onchange = () => { S.cfg.conc[i.value] = i.checked; salvar(); renderConc(); atualizarLegenda(); }));
    $('#btnVerTodas').onclick = verTodas;
    $('#compRaio').onchange = (e) => { S.compR = Number(e.target.value); renderCompLojas(); };
    $('#compLojas').addEventListener('click', (e) => {
      const th = e.target.closest('[data-ord]'); if (th) { const k = th.dataset.ord; if (S.compOrd === k) S.compDesc = !S.compDesc; else { S.compOrd = k; S.compDesc = k !== 'nome'; } renderCompLojas(); return; }
      const tr = e.target.closest('tr[data-id]'); if (tr) { const l = lojasEf().find((x) => x.id === tr.dataset.id); if (l && l.lat != null) { map.setView([l.lat, l.lng], 14); verLoja(l, false); } }
    });
    $('#chkCirculos').onchange = (e) => { S.cfg.circulos = e.target.checked; salvar(); renderLojasMapa(); };
    $('#chkUniao').onchange = (e) => { S.cfg.uniao = e.target.checked; salvar(); renderLojasMapa(); };
    $('#selDemanda').onchange = (e) => { S.cfg.demanda = e.target.value; limites = null; salvar(); renderDemanda(); };
    $('#selBase').onchange = (e) => { trocarBase(e.target.value); salvar(); };
    $('#selOrdem').innerHTML = Object.keys(ORDENS).map((k) => `<option value="${k}">${esc(ORDENS[k])}</option>`).join('');
    $('#selOrdem').onchange = (e) => { S.cfg.ordem = e.target.value; salvar(); renderTabela(); };
    $$('#abas button').forEach((b) => (b.onclick = () => setAba(b.dataset.aba)));
    ligarDivisor();
    $('#btnBuscar').onclick = buscar; $('#busca').onkeydown = (e) => { if (e.key === 'Enter') buscar(); };
    $('#btnMarcar').onclick = () => iniciarModo({ tipo: 'nova' }, 'Clique no mapa onde fica o ponto candidato.');
    $('#btnSalvarNova').onclick = salvarNova; $('#btnCancelarNova').onclick = () => { S.nova = null; gBusca.clearLayers(); atualizarForm(); };
    $('#tabelaCand').addEventListener('click', (e) => {
      const rm = e.target.closest('.rm');
      if (rm) { const c = S.cand.find((x) => x.id === rm.dataset.id); if (c && confirm('Remover "' + c.nome + '" da lista?')) { S.cand = S.cand.filter((x) => x !== c); S.cen = S.cen.filter((x) => x !== c.id); if (S.sel === c.id) S.sel = null; salvar(); atualizarTudo(); } return; }
      if (e.target.closest('#btnLimparLista')) { if (confirm('Remover todos os ' + S.cand.length + ' locais da lista? Isso não apaga as lojas nem os ajustes.')) { S.cand = []; S.cen = []; S.sel = null; gBusca.clearLayers(); salvar(); atualizarTudo(); toast('Lista limpa.'); } return; }
      const chk = e.target.closest('.cenChk');
      if (chk) { const id = chk.dataset.id; if (chk.checked) { if (!S.cen.includes(id)) S.cen.push(id); } else S.cen = S.cen.filter((x) => x !== id); salvar(); if (S.aba === 'cen') renderCenario(); renderSelMapa(); return; }
      if (e.target.closest('.cen') || e.target.closest('.rm')) return;
      const tr = e.target.closest('.item.cand'); if (tr) selecionar(tr.dataset.id, true);
    });
    $('#tabelaCand').addEventListener('keydown', (e) => { if (e.key !== 'Enter' && e.key !== ' ') return; const tr = e.target.closest('.item.cand'); if (tr && e.target === tr) { e.preventDefault(); selecionar(tr.dataset.id, true); } });
    $('#listaLojas').addEventListener('click', (e) => {
      const chk = e.target.closest('.lojaChk'); if (chk) { const id = chk.dataset.id; const i = S.ignorar.indexOf(id); if (!chk.checked && i < 0) S.ignorar.push(id); if (chk.checked && i >= 0) S.ignorar.splice(i, 1); salvar(); atualizarTudo(); return; }
      const ir = e.target.closest('.lojaIr'); if (ir) { e.preventDefault(); const l = lojasEf().find((x) => x.id === ir.dataset.id); if (l && l.lat != null) { map.setView([l.lat, l.lng], 15); verLoja(l, false); } else toast('Esta loja ainda não tem ponto no mapa.'); return; }
      const mk = e.target.closest('.lojaMarcar'); if (mk) iniciarModo({ tipo: 'loja', id: mk.dataset.id }, 'Clique no mapa onde fica esta loja.');
    });
    $('#btnPesosPadrao').onclick = () => { S.cfg.pesos = Object.assign({}, DM.PESOS_PADRAO); cache.clear(); renderPesos(); refrescarPesos(); };
    $('#btnExpCsv').onclick = exportarCsv; $('#btnExpGeo').onclick = exportarGeo; $('#btnExpJson').onclick = exportarJson; $('#btnImprimir').onclick = imprimir;
    $('#btnImpJson').onclick = () => $('#fileImp').click();
    $('#fileImp').onchange = (e) => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => importarJson(String(r.result)); r.readAsText(f); e.target.value = ''; };
    $('#btnLimpar').onclick = () => { if (confirm('Apagar candidatas, ajustes e pesos salvos neste navegador?')) { try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ } S.cfg = PADRAO(); S.cand = []; S.ajLojas = {}; S.ignorar = []; S.cen = []; S.sel = null; aplicarCfgNaTela(); atualizarTudo(); toast('Dados apagados.'); } };
  }

  // ---------- início ----------
  const salvo = lerArmazenado();
  if (salvo && salvo.v === 1) {
    if (salvo.cfg) { S.cfg = Object.assign(PADRAO(), salvo.cfg, { pesos: Object.assign({}, DM.PESOS_PADRAO, salvo.cfg.pesos || {}), grupos: Object.assign({ rmsp: true, entorno: true, outros: true }, salvo.cfg.grupos || {}), conc: Object.assign({ poke: true, saudavel: false, acai: false, japones: false }, salvo.cfg.conc || {}) }); }
    S.cand = Array.isArray(salvo.cand) ? salvo.cand.filter((c) => c && brasilOk(+c.lat, +c.lng)) : [];
    if (!salvo.semV2) { S.cand = S.cand.filter((c) => !(c.origem === 'v7' && c.imovel == null && !c.obs && !c.aluguel && c.precisao === 'area_aproximada')); S.cen = S.cen.filter((id) => S.cand.some((c) => c.id === id)); } S.ajLojas = salvo.ajLojas || {}; S.ignorar = salvo.ignorar || []; S.cen = salvo.cen || [];
  } else S.cand = [];
  trocarBase(bases[S.cfg.base] ? S.cfg.base : 'osm');
  ligar(); aplicarCfgNaTela(); filtrar(); renderTopo(); renderLojasMapa(); renderConc(); renderTabela(); renderCandMapa(); renderDemanda(); atualizarForm(); atualizarLegenda();
  setTimeout(() => map.invalidateSize(), 200);
  if (window.ResizeObserver) new ResizeObserver(debounce(() => { map.invalidateSize(); if (S.cfg.demanda !== 'off') renderDemanda(); }, 120)).observe($('#mapaBox'));
  window.MPApp = { S, analisar, filtrar, map }; // útil para testes no navegador
})();
