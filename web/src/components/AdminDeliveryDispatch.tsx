import React, { useEffect, useState } from 'react';
import { useFeedback } from './Feedback';
import { formatOrderCode, getDispatchIncidents, getDispatchSettings, resolveDispatchIncident, saveDispatchSettings } from '../services/api';
import type { DispatchIncident } from '../services/api';

const actions = [
  ['resume', 'Retomar a entrega com o mesmo entregador'],
  ['returned', 'Pacote devolvido à loja. Oferecer nova entrega'],
  ['delivered', 'Confirmar recebimento verificado pelo suporte'],
  ['cancel', 'Encerrar o pedido e solicitar estorno'],
];
const refunds: Record<string, string> = { pending: 'Estorno solicitado', processing: 'Estorno em processamento', review: 'Estorno requer conferência no Asaas' };

export function AdminDeliveryDispatch() {
  const [settings, setSettings] = useState<{ radius: string; subsidy: string; blockMinutes: string; enforceDeadline: boolean; auditEnabled: boolean; offerMode: 'push' | 'polling' }>();
  const [incidents, setIncidents] = useState<DispatchIncident[]>();
  const [incidentId, setIncidentId] = useState('');
  const [action, setAction] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { showToast } = useFeedback();

  useEffect(() => {
    let active = true;
    void getDispatchSettings().then((data) => {
      if (active) setSettings({ radius: String(data.radius_meters / 1000), subsidy: (data.subsidy_cents / 100).toFixed(2),
        blockMinutes: String(data.missed_offer_block_minutes ?? 60), enforceDeadline: data.enforce_delivery_deadline === true, auditEnabled: data.audit_enabled !== false, offerMode: data.offer_delivery_mode === 'polling' ? 'polling' : 'push' });
    }).catch(() => { if (active) setError('Não foi possível carregar as regras de alocação.'); });
    void getDispatchIncidents().then((data) => { if (active) setIncidents(data); })
      .catch(() => { if (active) setError('Não foi possível carregar as ocorrências.'); });
    return () => { active = false; };
  }, []);

  async function apply(event: React.FormEvent, operation: () => Promise<void>, message: string) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await operation();
      showToast(message);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Não foi possível concluir a operação.');
    } finally { setSaving(false); }
  }

  return (
    <div className="form-box admin-delivery-rate-form">
      <h3>Alocação e ocorrências de entrega</h3>
      {error && <p className="error-message" role="alert">{error}</p>}
      {!settings && !error && <p role="status">Carregando configuração…</p>}
      {settings && <form onSubmit={(event) => void apply(event, () =>
        saveDispatchSettings(Math.round(Number(settings.radius) * 1000), Math.round(Number(settings.subsidy) * 100), settings.offerMode, Number(settings.blockMinutes), settings.enforceDeadline, settings.auditEnabled),
        'Regras de alocação salvas.')}>
        <div className="admin-rate-fields">
          <div className="form-group">
            <label htmlFor="dispatch-radius">Raio da loja (km em linha reta)</label>
            <input id="dispatch-radius" type="number" min="0.1" max="100" step="0.1" required disabled={saving} value={settings.radius}
              onChange={(event) => setSettings({ ...settings, radius: event.target.value })} />
          </div>
          <div className="form-group">
            <label htmlFor="dispatch-subsidy">Teto de subsídio por pedido (R$)</label>
            <input id="dispatch-subsidy" type="number" min="0" max="10000" step="0.01" required disabled={saving} value={settings.subsidy}
              onChange={(event) => setSettings({ ...settings, subsidy: event.target.value })} />
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="dispatch-offer-mode">Recebimento de ofertas no UniEntregador</label>
          <select id="dispatch-offer-mode" value={settings.offerMode} disabled={saving} onChange={(event) =>
            setSettings({ ...settings, offerMode: event.target.value === 'polling' ? 'polling' : 'push' })}>
            <option value="push">Notificação OneSignal (padrão)</option>
            <option value="polling">Consulta periódica com o app aberto</option>
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="dispatch-block-duration">Bloqueio após 3 pedidos sem resposta (minutos)</label>
          <input id="dispatch-block-duration" type="number" min={1} max={10080} step={1} required
            disabled={saving} value={settings.blockMinutes}
            onChange={(event) => setSettings({ ...settings, blockMinutes: event.target.value })} />
        </div>
        <div className="form-group">
          <label htmlFor="dispatch-enforce-deadline">
            <input id="dispatch-enforce-deadline" type="checkbox" checked={settings.enforceDeadline} disabled={saving}
              onChange={(event) => setSettings({ ...settings, enforceDeadline: event.target.checked })} />
            {' '}Excluir entregadores quando a estimativa ultrapassar o prazo prometido
          </label>
        </div>
        <div className="form-group">
          <label htmlFor="dispatch-audit-enabled">
            <input id="dispatch-audit-enabled" type="checkbox" checked={settings.auditEnabled} disabled={saving}
              onChange={(event) => setSettings({ ...settings, auditEnabled: event.target.checked })} />
            {' '}Registrar auditoria de entregas
          </label>
        </div>
        <button type="submit" className="btn-primary" disabled={saving}>Salvar regras de alocação</button>
      </form>}
      <h4>Ocorrências e estornos</h4>
      {incidents?.length === 0 && <p>Nenhuma ocorrência ou estorno pendente.</p>}
      <ul className="admin-category-list">
        {incidents?.map((item) => <li key={item.order_id}>
          <div>
            <strong>Pedido #{formatOrderCode(item.order_id)} · {item.store_name}</strong>
            {item.incident_reason && <p>{item.incident_reason}</p>}
            {item.refund_state && <p>{refunds[item.refund_state]}</p>}
          </div>
          {item.state === 'incident' && <button type="button" className="btn-secondary" disabled={saving} onClick={() => {
            setIncidentId(item.order_id); setAction(''); setReason('');
          }}>Resolver ocorrência</button>}
        </li>)}
      </ul>
      {incidentId && <form onSubmit={(event) => void apply(event, async () => {
        await resolveDispatchIncident(incidentId, action, reason);
        setIncidentId('');
        setIncidents((current) => current?.filter((item) => item.order_id !== incidentId));
        setIncidents(await getDispatchIncidents());
      }, 'Ocorrência resolvida.')}>
        <div className="form-group">
          <label htmlFor="dispatch-resolution">Resolução do pedido #{formatOrderCode(incidentId)}</label>
          <select id="dispatch-resolution" value={action} required disabled={saving} onChange={(event) => setAction(event.target.value)}>
            <option value="">Selecione após verificar o pacote</option>
            {actions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="dispatch-reason">Motivo da resolução</label>
          <textarea id="dispatch-reason" value={reason} required minLength={3} maxLength={500} disabled={saving} onChange={(event) => setReason(event.target.value)} />
        </div>
        <button type="submit" className="btn-primary" disabled={saving}>Confirmar resolução</button>
      </form>}
    </div>
  );
}
