export const passwordRequirements = 'Use pelo menos 8 caracteres com maiúscula, minúscula, número e caractere especial.';
const passwordByteLimit = 'A senha deve ter no máximo 72 bytes.';

export function getUnmetPasswordRequirements(password: string) {
  return [
    [...password].length < 8 && 'Pelo menos 8 caracteres',
    !/\p{Lu}/u.test(password) && 'Uma letra maiúscula',
    !/\p{Ll}/u.test(password) && 'Uma letra minúscula',
    !/[0-9]/.test(password) && 'Um número',
    !/[\p{P}\p{S}]/u.test(password) && 'Um caractere especial',
    new TextEncoder().encode(password).length > 72 && passwordByteLimit,
  ].filter((requirement): requirement is string => typeof requirement === 'string');
}

export function validateNewPassword(password: unknown): string | null {
  if (typeof password !== 'string') return passwordRequirements;
  const unmet = getUnmetPasswordRequirements(password);
  if (unmet.some((requirement) => requirement !== passwordByteLimit)) return passwordRequirements;
  return unmet[0] ?? null;
}

export function validatePasswordConfirmation(password: string, confirmation: string) {
  return validateNewPassword(password) ?? (password === confirmation ? null : 'As senhas não coincidem.');
}
