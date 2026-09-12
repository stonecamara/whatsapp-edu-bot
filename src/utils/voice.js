import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { transcribeAudio } from '../ai.js';

export async function transcribeVoice(inputPath) {
  return transcribeAudio(inputPath);
}

export async function synthesizeVoice(text) {
  const tmpDir = process.env.TMP_DIR || 'tmp';
  fs.mkdirSync(tmpDir, { recursive: true });
  const mp3Path = path.join(tmpDir, `tts-${Date.now()}.mp3`);
  const oggPath = path.join(tmpDir, `tts-${Date.now()}.ogg`);
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=fr&client=tw-ob&q=${encodeURIComponent(text.slice(0, 180))}`;

  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`TTS HTTP ${response.status}`);
  fs.writeFileSync(mp3Path, Buffer.from(await response.arrayBuffer()));
  await convertToOpus(mp3Path, oggPath);
  return oggPath;
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
