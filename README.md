# views-bots

Classificador explicável para séries horárias de views. Recebe as views (e, se houver, as curtidas) hora a hora de um conteúdo e responde `organic`, `suspicious` ou `inconclusive`, com um motivo legível e os sinais usados. Inclui um dataset sintético reproduzível (sem rede) e um comando que mede a taxa de falso positivo citada abaixo.

Stack: Node 20+, TypeScript estrito, Fastify 5, Vitest. Sem banco e sem chamadas externas.

## Como rodar

```bash
npm install
npm test                 # inclui o teste que confere o número deste README
npm run typecheck
npm start                # API em http://127.0.0.1:3000 (PORT/HOST configuráveis)
npm run evaluate         # gera o dataset e mede FP/detecção
npm run evaluate -- --write-readme   # regrava o bloco de métricas abaixo
npm run dataset          # grava o dataset em data/dataset.json (ignorado pelo git)
```

`npm run evaluate -- --seed 7 --per-scenario 500` roda com outra semente/tamanho (não muda o README, a menos que use `--write-readme`).

## API

### `POST /v1/classify`

| Campo | Tipo | |
| --- | --- | --- |
| `startAt` | ISO-8601, hora cheia | início da primeira hora da série |
| `views` | inteiros >= 0 | views de cada hora (não acumulado), até 90 dias |
| `likes` | inteiros >= 0, opcional | curtidas de cada hora, mesmo tamanho de `views` |
| `utcOffsetMinutes` | inteiro, opcional (padrão 0) | fuso da audiência, usado para o ciclo dia/noite |

Horas que ainda não terminaram segundo o relógio do servidor são descartadas (`ignoredIncompleteHours`): uma hora parcial pareceria um "fim abrupto". O relógio é injetável (`buildApp({ clock })`, `fixedClock()` em `src/clock.ts`).

Exemplo com uma série do dataset (`bought_plateau-0000`, 168 horas):

```bash
npm run dataset
node -e "const d=require('./data/dataset.json');process.stdout.write(JSON.stringify(d.find(s=>s.id==='bought_plateau-0000').input))" \
  | curl -s localhost:3000/v1/classify -H 'content-type: application/json' -d @-
```

```json
{ "startAt": "2026-01-05T03:00:00.000Z", "utcOffsetMinutes": -180, "views": [44, 45, 27, "... 168 valores"], "likes": [4, 4, 4, "..."] }
```

Resposta (`signals` resumido aos dois primeiros):

```json
{
  "classification": "suspicious",
  "reason": "Pico de 15h com ~9557 views acima da linha de base. Padrão de views compradas: engajamento desacoplado — o pico trouxe 0% das curtidas extras esperadas pela taxa usual de 6.37%; platô plano — 15h no topo variando 1.38x o ruído esperado (CV 6.9%); ignora o ritmo dia/noite — o excesso acompanha 16% (±34 p.p.) do ritmo dia/noite da audiência, que varia 4.6x dentro do pico (orgânico fica perto de 100%); início abrupto — levou 0h para sair da linha de base e chegar a 80% do pico; fim abrupto — levou 0h para cair de 80% do pico até a linha de base.",
  "score": 9,
  "signalsUsed": ["engagement_decoupling", "flat_plateau", "rhythm_mismatch", "abrupt_onset", "abrupt_stop"],
  "signals": [
    { "id": "engagement_decoupling", "label": "Engajamento desacoplado", "status": "fired", "weight": 3, "value": -0.005, "threshold": "<= 0.3", "detail": "O pico trouxe 0% das curtidas extras esperadas pela taxa usual de 6.37%." },
    { "id": "flat_plateau", "label": "Platô plano", "status": "fired", "weight": 2, "value": 1.383, "threshold": "<= 1.5", "detail": "15h no topo variando 1.38x o ruído esperado (CV 6.9%)." }
  ],
  "spike": { "startAt": "2026-01-08T08:00:00.000Z", "endAt": "2026-01-08T23:00:00.000Z", "hours": 15, "peakAt": "2026-01-08T09:00:00.000Z", "peakViews": 735, "peakExcess": 722, "excessViews": 9557 },
  "analyzedHours": 168,
  "ignoredIncompleteHours": 0,
  "analyzedAt": "2026-10-10T06:39:32.627Z"
}
```

Caso em que o classificador prefere não acusar (mesma entrega plana, mas as curtidas acompanham o pico):

```json
{
  "classification": "inconclusive",
  "reason": "Pico de 12h com ~18099 views acima da linha de base. A forma lembra entrega comprada (platô plano — ...; início abrupto — ...; fim abrupto — ...), mas o engajamento acompanha o pico: o pico trouxe 104% das curtidas extras esperadas pela taxa usual de 4.87%. Prefiro não acusar: pode ser destaque de plataforma, live ou compra combinada de curtidas."
}
```

