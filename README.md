# itf-juniors-live-ranking
Live ranking project for ITF Junior tennis rankings, points breakdowns and weekly results tracking.

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
npm.cmd run update
```

- `data/raw/` contém respostas brutas e arquivos intermediários da coleta.
- `data/clean/` contém tabelas processadas.
- `data/exports/` contém o HTML final do live ranking.
- `data/audit/` contém arquivos de auditoria por jogador.
- `logs/` contém logs da última execução.

Se o usuário clonar o projeto em outro computador, deve rodar:

```bash
npm install
npm.cmd run update
```

Isso regenera os artefatos locais necessários.
