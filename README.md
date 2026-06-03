# itf-juniors-live-ranking

Projeto de live ranking do circuito ITF Junior, com ranking ao vivo, drops, resultados da semana, HTML estático e auditoria por jogador.

## Comandos

```bash
npm install
```

Instala as dependências do projeto.

```bash
npm.cmd run update
```

Recalcula o ranking e regenera HTML/auditoria usando os dados já coletados em `data/clean/`. Não faz scraping.

```bash
npm.cmd run update:full
```

Busca torneios/resultados na ITF, recalcula tudo e regenera HTML/auditoria. Use este comando para atualizar os resultados da semana.

```bash
npm.cmd run generate
```

Regenera apenas o HTML em `data/exports/`. Use este comando para mudanças visuais.

```bash
npm.cmd run audit
```

Regenera apenas a auditoria por jogador em `data/audit/`.

```bash
npm.cmd test
```

Roda os testes.

```bash
npm.cmd run check
```

Verifica a sintaxe dos scripts `.mjs`.

## Fluxos recomendados

Para mudanças visuais no HTML:

```bash
npm.cmd run generate
```

Para recalcular usando dados já baixados:

```bash
npm.cmd run update
```

Para buscar resultados novos da ITF e publicar dados atualizados:

```bash
npm.cmd run update:full
```

## Publicação no GitHub Pages

O workflow de GitHub Pages separa os cenários:

- Em `push` na branch `main`, usa dados gerados em cache e roda `npm run update`, sem scraping.
- Em execução agendada ou manual, roda `npm run update:full`, busca dados novos da ITF e atualiza o cache.

Isso evita gastar tempo buscando torneios/resultados quando a mudança é apenas visual.

## Política de dados

O repositório mantém versionados apenas os dados-base essenciais para reproduzir o cálculo principal:

- `data/config/`
- `data/clean/players.csv`
- `data/clean/rankings_snapshot.csv`
- `data/clean/points_ledger.csv`

Os demais arquivos são artefatos gerados automaticamente pelo pipeline e não são versionados:

- `data/raw/`
- `data/exports/`
- `data/audit/`
- `logs/`
- demais CSVs gerados dentro de `data/clean/`

Esses arquivos são recriados localmente ao rodar:

```bash
npm.cmd run update:full
```

- `data/raw/` contém respostas brutas e arquivos intermediários da coleta.
- `data/clean/` contém tabelas processadas.
- `data/exports/` contém o HTML final do live ranking.
- `data/audit/` contém arquivos de auditoria por jogador.
- `logs/` contém logs da última execução.

Se o usuário clonar o projeto em outro computador, deve rodar:

```bash
npm install
npm.cmd run update:full
```

Isso regenera os artefatos locais necessários.
