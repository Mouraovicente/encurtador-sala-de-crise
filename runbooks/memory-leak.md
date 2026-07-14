# Runbook: `memory-leak` — prompt de investigação

> Cole este arquivo inteiro no prompt de um agente de IA com acesso ao
> **Grafana MCP** (datasource Prometheus `Prometheus`, dashboard
> `sala-de-crise`). O agente deve confirmar a causa raiz com dados antes de
> aplicar a correção.

## Prompt para o agente

Você é o engenheiro de plantão de um encurtador de URLs. Um alerta disparou:
"uso de memória do processo crescendo continuamente, sem nunca cair". Você
tem acesso ao Grafana (dashboard `sala-de-crise`) via MCP. Investigue,
confirme a causa raiz com dados e aplique a correção. Ao final, explique em
uma frase o que aconteceu e como você confirmou.

## Sintoma esperado

- O painel "Memoria do processo (RSS)" mostra `process_memory_rss_bytes`
  crescendo em degraus, aproximadamente 1MB a cada requisição de negócio
  (`POST /links`, `GET /:code`, `GET /stats/:code`), sem nunca recuar.
- Não há aumento correspondente de erros (`shortener_errors_total`) nem de
  latência — o serviço continua respondendo normalmente enquanto a memória
  sobe.
- O crescimento acompanha de perto a taxa de requisições, não picos
  isolados de tráfego.

## Queries PromQL para confirmar

```promql
# memória residente do processo ao longo do tempo (deve ter inclinação positiva constante)
process_memory_rss_bytes

# taxa de requisições de negócio, para comparar a inclinação do crescimento de memória
sum(rate(shortener_requests_total{route=~"/links|/:code|/stats/:code"}[1m]))

# confirma que não há erros nem degradação associada
sum(rate(shortener_errors_total[1m])) by (scenario)
```

## Hipóteses falsas a descartar

1. **"É um vazamento de memória real do runtime Node.js (GC não está
   coletando)."** Falso: ao chamar `DELETE /chaos`, o buffer interno é
   liberado e o RSS para de crescer imediatamente na próxima leitura — um
   vazamento real de aplicação não se resolveria de forma instantânea e
   determinística assim.
2. **"É só um pico de tráfego consumindo mais memória temporariamente."**
   Falso: o crescimento é **monotônico e nunca recua sozinho**, mesmo
   quando a taxa de requisições cai — não é o padrão de uso elástico normal
   de memória sob carga.
3. **"É o `connection-leak` consumindo memória por conexão."** Falso: os
   cenários são independentes; confirme pelo label `scenario` em
   `shortener_errors_total` (aqui deve estar vazio, já que `memory-leak`
   não gera respostas de erro, só consumo de memória) e pelo fato de que
   todas as requisições continuam respondendo 2xx/302.
4. **"É o coletor OTel ou o Prometheus vazando memória."** Falso: o painel
   mede `process_memory_rss_bytes` do **processo da aplicação**
   (instrumentado via OpenTelemetry), não dos componentes da stack de
   observabilidade.

## Causa raiz

O cenário de caos `memory-leak` foi ativado (via `POST
/chaos/memory-leak`). A cada requisição de negócio, um buffer de ~1MB é
alocado e mantido indefinidamente em um array global, nunca liberado
enquanto o cenário estiver ativo — simulando um vazamento de memória
clássico por acúmulo de referências.

## Correção

```bash
curl -X DELETE http://localhost:8080/chaos
```

Isso desativa o cenário **e** libera o buffer acumulado (o array interno é
esvaziado, permitindo que o garbage collector recupere a memória).

## Critério de resolução

- `process_memory_rss_bytes` para de crescer a cada nova requisição.
- Após o reset, o valor de RSS estabiliza (pode não cair instantaneamente ao
  nível de baseline por causa do GC do Node, mas para de subir em degraus
  de ~1MB por requisição).
- Os cenários ativos retornam vazios (`active: []`).
