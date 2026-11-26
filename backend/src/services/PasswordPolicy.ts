export const passwordRequirements = 'Use pelo menos 8 caracteres com maiúscula, minúscula, número e caractere especial.';

export function validateNewPassword(password: unknown): string | null {
  if (typeof password !== 'string' || [...password].length < 8 ||
      !/\p{Lu}/u.test(password) || !/\p{Ll}/u.test(password) ||
      !/[0-9]/.test(password) || !/[\p{P}\p{S}]/u.test(password)) return passwordRequirements;
  if (Buffer.byteLength(password, 'utf8') > 72) return 'A senha deve ter no máximo 72 bytes.';
  return null;
}
