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

### VPS própria (Contabo, etc.) — recomendado

Numa VPS Ubuntu/Debian, como root:

```bash
curl -fsSL https://raw.githubusercontent.com/ericbass11/Flowise/ccr-622c48ad-0c8zah/truco/deploy/install.sh | bash
```

O script instala o Docker, baixa o código em `/opt/truco`, gera `.env` com segredo e um apelido de
admin, e sobe o app com **Caddy** (HTTPS automático). Sem domínio próprio, usa `<IP>.sslip.io`.
Os dados (SQLite) ficam num volume Docker e **sobrevivem** a reinícios e atualizações.

- Atualizar: rode o mesmo comando de novo.
- Domínio próprio: aponte um registro A para o IP e rode com `DOMAIN=jogo.seudominio.com` (ou edite
  `/opt/truco/truco/deploy/.env` e rode de novo).
- Já tem nginx/apache nas portas 80/443? Use `MODE=porta` no `.env` e aponte seu proxy para
  `127.0.0.1:3001` (com suporte a WebSocket).
- Logs: `cd /opt/truco/truco/deploy && docker compose logs -f app`.
- Backup do banco: `docker compose cp app:/data/truco.db ./backup.db`.

### Render (deploy de teste)

O arquivo [`render.yaml`](../render.yaml) na raiz do repositório cria o serviço sozinho:

1. Em [render.com](https://render.com), entre com o GitHub e clique em **New → Blueprint**.
2. Escolha o repositório e a branch; o Render lê o `render.yaml`.
3. Preencha `ADMIN_EMAILS` (ex.: `seu-apelido-secreto@dev.local` enquanto usa o login de teste).
   `GOOGLE_CLIENT_ID/SECRET` podem ficar vazios por enquanto.
4. **Deploy**. O jogo fica em `https://truco-boteco.onrender.com` (ou nome parecido).

Plano grátis: o serviço dorme após 15 min sem acesso (acorda em ~1 min) e o disco é temporário —
contas, ranking e o histórico do painel **zeram a cada deploy/reinício**. Para guardar dados, use o
plano pago com disco persistente (`DATABASE_FILE=/data/truco.db`).

`TEST_LOGIN=true` libera o login sem Google para qualquer pessoa: use um apelido difícil de adivinhar
no `ADMIN_EMAILS` e desligue (`false`) quando o Google estiver configurado.

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
