import React, { useEffect, useState } from 'react';
import { getDeliveryAlternatives, scheduleDeliveryAlternative } from '../services/api';

const time = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const hour = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' });

export function DeliveryAlternatives({ orderId, onChanged }: { orderId: string; onChanged: () => void }) {
  const [options, setOptions] = useState<Awaited<ReturnType<typeof getDeliveryAlternatives>>>();
  const [selection, setSelection] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    void getDeliveryAlternatives(orderId).then((data) => {
      if (active) setOptions(data);
    }).catch(() => {
      if (active) setError('Não foi possível consultar os horários de entrega.');
    });
    return () => { active = false; };
  }, [orderId, revision]);

  async function save() {
    setSaving(true);
    setError('');
    try {
      await scheduleDeliveryAlternative(orderId, selection === 'immediate' ? null : selection);
      onChanged();
    } catch {
      setSelection('');
      setError('Esta opção ficou indisponível. Consulte os horários novamente.');
    } finally { setSaving(false); }
  }

  return (
    <div className="order-delivery">
      <p>Não encontramos um entregador no prazo previsto. Você pode escolher outro horário pelo valor já pago ou cancelar o pedido.</p>
      {error && <p role="alert">{error}</p>}
      {options && (options.immediate || options.slots.length > 0) ? (
        <>
          <label htmlFor={`delivery-option-${orderId}`}>Nova opção de entrega</label>
          <select id={`delivery-option-${orderId}`} value={selection} disabled={saving} onChange={(event) => setSelection(event.target.value)}>
            <option value="">Selecione</option>
            {options.immediate && <option value="immediate">Tentar entrega imediata</option>}
            {options.slots.map((slot) => <option key={slot} value={slot}>
              Agendar de {time.format(new Date(slot))} até {hour.format(new Date(Date.parse(slot) + options.windowMinutes * 60000))}
            </option>)}
          </select>
          <button type="button" className="btn-primary" disabled={saving || !selection} onClick={() => void save()}>Confirmar nova entrega</button>
        </>
      ) : <p role="status">{options ? 'Nenhum horário disponível agora.' : error ? '' : 'Consultando horários…'}</p>}
      <button type="button" className="btn-secondary" disabled={saving} onClick={() => {
        setError(''); setOptions(undefined); setSelection(''); setRevision((value) => value + 1);
      }}>Atualizar opções</button>
    </div>
  );
}
