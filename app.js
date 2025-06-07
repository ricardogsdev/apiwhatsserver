const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('events').EventEmitter.defaultMaxListeners = 40;
process.setMaxListeners(40);


const app = express();
const clients = {};
const SESSIONS_PATH = path.join(__dirname, 'sessions');

app.use(bodyParser.json());
//app.use(cors({ origin: '*' }));
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'apitoken', 'sessionkey', 'session', 'Authorization'],
}));
app.options('*', cors());

require('dotenv').config();

// Garante que a pasta de sessões existe
if (!fs.existsSync(SESSIONS_PATH)) {
    fs.mkdirSync(SESSIONS_PATH);
}




// === CONFIGURAÇÃO DO TOKEN ===
const API_TOKEN = process.env.API_TOKEN;

// Middleware para validar o apitoken
function validateApiToken(req, res, next) {
    const token = req.headers['apitoken'];
    if (!token) {
        return res.status(401).json({ error: 'API token é obrigatório' });
    }
    if (token !== API_TOKEN) {
        return res.status(403).json({ error: 'Token inválido' });
    }
    next();
}

// Middleware para validar sessão
function validateSession(req, res, next) {
    const session = req.headers['sessionkey'] || req.body.sessionkey || req.query.sessionkey ||
                    req.body.session || req.query.session;

    if (!session || session.trim() === '') {
        return res.status(400).json({ error: 'session ou sessionkey é obrigatória' });
    }

    req.sessionName = session;
    next();
}

