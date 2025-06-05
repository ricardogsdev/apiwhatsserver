const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const axios = require('axios');

const app = express();
app.use(express.json());

const client = new Client({
    authStrategy: new LocalAuth({ clientId: "client" }),
    puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
});

client.on('qr', (qr) => {
    console.log('QR RECEIVED', qr);
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Client is ready!');
});

client.on('disconnected', (reason) => {
    console.log('Client was logged out', reason);
    axios.post('http://SEU_BACKEND/webhook/disconnect', { reason })
        .catch(err => console.error('Erro ao enviar webhook:', err));
    client.initialize();
});

client.initialize();

app.post('/send', async (req, res) => {
    const { number, message } = req.body;
    try {
        const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
        await client.sendMessage(chatId, message);
        res.send({ status: 'success', message: 'Message sent' });
    } catch (error) {
        console.error(error);
        res.status(500).send({ status: 'error', message: error.message });
    }
});

app.get('/status', (req, res) => {
    res.send({ status: 'online' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});