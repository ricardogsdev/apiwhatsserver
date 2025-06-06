#!/bin/bash

set -e  # Encerra em caso de erro

# === Carregar variáveis de ambiente ===
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
else
    echo "❌ Arquivo .env não encontrado! Crie um arquivo .env com as configurações necessárias."
    exit 1
fi

FULL_DOMAIN="${SUBDOMINIO}.${DOMINIO}"

echo "🚀 Variáveis carregadas:"
echo "Domínio completo: $FULL_DOMAIN"
echo "Git Repo: $GIT_REPO"
echo "Porta: $PORT"

echo "🚀 Atualizando o sistema..."
sudo apt update && sudo apt upgrade -y

echo "🚀 Instalando dependências essenciais..."
sudo apt install -y git curl build-essential nginx certbot python3-certbot-nginx

echo "🚀 Instalando Node.js (v${NODE_VERSION} LTS)..."
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
sudo apt install -y nodejs

echo "🚀 Instalando Google Chrome (para Puppeteer)..."
wget ${CHROME_URL}
sudo apt install -y ./google-chrome-stable_current_amd64.deb
rm google-chrome-stable_current_amd64.deb

echo "🚀 Clonando repositório da API..."
git clone $GIT_REPO whatsapp-api || echo "⚠️ Repositório já clonado."
cd whatsapp-api

echo "🚀 Instalando dependências Node.js..."
npm install

echo "🚀 Instalando PM2 para gerenciar a aplicação..."
sudo npm install -g pm2

echo "🚀 Criando diretório para sessões..."
mkdir -p sessions

echo "🚀 Iniciando a aplicação com PM2..."
pm2 start $APP_ENTRY --name $APP_NAME --watch --env production -- --port $PORT
pm2 save
pm2 startup

echo "🚀 Configurando Nginx para proxy reverso..."

NGINX_CONF="/etc/nginx/sites-available/${SUBDOMINIO}-${DOMINIO}"

sudo tee $NGINX_CONF > /dev/null <<EOF
server {
    listen 80;
    server_name ${FULL_DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

sudo ln -sf $NGINX_CONF /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

echo "🚀 Ajustando firewall para Nginx..."
sudo ufw allow 'Nginx Full' || echo "⚠️ UFW não configurado ou não instalado."

echo "🚀 Gerando certificado SSL com Let's Encrypt..."
sudo certbot --nginx -d ${FULL_DOMAIN} --non-interactive --agree-tos -m $EMAIL --redirect

echo "✅ Instalação e configuração finalizadas!"
echo "============================================="
echo "✅ API disponível em: https://${FULL_DOMAIN}"
echo "✅ PM2 app name: $APP_NAME"
echo "✅ Pasta para sessões: $(pwd)/sessions"
echo "✅ Porta local: $PORT"
echo "✅ Subdomínio configurado: ${FULL_DOMAIN}"
echo "✅ Configuração Nginx: $NGINX_CONF"
echo "✅ Para monitorar: pm2 status"
echo "✅ Para ver logs: pm2 logs $APP_NAME"
echo "============================================="