// Salva sessão no arquivo
function saveSession(sessionId, data) {
    const filePath = path.join(SESSIONS_PATH, `${sessionId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// Carrega sessão do arquivo
function loadSession(sessionId) {
    const filePath = path.join(SESSIONS_PATH, `${sessionId}.json`);
    if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
    return null;
}

// **Carregar todas as sessões automaticamente na inicialização**
function loadAllSessions() {
    if (!fs.existsSync(SESSIONS_PATH)) {
        return;
    }

    const sessionFiles = fs.readdirSync(SESSIONS_PATH);
    sessionFiles.forEach(file => {
        const sessionId = file.replace('.json', '');
        const sessionData = loadSession(sessionId);

        if (sessionData) {
            console.log(`🔄 Restaurando sessão: ${sessionId}`);
            clients[sessionId] = { status: sessionData.status };
            clients[sessionId].client = createClient(sessionId);
        }
    });
}

// Criação do cliente
function createClient(sessionId) {
    const sessionData = loadSession(sessionId);
    
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: sessionId }),
        puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] }
    });

    client.setMaxListeners(40);

    client.on('qr', qr => {
        qrcode.toDataURL(qr, (err, url) => {
            clients[sessionId].qr = url;
            saveSession(sessionId, { qr: url, status: 'waiting_qr' });
        });
    });

    client.on('ready', () => {
        clients[sessionId].status = 'inChat';
        saveSession(sessionId, { status: 'inChat' });
    });

    client.on('disconnected', () => {
        clients[sessionId].status = 'disconnected';
        saveSession(sessionId, { status: 'disconnected' });
    });

    client.initialize();
    return client;
}

app.get('/', (req, res) => {
    res.send('API WhatsApp rodando!');
});

// Inicia uma nova sessão
app.post('/start', validateApiToken, (req, res) => {
    const { session } = req.body;
    if (!session) return res.status(400).json({ error: 'Nome da sessão é obrigatório' });

    if (!clients[session]) {
        clients[session] = { status: 'starting' };
        const client = createClient(session);
        clients[session].client = client;
        saveSession(session, { status: 'starting' });
    }

    res.json({ session, status: 'started' });
});

// Retorna QR Code
app.get('/getQrCode', validateSession, async (req, res) => {
    const { sessionName } = req;
    let maxTentativas = 10; // Número máximo de tentativas antes de desistir
    let intervalo = 2000; // Tempo de espera entre verificações (2 segundos)

    for (let i = 0; i < maxTentativas; i++) {
        const sessionData = loadSession(sessionName);
        const qr = sessionData?.qr || clients[sessionName]?.qr;

        if (qr) {
            return res.json({ session: sessionName, status: 'waiting_qr', qrCode: qr });
        }

        // Aguarda um tempo antes de tentar novamente
        await new Promise(resolve => setTimeout(resolve, intervalo));
    }

    // Se o QR Code não estiver disponível após todas as tentativas
    return res.status(404).json({ session: sessionName, status: 'qrCodeUnavailable', error: 'QR Code não disponível após múltiplas tentativas' });
});


// Verifica o status da conexão
app.post('/getConnectionStatus', validateSession, async (req, res) => {
    const clientObj = clients[req.sessionName];

    if (!clientObj?.client) {
        return res.status(404).json({ error: 'Sessão não encontrada' });
    }

    try {
        const state = await clientObj.client.getState();
        let response = {
            session: req.sessionName,
            status: state === 'CONNECTED' ? 'inChat' : 'disconnected',
            qrcode: clientObj.qr || null
        };

        // Se não estiver conectado, verificar se ainda está aguardando QR Code
        if (state !== 'CONNECTED' && clientObj.qr) {
            response.status = 'waiting_qr';
        }
         // 🚀 Se ainda não houver QR Code na memória, tentar carregar da sessão
        if (!response.qrcode) {
            const sessionData = loadSession(req.sessionName);
            response.qrcode = sessionData?.qr || clients[req.sessionName]?.qr || null;
        }

        return res.json(response);
    } catch (err) {
        return res.status(500).json({ error: 'Erro ao obter estado da conexão', details: err.message });
    }
});

// Envia mensagem de texto
app.post('/sendText', validateSession, async (req, res) => {
    const { number, text } = req.body;
    const session = req.sessionName;

    if (!number || !text) {
        return res.status(400).json({ error: 'Número e texto são obrigatórios' });
    }

    const clientObj = clients[session];
    if (!clientObj?.client) {
        return res.status(404).json({ error: 'Sessão não encontrada' });
    }

    try {
        const state = await clientObj.client.getState();
        if (state !== 'CONNECTED') {
            return res.status(400).json({ error: 'Sessão não está conectada' });
        }

        const numberId = await clientObj.client.getNumberId(number);
        if (!numberId) {
            return res.status(404).json({ error: 'Número não está registrado no WhatsApp' });
        }

        const chat = await clientObj.client.getChatById(numberId._serialized);
        if (!chat) {
            return res.status(500).json({
                error: 'Erro ao acessar a conversa. O número pode estar incorreto ou o cliente não está conectado.'
            });
        }

        await chat.sendMessage(text);
        return res.json({ status: 'Mensagem enviada com sucesso' });
    } catch (e) {
        return res.status(500).json({ 
            error: 'Erro ao enviar mensagem', 
            details: e.message.includes('getChat') 
                ? 'Falha ao acessar a conversa. O número pode estar incorreto ou o cliente não está conectado.'
                : e.message 
        });
    }
});



    // Função para traduzir status
function traduzirStatus(status) {
    const traducoes = {
        'inChat': 'Conectado e ativo',
        'waiting_qr': 'Aguardando leitura do QR Code',
        'disconnected': 'Sessão finalizada ou desconectada',
        'unknown': 'Desconhecido'
    };
    return traducoes[status] || 'Desconhecido';
}
app.post('/disconnectSession', validateSession, async (req, res) => {
    const session = req.sessionName;
    const clientObj = clients[session];

    if (!clientObj?.client) {
        return res.status(404).json({ error: 'Sessão não encontrada' });
    }

    try {
        await clientObj.client.logout();
        clientObj.client.destroy();
        delete clients[session];

        // Também exclui o arquivo da sessão armazenada
        const filePath = path.join(SESSIONS_PATH, `${session}.json`);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        return res.json({ success: true, message: `Sessão ${session} desconectada com sucesso.` });
    } catch (err) {
        return res.status(500).json({ error: 'Erro ao desconectar sessão', details: err.message });
    }
});

app.get('/listarSessoes', validateApiToken, (req, res) => {
    const sessoes = Object.keys(clients).map(sessionId => ({
        sessao: sessionId,
        status: traduzirStatus(clients[sessionId]?.status || 'desconhecido')
    }));

    return res.json({ total: sessoes.length, sessoes });
});



// 🔄 **Ao iniciar a API, carrega todas as sessões salvas**
app.listen(3000, () => {
    console.log('WhatsApp API rodando na porta 3000');
    loadAllSessions();  // 🔄 Carrega todas as sessões salvas na inicialização
});