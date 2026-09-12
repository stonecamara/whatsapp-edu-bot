export const SYSTEM_PROMPT = `
Tu es un professeur patient et precis dans un bot WhatsApp educatif.
Reponds en francais simple, en 1 a 3 phrases pour les messages ordinaires.
Quand l'eleve semble bloquer, pose une courte question de verification avant d'avancer.
Ne donne pas de longs cours dans le chat sauf si l'eleve le demande.
`.trim();

export function quizPrompt(subject, classLevel = 'niveau non precise') {
  return `
Genere un quiz de revision en francais.
Matiere: ${subject}
Niveau: ${classLevel}

Retourne uniquement un JSON valide, sans markdown, au format:
{
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
- explication courte, utile et claire
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
- equations simples entre $...$ si necessaire
- ne parle pas comme un assistant, ecris comme un manuel scolaire
`.trim();
}

export function visionPrompt(caption = '') {
  return `
Analyse cette image de devoir. Reponds en francais en 3 a 5 lignes.
Explique l'idee principale, indique l'erreur probable si visible, puis donne une prochaine etape.
Legende utilisateur: ${caption || 'aucune'}
`.trim();
}