Erros: `400` para corpo fora do schema; `422` para série incoerente (`startAt` fora da hora cheia ou no futuro, `likes` de tamanho diferente).

### `GET /v1/criteria`

Devolve os sinais, pesos, regras de decisão, limiares e a lista do que não é detectado (mesmo conteúdo da seção abaixo, gerado de `src/domain/criteria.ts`).

### `GET /health`

`{ "status": "ok", "now": "<relógio do servidor>" }`

## Critérios

Linha de base: com 96h ou mais, mediana das views em cada hora local do dia (captura o ciclo dia/noite da própria audiência e é robusta a um pico que ocupa menos da metade dos dias); com menos, mediana global. Ruído: MAD relativo das horas fora do pico combinado com ruído de Poisson. Um pico só existe se o maior excesso for >= 6x o ruído, >= 50% da linha de base média e >= 20 views. A janela do pico é a região contígua em volta do máximo com excesso >= 20% do pico (escalado pelo perfil horário, para não cortar a madrugada de um pico orgânico).

| Sinal | Peso | Dispara quando | Por que | Contraexemplo orgânico |
| --- | ---: | --- | --- | --- |
| `engagement_decoupling` | 3 | curtidas extras do pico <= 30% do esperado pela taxa usual | views compradas não curtem | viralizar fora da bolha reduz a taxa, mas raramente abaixo de 30% |
| `flat_plateau` | 2 | >= 3h acima de 50% do pico, topo >= 4x o ruído, desvio <= 1,5x o ruído e CV <= 15% | painel entrega volume fixo por hora | destaque de plataforma pode ser plano |
| `rhythm_mismatch` | 2 | elasticidade do excesso ao perfil horário + 2 erros-padrão <= 0,5 | humanos assistem acordados; bot entrega igual de madrugada | audiência global tem perfil plano; aí o sinal fica indisponível |
| `abrupt_onset` | 1 | chega a 80% do pico em <= 1h | entrega comprada liga de uma vez | repost de conta grande também |
| `abrupt_stop` | 1 | cai de 80% para < 20% do pico em <= 1h | pacote acaba de uma vez | fim de live ou de destaque também |

`rhythm_mismatch` é uma regressão `log(excesso) ~ 1 + t + t² + log(perfil horário)` dentro do pico; o coeficiente do perfil é a elasticidade (perto de 1 para gente real, perto de 0 para bot). Só é avaliada com >= 12h de pico e perfil variando >= 2x dentro dele. A tendência quadrática existe para que um pico orgânico que decai durante a madrugada não seja confundido com bot; mesmo assim, é o sinal que mais erra em orgânicos, por isso nunca acusa sozinho.

Cada sinal tem três estados: `fired`, `clear` ou `unavailable` (sem dados para avaliar). `signalsUsed` lista os que foram efetivamente avaliados.

Decisão:

1. Menos de 48h completas: `inconclusive`.
2. Sem pico significativo: `organic`.
3. `suspicious` se pontuação >= 4, ao menos 2 sinais e ao menos um entre engajamento, platô e ritmo.
4. Vetos que rebaixam para `inconclusive`: engajamento acoplado (curtidas extras >= 50% do esperado) ou excesso total < 300 views.
5. Pontuação >= 2 sem chegar a suspeito: `inconclusive`.
6. Caso contrário: `organic`.

Os vetos são a forma explícita de "preferir não acusar": formato de compra sozinho (liga/desliga, platô) não basta quando o engajamento parece humano ou quando o volume é pequeno demais para estatística.

### O que não detecta

- Views compradas junto com curtidas proporcionais (o veto de engajamento evita acusar e, por consequência, deixa passar; ver `bought_with_likes` na tabela).
- Bots que imitam a curva diária e a subida/decaimento de um pico orgânico.
- Compras pequenas (excesso < 300 views) ou diluídas a ponto de não formar pico (parte de `bought_drip` cai aqui).
- Compras contínuas desde o início da série: a linha de base já nasce contaminada.
- Mais de um pico na mesma série: só o maior é analisado.
- Audiência global sem ciclo dia/noite: `rhythm_mismatch` fica inoperante.
- Fazendas de clique com pessoas reais em horário comercial.
- Sinais de rede/dispositivo/retenção: só olha contagens agregadas por hora.

## Dataset sintético e avaliação

`src/dataset/generator.ts` gera séries de 7 dias (UTC-3) a partir de uma semente (PRNG mulberry32, sem `Math.random`, sem rede). Cada amostra tem semente própria derivada de `seed:cenário:índice`, então a geração não depende de ordem. A audiência tem ciclo dia/noite com vale e horário de pico aleatórios, variação diária de ~8%, jitter horário e ruído de Poisson. Views humanas extras são multiplicadas pelo perfil horário; views de bot não. Curtidas seguem a taxa da audiência para humanos (com fator 0,45–1,2 no pico orgânico) e zero para bots, exceto em `bought_with_likes`.

