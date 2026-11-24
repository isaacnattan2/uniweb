import React, { useEffect, useState } from 'react';
import { useFeedback } from './Feedback';
import { getAdminDrivers, setAdminBlock, setDriverDeliveryRateLock } from '../services/api';
import type { AdminDriver } from '../services/api';
import { AdminDeliveryRates } from './AdminDeliveryRates';
import { AdminDeliveryDispatch } from './AdminDeliveryDispatch';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const statusLabels = { active: 'Ativo', inactive: 'Inativo', suspended: 'Bloqueado' };
const vehicleLabels: Record<string, string> = {
  bicycle: 'Bicicleta',
  motorcycle: 'Moto',
  car: 'Carro',
  utility: 'Utilitário',
  van: 'Van',
  truck: 'Caminhão',
};

export function AdminDrivers() {
  const [drivers, setDrivers] = useState<AdminDriver[]>();
  const [savingId, setSavingId] = useState<string>();
  const [lockingId, setLockingId] = useState<string>();
  const [error, setError] = useState('');
  const { confirmAction, showToast } = useFeedback();

  useEffect(() => {
    const controller = new AbortController();
    void getAdminDrivers(controller.signal).then(setDrivers).catch(() => {
      if (!controller.signal.aborted) setError('Não foi possível carregar os entregadores.');
    });
    return () => controller.abort();
  }, []);

  async function changeAccess(driver: AdminDriver) {
    const blocked = driver.status === 'active';
    if (blocked && !(await confirmAction({
      title: `Bloquear o acesso de ${driver.full_name}?`,
      message: 'Durante o bloqueio, o entregador ficará impedido de atualizar as entregas pelo app.',
      confirmLabel: 'Bloquear acesso',
    }))) return;

    setSavingId(driver.id);
    setError('');
    try {
      await setAdminBlock('drivers', driver.id, blocked);
      setDrivers((current) => current?.map((item) =>
        item.id === driver.id ? { ...item, status: blocked ? 'suspended' : 'active' } : item
      ));
      showToast(blocked ? 'Acesso do entregador bloqueado.' : 'Acesso do entregador restabelecido.');
    } catch {
      setError('Não foi possível alterar o acesso do entregador.');
    } finally {
      setSavingId(undefined);
    }
  }

  async function changeRateLock(driver: AdminDriver) {
    setLockingId(driver.id);
    setError('');
    try {
      const { locked } = await setDriverDeliveryRateLock(driver.id, !driver.delivery_rate_locked);
      setDrivers((current) => current?.map((item) =>
        item.id === driver.id ? { ...item, delivery_rate_locked: locked } : item
      ));
      showToast(locked ? 'Taxa individual bloqueada. A taxa padrão será aplicada.' : 'Bloqueio individual da taxa removido.');
    } catch {
      setError('Não foi possível alterar o bloqueio da taxa individual.');
    } finally {
      setLockingId(undefined);
    }
  }

  return (
    <section aria-labelledby="drivers-heading">
      <h2 id="drivers-heading">Entregadores</h2>
      <AdminDeliveryRates />
      <AdminDeliveryDispatch />
      {error && <p className="error-message" role="alert">{error}</p>}
      {!drivers && !error && <p role="status">Carregando entregadores…</p>}
      {drivers?.length === 0 && <p>Nenhum entregador cadastrado.</p>}
      {!!drivers?.length && (
        <div className="business-grid card-grid card-grid-5">
          {drivers.map((driver) => (
            <article key={driver.id} className="business-card card-layout admin-driver-card">
              <h3 className="card-row-1">{driver.full_name}</h3>
              <div className="card-row-2">
                <p>{driver.email}</p>
                <p>{driver.phone || 'Telefone não cadastrado'}</p>
              </div>
              <div className="card-row-3">
                {driver.vehicle_type ? (
                  <>
                    <p>{[vehicleLabels[driver.vehicle_type] || driver.vehicle_type, driver.vehicle_manufacturer, driver.vehicle_brand, driver.vehicle_color].filter(Boolean).join(' · ')}</p>
                    {driver.vehicle_plate && <p>Placa {driver.vehicle_plate}</p>}
                  </>
                ) : <p>Veículo não cadastrado</p>}
              </div>
              <div className="card-row-4">
                <p>Acesso {statusLabels[driver.status].toLowerCase()}</p>
                {driver.delivery_rate_locked != null && (
                  <p>{driver.delivery_rate_locked ? 'Taxa individual bloqueada' :
                    driver.delivery_rate_cents == null ? 'Taxa individual em branco' :
                      'Taxa individual cadastrada: ' + currency.format(driver.delivery_rate_cents / 100) + '/km'}</p>
                )}
              </div>
              <div className="card-footer card-row-5 admin-driver-actions">
                {driver.status !== 'inactive' && (
                  <button type="button" className={driver.status === 'suspended' ? 'btn-primary' : 'btn-secondary'}
                    disabled={!!savingId} onClick={() => void changeAccess(driver)}>
                    {savingId === driver.id ? 'Atualizando…' : driver.status === 'active' ? 'Bloquear acesso' : 'Reativar acesso'}
                  </button>
                )}
                {driver.delivery_rate_locked != null && (
                  <button type="button" className="btn-secondary" disabled={!!lockingId} onClick={() => void changeRateLock(driver)}>
                    {lockingId === driver.id ? 'Atualizando taxa…' :
                      driver.delivery_rate_locked ? 'Desbloquear taxa individual' : 'Bloquear taxa individual'}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
