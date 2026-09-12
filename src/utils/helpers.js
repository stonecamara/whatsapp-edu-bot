export function extractText(message) {
  return (
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    ''
  ).trim();
}

export function phoneFromJid(jid) {
  return jid.split('@')[0];
}

export function commandOf(text) {
  if (!text.startsWith('/')) return { command: null, arg: '' };
  const [command, ...rest] = text.trim().split(/\s+/);
  return { command: command.toLowerCase(), arg: rest.join(' ').trim() };
}

export function menuText(botName = process.env.BOT_NAME || 'ScholarAI') {
  return `${botName}\n/menu - aide\n/quiz [matiere] - quiz rapide\n/fiche [matiere] - fiche PDF\n/vocal - activer/desactiver le vocal\n/profil - voir ton profil\n/stop - annuler`;
}
