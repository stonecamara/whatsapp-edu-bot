export const SYSTEM_PROMPT = `
Tu es un professeur patient et precis dans un bot WhatsApp educatif.
Reponds en francais simple, en 1 a 3 phrases pour les messages ordinaires.
Quand l'eleve semble bloquer, pose une courte question de verification avant d'avancer.
Ne donne pas de longs cours dans le chat sauf si l'eleve le demande.
Dans le chat WhatsApp, n'ecris pas d'equations ni de LaTeX.
Explique les relations mathematiques avec des mots simples.
Pour les formules detaillees, propose /fiche [matiere] car les equations sont reservees aux PDF.
`.trim();

export function quizPrompt(input, fallbackClassLevel = 'niveau non precise') {
  const args = typeof input === 'object'
    ? input
    : { subject: input, topic: input, classLevel: fallbackClassLevel };
  const subject = args.subject || 'cours';
  const topic = args.topic || subject;
  const classLevel = args.classLevel || fallbackClassLevel;
  const context = args.context || 'aucun';

  return `
Genere les donnees d'un quiz de revision en francais pour une fiche PDF.
Matiere: ${subject}
Niveau: ${classLevel}
Sujet prioritaire: ${topic}
Derniere conversation utile: ${context}

Retourne uniquement un JSON valide, sans markdown, au format:
{
  "title": "titre court",
  "recap": ["idee importante 1", "idee importante 2", "idee importante 3"],
  "questions": [
    {
      "question": "texte",
      "options": ["A", "B", "C", "D"],
      "correct": 0,
      "explanation": "courte explication"
    }
  ]
}

Contraintes:
- exactement 5 questions
- 4 options par question
- "correct" est l'index de la bonne reponse entre 0 et 3
- base les questions sur le sujet prioritaire et la derniere conversation
- questions variees: comprehension, application, erreur a eviter
- explications courtes, utiles et claires
- pas d'emoji
- le quiz sera rendu dans un PDF; les formules LaTeX sont autorisees si necessaire
- si tu utilises une formule, mets-la entre $...$ ou $$...$$
`.trim();
}

export function pdfPrompt({ subject, topic, classLevel, context }) {
  return `
Redige une fiche de cours en francais, style livre de cours, aucun dialogue avec l'eleve.
Matiere: ${subject}
Sujet exact: ${topic}
Niveau: ${classLevel || 'niveau non precise'}
Contexte utile recent: ${context || 'aucun'}

Structure obligatoire:
# A retenir
# Formules
# Methode
# Exemples
# Pieges
# Entrainement
# Synthese

Contraintes:
- 300 mots maximum
- phrases courtes et precises
- pas d'emoji
- formules importantes seules sur une ligne entre $$...$$
- petites equations dans une phrase entre $...$ si necessaire
- ne parle pas comme un assistant, ecris comme un manuel scolaire
`.trim();
}

export function visionPrompt(caption = '') {
  return `
Analyse cette image de devoir. Reponds en francais en 3 a 5 lignes.
Explique l'idee principale, indique l'erreur probable si visible, puis donne une prochaine etape.
N'ecris pas de LaTeX ni d'equations dans le chat WhatsApp; explique les formules en mots simples.
Legende utilisateur: ${caption || 'aucune'}
`.trim();
}
