import fs from 'node:fs';
import path from 'node:path';
import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { Boom } from '@hapi/boom';
import { chatWithTutor, analyzeImage } from './ai.js';
import { getHistory, getOrCreateStudent, saveMessage } from './database.js';
import { ensureRegistered } from './studentManager.js';
import { answerQuiz, activeQuizzes, startQuiz, stopQuiz } from './quizGenerator.js';
import { createLessonPdf } from './pdf.js';
import { commandOf, extractText, menuText, phoneFromJid } from './utils/helpers.js';
import { synthesizeVoice, transcribeVoice } from './utils/voice.js';

const pendingFiches = new Map();
const voicePrefs = new Map();

export async function startWhatsAppBot() {
  const authDir = process.env.AUTH_DIR || 'auth';
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === 'open') console.log('Bot WhatsApp connecte.');
    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        startWhatsAppBot().catch(console.error);
      } else {
        console.log('Session deconnectee. Supprime auth/ puis relance si necessaire.');
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const message of messages) {
      if (!message.message || message.key.fromMe) continue;
      await handleMessage(sock, message).catch(async (error) => {
        console.error(error);
        if (message.key.remoteJid) {
          await sock.sendMessage(message.key.remoteJid, { text: `Erreur: ${error.message}` });
        }
      });
    }
  });
}

async function handleMessage(sock, raw) {
  const jid = raw.key.remoteJid;
  if (!jid || jid.endsWith('@g.us')) return;

  const phone = phoneFromJid(jid);
  let text = extractText(raw.message);
  const hasVoice = Boolean(raw.message?.audioMessage);
  const hasImage = Boolean(raw.message?.imageMessage);

  if (hasVoice) {
    const audioPath = await saveIncomingMedia(raw, 'voice');
    text = await transcribeVoice(audioPath);
  }

  const registration = await ensureRegistered(phone, text);
  if (registration.reply) await sendReply(sock, jid, registration.reply, phone, hasVoice);
  if (!registration.registered) return;

  if (hasImage) {
    const reply = await handleImage(raw, text);
    await sendReply(sock, jid, reply, phone, hasVoice);
    return;
  }

  if (!text) return;

  if (activeQuizzes.has(phone) && !text.startsWith('/')) {
    const reply = await answerQuiz(phone, text);
    await sendReply(sock, jid, reply, phone, hasVoice);
    return;
  }

  if (pendingFiches.has(phone) && !text.startsWith('/')) {
    const { subject, classLevel } = pendingFiches.get(phone);
    pendingFiches.delete(phone);
    await sock.sendMessage(jid, { text: 'Je prepare la fiche PDF...' });
    const history = await getHistory(phone);
    const context = history.map((item) => `${item.role}: ${item.content}`).join('\n').slice(-1200);
    const filePath = await createLessonPdf({ phone, subject, topic: text, classLevel, context });
    await sock.sendMessage(jid, {
      document: fs.readFileSync(filePath),
      fileName: `fiche-${subject}.pdf`,
      mimetype: 'application/pdf'
    });
    return;
  }

  const { command, arg } = commandOf(text);
  if (command) {
    await handleCommand(sock, jid, phone, command, arg, hasVoice);
    return;
  }

  await saveMessage(phone, 'user', text);
  const history = await getHistory(phone);
  const reply = await chatWithTutor(text, history);
  await saveMessage(phone, 'assistant', reply);
  await sendReply(sock, jid, reply, phone, hasVoice);
}

async function handleCommand(sock, jid, phone, command, arg, forceVoice) {
  if (['/menu', '/aide', '/help'].includes(command)) {
    await sendReply(sock, jid, menuText(), phone, forceVoice);
    return;
  }

  if (['/stop', '/annuler', '/cancel'].includes(command)) {
    const stopped = stopQuiz(phone) || pendingFiches.delete(phone);
    await sendReply(sock, jid, stopped ? 'Action annulee.' : 'Aucune action en cours.', phone, forceVoice);
    return;
  }

  if (command === '/vocal') {
    const enabled = !voicePrefs.get(phone);
    voicePrefs.set(phone, enabled);
    await sock.sendMessage(jid, { text: enabled ? 'Reponses vocales activees.' : 'Reponses vocales desactivees.' });
    return;
  }

  const student = await getOrCreateStudent(phone);

  if (command === '/profil') {
    await sendReply(
      sock,
      jid,
      `Nom: ${student.name}\nClasse: ${student.class_level}\nMatieres: ${(student.subjects || []).join(', ') || 'aucune'}`,
      phone,
      forceVoice
    );
    return;
  }

  if (command === '/quiz') {
    const subject = arg || student.subjects?.[0] || 'mathematiques';
    await sock.sendMessage(jid, { text: `Je prepare un quiz en ${subject}...` });
    const reply = await startQuiz(phone, subject, student.class_level);
    await sendReply(sock, jid, reply, phone, forceVoice);
    return;
  }

  if (command === '/fiche') {
    const subject = arg || student.subjects?.[0] || 'cours';
    pendingFiches.set(phone, { subject, classLevel: student.class_level });
    await sendReply(sock, jid, `Quel sujet exact pour la fiche de ${subject} ?`, phone, forceVoice);
    return;
  }

  await sendReply(sock, jid, 'Commande inconnue. Tape /menu.', phone, forceVoice);
}

async function handleImage(raw, caption) {
  const buffer = await downloadMediaMessage(raw, 'buffer', {});
  const resized = await sharp(buffer)
    .rotate()
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  return analyzeImage({
    base64Image: resized.toString('base64'),
    mimeType: 'image/jpeg',
    caption
  });
}

async function saveIncomingMedia(raw, prefix) {
  const buffer = await downloadMediaMessage(raw, 'buffer', {});
  const type = await fileTypeFromBuffer(buffer);
  const ext = type?.ext || 'bin';
  const tmpDir = process.env.TMP_DIR || 'tmp';
  fs.mkdirSync(tmpDir, { recursive: true });
  const filePath = path.join(tmpDir, `${prefix}-${Date.now()}.${ext}`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

async function sendReply(sock, jid, text, phone, forceVoice = false) {
  if ((forceVoice || voicePrefs.get(phone)) && text.length <= 180) {
    try {
      const voicePath = await synthesizeVoice(text);
      await sock.sendMessage(jid, {
        audio: fs.readFileSync(voicePath),
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true
      });
      return;
    } catch (error) {
      console.warn('TTS indisponible, fallback texte:', error.message);
    }
  }

  await sock.sendMessage(jid, { text });
}
