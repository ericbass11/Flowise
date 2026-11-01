# Spec 001 — Truco Online (Paulista, 2x2) com robôs

Status: aprovada (entrevista `/grill-me`, 20 decisões) · Data: 2026-11-01

## Visão

Um jogo de **Truco Paulista em duplas (2x2)** jogável no navegador, online com amigos ou
desconhecidos, e com **robôs** que completam qualquer vaga. Clima de **boteco**: mesa de bar,
falas debochadas dos robôs ("TRUCO, ladrão!").

## Decisões (registro da entrevista)

| # | Tema | Decisão |
|---|------|---------|
| 1 | Local | App isolado em `truco/` neste repositório, sem tocar no Flowise |
| 2 | Variante | Truco Paulista: baralho de 40 cartas, vira define a manilha |
| 3 | Jogadores | Somente 2x2 (duplas) |
| 4 | Online | Salas privadas por código **e** fila pública |
| 5 | Contas | Login + ranking + histórico |
| 6 | Login | Google OAuth |
| 7 | Banco | SQLite |
| 8 | Ranking | Elo |
| 9 | Robôs | Heurística com níveis: fácil / médio / difícil |
| 10 | Queda | Partida pausa até 2 min aguardando reconexão; depois, W.O. |
| 11 | Regras | Mão de 11, mão de ferro, carta coberta, truco/6/9/12 com resposta |
| 12 | Vitória | 12 pontos, 1 jogo |
| 13 | Chat | Chat de texto + sinais rápidos ao parceiro |
| 14 | Sinais | Cada sinal tem ~20% de chance de ser visto pelo adversário |
| 15 | Stack | TypeScript: Node + Express + Socket.IO + SQLite (`node:sqlite`) / React + Vite |
| 16 | Visual | Boteco/rua, mobile-first, em português |
| 17 | Deploy | Local + Dockerfile |
| 18 | Dev login | Botão "entrar como teste" somente com `NODE_ENV=development` |
| 19 | Elo | Só partidas da fila pública com 4 humanos; W.O. = derrota |
| 20 | Fila | Após 60 s sem 4 humanos, robôs (médio) completam; partida não vale Elo |

## Histórias de usuário

1. **Jogar sozinho contra robôs** — Como jogador, crio uma sala, preencho as 3 vagas com robôs
   (escolhendo o nível) e jogo imediatamente.
2. **Jogar com amigos** — Crio uma sala, compartilho o código/link; amigos entram nas vagas;
   vagas restantes podem ser robôs; escolho a dupla de cada um trocando de lugar.
3. **Fila pública** — Entro na fila; quando houver 4 humanos a partida começa valendo Elo. Se
   em 60 s não houver, robôs completam (sem Elo) e sou avisado.
4. **Ranking e histórico** — Vejo o ranking por Elo e o histórico das minhas partidas.
5. **Comunicação** — Converso no chat da mesa e mando sinais ao parceiro (zap, copas, espadilha,
   pica-fumo, "tenho três", "não tenho nada"); o adversário às vezes "flagra" o sinal.
6. **Queda** — Se eu cair, a partida pausa até 2 min; se eu voltar, continuo de onde parei.

## Regras do jogo (fonte da verdade da engine)

- **Baralho**: 40 cartas (sem 8, 9, 10). Ordem de força das comuns:
  `4 < 5 < 6 < 7 < Q < J < K < A < 2 < 3`.
- **Vira e manilha**: após dar 3 cartas a cada um, vira-se uma carta; a manilha é a carta
  seguinte na ordem (após o 3 volta ao 4). Força entre manilhas por naipe:
  `♦ (pica-fumo) < ♠ (espadilha) < ♥ (copas) < ♣ (zap)`.
- **Empates de cartas comuns** de mesmo valor e de duplas diferentes "cangam" (empatam a vaza).
- **Mão**: até 3 vazas, vence quem fizer 2. Regras de empate:
  - 1ª empata → vence quem ganhar a 2ª; se a 2ª também empatar → quem ganhar a 3ª; se as 3
    empatarem → ninguém pontua.
  - 1ª ganha por A e 2ª empata → A vence.
  - 1ª A, 2ª B, 3ª empata → vence quem ganhou a 1ª (A).
- **Quem começa a vaza**: o vencedor da vaza anterior; em empate, começa quem iniciou a vaza
  empatada. A cada mão o "pé" (quem começa) gira no sentido anti-horário.
- **Valor da mão**: 1 ponto. Pedidos: **truco** (3), **seis** (6), **nove** (9), **doze** (12).
  Quem recebe o pedido (a dupla adversária) pode **aceitar**, **correr** (o pedinte ganha o
  valor anterior) ou **aumentar**. Uma dupla não pode aumentar a própria aposta consecutivamente.
- **Mão de 11**: a dupla com 11 (e só ela) vê as cartas do parceiro e decide jogar (vale 3) ou
  correr (adversário ganha 1). Ninguém pode pedir truco nessa mão (o botão fica desabilitado;
  o servidor rejeita).
- **Mão de ferro**: ambas com 11 → todos jogam com cartas cobertas e sem truco; a mão vale 1.
- **Carta coberta**: a partir da 2ª vaza o jogador pode jogar uma carta virada; ela vale menos
  que qualquer carta e nunca empata.
- **Fim**: primeira dupla com 12+ pontos vence.

## Requisitos funcionais

- RF1 A engine é pura (sem I/O), determinística dado um RNG, e coberta por testes.
- RF2 O servidor é autoritativo: cliente só envia intenções; cada jogador recebe apenas a sua
  visão (cartas alheias ocultas, exceto o parceiro na mão de 11).
- RF3 Robôs jogam com atraso humano (0,6–1,6 s) e falam frases de boteco.
- RF4 Tempo por ação: 30 s; humano sem ação → jogada automática (a heurística do robô médio
  decide por ele). Desconexão → pausa de até 2 min → W.O.
- RF5 Elo K=32 com média da dupla; só fila pública com 4 humanos; W.O. = derrota da dupla.
- RF6 Histórico salva placar final, participantes, data, tipo (privada/fila), W.O.
- RF7 Login Google OAuth 2.0 (Authorization Code); sessão em cookie JWT httpOnly. Login de dev
  disponível só com `NODE_ENV=development`.

## Fora do escopo (MVP)

Outras variantes, 1x1, espectadores, torneios, moderação de chat, app nativo.
