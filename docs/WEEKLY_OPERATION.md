# Rotina Semanal

Durante a semana:

```bash
npm run update
```

Para consultar o estado:

```bash
npm run weekly:status
```

O status agora verifica automaticamente, usando apenas os arquivos locais ja coletados, se os eventos da semana parecem concluidos, pendentes ou se exigem revisao antes do fechamento.

No fim da semana:

```bash
npm run weekly:close -- --week-start=AAAA-MM-DD --week-end=AAAA-MM-DD --mode=dry-run
```

Esse fechamento so sera liberado quando o status indicar que a semana esta pronta, sem eventos pendentes, sem eventos ausentes e sem erros de coleta.

Depois da conferencia:

```bash
npm run weekly:close -- --week-start=AAAA-MM-DD --week-end=AAAA-MM-DD --mode=apply --confirm=true
```

Na segunda-feira:

1. Execute os workflows oficiais ja existentes.
2. Promova a base somente quando houver 1000/1000.
3. Inicie a nova semana:

```bash
npm run weekly:start -- --week-start=AAAA-MM-DD --week-end=AAAA-MM-DD --mode=dry-run
```

Depois:

```bash
npm run weekly:start -- --week-start=AAAA-MM-DD --week-end=AAAA-MM-DD --mode=apply --confirm=true
```

4. Se houver lista manual de torneios da semana, gere `week_tournaments.csv` a partir dela:

```bash
node scripts/04_fetch_week_tournaments.mjs --week-start=AAAA-MM-DD --week-end=AAAA-MM-DD --manual-file=data/config/weekly_tournaments_AAAA-MM-DD.json
```

O arquivo manual aceita `current_tournaments` e `dropping_tournaments` como listas de URLs da ITF. Os torneios atuais alimentam `week_tournaments.csv`; os torneios caindo ficam no JSON raw para auditoria e proximas validacoes de drops.

## O que nao fazer

- Nao editar CSV manualmente.
- Nao rodar fechamento apply duas vezes sem necessidade.
- Nao iniciar semana sem base oficial reconciliada.
- Nao apagar `data/clean/points_ledger.csv`.
- Nao usar force push.
