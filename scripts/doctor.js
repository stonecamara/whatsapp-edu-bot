import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

loadEnvFile();

const checks = [];

function add(name, ok, detail) {
  checks.push({ name, ok, detail });
}

add('Node.js >= 20', Number(process.versions.node.split('.')[0]) >= 20, process.version);
add('AI_PROVIDER', ['groq', 'openai'].includes(process.env.AI_PROVIDER || 'groq'), process.env.AI_PROVIDER || 'groq');
const hasGroqKey = Boolean(process.env.GROQ_API_KEY);
const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY);
add('Groq key', hasGroqKey, hasGroqKey ? 'configuree' : process.env.AI_PROVIDER === 'openai' ? 'optionnel' : 'requis si AI_PROVIDER=groq');
add('OpenAI key', hasOpenAiKey, hasOpenAiKey ? 'configuree' : process.env.AI_PROVIDER === 'groq' ? 'optionnel' : 'requis si AI_PROVIDER=openai');
const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
add('Supabase', hasSupabase, hasSupabase ? 'configure' : 'optionnel: fallback memoire locale');
add('Groq vision', Boolean(process.env.GROQ_VISION_MODEL || process.env.OPENAI_API_KEY), process.env.GROQ_VISION_MODEL ? process.env.GROQ_VISION_MODEL : 'non configure');

const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
add('ffmpeg', ffmpeg.status === 0, ffmpeg.status === 0 ? ffmpeg.stdout.split('\n')[0] : 'requis pour les notes vocales TTS');

for (const check of checks) {
  const icon = check.ok ? 'OK' : '!!';
  console.log(`${icon} ${check.name}: ${check.detail}`);
}

const blocking = checks.filter((check) => !check.ok && ['Node.js >= 20', 'AI_PROVIDER'].includes(check.name));
if (blocking.length > 0) process.exit(1);

function loadEnvFile() {
  if (!fs.existsSync('.env')) return;
  const lines = fs.readFileSync('.env', 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}
