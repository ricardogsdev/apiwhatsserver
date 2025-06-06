const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const clients = {};  // múltiplas sessões

app.use(bodyParser.json());
app.use(cors());

function createClient(sessionId) {
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: sessionId }),
        puppeteer: { headless: true }
    });

    client.on('qr', qr => {
        qrcode.toDataURL(qr, (err, url) => {
            clients[sessionId].qr = url;
        });
    });

    client.on('ready', () => {
        clients[sessionId].status = 'inChat';
    });

    client.on('disconnected', () => {
        clients[sessionId].status = 'disconnected';
    });

    client.initialize();
    return client;
}

app.post('/start', (req, res) => {
    const { session } = req.body;

    if (!clients[session]) {
        clients[session] = { status: 'starting' };
        const client = createClient(session);
        clients[session].client = client;
    }

    res.json({ session, status: 'started' });
});

app.get('/getQrCode', (req, res) => {
    const { session } = req.query;

    if (clients[session] && clients[session].qr) {
        res.send(clients[session].qr);
    } else {
        res.status(404).json({ error: 'QR Code not available' });
    }
});

app.post('/getConnectionStatus', (req, res) => {
    const { session } = req.body;
    const status = clients[session]?.status || 'disconnected';
    const qrCode = clients[session]?.qr || null;

    res.json({ status, data: { qrCode } });
});

app.post('/sendText', async (req, res) => {
    const { session, number, text } = req.body;
    const sessionkey = req.headers['sessionkey'];

    if (session !== sessionkey) {
        return res.status(401).json({ status: 'Unauthorized' });
    }

    const clientObj = clients[session];
    if (!clientObj || clientObj.status !== 'inChat') {
        return res.status(404).json({ status: 'NOT FOUND' });
    }

    try {
        await clientObj.client.sendMessage(number + '@c.us', text);
        res.json({ status: 'SENT' });
    } catch (e) {
        res.status(500).json({ error: true, message: e.message });
    }
});

app.listen(3333, () => console.log('WhatsApp API running on port 3333'));
