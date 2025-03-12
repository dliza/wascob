const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
const port = 3000;

app.use(express.json());

// Diccionario de links (ejemplo) basado en el código recibido
const linksDrive = {
    '1': 'https://drive.google.com/drive/folders/1YPovOfj0gsuEHzmQ1kbozO5Di574RJBS',
    '2': 'https://drive.google.com/drive/folders/10ogFyFt3IEl3DgLehbTtsiEGkoWc5Uzn',
};

// Inicialización del cliente de WhatsApp con persistencia de sesión
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: false } // En producción, podrías cambiar a true
});

// Muestra el QR en consola para escanearlo
client.on('qr', (qr) => {
    console.log('QR recibido, escanéalo con tu teléfono:');
    qrcode.generate(qr, { small: true });
});

// Indica que el cliente está listo para enviar mensajes
client.on('ready', () => {
    console.log('El cliente de WhatsApp está listo!');
});

// Endpoint para recibir la data desde tu Google Form o script externo
app.post('/send-wsp', async (req, res) => {
    const { number, code } = req.body;

    if (!number || !code) {
        return res.status(400).json({ error: 'El número y el código son requeridos' });
    }

    // Buscar el link de fotos basado en el código recibido
    const linkPhoto = linksDrive[code] || 'No hay link disponible';

    // Personaliza el mensaje según tus necesidades
    const message = `Hola,\n\nGracias por participar en nuestro evento.\n\nAquí tienes el link de tus fotos: ${linkPhoto}\n\nSaludos,\nPROMPERU`;

    try {
        // El identificador de WhatsApp se forma agregando '@c.us'
        const chatId = `${number}@c.us`;

        // Envía el mensaje utilizando el cliente de WhatsApp
        await client.sendMessage(chatId, message);
        res.status(200).json({ success: true, message: 'Mensaje enviado correctamente' });
    } catch (error) {
        console.error('Error al enviar mensaje:', error.message);
        res.status(500).json({ success: false, error: 'Error enviando mensaje', details: error.message });
    }
});

// Inicia el servidor Express
app.listen(port, () => {
    console.log(`Servidor corriendo en http://localhost:${port}`);
});

// Inicializa el cliente de WhatsApp
client.initialize();