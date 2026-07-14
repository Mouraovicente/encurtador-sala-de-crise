# Runbook: `error-burst` — prompt de investigação

> Cole este arquivo inteiro no prompt de um agente de IA com acesso ao
> **Grafana MCP** (datasource Prometheus `Prometheus`, dashboard
> `sala-de-crise`). O agente deve confirmar a causa raiz com dados antes de
> aplicar a correção.

## Prompt para o agente

Você é o engenheiro de plantão de um encurtador de URLs. Um alerta disparou:
"taxa de erros 5xx acima do normal, mas o serviço não caiu por completo".
Você tem acesso ao Grafana (dashboard `sala-de-crise`) via MCP. Investigue,
confirme a causa raiz com dados e aplique a correção. Ao final, explique em
uma frase o que aconteceu e como você confirmou.

## Sintoma esperado

- O painel "Error rate" mostra a razão de respostas 5xx sobre o total
  subindo para ~30% (não 100% — o serviço segue majoritariamente saudável).
- `shortener_errors_total{scenario="error-burst"}` cresce continuamente.
- A latência (p95) permanece normal — os erros são instantâneos, não
  demorados.
- O erro acontece em qualquer rota de negócio (`/links`, `/:code`,
  `/stats/:code`), não só no redirecionamento.

## Queries PromQL para confirmar

```promql
# razão de 5xx sobre o total de requisições
sum(rate(shortener_requests_total{status=~"5.."}[1m]))
/
sum(rate(shortener_requests_total[1m]))

# erros atribuídos especificamente ao cenário de caos
sum(rate(shortener_errors_total{scenario="error-burst"}[1m]))

# confirma que a latência não é a causa (deve estar normal)
histogram_quantile(0.95, sum(rate(shortener_request_duration_seconds_bucket[5m])) by (le))
```

## Hipóteses falsas a descartar

1. **"O serviço caiu."** Falso: a razão de erro fica perto de 30%, não
   100% — a maioria das requisições continua tendo sucesso. Um outage total
   mostraria a razão de erro colada em 1.0.
2. **"É um deploy quebrado."** Falso: não há mudança de versão nem reinício
   do processo; o padrão é probabilístico e uniforme ao longo do tempo, não
   um degrau permanente após um deploy.
3. **"É o `connection-leak`."** Falso: os erros são 500, não 503, e
   `shortener_errors_total` tem `scenario="error-burst"`, não
   `connection-leak`. Além disso, o erro não se agrava progressivamente
   (não "esgota" como um pool).
4. **"É lentidão de downstream causando timeout."** Falso: a latência (p95)
   está normal; os erros são imediatos.

## Causa raiz

O cenário de caos `error-burst` foi ativado (via `POST
/chaos/error-burst`). Com a probabilidade padrão de 30%, uma fração das
respostas em rotas de negócio é substituída por `500` antes mesmo de
executar a lógica normal, simulando uma dependência instável que falha de
forma intermitente.

## Correção

```bash
curl -X DELETE http://localhost:8080/chaos
```

## Critério de resolução

- A razão de erro 5xx volta a 0 nas janelas seguintes.
- `shortener_errors_total{scenario="error-burst"}` para de crescer.
- Os cenários ativos retornam vazios (`active: []`).
