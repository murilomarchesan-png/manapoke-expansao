# Mana Poke · Expansão

Mapa interativo para escolher onde abrir a próxima loja Mana Poke: raio de **3 km e 5 km**, **sobreposição** com as lojas existentes (área contada uma vez só), **demanda** ao redor e uma **nota de 0 a 100 explicável** por ponto candidato.

Página estática, sem servidor e sem cadastro. Todos os dados são públicos (IBGE, Receita Federal, RAIS/MTE, OpenStreetMap).

## Como abrir

- **Online (GitHub Pages):** abra o endereço do repositório publicado.
- **No computador:** baixe o repositório e dê duplo clique em `index.html`. Funciona sem internet, exceto o fundo do mapa.
- **Testes:** `npm install` e depois `npm test`.

## O que dá para fazer

| Recurso | Como |
|---|---|
| Raio de **3 km**, **5 km** ou **os dois** | Botões no topo. Os dois raios aparecem lado a lado no ranking. |
| **Incluir lojas de shopping** | Caixa no topo. Desmarcada, as lojas de shopping somem do mapa e de todos os cálculos. "Não classificado" não é tratado como loja de rua. |
| Lojas **sem ponto no mapa** | O topo mostra "cobertura parcial" com os nomes. A sobreposição só usa as lojas localizadas. Na aba **Lojas** dá para marcar o ponto no mapa. |
| **Bairro do ponto** | Ao marcar ou arrastar um pino, o app mostra o bairro (CNPJ) e o distrito/localidade (CEP). A busca acha ruas e também bairros de qualquer município da base. As lojas e as candidatas mostram o nome com o bairro no mapa. |
| **A cidade como um todo** | No detalhe de cada local, o raio é comparado com a cidade inteira (moradores, renda, empregos, restaurantes, academias), com a posição da cidade entre as 645 do estado e as lojas Mana Poke que ela já tem. A aba **Cidades** lista as 645 cidades em cartões que abrem com **+**: potencial de consumo, moradores, renda, empregos, restaurantes, academias e os 4 bairros com mais moradores (estimados pela grade de 500 m). Ordena por potencial de consumo, moradores, renda, empregos ou índice, com filtro "só cidades sem loja".
| **Potencial de consumo** | Renda média do responsável × responsáveis com renda declarada, em R$ por mês (Censo 2022). É proxy de poder de compra da região, **não** é gasto medido nem faturamento. Aparece no raio, na cidade e nos bairros. | |
| **Locais escolhidos** | A lista começa vazia: você adiciona buscando uma rua, um bairro, coordenadas ou clicando no mapa. Arraste o pino até o imóvel. |
| **Nota** | Aba **Detalhe**: cada componente com valor, fonte e percentil. Pesos ajustáveis na aba **Ajustes**. |
| **Cenário** | Marque 2 ou 3 candidatas na coluna "Cen.": área nova do conjunto e canibalização entre elas. |
| **Camada de demanda** | Ajustes: moradores, renda, empregos, academias ou restaurantes por km². |
| **Exportar** | JSON (completo, para o sócio importar), CSV para Excel, GeoJSON e relatório para imprimir. |

Suas candidatas e ajustes ficam salvos só no navegador. Use **Exportar tudo (JSON)** para levar a outro computador ou compartilhar com o sócio.

## Como é calculado

- **Distância:** linha reta (Haversine). **Círculos:** geodésicos reais (área teórica 28,27 km² e 78,54 km²). **Sobreposição:** união e diferença de polígonos, sem somar a mesma área duas vezes.
- **Dentro do raio × círculos sobrepostos:** uma loja a 4 km está *fora* do raio de 3 km da candidata, mas os círculos de 3 km das duas se sobrepõem. O app mostra as duas coisas separadas.
- **Nota (padrão):** renda 25, moradores 20, comércio e emprego 15, aderência ao público saudável 15, área nova 15, viabilidade do imóvel 10. Cada indicador de demanda vira um percentil entre pontos urbanos da área coberta. Componente sem dado sai da conta e a nota fica marcada como **parcial**.
- **Viabilidade do imóvel** é uma nota sua (0 a 10). Aluguel por bairro e fluxo de pessoas **não entram** porque não há fonte gratuita confiável para o Brasil.
- **Aderência ao público saudável** usa academias ativas (CNAE 9313-1/00) como indicador indireto. Não existe código de atividade de "público saudável".

