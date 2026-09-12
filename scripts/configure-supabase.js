import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const token = process.env.SUPABASE_ACCESS_TOKEN;
const requestedRef = process.env.SUPABASE_PROJECT_REF;
const apiBase = 'https://api.supabase.com/v1';

if (!token) {
  console.error('SUPABASE_ACCESS_TOKEN manquant.');
  process.exit(1);
}

const project = await selectProject();
const keys = await getProjectKeys(project.ref);
const serverKey = selectServerKey(keys);

if (!serverKey) {
  console.error('Aucune cle serveur Supabase trouvee. Permissions requises: api_gateway_keys_read.');
  process.exit(1);
}

writeEnv({
  SUPABASE_URL: `https://${project.ref}.supabase.co`,
  SUPABASE_SERVICE_ROLE_KEY: serverKey.api_key
});

console.log(`Projet Supabase configure: ${project.name} (${project.ref})`);
console.log(`Cle serveur configuree: ${serverKey.name || serverKey.id || serverKey.type}`);

await applySchema(project.ref);

async function selectProject() {
  const projects = await request('/projects');
  if (!Array.isArray(projects) || projects.length === 0) {
    throw new Error('Aucun projet Supabase trouve.');
  }

  if (requestedRef) {
    const project = projects.find((item) => item.ref === requestedRef || item.id === requestedRef);
    if (!project) throw new Error(`Projet introuvable: ${requestedRef}`);
    return project;
  }

  const activeProjects = projects.filter((item) => String(item.status || '').startsWith('ACTIVE'));
  if (activeProjects.length === 1) return activeProjects[0];
  if (projects.length === 1) return projects[0];

  const names = projects.map((item) => `${item.name} (${item.ref})`).join(', ');
  throw new Error(`Plusieurs projets trouves. Relance avec SUPABASE_PROJECT_REF. Projets: ${names}`);
}

async function getProjectKeys(ref) {
  return request(`/projects/${ref}/api-keys?reveal=true`);
}

function selectServerKey(keys) {
  if (!Array.isArray(keys)) return null;
  const candidates = keys.map((key) => ({
    ...key,
    label: `${key.name || ''} ${key.type || ''} ${key.id || ''} ${key.prefix || ''}`.toLowerCase()
  }));

  return (
    candidates.find((key) => key.api_key?.startsWith('sb_secret_')) ||
    candidates.find((key) => key.label.includes('service_role')) ||
    candidates.find((key) => key.label.includes('secret')) ||
    candidates.find((key) => key.label.includes('service')) ||
    null
  );
}

async function applySchema(ref) {
  const schema = fs.readFileSync('supabase/schema.sql', 'utf8');
  try {
    await request(`/projects/${ref}/database/query`, {
      method: 'POST',
      body: JSON.stringify({ query: schema })
    });
    console.log('Schema Supabase applique.');
  } catch (error) {
    console.warn(`Schema non applique automatiquement: ${error.message}`);
    console.warn('Applique manuellement supabase/schema.sql dans le SQL Editor si necessaire.');
  }
}

async function request(path, options = {}) {
  const args = [
    '-sS',
    '-w', '\n%{http_code}',
    `${apiBase}${path}`,
    '-H', `Authorization: Bearer ${token}`,
    '-H', 'Content-Type: application/json'
  ];

  if (options.method) args.splice(0, 0, '-X', options.method);
  if (options.body) args.push('--data', options.body);

  const result = spawnSync('curl', args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `curl exit ${result.status}`);

  const output = result.stdout.trimEnd();
  const splitAt = output.lastIndexOf('\n');
  const text = splitAt >= 0 ? output.slice(0, splitAt) : '';
  const status = Number(splitAt >= 0 ? output.slice(splitAt + 1) : output);
  const payload = text ? JSON.parse(text) : null;
  if (status < 200 || status >= 300) {
    throw new Error(payload?.message || payload?.error || `HTTP ${status}`);
  }
  return payload;
}

function writeEnv(values) {
  const existing = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : fs.readFileSync('.env.example', 'utf8');
  let next = existing;

  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    if (pattern.test(next)) {
      next = next.replace(pattern, line);
    } else {
      next += `\n${line}`;
    }
  }

  fs.writeFileSync('.env', next.endsWith('\n') ? next : `${next}\n`);
}
