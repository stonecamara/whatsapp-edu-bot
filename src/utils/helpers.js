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

export function commandListText() {
  return `/menu - aide
/quiz [sujet] - fiche quiz PDF sur le dernier sujet
/fiche [matiere] - fiche PDF
/vocal - activer/desactiver le vocal
/profil - voir ton profil
/stop - annuler`;
}

export function menuText(botName = process.env.BOT_NAME || 'ScholarAI') {
  return `${botName}\n${commandListText()}`;
}

export function introText(botName = process.env.BOT_NAME || 'ScholarAI') {
  return `Bonjour, je suis ${botName}, ton assistant d'etude sur WhatsApp.
Je peux t'aider a comprendre un cours, analyser une image de devoir, creer une fiche PDF et generer un quiz PDF.

Commandes:
${commandListText()}

Pour commencer, quel est ton nom ?`;
}
