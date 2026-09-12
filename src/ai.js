import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import Groq from 'groq-sdk';
import OpenAI from 'openai';
import { SYSTEM_PROMPT, quizPrompt, quizSheetPrompt, pdfPrompt, visionPrompt } from './prompts.js';

const provider = process.env.AI_PROVIDER || 'groq';
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const maxChatTokens = Number(process.env.MAX_CHAT_TOKENS || 700);
const maxPdfTokens = Number(process.env.MAX_PDF_TOKENS || 900);
const retries = Number(process.env.RATE_LIMIT_RETRIES || 3);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function retryOnRateLimit(fn) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = error?.status || error?.response?.status;
      if (status !== 429 || attempt === retries) break;
      await wait(1200 * (attempt + 1));
    }
  }
  throw lastError;
}

function requireClient() {
  if (provider === 'openai') {
    if (!openai) throw new Error('OPENAI_API_KEY manquant');
    return 'openai';
  }
  if (!groq) throw new Error('GROQ_API_KEY manquant');
  return 'groq';
}

function useCurlForGroq() {
  return ['curl', 'true', '1'].includes(String(process.env.GROQ_HTTP_CLIENT || '').toLowerCase());
}

async function complete(messages, { maxTokens = maxChatTokens, model } = {}) {
  const selected = requireClient();

  if (selected === 'openai') {
    const response = await retryOnRateLimit(() =>
      openai.chat.completions.create({
        model: model || process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
        messages,
        max_tokens: maxTokens,
        temperature: 0.4
      })
    );
    return response.choices?.[0]?.message?.content?.trim() || '';
  }

  const response = await retryOnRateLimit(() =>
    createGroqChatCompletion({
      model: model || process.env.GROQ_CHAT_MODEL || 'groq/compound-mini',
      messages,
      max_tokens: maxTokens,
      temperature: 0.4
    })
  );
  return response.choices?.[0]?.message?.content?.trim() || '';
}

function createGroqChatCompletion(body) {
  if (useCurlForGroq()) return postGroqJson('/chat/completions', body);
  return groq.chat.completions.create(body);
}

export async function chatWithTutor(text, history = []) {
  return complete([
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: text }
  ]);
}

export async function generateQuiz(subject, classLevel) {
  const raw = await complete([
    { role: 'system', content: 'Tu retournes uniquement du JSON valide.' },
    { role: 'user', content: quizPrompt(subject, classLevel) }
  ]);
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  return JSON.parse(cleaned);
}

export async function generatePdfLesson(args) {
  return complete([
    { role: 'system', content: 'Tu rediges des fiches de cours compactes et exactes.' },
    { role: 'user', content: pdfPrompt(args) },
    { role: 'user', content: 'Genere maintenant le contenu demande.' }
  ], { maxTokens: maxPdfTokens });
}

export async function generateQuizSheet(args) {
  return complete([
    { role: 'system', content: 'Tu rediges des fiches PDF de quiz compactes et exactes.' },
    { role: 'user', content: quizSheetPrompt(args) },
    { role: 'user', content: 'Genere maintenant la fiche quiz demandee.' }
  ], { maxTokens: maxPdfTokens });
}

export async function analyzeImage({ base64Image, mimeType, caption }) {
  const selected = requireClient();
  const prompt = visionPrompt(caption);

  if (selected === 'openai') return analyzeImageWithOpenAi({ base64Image, mimeType, prompt });

  const groqVisionModel = process.env.GROQ_VISION_MODEL;
  if (!groqVisionModel && openai) return analyzeImageWithOpenAi({ base64Image, mimeType, prompt });
  if (!groqVisionModel) {
    throw new Error('Analyse image non configuree: aucun modele vision Groq accessible. Ajoute OPENAI_API_KEY ou un GROQ_VISION_MODEL compatible vision.');
  }

  const response = await retryOnRateLimit(() =>
    createGroqChatCompletion({
      model: groqVisionModel,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
        ]
      }],
      max_tokens: 450
    })
  );
  return response.choices?.[0]?.message?.content?.trim() || '';
}

async function analyzeImageWithOpenAi({ base64Image, mimeType, prompt }) {
  const response = await retryOnRateLimit(() =>
    openai.chat.completions.create({
      model: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
        ]
      }],
      max_tokens: 450
    })
  );
  return response.choices?.[0]?.message?.content?.trim() || '';
}

