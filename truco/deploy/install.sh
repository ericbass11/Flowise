#!/usr/bin/env bash
# Instala/atualiza o Truco do Boteco numa VPS Ubuntu/Debian (ex.: Contabo).
#
#   curl -fsSL https://raw.githubusercontent.com/ericbass11/Flowise/ccr-622c48ad-0c8zah/truco/deploy/install.sh | sudo bash
#
# Rodar de novo atualiza o código e reinicia, mantendo banco e configuração.
# Variáveis opcionais: DOMAIN=jogo.seudominio.com  BRANCH=main  INSTALL_DIR=/opt/truco
set -euo pipefail

REPO="${REPO:-https://github.com/ericbass11/Flowise.git}"
BRANCH="${BRANCH:-ccr-622c48ad-0c8zah}"
INSTALL_DIR="${INSTALL_DIR:-/opt/truco}"

say() { printf '\n\033[1;33m🃏 %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Rode como root (sudo)."
command -v apt-get >/dev/null || die "Este script é para Ubuntu/Debian."

say "Instalando dependências (git, curl, docker)..."
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git curl ca-certificates openssl iproute2 >/dev/null
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 não encontrado."

say "Baixando o código ($BRANCH)..."
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$INSTALL_DIR" checkout -q -B "$BRANCH" FETCH_HEAD
else
  git clone -q --depth 1 --branch "$BRANCH" "$REPO" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR/truco/deploy"

ENV_FILE=.env
if [ ! -f "$ENV_FILE" ]; then
  IP="$(curl -fsS4 https://api.ipify.org || hostname -I | awk '{print $1}')"
  DOMAIN="${DOMAIN:-${IP}.sslip.io}"
  ADMIN_NAME="admin-$(openssl rand -hex 3)"
  cat > "$ENV_FILE" <<ENV
# Gerado pelo install.sh em $(date -Iseconds). Edite e rode o install.sh de novo para aplicar.
DOMAIN=$DOMAIN
JWT_SECRET=$(openssl rand -hex 32)
# Login sem Google, para teste. Troque para false quando configurar o Google.
TEST_LOGIN=true
# Quem vê o painel /admin. No login de teste, entre com o apelido antes do @.
ADMIN_EMAILS=${ADMIN_NAME}@dev.local
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# Modo: caddy (HTTPS automático nas portas 80/443) ou porta (só 127.0.0.1:APP_PORT, para seu proxy)
MODE=caddy
APP_PORT=3001
ENV
  chmod 600 "$ENV_FILE"
  FIRST_RUN=1
fi
set -a; . "./$ENV_FILE"; set +a

if [ "${MODE:-caddy}" = "caddy" ]; then
  busy=""
  for p in 80 443; do
    ours="$(docker ps -q --filter label=com.docker.compose.project=truco --filter label=com.docker.compose.service=caddy)"
    if ss -ltnH "sport = :$p" | grep -q . && [ -z "$ours" ]; then busy="$busy $p"; fi
  done
  if [ -n "$busy" ]; then
    die "Porta(s)$busy já em uso (nginx/apache/outro app?). Pare o serviço ou edite $INSTALL_DIR/truco/deploy/.env com MODE=porta e aponte seu proxy para 127.0.0.1:${APP_PORT:-3001}."
  fi
  if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
    ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
  fi
  PROFILE=(--profile caddy)
else
  PROFILE=()
fi

say "Construindo e subindo (a primeira vez leva alguns minutos)..."
docker compose "${PROFILE[@]}" up -d --build --remove-orphans

say "Aguardando o jogo responder..."
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${APP_PORT:-3001}/auth/config" >/dev/null 2>&1; then OK=1; break; fi
  sleep 2
done
[ "${OK:-}" = 1 ] || die "O app não respondeu. Veja os logs: cd $INSTALL_DIR/truco/deploy && docker compose logs app"

URL="https://$DOMAIN"; [ "${MODE:-caddy}" = "caddy" ] || URL="http://127.0.0.1:${APP_PORT:-3001} (atrás do seu proxy)"
say "Pronto! Jogo no ar em: $URL"
echo "   Painel: $URL/admin"
if [ -n "${FIRST_RUN:-}" ]; then
  echo "   Para ver o painel: 'Entrar como teste' com o apelido: ${ADMIN_EMAILS%@dev.local}"
fi
echo "   Configuração: $INSTALL_DIR/truco/deploy/.env   (depois de editar, rode este script de novo)"
echo "   Logs: cd $INSTALL_DIR/truco/deploy && docker compose logs -f app"
echo "   O certificado HTTPS pode levar ~1 min no primeiro acesso."
