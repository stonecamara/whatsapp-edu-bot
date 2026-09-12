import { generateQuiz } from './ai.js';
import { saveQuiz } from './database.js';

export const activeQuizzes = new Map();

const letters = ['A', 'B', 'C', 'D'];

export async function startQuiz(phone, subject, classLevel) {
  const quiz = await generateQuiz(subject, classLevel);
  const questions = quiz.questions || [];
  if (questions.length !== 5) throw new Error('Quiz invalide: 5 questions attendues');

  activeQuizzes.set(phone, { subject, questions, index: 0, score: 0 });
  return formatQuestion(activeQuizzes.get(phone));
}

export async function answerQuiz(phone, text) {
  const state = activeQuizzes.get(phone);
  if (!state) return null;

  const choice = normalizeChoice(text);
  if (choice === null) {
    return 'Reponds avec A, B, C ou D. Tape /stop pour annuler.';
  }

  const question = state.questions[state.index];
  const correct = Number(question.correct);
  const ok = choice === correct;
  if (ok) state.score += 1;

  const feedback = `${ok ? 'Correct.' : `Incorrect. Bonne reponse: ${letters[correct]}.`} ${question.explanation}`;
  state.index += 1;

  if (state.index >= state.questions.length) {
    activeQuizzes.delete(phone);
    await saveQuiz({
      phone,
      subject: state.subject,
      score: state.score,
      total: state.questions.length,
      questions: state.questions
    });
    return `${feedback}\n\nScore final: ${state.score}/${state.questions.length}`;
  }

  return `${feedback}\n\n${formatQuestion(state)}`;
}

export function stopQuiz(phone) {
  return activeQuizzes.delete(phone);
}

function formatQuestion(state) {
  const question = state.questions[state.index];
  const options = question.options.map((option, index) => `${letters[index]}. ${option}`).join('\n');
  return `Question ${state.index + 1}/5 - ${state.subject}\n${question.question}\n${options}`;
}

function normalizeChoice(text) {
  const value = text.trim().toUpperCase();
  if (['A', '1'].includes(value)) return 0;
  if (['B', '2'].includes(value)) return 1;
  if (['C', '3'].includes(value)) return 2;
  if (['D', '4'].includes(value)) return 3;
  return null;
}
