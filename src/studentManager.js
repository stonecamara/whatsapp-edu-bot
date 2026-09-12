import { getOrCreateStudent, updateStudent } from './database.js';

export async function ensureRegistered(phone, text) {
  const student = await getOrCreateStudent(phone);
  if (student.is_registered) {
    return { registered: true, student };
  }

  const value = text.trim();
  if (!value) {
    return { registered: false, reply: registrationQuestion(student.registration_step) };
  }

  if (student.registration_step === 'name') {
    await updateStudent(phone, { name: value, registration_step: 'class_level' });
    return { registered: false, reply: 'Merci. Quelle est ta classe ? Exemple: Terminale SM, 10eme annee, 3eme.' };
  }

  if (student.registration_step === 'class_level') {
    await updateStudent(phone, { class_level: value, registration_step: 'subjects' });
    return { registered: false, reply: 'Quelles matieres veux-tu travailler ? Separe-les par des virgules.' };
  }

  const subjects = value.split(',').map((item) => item.trim()).filter(Boolean);
  const updated = await updateStudent(phone, {
    subjects,
    is_registered: true,
    registration_step: 'done'
  });
  return {
    registered: true,
    student: updated,
    reply: `Profil cree. Tape /menu pour voir les commandes.`
  };
}

function registrationQuestion(step) {
  if (step === 'class_level') return 'Quelle est ta classe ?';
  if (step === 'subjects') return 'Quelles matieres veux-tu travailler ?';
  return 'Bienvenue. Quel est ton nom ?';
}
