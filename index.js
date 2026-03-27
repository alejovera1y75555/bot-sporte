require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const claude = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
app.use(express.json());

// ─────────────────────────────────────
// TU número personal — aquí recibes
// la alerta cuando pidan un técnico
// Cámbialo por tu WhatsApp con 57
// ─────────────────────────────────────
const TU_NUMERO = '573164648967';

// ─────────────────────────────────────
// Estado de cada usuario
// 'nuevo'     = primer mensaje
// 'bot'       = siendo atendido por bot
// 'transferido' = pidió técnico humano
// ─────────────────────────────────────
const estadoUsuarios = {};

// ─────────────────────────────────────
// Palabras que piden técnico humano
// ─────────────────────────────────────
const palabrasTransferencia = [
  'técnico', 'tecnico', 'agente', 'humano',
  'persona', 'hablar con alguien', 'transferir',
  'no entiendo', 'no pude', 'no funciono',
];

// ─────────────────────────────────────
// Palabras clave de soporte técnico
// ─────────────────────────────────────
const palabrasClave = [
  'internet', 'wifi', 'red', 'router', 'señal',
  'contraseña', 'password', 'clave',
  'lento', 'lenta', 'tarda', 'demora',
  'no conecta', 'no funciona', 'no carga', 'no abre',
  'pantalla', 'reiniciar', 'reinicio', 'error',
  'cable', 'soporte', 'falla', 'fallo', 'caída', 'ventilador',
  'computador', 'pc', 'impresora', 'sistema'
];

// ─────────────────────────────────────
// Detectores
// ─────────────────────────────────────
function quiereTecnico(mensaje) {
  const mensajeLower = mensaje.toLowerCase();
  return palabrasTransferencia.some(p => mensajeLower.includes(p));
}

function tieneProblema(mensaje) {
  const mensajeLower = mensaje.toLowerCase();
  return palabrasClave.some(p => mensajeLower.includes(p));
}

// ─────────────────────────────────────
// Enviar mensaje por WhatsApp
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
// Preguntarle a Claude
// ─────────────────────────────────────
async function preguntarAClaude(mensajeUsuario) {
  const respuesta = await claude.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    system: `Eres un asistente de soporte técnico amable y claro.
Tu trabajo es ayudar a los usuarios a resolver problemas técnicos paso a paso.
Responde siempre en español, de forma corta y fácil de entender.
Máximo 6 pasos por respuesta. Usa emojis para que sea más amigable.
Al final de cada respuesta agrega siempre: "Si prefieres hablar con un técnico escribe: *técnico*"`,
    messages: [
      { role: 'user', content: mensajeUsuario }
    ]
  });

  return respuesta.content[0].text;
}

// ─────────────────────────────────────
// Webhook verificación
// ─────────────────────────────────────
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('✅ Webhook verificado');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ─────────────────────────────────────
// Recibir mensajes
// ─────────────────────────────────────
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    if (body.object !== 'whatsapp_business_account') {
      return res.sendStatus(404);
    }

    const mensaje = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!mensaje || mensaje.type !== 'text') {
      return res.sendStatus(200);
    }

    const textoUsuario = mensaje.text.body;
    const numeroUsuario = mensaje.from;

    console.log(`📩 Mensaje de ${numeroUsuario}: ${textoUsuario}`);

    // ── Si el usuario ya fue transferido a técnico
    // el bot no interrumpe esa conversación ──
    if (estadoUsuarios[numeroUsuario] === 'transferido') {
      console.log('👨‍💻 Usuario ya transferido — bot en silencio');
      return res.sendStatus(200);
    }

    // ── Primer mensaje — saludo y presentación ──
    if (!estadoUsuarios[numeroUsuario]) {
      console.log('🆕 Nuevo usuario — enviando saludo');
      estadoUsuarios[numeroUsuario] = 'bot';

      await enviarMensaje(numeroUsuario,
        '👋 ¡Hola! Bienvenido al soporte técnico.\n\n🤖 Soy el asistente virtual y estoy aquí para ayudarte con problemas de:\n• Internet y WiFi\n• Contraseñas\n• Computadores e impresoras\n• Errores del sistema\n\nCuéntame, *¿qué problema tienes?* 🛠️\n\nSi prefieres hablar directamente con un técnico escribe: *técnico*'
      );

      return res.sendStatus(200);
    }

    // ── El usuario pide técnico humano ──
    if (quiereTecnico(textoUsuario)) {
      console.log('👨‍💻 Usuario pidió técnico humano');
      estadoUsuarios[numeroUsuario] = 'transferido';

      await enviarMensaje(numeroUsuario,
        '👨‍💻 Perfecto, te voy a conectar con un técnico en sistemas ahora mismo.\n\n⏳ Por favor espera un momento, en breve te contactará.'
      );

      await enviarMensaje(TU_NUMERO,
        `🔔 *ALERTA - Cliente necesita técnico*\n\nNúmero del cliente: +${numeroUsuario}\n\nEscríbele directamente para atenderlo.`
      );

      return res.sendStatus(200);
    }

    // ── El usuario describe un problema técnico ──
    if (tieneProblema(textoUsuario)) {
      console.log('🔍 Problema técnico — consultando Claude...');
      const respuestaClaude = await preguntarAClaude(textoUsuario);
      await enviarMensaje(numeroUsuario, respuestaClaude);
      console.log('✅ Respuesta enviada');
      return res.sendStatus(200);
    }

    // ── Mensaje que no encaja en nada — Claude responde igual ──
    const respuestaClaude = await preguntarAClaude(textoUsuario);
    await enviarMensaje(numeroUsuario, respuestaClaude);
    return res.sendStatus(200);

  } catch (error) {
    console.error('❌ Error:', error.message);
    res.sendStatus(500);
  }
});

// ─────────────────────────────────────
// Iniciar servidor
// ─────────────────────────────────────
const PUERTO = 3000;
app.listen(PUERTO, () => {
  console.log(`🚀 Bot corriendo en http://localhost:${PUERTO}`);
});