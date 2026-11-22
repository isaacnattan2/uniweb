import { Request, Response } from 'express';

export const brazilianStates = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

export function normalizeDeliveryAddress(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const fields = input as Record<string, unknown>;
  const text = (name: string) => {
    const value = fields[name];
    return typeof value === 'string' ? value.trim() : '';
  };
  const cep = text('cep').replace('-', '');
  const street = text('street');
  const number = text('number');
  const neighborhood = text('neighborhood');
  const city = text('city');
  const state = text('state').toUpperCase();
  const complement = text('complement');
  if (!/^[0-9]{8}$/.test(cep) || !street || !number || !city || !brazilianStates.includes(state) ||
      street.length > 160 || number.length > 30 || neighborhood.length > 100 || city.length > 100 || complement.length > 120) return null;

  return { cep: cep.slice(0, 5) + '-' + cep.slice(5), street, number, neighborhood, city, state, complement };
}

export type DeliveryAddress = NonNullable<ReturnType<typeof normalizeDeliveryAddress>>;

export function formatDeliveryAddress(input: unknown): string | null {
  if (typeof input === 'string') return input.trim();
  const parsed = normalizeDeliveryAddress(input);
  if (!parsed) return null;
  const { cep, street, number, neighborhood, city, state, complement } = parsed;
  const location = street + ', ' + number;
  return [location, complement, neighborhood, city + '/' + state, 'CEP ' + cep]
    .filter(Boolean).join(' · ');
}

export async function lookupPostalCode(req: Request, res: Response) {
  const { cep } = req.params;
  if (!/^[0-9]{8}$/.test(cep)) return res.status(400).json({ error: 'Informe um CEP com 8 dígitos.' });
  try {
    const response = await fetch('https://viacep.com.br/ws/' + cep + '/json/', {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(4500),
    });
    if (!response.ok) throw new Error('ViaCEP HTTP ' + response.status);
    const data = await response.json() as Record<string, unknown>;
    if (data?.erro === true || data?.erro === 'true') {
      return res.status(404).json({ error: 'CEP não encontrado. Confira o número ou preencha o endereço manualmente.' });
    }
    if (typeof data?.localidade !== 'string' || !data.localidade.trim() ||
        typeof data.uf !== 'string' || !brazilianStates.includes(data.uf)) throw new Error('ViaCEP response invalid');
    return res.json({
      street: typeof data.logradouro === 'string' ? data.logradouro.trim().slice(0, 160) : '',
      neighborhood: typeof data.bairro === 'string' ? data.bairro.trim().slice(0, 100) : '',
      city: data.localidade.trim().slice(0, 100),
      state: data.uf,
    });
  } catch {
    return res.status(503).json({ error: 'A consulta de CEP está indisponível. Preencha o endereço manualmente.' });
  }
}
