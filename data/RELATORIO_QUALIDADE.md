# Relatório de qualidade da base de lojas

Gerado a partir de `lojas_base.psv` (registros do levantamento de 19/11/2026 mais as lojas achadas na conferência pelo Google Maps) e do CNEFE (IBGE, Censo 2022).

## Resumo

- Registros: **62**  (Grande SP: 24, entorno: 19, só LinkedIn: 19)
- Status operacional (conferência manual no Google Maps em 19/11/2026): **59 abertas**, 1 fechada(s), 2 não encontrada(s) (duplicatas prováveis).
- Com ponto no mapa: **61**; pendentes: **1**

| Qualidade do ponto | Lojas |
|---|---|
| Endereço (número exato no CNEFE) | 47 |
| Endereço (número vizinho no CNEFE) | 6 |
| Ponto do shopping (OpenStreetMap) | 1 |
| Ponto da ficha do Google Maps | 7 |
| Pendente | 1 |

## Pendentes (marcar o ponto no mapa)

- **Vinhedo (endereço incompleto)** (Vinhedo): endereço incompleto  — Endereço incompleto; possível duplicata de Vinhedo

## Possíveis duplicatas

- `campinas-cambui-galizia` x `campinas-cambui` (apontado no levantamento)
- `vinhedo-incompleto` x `vinhedo` (apontado no levantamento)

## Endereços com número divergente entre fontes

- **Campinas – Cambuí**: Número diverge entre fontes: 207 x 447
- **Santana**: Número diverge entre fontes: 435 x 436

## Concordância com as coordenadas aproximadas anteriores (V7)

| Loja | Distância entre CNEFE e coordenada anterior |
|---|---|
| Alphaville | 0.72 km |
| Guarulhos | 0.72 km |
| Mogi das Cruzes | 1.04 km |
| Santo André | 0.57 km |
| São Bernardo | 0.97 km |
| São Caetano | 0.42 km |
| Brooklin | 2.41 km |
| Butantã | 0.21 km |
| Chácara Flora | 0.01 km |
| Higienópolis | 0.43 km |
| Ipiranga | 0.39 km |
| Moema | 0.71 km |
| Portal do Morumbi | 1.02 km |
| Santana | 1.64 km |
| Shopping Eldorado | 0.16 km |
| Tatuapé | 0.88 km |
| Vila Andrade | 0.95 km |
| Vila Leopoldina | 0.68 km |
| Vila Madalena | 0.37 km |
| Vila Mariana | 0.64 km |
| Vila Prudente | 1.21 km |

## Pontos com ressalva

- **Granja Viana**: CNEFE não tem número (s/n). Ponto é o centro do shopping no OSM; conferir a loja 201B no local.
- **Jundiaí – Anhangabaú**: número vizinho no CNEFE (3320 no lugar de 3333); erro típico de dezenas de metros.
- **Santos – Aparecida**: número vizinho no CNEFE (83 no lugar de 80); erro típico de dezenas de metros.
- **São Carlos**: número vizinho no CNEFE (1352 no lugar de 1342); erro típico de dezenas de metros.
- **São José do Rio Preto**: número vizinho no CNEFE (3351 no lugar de 3355); erro típico de dezenas de metros.
- **Brooklin**: número vizinho no CNEFE (773 no lugar de 774); erro típico de dezenas de metros.
- **Vila Madalena**: número vizinho no CNEFE (218 no lugar de 223); erro típico de dezenas de metros.

## Só LinkedIn (evidência fraca)

- Araçatuba Centro
- Bauru
- Campinas Cambuí - Galízia
- Itu
- Marília
- Piracicaba
- Ribeirão Preto Jardim Botânico
- Ribeirão Preto Jardim Sumaré
- Rio Claro
- Sorocaba
- São Carlos
- São José do Rio Preto
- São José dos Campos
- Taubaté
- Vinhedo (endereço incompleto)
- Araraquara
- Paulínia
- Franca
- Catanduva
