// Cargamos las librerías que instalamos
require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

// Iniciamos la app y el cliente de Claude
const app = express();
const claude = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
app.use(express.json());

// ─────────────────────────────────────
// PALABRAS CLAVE de soporte técnico
// Agrega o quita las que quieras
// ─────────────────────────────────────
const palabrasClave = [
  'internet', 'wifi', 'red', 'router', 'señal',
  'contraseña', 'password', 'clave',
  'lento', 'lenta', 'tarda', 'demora',
  'no conecta', 'no funciona', 'no carga', 'no abre',
  'pantalla', 'reiniciar', 'reinicio', 'error',
  'cable', 'soporte', 'falla', 'fallo', 'caída' , 'ventilador'
];

// ─────────────────────────────────────
// FUNCIÓN: detectar si el mensaje
// contiene alguna palabra clave
// ─────────────────────────────────────
function contienePalabraClave(mensaje) {
  const mensajeLower = mensaje.toLowerCase();
  return palabrasClave.some(palabra => mensajeLower.includes(palabra));
}

// ─────────────────────────────────────
// FUNCIÓN: enviar mensaje por WhatsApp
// ─────────────────────────────────────
async function enviarMensaje(numero, texto) {
  const url = `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: numero,
      type: 'text',
      text: { body: texto }
    })
  });

  const resultado = await response.json();
  console.log('📤 Respuesta de Meta:', JSON.stringify(resultado));
  return resultado;
  
}

// ─────────────────────────────────────
// FUNCIÓN: preguntarle a Claude cómo
// resolver el problema del usuario
// ─────────────────────────────────────
async function preguntarAClaude(mensajeUsuario) {
  const respuesta = await claude.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    system: `Eres un asistente de soporte técnico amable y claro. 
    Tu trabajo es ayudar a los usuarios a resolver problemas técnicos paso a paso.
    Responde siempre en español, de forma corta y fácil de entender.
    Máximo 3 pasos por respuesta. Usa emojis para que sea más amigable.`,
    messages: [
      { role: 'user', content: mensajeUsuario }
    ]
  });

  return respuesta.content[0].text;
}

// ─────────────────────────────────────
// RUTA: verificación del webhook
// Meta llama aquí para confirmar
// que tu servidor es tuyo
// ─────────────────────────────────────
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('✅ Webhook verificado correctamente');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ─────────────────────────────────────
// RUTA: recibir mensajes de WhatsApp
// Aquí llega cada mensaje de un usuario
// ─────────────────────────────────────
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    // Verificamos que es un mensaje de WhatsApp
    if (body.object !== 'whatsapp_business_account') {
      return res.sendStatus(404);
    }

    const mensaje = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    // Si no hay mensaje de texto, ignoramos
    if (!mensaje || mensaje.type !== 'text') {
      return res.sendStatus(200);
    }

    const textoUsuario = mensaje.text.body;
    const numeroUsuario = mensaje.from;

    console.log(`📩 Mensaje de ${numeroUsuario}: ${textoUsuario}`);

    // Detectamos si tiene palabra clave
    if (contienePalabraClave(textoUsuario)) {
      console.log('🔍 Palabra clave detectada — consultando a Claude...');

      const respuestaClaude = await preguntarAClaude(textoUsuario);
      await enviarMensaje(numeroUsuario, respuestaClaude);

      console.log('✅ Respuesta enviada');
    } else {
      // Si no hay palabra clave, mensaje genérico
      const mensajeGenerico = '👋 Hola, soy el asistente de soporte técnico. Puedo ayudarte con problemas de internet, wifi, contraseñas, y más. ¿Cuál es tu problema?';
      await enviarMensaje(numeroUsuario, mensajeGenerico);
    }

    res.sendStatus(200);

  } catch (error) {
    console.error('❌ Error:', error.message);
    res.sendStatus(500);
  }
});

// ─────────────────────────────────────
// Iniciamos el servidor en el puerto 3000
// ─────────────────────────────────────
const PUERTO = 3000;
app.listen(PUERTO, () => {
  console.log(`🚀 Bot corriendo en http://localhost:${PUERTO}`);
});