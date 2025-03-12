const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

const linksDrive = {
    '1': 'https://drive.google.com/drive/folders/1YPovOfj0gsuEHzmQ1kbozO5Di574RJBS',
    '2': 'https://drive.google.com/drive/folders/10ogFyFt3IEl3DgLehbTtsiEGkoWc5Uzn',
};

const sessionDir = path.join(__dirname, 'whatsapp-session');
if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

let globalBrowser = null;
let globalPage = null;

async function initBrowser() {
    if (globalBrowser) {
        try {
            await globalBrowser.pages();
            return globalBrowser;
        } catch (e) {
            console.error("⚠️ Error con el navegador, reiniciando...");
            globalBrowser = null;
        }
    }

    console.log('🟢 Iniciando navegador con sesión guardada...');
    const browser = await puppeteer.launch({
        headless: false,
        userDataDir: './whatsapp-session',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,720']
    });
    globalBrowser = browser;
    return browser;
}

// Función para verificar si WhatsApp Web está autenticado
async function isWhatsAppAuthenticated(page) {
    try {
        // Intenta localizar elementos que solo aparecen cuando estás autenticado
        const authenticated = await page.evaluate(() => {
            // Busca cualquiera de estos elementos que puedan indicar que estás autenticado
            const searchBox = document.querySelector('[data-testid="chat-list-search"]') || 
                              document.querySelector('div[aria-label="Buscar o empezar un chat"]') ||
                              document.querySelector('[data-icon="search"]');
            
            return !!searchBox;
        });
        return authenticated;
    } catch (error) {
        console.error("Error verificando autenticación:", error);
        return false;
    }
}

// Función para lanzar WhatsApp Web al iniciar el servidor
async function launchWhatsApp() {
    try {
        const browser = await initBrowser();
        globalPage = await browser.newPage();
        
        // Configurar viewport para mejor compatibilidad
        await globalPage.setViewport({ width: 1280, height: 800 });
        
        await globalPage.goto('https://web.whatsapp.com/', { 
            waitUntil: 'networkidle2', 
            timeout: 90000 
        });
        
        console.log("WhatsApp Web cargado. Verificando autenticación...");
        
        // Verificar autenticación con un timeout
        let authenticated = false;
        let attempts = 0;
        const maxAttempts = 30; // 5 minutos máximo (10 segundos * 30)
        
        while (!authenticated && attempts < maxAttempts) {
            authenticated = await isWhatsAppAuthenticated(globalPage);
            if (authenticated) {
                console.log("✅ WhatsApp autenticado y listo.");
                break;
            }
            console.log(`Esperando autenticación... (${attempts + 1}/${maxAttempts})`);
            await new Promise(r => setTimeout(r, 10000)); // Esperar 10 segundos entre verificaciones
            attempts++;
        }
        
        if (!authenticated) {
            console.error("❌ Tiempo de espera agotado. Por favor, escanea el código QR manualmente.");
        }
    } catch (error) {
        console.error("Error al lanzar WhatsApp:", error);
    }
}

// Función para enviar mensaje a WhatsApp
async function sendWhatsAppMessage(page, number, message) {
    try {
        // URL directa al chat (más confiable que usar los botones de la interfaz)
        await page.goto(`https://web.whatsapp.com/send?phone=${number}&text=${encodeURIComponent(message)}`, {
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        
        // Esperar a que cargue la página y verificar si el número es válido
        await page.waitForSelector('div[data-testid="conversation-panel-wrapper"]', { timeout: 30000 })
            .catch(() => {
                throw new Error('El número no parece ser válido en WhatsApp o la conversación no pudo cargarse');
            });
        
        // Esperar al botón de enviar y hacer clic en él
        await page.waitForSelector('span[data-testid="send"]', { timeout: 10000 });
        await page.click('span[data-testid="send"]');
        
        // Esperar a que se envíe el mensaje (buscar el tick de enviado)
        await page.waitForSelector('span[data-testid="msg-check"]', { timeout: 10000 })
            .catch(() => {
                console.warn("⚠️ No se pudo verificar el envío del mensaje, pero es posible que se haya enviado");
            });
        
        // Esperar un momento para asegurar que el mensaje se envió completamente
        await new Promise(r => setTimeout(r, 3000));
        
        return true;
    } catch (error) {
        console.error(`Error enviando mensaje a ${number}:`, error.message);
        throw error;
    }
}

// Endpoint para enviar mensaje
app.post('/send-whatsapp', async (req, res) => {
    const { number, code } = req.body;
    if (!number || !code) {
        return res.status(400).json({ error: 'Faltan datos requeridos' });
    }
    
    const cleanNumber = String(number).replace(/[^\d]/g, '');
    const linkPhoto = linksDrive[code] || 'No hay link disponible';
    const message = `Hola,\n\nGracias por participar en nuestro evento.\n\nEnlace de fotos: ${linkPhoto}\n\nSaludos,\nPROMPERU`;

    try {
        // Verificar que el navegador y la página estén inicializados
        if (!globalBrowser || !globalPage || globalPage.isClosed()) {
            console.log("Iniciando nueva sesión de WhatsApp...");
            await launchWhatsApp();
            
            // Si después de intentar iniciar, aún no tenemos navegador o página, es un error
            if (!globalBrowser || !globalPage || globalPage.isClosed()) {
                throw new Error("No se pudo inicializar la sesión de WhatsApp");
            }
        }
        
        // Verificar que WhatsApp esté autenticado
        const authenticated = await isWhatsAppAuthenticated(globalPage);
        if (!authenticated) {
            throw new Error("WhatsApp no está autenticado. Por favor, escanea el código QR.");
        }
        
        // Enviar el mensaje
        const sent = await sendWhatsAppMessage(globalPage, cleanNumber, message);
        
        res.status(200).json({ 
            success: true, 
            message: 'Mensaje enviado correctamente',
            number: cleanNumber,
            link: linkPhoto
        });
    } catch (error) {
        console.error('❌ Error enviando WhatsApp:', error.message);
        res.status(500).json({ 
            success: false, 
            error: 'Error enviando WhatsApp', 
            details: error.message 
        });
    }
});

app.get('/status', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        whatsappSession: globalBrowser && globalPage && !globalPage.isClosed() ? 'Active' : 'Not initialized' 
    });
});

const PORT = process.env.PORT || 3060;
app.listen(PORT, async () => {
    console.log(`✅ Servidor en el puerto ${PORT}`);
    // Se lanza WhatsApp Web al iniciar el servidor
    await launchWhatsApp();
});

process.on('SIGINT', async () => {
    if (globalBrowser) {
        console.log('⚠️ Cerrando navegador...');
        await globalBrowser.close();
    }
    process.exit(0);
});