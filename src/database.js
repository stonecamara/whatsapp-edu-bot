import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabase = url && serviceKey
  ? createClient(url, serviceKey, { auth: { persistSession: false } })
  : null;

const memory = {
  students: new Map(),
  conversations: new Map(),
  messages: [],
  quizzes: []
};

function requireDb() {
  if (!supabase) throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant');
}

function useCurlForSupabase() {
  return ['curl', 'true', '1'].includes(String(process.env.SUPABASE_HTTP_CLIENT || '').toLowerCase());
}

export async function getOrCreateStudent(phone) {
  if (!supabase) {
    if (!memory.students.has(phone)) {
      memory.students.set(phone, {
        id: phone,
        phone,
        name: null,
        class_level: null,
        subjects: [],
        is_registered: false,
        registration_step: 'intro',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }
    return memory.students.get(phone);
  }

  if (useCurlForSupabase()) {
    const found = await supabaseRest(`/students?phone=eq.${encodeURIComponent(phone)}&select=*`);
    if (found[0]) return found[0];
    const created = await supabaseRest('/students?select=*', {
      method: 'POST',
      body: { phone, registration_step: 'intro' },
      prefer: 'return=representation'
    });
    return created[0];
  }

  requireDb();
  const { data: existing, error: findError } = await supabase
    .from('students')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) return existing;

  const { data, error } = await supabase
    .from('students')
    .insert({ phone, registration_step: 'intro' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function updateStudent(phone, patch) {
  if (!supabase) {
    const student = await getOrCreateStudent(phone);
    const updated = { ...student, ...patch, updated_at: new Date().toISOString() };
    memory.students.set(phone, updated);
    return updated;
  }

  if (useCurlForSupabase()) {
    const updated = await supabaseRest(`/students?phone=eq.${encodeURIComponent(phone)}&select=*`, {
      method: 'PATCH',
      body: { ...patch, updated_at: new Date().toISOString() },
      prefer: 'return=representation'
    });
    return updated[0];
  }

  requireDb();
  const { data, error } = await supabase
    .from('students')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('phone', phone)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function getLatestConversation(phone) {
  if (!supabase) {
    if (!memory.conversations.has(phone)) {
      memory.conversations.set(phone, {
        id: `conversation-${phone}`,
        phone,
        title: 'Conversation WhatsApp',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }
    return memory.conversations.get(phone);
  }

  if (useCurlForSupabase()) {
    const found = await supabaseRest(`/conversations?phone=eq.${encodeURIComponent(phone)}&select=*&order=updated_at.desc&limit=1`);
    if (found[0]) return found[0];
    const created = await supabaseRest('/conversations?select=*', {
      method: 'POST',
      body: { phone, title: 'Conversation WhatsApp' },
      prefer: 'return=representation'
    });
    return created[0];
  }

  requireDb();
  const { data: existing, error: findError } = await supabase
    .from('conversations')
    .select('*')
    .eq('phone', phone)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) return existing;

  const { data, error } = await supabase
    .from('conversations')
    .insert({ phone, title: 'Conversation WhatsApp' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function saveMessage(phone, role, content) {
  if (!supabase) {
    const conversation = await getLatestConversation(phone);
    memory.messages.push({
      conversation_id: conversation.id,
      phone,
      role,
      content,
      created_at: new Date().toISOString()
    });
    memory.conversations.set(phone, { ...conversation, updated_at: new Date().toISOString() });
    return;
  }

  if (useCurlForSupabase()) {
    const conversation = await getLatestConversation(phone);
    await supabaseRest('/messages', {
      method: 'POST',
      body: {
        conversation_id: conversation.id,
        phone,
        role,
        content
      }
    });

    await supabaseRest(`/conversations?id=eq.${conversation.id}`, {
      method: 'PATCH',
      body: { updated_at: new Date().toISOString() }
    });
    return;
  }

  requireDb();
  const conversation = await getLatestConversation(phone);
  const { error } = await supabase.from('messages').insert({
    conversation_id: conversation.id,
    phone,
    role,
    content
  });
  if (error) throw error;

  await supabase
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversation.id);
}

export async function getHistory(phone, limit = Number(process.env.MAX_HISTORY_MESSAGES || 12)) {
  if (!supabase) {
    return memory.messages
      .filter((message) => message.phone === phone && ['user', 'assistant'].includes(message.role))
      .slice(-limit)
      .map(({ role, content }) => ({ role, content }));
  }

  if (useCurlForSupabase()) {
    const data = await supabaseRest(`/messages?phone=eq.${encodeURIComponent(phone)}&role=in.(user,assistant)&select=role,content,created_at&order=created_at.desc&limit=${limit}`);
    return [...(data || [])].reverse().map(({ role, content }) => ({ role, content }));
  }

  requireDb();
  const { data, error } = await supabase
    .from('messages')
    .select('role, content, created_at')
    .eq('phone', phone)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return [...(data || [])].reverse().map(({ role, content }) => ({ role, content }));
}

export async function saveQuiz({ phone, subject, score, total, questions }) {
  if (!supabase) {
    memory.quizzes.push({ phone, subject, score, total, questions, created_at: new Date().toISOString() });
    return;
  }

  if (useCurlForSupabase()) {
    await supabaseRest('/quizzes', {
      method: 'POST',
      body: {
        phone,
        subject,
        score,
        total,
        questions
      }
    });
    return;
  }

  requireDb();
  const { error } = await supabase.from('quizzes').insert({
    phone,
    subject,
    score,
    total,
    questions
  });
  if (error) throw error;
}

function supabaseRest(endpoint, { method = 'GET', body, prefer } = {}) {
  return new Promise((resolve, reject) => {
    const tmpDir = process.env.TMP_DIR || 'tmp';
    fs.mkdirSync(tmpDir, { recursive: true });
    const bodyPath = body ? path.join(tmpDir, `supabase-body-${randomUUID()}.json`) : null;
    if (bodyPath) fs.writeFileSync(bodyPath, JSON.stringify(body));

    const lines = [
      `url = "${escapeCurlConfig(`${url}/rest/v1${endpoint}`)}"`,
      `request = "${method}"`,
      `header = "apikey: ${escapeCurlConfig(serviceKey)}"`,
      `header = "Authorization: Bearer ${escapeCurlConfig(serviceKey)}"`,
      'header = "Content-Type: application/json"'
    ];
    if (prefer) lines.push(`header = "Prefer: ${escapeCurlConfig(prefer)}"`);
    if (bodyPath) lines.push(`data-binary = "@${escapeCurlConfig(bodyPath)}"`);
    lines.push('');

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
      parseCurlJson(stdout, resolve, reject);
    });
    child.stdin.end(lines.join('\n'));
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
      const error = new Error(payload?.message || payload?.error || `HTTP ${status}`);
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
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Nothing to clean.
  }
}
