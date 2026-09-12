import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { transcribeAudio } from '../ai.js';

export async function transcribeVoice(inputPath) {
  return transcribeAudio(inputPath);
}

export async function synthesizeVoice(text) {
  const tmpDir = process.env.TMP_DIR || 'tmp';
  const maxChars = Number(process.env.VOICE_MAX_TTS_CHARS || 160);
  const timeoutMs = Number(process.env.TTS_TIMEOUT_MS || 8000);
  fs.mkdirSync(tmpDir, { recursive: true });
  const mp3Path = path.join(tmpDir, `tts-${Date.now()}.mp3`);
  const oggPath = path.join(tmpDir, `tts-${Date.now()}.ogg`);
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=fr&client=tw-ob&q=${encodeURIComponent(text.slice(0, maxChars))}`;

  try {
    const response = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }, timeoutMs);
    if (!response.ok) throw new Error(`TTS HTTP ${response.status}`);
    fs.writeFileSync(mp3Path, Buffer.from(await response.arrayBuffer()));
    await convertToOpus(mp3Path, oggPath);
    return oggPath;
  } finally {
    safeUnlink(mp3Path);
  }
}

function convertToOpus(input, output) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-y',
      '-i', input,
      '-c:a', 'libopus',
      '-b:a', '32k',
      '-vbr', 'on',
      output
    ], { stdio: 'ignore' });
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('ffmpeg conversion failed'));
    });
  });
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`TTS timeout ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function safeUnlink(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Nothing to clean.
  }
}