| Cenário | Rótulo | Descrição |
| --- | --- | --- |
| `organic_steady` | legit | sem pico |
| `organic_viral` | legit | subida em 2–9h, decaimento em lei de potência |
| `organic_shoutout` | legit | salto em 1h (repost) e decaimento exponencial — o "pico orgânico plausível" |
| `organic_featured_slot` | legit | destaque de 4–10h que liga e desliga de uma vez |
| `organic_low_volume` | legit | 2–15 views/h com pico orgânico |
| `organic_viral_no_likes` | legit | viral sem série de curtidas |
| `bought_plateau` | suspicious | volume fixo por 6–30h |
| `bought_burst` | suspicious | rajada de 1–2h com 10–60x a base |
| `bought_drip` | suspicious | 0,8–2,5x a base por 24–60h, dia e noite |
| `bought_plateau_no_likes` | suspicious | volume fixo sem série de curtidas |
| `bought_ramped` | suspicious | rampa linear de 3–6h na subida e na descida |
| `bought_with_likes` | suspicious | compra de views + curtidas proporcionais (ponto cego) |

Falso positivo = série `legit` classificada como `suspicious`. `inconclusive` não conta como acusação. O bloco abaixo é gerado por `npm run evaluate -- --write-readme`; `test/evaluation.test.ts` recalcula e falha se a linha ou a tabela divergirem.

Taxa de falso positivo esperada: **0.50%** (limite superior 95%: 1.09%; 1200 séries legítimas, seed 20261010).

- Detecção (suspeitos marcados como suspeito): 76.75% de 1200
- Legítimos inconclusivos: 8.92%
- Suspeitos inconclusivos: 22.17%

| Cenário | Rótulo | Séries | Orgânico | Inconclusivo | Suspeito |
| --- | --- | ---: | ---: | ---: | ---: |
| organic_steady | legit | 200 | 199 | 1 | 0 |
| organic_viral | legit | 200 | 184 | 15 | 1 |
| organic_shoutout | legit | 200 | 186 | 14 | 0 |
| organic_featured_slot | legit | 200 | 182 | 15 | 3 |
| organic_low_volume | legit | 200 | 164 | 35 | 1 |
| organic_viral_no_likes | legit | 200 | 172 | 27 | 1 |
| bought_plateau | suspicious | 200 | 0 | 0 | 200 |
| bought_burst | suspicious | 200 | 0 | 4 | 196 |
| bought_drip | suspicious | 200 | 13 | 1 | 186 |
| bought_plateau_no_likes | suspicious | 200 | 0 | 0 | 200 |
| bought_ramped | suspicious | 200 | 0 | 62 | 138 |
| bought_with_likes | suspicious | 200 | 0 | 199 | 1 |

Leitura honesta: esse número vale para este gerador. Os limiares foram calibrados olhando este mesmo dataset, então ele é otimista; em dados reais a taxa tende a ser maior. A maior fonte de falso positivo é o destaque de plataforma (`organic_featured_slot`), que é plano e liga/desliga como um pacote comprado e cuja taxa de curtidas cai abaixo do veto.

## Decisões

- **Regras com pesos em vez de modelo treinado.** Cada decisão vira uma frase com número e limiar; dá para contestar sinal por sinal. O custo é menos recall que um modelo ajustado.
- **Três classes.** `inconclusive` é resposta de primeira classe: acusar um criador sem evidência tem custo alto; preferi perder recall (`bought_ramped`, `bought_with_likes`) a subir falso positivo.
- **Excesso sobre linha de base por hora do dia.** Compara cada hora com a mesma hora em outros dias, o que separa "madrugada alta" de "dia normal".
- **Limite superior de Wilson junto da taxa.** Com 0,5% em 1200 séries, o intervalo importa mais que o ponto.
- **Hora corrente descartada pelo relógio injetável**, para que uma hora pela metade não vire "fim abrupto".

## O que ficou de fora

- Persistência, autenticação, rate limit e lote de séries numa só chamada.
- Validação com dados reais rotulados (não há rede neste projeto, por definição).
- Análise de múltiplos picos, comentários/compartilhamentos/retenção e sinais por dispositivo ou origem de tráfego.
- Calibração dos limiares em um conjunto separado do de avaliação.

## Uso de IA

Código gerado com assistência de IA (Claude Code). O que a IA fez:

- desenhou os sinais, as regras de decisão e os vetos de "não acusar";
- escreveu o classificador, o gerador de dataset, a avaliação, a API Fastify e os testes;
- iterou os limiares contra o dataset sintético (por exemplo, trocou um sinal de razão noite/dia, que confundia decaimento orgânico com bot, pela regressão de elasticidade);
- escreveu este README.

Revisao humana: [Rodrigo completa]
