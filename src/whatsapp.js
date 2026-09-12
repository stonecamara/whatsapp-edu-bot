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
import { createLessonPdf, createQuizPdf } from './pdf.js';
import { commandOf, extractText, menuText, phoneFromJid } from './utils/helpers.js';
import { synthesizeVoice, transcribeVoice } from './utils/voice.js';

const pendingFiches = new Map();
const voicePrefs = new Map();
const mediaDownloadTimeoutMs = Number(process.env.MEDIA_DOWNLOAD_TIMEOUT_MS || 12000);
const mediaDownloadRetries = Number(process.env.MEDIA_DOWNLOAD_RETRIES || 2);
const voiceReplyToIncoming = parseBoolean(process.env.VOICE_REPLY_TO_INCOMING, false);

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
        logErrorSummary('message', error);
        if (message.key.remoteJid) {
          await sock.sendMessage(message.key.remoteJid, { text: userFacingError(error) });
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
    await sendPresence(sock, jid, 'composing');
    const audioPath = await saveIncomingMedia(sock, raw, 'voice').catch((error) => {
      logErrorSummary('voice-download', error);
      throw new UserVisibleError("Je n'arrive pas a recuperer ton vocal depuis WhatsApp. Renvoie un vocal plus court ou ecris ton message.");
    });

    try {
      text = await transcribeVoice(audioPath);
    } catch (error) {
      logErrorSummary('voice-transcription', error);
      throw new UserVisibleError("J'ai recupere le vocal, mais je n'ai pas pu le transcrire. Essaie avec un vocal plus court et plus clair.");
    } finally {
      safeUnlink(audioPath);
    }
  }

  const registration = await ensureRegistered(phone, text);
  if (registration.reply) await sendReply(sock, jid, registration.reply, phone, hasVoice);
  if (!registration.registered) return;

  if (hasImage) {
    await sendPresence(sock, jid, 'composing');
    const reply = await handleImage(sock, raw, text);
    await sendReply(sock, jid, reply, phone, hasVoice);
    return;
  }

  if (!text) return;

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
  await sendPresence(sock, jid, 'composing');
  const history = await getHistory(phone);
  const reply = await chatWithTutor(text, history);
  const chatReply = sanitizeWhatsappChatText(reply);
  await saveMessage(phone, 'assistant', chatReply);
  await sendReply(sock, jid, chatReply, phone, hasVoice);
}

