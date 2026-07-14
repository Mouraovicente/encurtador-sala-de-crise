# Runbook: `latency-spike` — prompt de investigação

> Este arquivo foi escrito para ser colado inteiro no prompt de um agente de
> IA com acesso ao **Grafana MCP** (datasource Prometheus `Prometheus`,
> dashboard `sala-de-crise`). O objetivo é treinar o diagnóstico: o agente
> recebe só o sintoma e o acesso às métricas, e deve chegar sozinho à causa
> raiz antes de olhar a resposta neste documento.

## Prompt para o agente

Você é o engenheiro de plantão de um encurtador de URLs. Um alerta disparou:
"p95 de latência do endpoint de redirecionamento acima do normal". Você tem
acesso ao Grafana (dashboard `sala-de-crise`) via MCP. Investigue, confirme a
causa raiz com dados (não suposições) e aplique a correção. Ao final, explique
em uma frase o que aconteceu e como você confirmou.

## Sintoma esperado

- O painel "p95 de latencia" do dashboard `sala-de-crise` mostra a série
  `route="/:code"` subindo para algo entre ~800ms e ~2000ms.
- As demais rotas (`/links`, `/stats/:code`, `/health`) continuam rápidas.
- A taxa de requisições (`req rate`) não muda — o serviço continua
  respondendo, só que mais devagar no redirecionamento.
- Não há aumento de erros 5xx nem de `shortener_errors_total`.

## Queries PromQL para confirmar

```promql
# p95 de latência isolado na rota de redirecionamento
histogram_quantile(0.95, sum(rate(shortener_request_duration_seconds_bucket{route="/:code"}[5m])) by (le))

# comparação: p95 das demais rotas deveria estar normal
histogram_quantile(0.95, sum(rate(shortener_request_duration_seconds_bucket{route!="/:code"}[5m])) by (le, route))

# taxa de requisições da rota afetada (deve estar estável, não em queda)
sum(rate(shortener_requests_total{route="/:code"}[1m]))

# taxa de erros (deve estar em zero durante este incidente)
sum(rate(shortener_errors_total[1m])) by (scenario)
```

## Hipóteses falsas a descartar

1. **"O banco (SQLite) está lento."** Falso: `POST /links` e `GET
   /stats/:code` também tocam o repositório e continuam rápidos — o atraso
   está isolado na rota de redirecionamento, não no acesso a dados.
2. **"Estamos sob um pico de tráfego."** Falso: a taxa de requisições
   (`shortener_requests_total`) não mudou; o problema é latência por
   requisição, não volume.
3. **"É o cenário `error-burst`."** Falso: `shortener_errors_total` está
   zerado e os status code continuam 302 (sucesso), não 5xx.
4. **"É o pool de conexões (`connection-leak`) items segurando requisições."**
   Falso: não há respostas 503; todas as requisições eventualmente têm
   sucesso, só que atrasadas.

## Causa raiz

O cenário de caos `latency-spike` foi ativado (via `POST
/chaos/latency-spike`). Ele injeta um atraso aleatório de 800–2000ms
especificamente antes de responder ao `GET /:code`, simulando uma
dependência externa lenta no caminho crítico de redirecionamento.

## Correção

```bash
curl -X DELETE http://localhost:8080/chaos
```

Isso zera todos os cenários ativos (incluindo este) e libera qualquer estado
acumulado (pool de conexões e buffer de memória, que não são afetados aqui,
mas o reset é sempre completo).

## Critério de resolução

- `POST /chaos/:scenario` mostra `active: []` (ou o `GET` equivalente no seu
  painel de estado).
- O p95 de `route="/:code"` volta para a mesma ordem de grandeza das outras
  rotas (poucos milissegundos) na janela seguinte de 1–5 minutos.
- Nenhuma nova amostra de `shortener_errors_total` aparece.
