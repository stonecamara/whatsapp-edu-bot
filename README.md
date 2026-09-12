# WhatsApp Edu Bot

Bot WhatsApp educatif en Node.js avec Baileys, Supabase, fiches PDF, quiz PDF sur le dernier sujet, analyse d'image et support vocal.

## Installation

```bash
npm install
cp .env.example .env
```

Renseigne ensuite `.env`, puis applique le schema SQL dans `supabase/schema.sql`.

## Demarrage

```bash
npm start
```

Au premier lancement, scanne le QR code WhatsApp affiche dans le terminal.

## Commandes WhatsApp

Au premier message, le bot se presente, affiche cette liste de commandes, puis lance l'inscription.

- `/menu`, `/aide`, `/help` : afficher l'aide
- `/quiz [sujet]` : generer une fiche quiz PDF. Sans sujet, le bot utilise le dernier sujet de la conversation.
- `/fiche [matiere]` : generer une fiche PDF
- `/vocal` : activer/desactiver les reponses vocales
- `/profil` : afficher le profil
- `/stop` : annuler l'action en cours

## Notes importantes

- WhatsApp Web n'est pas une API officielle. Utilise un numero de test.
- `ffmpeg` doit etre installe pour envoyer des notes vocales OGG/Opus.
- Verifie les vrais modeles disponibles chez ton fournisseur IA avant de lancer en production.
- Les vocaux entrants sont transcrits, mais la reponse automatique en note vocale est desactivee par defaut (`VOICE_REPLY_TO_INCOMING=false`). Active `/vocal` dans WhatsApp pour recevoir les reponses en audio.
- Le chat WhatsApp evite les equations et le LaTeX. Les formules detaillees doivent etre generees dans les fiches PDF via `/fiche`.
- Les fiches PDF rendent les formules LaTeX via MathJax puis PNG avant insertion dans PDFKit.
