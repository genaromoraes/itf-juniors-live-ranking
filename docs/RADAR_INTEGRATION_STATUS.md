# Radar Top 1.000 — ponto de retomada

Trabalhar neste checkout, branch `codex/public-top1000-radar`, baseado em `4e253fc` (semana oficial 07/09/2026). Plano completo na pasta principal: `../../docs/PLANO_TOP1000_PUBLICO_RADAR.md` relativo à raiz deste checkout.

## Concluído

- Integração seletiva da ampliação pública e do detector sem participação semanal, preservando as correções recentes da main.
- Universo oficial estendido até a faixa disponível próxima de 5.000 por gênero: `data/staging/radar_2026-09-07/preview/data/clean/rankings_universe.csv` (4.866 M e 4.994 F; cauda oficial observada em 0,75 ponto).
- Inventário dos 1.000 atletas adicionais: 232 com resultados recuperados (19 cache + 213 Git), 768 sem ledger localizado.
- Auditoria da base atual: 2.000/2.000 totais oficiais exatos. Recuperados: 138 totais correspondentes e 94 divergentes; composição histórica ainda requer revisão.
- Limites separados: público 1.000; radar 1.500 por gênero. A promoção atômica específica do RADAR1500 foi implementada e executada neste branch isolado; `data/config/base_state.json` agora está em `RADAR1500_ACTIVE`, com backup e rollback disponíveis. Nenhum push ou deploy remoto foi feito.
- Staging preparado com 3.000 atletas, preservando os 2.000 atuais. Fila retomável exclusivamente para os 1.000 adicionais.
- Em 08/09: os 1.000 adicionais foram coletados e validados. A validação do staging confirmou 3.000/3.000 atletas, 3.000/3.000 totais exatos e nenhuma pendência. Evidência em `data/staging/radar_2026-09-07/base/validation.json`.
- Proteções adicionadas: desconhecido não equivale a zero; candidatos fora da faixa só recebem limite `BOUNDED` quando o universo completo e seu teto são explicitamente comprovados; cache de candidato exige mesma semana e pontos; cooldown não é renovado a cada detecção; auditoria pública independente identifica candidatos omitidos, evidência de outra semana e ausência de ledger.
- Pacote semanal real de 07/09 recuperado com o perfil compatível com o GitHub (browser, 12s entre eventos, 20s entre torneios, jitter de 3s, retry de 20s e cooldown de 90s): 30 torneios, 4.826 partidas, 4.377 resultados por atleta e 0 erros. O pacote anterior ficou como fallback; Cairo e Accra foram confirmados em tentativas isoladas. A recuperação local confirmou que a diferença para as tentativas diretas agressivas era principalmente cadence/transporte, além do IP limpo do runner.
- Detector externo após o pacote completo: 7.649 atletas auditados, 0 `FETCH_REQUIRED`, 0 `LOOKUP_REQUIRED`, 7.578 `INELIGIBLE` e 71 `WATCH`; nenhum candidato pendente capaz de entrar no público.
- Preview e candidato de produção com dados reais: 3.000 atletas rastreados, 1.500 por gênero; Top 1.000 público coerente (M=1.000, F=1.000). A validação estrutural e a validação estrita passam sem erros também após a promoção local.
- Suíte completa após as proteções, a correção de recuperação direcionada e a promoção atômica: 292/292 testes aprovados. Verificação sintática: 96 módulos.
- Gerador mantém o ranking completo como entrada para não perder atletas do Top 1.000 oficial que estejam fora do Top 1.000 live; o limite público é aplicado por visualização, preservando filtros de país e geração existentes.
- Prévia isolada gerada em `data/staging/radar_2026-09-07/preview/data/exports`. O cálculo contém 1.500 atletas por gênero; a validação estrutural confirmou M=1.000 e F=1.000.

## Continuar

1. Revisar visualmente a prévia e a fronteira Top 1.000; confirmar empates, filtros e páginas dos atletas. A abertura local de arquivos ficou bloqueada pela política do navegador integrado, então essa conferência ainda precisa ser feita manualmente no navegador do usuário.
2. Reexecutar os validadores no commit final e conferir o diff de produção.
3. Fazer commit, push/merge e executar o workflow do GitHub Pages. Só depois conferir as URLs públicas e anunciar.

O workflow GitHub pode aparecer verde mesmo quando uma leitura isolada falha: o scrape usa `continue-on-error`, aceita coleta parcial para a publicação e restaura o último pacote completo via cache quando necessário. Portanto, sucesso do workflow não deve ser confundido com 100% de draws novos; neste staging atual, porém, o pacote passou a ter 0 erros.

Não executar a atualização usando a pasta principal antiga. Não promover staging incompleto. Os CSVs oficiais deste checkout continuam os de 07/09 com 1.000 atletas por gênero.

## Ferramentas disponíveis

- `node scripts/28_inventory_radar.mjs --extension=data/staging/radar_2026-09-07/ranking_extension.csv --cache-root="C:\Users\genar\OneDrive\Documentos\Live Ranking v2" --output-dir=data/staging/radar_2026-09-07/inventory --scan-local`
- `node scripts/29_audit_radar_inventory.mjs`
- `node scripts/30_prepare_radar_base.mjs` — preserva staging existente se os insumos não mudaram.
- `node scripts/31_fetch_radar_breakdowns.mjs --cache-root="C:\Users\genar\OneDrive\Documentos\Live Ranking v2" --limit=150` — apenas um processo por vez, checkpoint por atleta, pausa ao detectar bloqueio da fonte.
- `node scripts/32_validate_radar_base.mjs` — validação, sem promoção.
- `node scripts/33_prepare_radar_preview.mjs` — cria uma cópia isolada do staging para cálculo e HTML.
- `node scripts/34_build_preview_universe.mjs` — combina o universo oficial de 1–1.600 com a extensão coletada até a faixa 5.000.
- `ITF_RESULTS_TRANSPORT=browser ITF_RESULTS_EVENT_DELAY_MS=12000 ITF_RESULTS_TOURNAMENT_DELAY_MS=20000 ITF_RESULTS_JITTER_MS=3000 ITF_RESULTS_RETRY_DELAY_MS=20000 ITF_RESULTS_BLOCK_DELAY_MS=90000 node scripts/05_fetch_week_results.mjs ...` — perfil compatível com o workflow GitHub; usar com fallback do pacote anterior e saída isolada.
- `ITF_RESULTS_TRANSPORT=direct node scripts/05_fetch_week_results.mjs ...` — recuperação HTTP direta; mais agressiva e não equivalente ao workflow GitHub.
- `node --test tests/*.test.mjs`

A coleta do universo até 1.600 e dos 1.000 breakdowns adicionais terminou. Não recolher os 2.000 atletas atuais: eles já foram validados. Consulte os relatórios existentes antes de rodar comandos novamente.
