# Relatório de performance

Data: 23 de agosto de 2026

## Metodologia

O benchmark reproduzível está em `scripts/benchmark_performance.mjs` e pode ser executado com `npm run benchmark`. A comparação usou o mesmo computador, dados e navegador nas duas versões:

- Chromium headless, com cinco contextos frios;
- CPU limitada a 4× mais lenta;
- rede controlada em 1,6 Mbps, 150 ms de latência e compressão gzip;
- mediana das cinco execuções para as métricas de navegação;
- três execuções do gerador no baseline e sete na verificação final.

Os relatórios brutos desta execução foram gravados em `.tmp/performance-baseline.json`, `.tmp/performance-final.json` e `.tmp/performance-generation-optimized.json`.

## Gargalos encontrados

1. O HTML inicial tinha 14,01 MB. O campo `point_cartel`, usado somente no modal do atleta, respondia por 10,00 MB (72,2% do JSON).
2. O payload também repetia campos sem uso no navegador, inclusive os seis melhores resultados e o horário de cálculo em cada um dos 2.000 registros.
3. A tabela criava 500 linhas e 11.817 nós do DOM na primeira carga.
4. Abrir ou fechar um atleta reconstruía as 500 linhas, mesmo quando apenas a seleção visual havia mudado.
5. A montagem do payload repetia normalização e parsing dos mesmos resultados.

## Melhorias implementadas

- O payload inicial agora contém apenas os campos usados pela tabela.
- Os cartéis foram compactados e divididos em 20 blocos de 100 atletas, carregados apenas quando um atleta daquele bloco é aberto.
- A tabela renderiza 100 linhas inicialmente e disponibiliza as restantes em lotes de 100 pelo botão/rolagem progressiva.
- Selecionar ou fechar um atleta atualiza somente a classe da linha afetada; não reconstrói a tabela.
- O gerador reaproveita resultados já normalizados e evita parsing repetido.
- Leituras de benchmark, compressão, rede, CPU e interação ficaram automatizadas no comando `npm run benchmark`.

## Antes e depois

| Métrica (mediana) | Antes | Depois | Variação |
|---|---:|---:|---:|
| HTML inicial bruto | 14.011.772 B | 1.288.054 B | -90,8% |
| HTML inicial gzip | 1.067.306 B | 128.820 B | -87,9% |
| HTML inicial Brotli | 466.269 B | 85.039 B | -81,8% |
| Fim da resposta | 6.711,2 ms | 1.164,1 ms | -82,7% |
| DOMContentLoaded | 12.188,0 ms | 3.008,9 ms | -75,3% |
| Aplicação pronta | 12.521,5 ms | 3.322,2 ms | -73,5% |
| Tempo total em tarefas longas | 5.460,0 ms | 2.346,0 ms | -57,0% |
| Maior tarefa bloqueante | 2.797,0 ms | 960,0 ms | -65,7% |
| Nós no DOM inicial | 11.817 | 2.465 | -79,1% |
| Primeiro detalhe pronto | 2.601,7 ms | 924,5 ms | -64,5% |
| Geração do site | 4.219,6 ms | 4.384,6 ms | +3,9% |

O First Contentful Paint variou de 804 ms para 940 ms na mediana, mas os intervalos das amostras se sobrepõem amplamente (716–1.044 ms antes e 588–1.112 ms depois); o teste não sustenta uma mudança conclusiva nessa métrica. O pequeno custo adicional do gerador vem da criação dos blocos de detalhes e não afeta a navegação publicada.

## Verificação

- 249 testes automatizados passaram após a mudança.
- O benchmark abre a página, confirma a primeira tabela e aguarda o cartel do primeiro atleta, falhando em caso de erro JavaScript.
- A página continua compatível com abertura local: os detalhes são arquivos JavaScript relativos, sem depender de `fetch` ou de um servidor.

## Próximas oportunidades

O maior custo restante é renderizar o primeiro lote de 100 linhas sob CPU 4× limitada. Se necessário, uma etapa futura pode aplicar virtualização completa da tabela e hospedar as bandeiras localmente para reduzir ainda mais trabalho de layout e requisições externas.
