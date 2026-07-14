# Runbook: `connection-leak` — prompt de investigação

> Cole este arquivo inteiro no prompt de um agente de IA com acesso ao
> **Grafana MCP** (datasource Prometheus `Prometheus`, dashboard
> `sala-de-crise`). O agente deve confirmar a causa raiz com dados antes de
> aplicar a correção.

## Prompt para o agente

Você é o engenheiro de plantão de um encurtador de URLs. Um alerta disparou:
"respostas 503 (serviço indisponível) começaram a aparecer e estão piorando
com o tempo, até que praticamente toda requisição falha". Você tem acesso ao
Grafana (dashboard `sala-de-crise`) via MCP. Investigue, confirme a causa
raiz com dados e aplique a correção. Ao final, explique em uma frase o que
aconteceu e como você confirmou.

## Sintoma esperado

- No início do incidente, a maioria das requisições ainda funciona.
- `shortener_errors_total{scenario="connection-leak"}` cresce de forma
  monotônica e, depois de um número pequeno de requisições (dependendo do
  tamanho do pool configurado), **toda** requisição de negócio passa a
  responder 503.
- Diferente do `error-burst`, aqui o padrão é de **degradação progressiva
  até 100% de falha**, não uma taxa estável de ~30%.
- A latência das requisições que ainda têm sucesso é normal.

## Queries PromQL para confirmar

```promql
# erros atribuídos especificamente ao esgotamento do pool
sum(rate(shortener_errors_total{scenario="connection-leak"}[1m]))

# razão de 5xx/503 sobre o total, ao longo do tempo (deve subir até ~1.0)
sum(rate(shortener_requests_total{status="503"}[1m]))
/
sum(rate(shortener_requests_total[1m]))

# confirma que a latência das respostas de sucesso continua normal
histogram_quantile(0.95, sum(rate(shortener_request_duration_seconds_bucket[5m])) by (le))
```

## Hipóteses falsas a descartar

1. **"O banco de dados real caiu ou esgotou conexões."** Falso (para este
   laboratório): não há um banco relacional com pool de verdade aqui — o
   SQLite usa uma conexão direta por processo. O "pool" é uma simulação em
   memória (`ChaosEffects`) criada propositalmente para este exercício.
2. **"É uma taxa de erro fixa como no `error-burst`."** Falso: a razão de
   503 não fica estável em ~30%, ela **sobe progressivamente até 100%**
   conforme o pool fake se esgota — um padrão de esgotamento, não de ruído
   aleatório constante.
3. **"É lentidão (`latency-spike`) que está causando timeout no cliente."**
   Falso: o status retornado é 503 explícito do próprio serviço, não um
   timeout, e a latência das respostas bem-sucedidas está normal.
4. **"Reiniciar o processo resolve."** Falso (didaticamente): reiniciar
   reseta o estado só porque é em memória; a causa raiz é o cenário de caos
   ligado, e ele continuaria vazando conexões após o restart enquanto ativo.
   O reset correto é via `DELETE /chaos`.

## Causa raiz

O cenário de caos `connection-leak` foi ativado (via `POST
/chaos/connection-leak`). Um pool fake de conexões (10 por padrão) vaza uma
conexão a cada requisição de negócio e nunca a devolve; quando o pool se
esgota, toda nova requisição recebe `503`.

## Correção

```bash
curl -X DELETE http://localhost:8080/chaos
```

Isso desativa o cenário **e** libera todas as conexões vazadas do pool fake
(contador interno volta a zero).

## Critério de resolução

- A razão de respostas 503 volta a 0.
- `shortener_errors_total{scenario="connection-leak"}` para de crescer.
- Uma nova requisição a `GET /:code` logo após o reset responde `302`
  normalmente, confirmando que o pool foi liberado (não apenas que o
  cenário foi desativado).