export async function transcribeAudio(filePath) {
  const selected = requireClient();

  if (selected === 'openai') {
    const response = await retryOnRateLimit(() =>
      openai.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: process.env.OPENAI_TRANSCRIPTION_MODEL || 'whisper-1'
      })
    );
    return response.text?.trim() || '';
  }

  if (useCurlForGroq()) {
    const response = await retryOnRateLimit(() =>
      postGroqForm('/audio/transcriptions', [
        { name: 'file', file: filePath },
        { name: 'model', value: process.env.GROQ_TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo' }
      ])
    );
    return response.text?.trim() || '';
  }

  const response = await retryOnRateLimit(() =>
    groq.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: process.env.GROQ_TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo'
    })
  );
  return response.text?.trim() || '';
}

function postGroqJson(endpoint, body) {
  return postJsonWithCurl(`https://api.groq.com/openai/v1${endpoint}`, process.env.GROQ_API_KEY, body);
}

function postGroqForm(endpoint, fields) {
  return requestWithCurlConfig([
    `url = "${escapeCurlConfig(`https://api.groq.com/openai/v1${endpoint}`)}"`,
    'request = "POST"',
    `header = "Authorization: Bearer ${escapeCurlConfig(process.env.GROQ_API_KEY)}"`,
    ...fields.map((field) => {
      const value = field.file ? `@${field.file}` : field.value;
      return `form = "${escapeCurlConfig(`${field.name}=${value}`)}"`;
    }),
    ''
  ]);
}

function postJsonWithCurl(url, bearerToken, body) {
  return new Promise((resolve, reject) => {
    const tmpDir = process.env.TMP_DIR || 'tmp';
    fs.mkdirSync(tmpDir, { recursive: true });
    const bodyPath = path.join(tmpDir, `curl-body-${randomUUID()}.json`);
    fs.writeFileSync(bodyPath, JSON.stringify(body));

    const child = spawn('curl', ['-sS', '-w', '\n%{http_code}', '--config', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      cleanupTempFile(bodyPath);
      reject(error);
    });

    child.on('close', (code) => {
      cleanupTempFile(bodyPath);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `curl exit ${code}`));
        return;
      }

      try {
        const output = stdout.trimEnd();
        const splitAt = output.lastIndexOf('\n');
        const text = splitAt >= 0 ? output.slice(0, splitAt) : '';
        const status = Number(splitAt >= 0 ? output.slice(splitAt + 1) : output);
        const payload = text ? JSON.parse(text) : null;
        if (status < 200 || status >= 300) {
          const error = new Error(payload?.error?.message || payload?.message || `HTTP ${status}`);
          error.status = status;
          reject(error);
          return;
        }
        resolve(payload);
      } catch (error) {
        reject(error);
      }
    });

    child.stdin.end([
      `url = "${escapeCurlConfig(url)}"`,
      'request = "POST"',
      `header = "Authorization: Bearer ${escapeCurlConfig(bearerToken)}"`,
      'header = "Content-Type: application/json"',
      `data-binary = "@${escapeCurlConfig(bodyPath)}"`,
      ''
    ].join('\n'));
  });
}

function requestWithCurlConfig(configLines) {
  return new Promise((resolve, reject) => {
    const child = spawn('curl', ['-sS', '-w', '\n%{http_code}', '--config', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `curl exit ${code}`));
        return;
      }
      parseCurlJson(stdout, resolve, reject);
    });
    child.stdin.end(configLines.join('\n'));
  });
}

function parseCurlJson(stdout, resolve, reject) {
  try {
    const output = stdout.trimEnd();
    const splitAt = output.lastIndexOf('\n');
    const text = splitAt >= 0 ? output.slice(0, splitAt) : '';
    const status = Number(splitAt >= 0 ? output.slice(splitAt + 1) : output);
    const payload = text ? JSON.parse(text) : null;
    if (status < 200 || status >= 300) {
      const error = new Error(payload?.error?.message || payload?.message || `HTTP ${status}`);
      error.status = status;
      reject(error);
      return;
    }
    resolve(payload);
  } catch (error) {
    reject(error);
  }
}

function escapeCurlConfig(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function cleanupTempFile(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Nothing to clean.
  }
}
