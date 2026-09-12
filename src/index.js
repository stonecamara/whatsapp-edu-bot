import 'dotenv/config';
import dns from 'node:dns';
import process from 'node:process';
import { startWhatsAppBot } from './whatsapp.js';

dns.setDefaultResultOrder('ipv4first');

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

const shutdown = () => {
  console.log('Arret du bot...');
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await startWhatsAppBot();
