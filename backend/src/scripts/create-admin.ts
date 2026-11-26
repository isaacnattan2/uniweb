import 'dotenv/config';
import readline from 'readline';
import { validateNewPassword } from '../services/PasswordPolicy';
import AuthService from '../services/AuthService';
import pool from '../config/database';

async function readPassword(label: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('Execute o comando em um terminal interativo');
  process.stdout.write(label);
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let password = '';
    const onKey = (text: string, key: readline.Key) => {
      if (key.ctrl && key.name === 'c') {
        finish();
        reject(new Error('Operação cancelada'));
      } else if (key.name === 'return' || key.name === 'enter') {
        finish();
        resolve(password);
      } else if (key.name === 'backspace') {
        password = password.slice(0, -1);
      } else if (text && !key.ctrl && !key.meta) {
        password += text;
      }
    };
    const finish = () => {
      process.stdin.removeListener('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    process.stdin.on('keypress', onKey);
  });
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL no backend antes de criar o administrador');
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  const question = (label: string) => new Promise<string>((resolve) => input.question(label, resolve));
  const fullName = (await question('Nome: ')).trim();
  const email = (await question('E-mail: ')).trim().toLowerCase();
  input.close();
  const password = await readPassword('Senha: ');
  const passwordError = validateNewPassword(password);
  if (passwordError) throw new Error(passwordError);
  const confirmation = await readPassword('Confirme a senha: ');
  if (confirmation !== password) throw new Error('As senhas não coincidem.');
  if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Informe nome e e-mail válido.');
  }
  await AuthService.register(email, password, fullName, '', 'admin');
  console.log('Administrador criado com sucesso.');
}

main().catch((error: unknown) => {
  console.error('Não foi possível criar o administrador:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => pool.end());