## Fontes

| Dado | Fonte |
|---|---|
| Moradores, domicílios, faixa etária, renda do responsável | IBGE, Censo 2022, por setor censitário |
| Empregos formais | RAIS 2025 (Ministério do Trabalho), vínculos por CEP |
| Restaurantes, lanchonetes e academias ativos | Receita Federal, CNPJ (base de 11/10/2026) |
| Endereços e coordenadas das lojas, ruas | IBGE, CNEFE (Censo 2022) e CEP |
| Totais da cidade inteira | IBGE (Censo 2022: moradores, domicílios, renda, faixa etária, área), RAIS 2025 e CNPJ ativo (restaurantes e academias) |
| Bairro de cada ponto e busca por bairro | Receita Federal, CNPJ (bairro das empresas ativas, base de 11/10/2026), e distrito/localidade dos CEPs (IBGE, CNEFE) |
| Fundo do mapa | OpenStreetMap, CARTO ou Esri |

A grade de demanda tem células de 500 m e cobre o **estado de São Paulo inteiro (645 municípios)**. Fora dele o app avisa e não calcula nota de demanda.

## Validação

- Geometria: área do círculo igual a πr²; interseção de dois círculos igual à fórmula analítica e a uma amostragem independente em grade; conferência com PostGIS com diferença de 0,2% (`tests/geo.test.js`).
- Demanda: a grade foi comparada, em 20 pontos (lojas) e 2 raios, com a consulta exata por interseção de setores: erro mediano de **0,3% em moradores, 0,9% em empregos e 0,2% em renda**. O maior erro foi 11% em empregos de um ponto, por causa de um CEP grande na borda do círculo. Tabela completa em [`data/VALIDACAO_DEMANDA.md`](data/VALIDACAO_DEMANDA.md).
- Dados: 27 testes automáticos, incluindo integridade da base de lojas e escape de HTML.

## Limites que você precisa saber

1. **Nenhuma loja está confirmada como aberta.** A base de 58 registros vem de planilhas e LinkedIn. Cada loja aparece como "não verificada" e dá para tirá-la dos cálculos.
2. **3 lojas não têm ponto no mapa** (Atibaia, Bauru, Bragança Paulista): faltam rua ou número. Enquanto isso o app mostra "cobertura parcial". A de Vinhedo "incompleta" está oculta como duplicata de Vinhedo.
3. **Pontos aproximados:** as áreas do mapa anterior (arquivo `data/candidatas.json`, não usadas pela tela) são pontos de **área**, não imóveis. O endereço buscado é o ponto médio do **trecho** da rua. Arraste o pino até o imóvel antes de decidir.
4. **Possíveis duplicatas e divergências** da base (Campinas Cambuí, Santana 435/436 e outras) estão em [`data/RELATORIO_QUALIDADE.md`](data/RELATORIO_QUALIDADE.md).
5. **Bairro é aproximado:** vem dos endereços mais próximos (quadras de uns 280 m) e segue o nome escrito pelas empresas no CNPJ; nomes populares (por exemplo, de empreendimentos) podem não existir. **Nomes de rua sem acento** na busca (vêm assim da base oficial). A busca ignora acentos, então "Bragança" e "braganca" funcionam igual.
6. A nota mede **potencial de demanda e cobertura**, não prevê faturamento.

## Estrutura

```
index.html         tela
src/geo.js         distância, círculos, união e diferença de áreas, cenários
src/demanda.js     agregação da grade e nota explicável
src/app.js         interface
vendor/            Leaflet 1.9.4 e polygon-clipping 0.15.7 (sem CDN)
data/              municipios (totais por cidade), lojas, candidatas, grade de demanda, referências, ruas por município, bairros
tests/             testes automáticos
```

Os arquivos de `data/` existem em `.json` (leitura por máquina) e `.js` (para abrir `index.html` direto do computador).

## Atualizar os dados

A grade, as referências e o índice de ruas foram gerados offline a partir das bases oficiais acima. Para atualizar a lista de lojas, edite `data/lojas.json` (e o `.js` correspondente) e rode `npm test`.
