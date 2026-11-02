# 🃏 Truco do Boteco

Truco Paulista em duplas (2x2), online e com robôs. Spec, plano e tarefas em
[`specs/001-truco`](../specs/001-truco).

- Salas privadas por código/link e **fila pública valendo Elo**
- Robôs **fácil / médio / difícil** que blefam, pedem truco e falam besteira
- Mão de 11, mão de ferro, carta coberta, truco → seis → nove → doze
- Chat + sinais para o parceiro (o adversário flagra 20% das vezes)
- Login com Google, ranking Elo e histórico (SQLite)
- Queda: a partida pausa até 2 min; depois é W.O.

## Rodando

Requer **Node 22+** (usa o `node:sqlite` nativo).

```bash
cd truco
npm install
npm run dev          # servidor :3001 + Vite :5173 → abra http://localhost:5173
```

Em desenvolvimento aparece o botão **“Entrar como teste”** (sem Google). Ele não existe em produção.

### Produção

```bash
cp .env.example .env   # preencha JWT_SECRET, PUBLIC_URL e as credenciais Google
npm run build
npm start              # http://localhost:3001
```

### Docker

```bash
docker build -t truco-boteco .
docker run -p 3001:3001 -v truco-data:/data \
  -e JWT_SECRET=... -e PUBLIC_URL=https://seu-dominio \
  -e GOOGLE_CLIENT_ID=... -e GOOGLE_CLIENT_SECRET=... truco-boteco
```

### Google OAuth

No [Google Cloud Console](https://console.cloud.google.com/apis/credentials) crie um
*OAuth client ID* do tipo **Web** com a URI de redirecionamento
`${PUBLIC_URL}/auth/google/callback`.

## Painel de KPIs (`/admin`)

Acessos, contas, jogos e pessoas em tempo real: online agora, mesas em jogo, fila, visitas e
visitantes únicos, contas novas e conversão, ativos no dia/semana/mês, horário de pico, partidas por
tipo, duração média, W.O., top Elo e partidas recentes (períodos de 7, 30 ou 90 dias).

Acesso liberado para os e-mails em `ADMIN_EMAILS` (separados por vírgula). Em desenvolvimento,
com `ADMIN_EMAILS` vazio, qualquer login de teste vê o painel. O botão **Painel** aparece no topo
para quem tem acesso.

## Testes

```bash
npm test         # engine, robôs (centenas de partidas robô x robô) e servidor via Socket.IO
npm run typecheck
```

## Estrutura

| Pasta | O quê |
|---|---|
| `src/engine` | Regras puras e determinísticas (sem I/O) |
| `src/bots` | IA heurística + falas de boteco |
| `src/server` | Express + Socket.IO autoritativo, OAuth, SQLite, Elo, fila, timers |
| `src/client` | React + Vite, mesa mobile-first |
| `tests` | Vitest |