async function handleCommand(sock, jid, phone, command, arg, forceVoice) {
  if (['/menu', '/aide', '/help'].includes(command)) {
    await sendReply(sock, jid, menuText(), phone, forceVoice);
    return;
  }

  if (['/stop', '/annuler', '/cancel'].includes(command)) {
    const stopped = pendingFiches.delete(phone);
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
    const history = await getHistory(phone);
    const topic = arg || latestConversationTopic(history);
    if (!topic) {
      await sendReply(sock, jid, "Parle-moi d'abord du sujet, puis tape /quiz. Tu peux aussi taper /quiz [sujet].", phone, forceVoice);
      return;
    }

    const subject = student.subjects?.[0] || arg || 'cours';
    const context = conversationContext(history);
    await sock.sendMessage(jid, { text: `Je prepare une fiche quiz PDF sur ${topic}...` });
    const filePath = await createQuizPdf({ phone, subject, topic, classLevel: student.class_level, context });
    await sock.sendMessage(jid, {
      document: fs.readFileSync(filePath),
      fileName: `quiz-${safeFileNamePart(topic)}.pdf`,
      mimetype: 'application/pdf'
    });
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

async function handleImage(sock, raw, caption) {
  const buffer = await downloadMediaBuffer(sock, raw);
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

async function saveIncomingMedia(sock, raw, prefix) {
  const buffer = await downloadMediaBuffer(sock, raw);
  const type = await fileTypeFromBuffer(buffer);
  const ext = type?.ext || 'bin';
  const tmpDir = process.env.TMP_DIR || 'tmp';
  fs.mkdirSync(tmpDir, { recursive: true });
  const filePath = path.join(tmpDir, `${prefix}-${Date.now()}.${ext}`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

async function sendReply(sock, jid, text, phone, forceVoice = false) {
  const chatText = sanitizeWhatsappChatText(text);
  const maxTtsChars = Number(process.env.VOICE_MAX_TTS_CHARS || 160);
  const shouldSendVoice = voicePrefs.get(phone) || (forceVoice && voiceReplyToIncoming);

  if (shouldSendVoice && chatText.length <= maxTtsChars) {
    let voicePath;
    try {
      await sendPresence(sock, jid, 'recording');
      voicePath = await synthesizeVoice(chatText);
      await sock.sendMessage(jid, {
        audio: fs.readFileSync(voicePath),
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true
      });
      await sendPresence(sock, jid, 'paused');
      return;
    } catch (error) {
      logErrorSummary('voice-tts', error);
    } finally {
      if (voicePath) safeUnlink(voicePath);
    }
  }

  await sendPresence(sock, jid, 'paused');
  await sock.sendMessage(jid, { text: chatText });
}

function sanitizeWhatsappChatText(text) {
  const value = String(text ?? '');
  const sanitized = value
    .replace(/\\begin\{(?:equation|align|gather|multline)\*?\}[\s\S]*?\\end\{(?:equation|align|gather|multline)\*?\}/g, 'La formule detaillee est disponible dans la fiche PDF.')
    .replace(/\\\[[\s\S]*?\\\]/g, 'La formule detaillee est disponible dans la fiche PDF.')
    .replace(/\\\([^)]*?\\\)/g, 'la formule est disponible dans la fiche PDF')
    .replace(/\$\$[\s\S]*?\$\$/g, 'La formule detaillee est disponible dans la fiche PDF.')
    .replace(/(^|[^\\])\$([^$\n]+)\$/g, '$1la formule est disponible dans la fiche PDF')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return sanitized || 'La formule detaillee est disponible dans la fiche PDF. Tape /fiche [matiere] pour recevoir le PDF.';
}

function conversationContext(history) {
  return history.map((item) => `${item.role}: ${item.content}`).join('\n').slice(-1600);
}

function latestConversationTopic(history) {
  const ignored = new Set(['ok', 'oui', 'non', 'merci', 'cool', 'daccord', "d'accord", 'continue', 'continuer']);
  const lastUserMessage = [...history]
    .reverse()
    .find((item) => {
      const content = item.content?.trim();
      if (item.role !== 'user' || !content || content.startsWith('/')) return false;
      return !ignored.has(content.toLowerCase());
    });

  return lastUserMessage?.content.trim().slice(0, 160) || '';
}

function safeFileNamePart(value, fallback = 'quiz') {
  const slug = String(value || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return slug || fallback;
}

async function downloadMediaBuffer(sock, raw) {
  let lastError;
  for (let attempt = 0; attempt <= mediaDownloadRetries; attempt += 1) {
    try {
      return await downloadMediaMessage(
        raw,
        'buffer',
        {
          options: {
            timeout: mediaDownloadTimeoutMs,
            family: 4
          }
        },
        {
          reuploadRequest: sock.updateMediaMessage.bind(sock),
          logger: pino({ level: 'silent' })
        }
      );
    } catch (error) {
      lastError = error;
      if (attempt >= mediaDownloadRetries || !isRetryableNetworkError(error)) break;
      await wait(700 * (attempt + 1));
    }
  }
  throw lastError;
}

function isRetryableNetworkError(error) {
  const status = error?.response?.status || error?.status;
  const code = error?.code || error?.cause?.code;
  return (
    ['ETIMEDOUT', 'ENETUNREACH', 'ECONNRESET', 'ECONNABORTED', 'EAI_AGAIN'].includes(code) ||
    status === 408 ||
    status === 429 ||
    status >= 500
  );
}

function userFacingError(error) {
  if (error instanceof UserVisibleError) return error.message;
  return "Je n'ai pas pu traiter ce message. Essaie encore, ou envoie le contenu en texte.";
}

function logErrorSummary(context, error) {
  const url = error?.config?.url || error?.request?._currentUrl;
  const host = hostFromUrl(url);
  console.error(`[${context}]`, {
    name: error?.name,
    code: error?.code || error?.cause?.code,
    status: error?.response?.status || error?.status,
    host,
    message: error?.message
  });
}

function hostFromUrl(url) {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

function parseBoolean(value, fallback) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeUnlink(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Nothing to clean.
  }
}

async function sendPresence(sock, jid, presence) {
  try {
    await sock.sendPresenceUpdate(presence, jid);
  } catch {
    // Presence updates are best effort.
  }
}

class UserVisibleError extends Error {}
