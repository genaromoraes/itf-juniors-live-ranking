# Rotina Semanal

Durante a semana:

```bash
npm run update
```

Para consultar o estado:

```bash
npm run weekly:status
```

No fim da semana:

```bash
npm run weekly:close -- --week-start=AAAA-MM-DD --week-end=AAAA-MM-DD --mode=dry-run
```

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

## O que nao fazer

- Nao editar CSV manualmente.
- Nao rodar fechamento apply duas vezes sem necessidade.
- Nao iniciar semana sem base oficial reconciliada.
- Nao apagar `data/clean/points_ledger.csv`.
- Nao usar force push.
