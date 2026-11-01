# Plano técnico — 001 Truco Online

## Arquitetura

```
truco/
├─ src/engine/     # regras puras (sem I/O): baralho, manilha, vazas, apostas, mão de 11/ferro
├─ src/bots/       # IA heurística (fácil/médio/difícil) + falas de boteco
├─ src/server/     # Express + Socket.IO (autoritativo), auth Google, SQLite, Elo, fila
├─ src/client/     # React + Vite (mesa de boteco, lobby, ranking, histórico)
├─ tests/          # Vitest: engine, bots (partidas completas bot x bot), elo
└─ Dockerfile
```

Pacote único (`truco/package.json`), fora do workspace pnpm do Flowise (`packages/*`),
portanto não afeta o build/turbo do Flowise.

## Fluxo de dados

1. Cliente autentica (`/auth/google` → callback → cookie `truco_session` JWT httpOnly).
2. Cliente abre Socket.IO; o handshake valida o cookie → `userId`.
3. Ações: `room:create`, `room:join`, `room:seat`, `room:addBot`, `room:start`,
   `queue:join`, `queue:leave`, `game:action`, `chat:send`, `signal:send`.
4. Servidor aplica `applyAction(state, seat, action)` da engine; em sucesso envia a cada socket
   `game:state` = `viewFor(state, seat)` (cartas ocultas).
5. Turno de robô: agendado com atraso humano; turno humano: timer de 30 s.
6. Fim da partida: grava `Match` + `MatchPlayer`; se `ranked`, atualiza Elo.

## Engine (API)

- `newGame(rng, startSeat?) → GameState`
- `legalActions(state, seat) → Action[]`
- `applyAction(state, seat, action) → GameState` (imutável; lança `RuleError`)
- `viewFor(state, seat) → PlayerView`
- Ações: `play {card, covered?}`, `raise`, `accept`, `run`, `mao11 {play|run}`.
- Assentos 0..3; dupla = `seat % 2`; ordem anti-horária `seat+1`.

## Robôs

Força da mão = soma de pesos (manilhas ≫ 3 > 2 > A ...). Dificuldade ajusta: limiar para
pedir/aceitar truco, taxa de blefe, uso de "carta mais baixa que vence" e leitura do parceiro
(se o parceiro já está ganhando a vaza, descarta a menor). Difícil considera cartas já jogadas
e os sinais recebidos do parceiro.

## Banco (SQLite via `node:sqlite`, nativo do Node 22 — sem ORM/dependência nativa)

`User(id, googleId, email, name, avatar, elo=1000, wins, losses, createdAt)`
`Match(id, ranked, kind, scoreA, scoreB, winnerTeam, walkover, createdAt)`
`MatchPlayer(matchId, userId?, seat, team, isBot, botLevel, eloBefore, eloAfter)`

## Elo

`E = 1/(1+10^((Rb−Ra)/400))`, `K = 32`, `R' = R + K(S−E)` aplicado a cada jogador
usando as médias das duplas.

## Riscos

- Credenciais Google são do usuário → `.env.example` + login de dev local.
- Estado de salas em memória → reinício do servidor encerra partidas em andamento (aceito no MVP).
