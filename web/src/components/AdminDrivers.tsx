import { AdminStoreAsaas } from './AdminStoreAsaas';
import React, { useEffect, useState } from 'react';
import { useFeedback } from './Feedback';
import { getAdminDrivers, setAdminBlock, setDriverDeliveryRateLock } from '../services/api';
import type { AdminDriver } from '../services/api';
import { AdminDeliveryRates } from './AdminDeliveryRates';
import { AdminDeliveryDispatch } from './AdminDeliveryDispatch';
import { driverPresenceEvent } from './StorePush';

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
  const [selectedAsaasDriver, setSelectedAsaasDriver] = useState<string>();
  const [drivers, setDrivers] = useState<AdminDriver[]>();
  const [savingId, setSavingId] = useState<string>();
  const [lockingId, setLockingId] = useState<string>();
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const { confirmAction, showToast } = useFeedback();

  useEffect(() => {
    let request: AbortController | undefined;
    function refresh() {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      void getAdminDrivers(controller.signal).then((rows) => {
        if (controller.signal.aborted) return;
        setDrivers(rows);
        setLoadError('');
      }).catch(() => {
        if (!controller.signal.aborted) setLoadError('Não foi possível atualizar a lista de entregadores.');
      });
    }
    function onVisible() {
      if (document.visibilityState === 'visible') refresh();
    }
    refresh();
    window.addEventListener(driverPresenceEvent, refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      request?.abort();
      window.removeEventListener(driverPresenceEvent, refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
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
        item.id === driver.id ? { ...item, status: blocked ? 'suspended' : 'active', checked_in: blocked ? false : item.checked_in } : item
      ));
      window.dispatchEvent(new Event(driverPresenceEvent));
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

  const asaasDriver = drivers?.find((driver) => driver.id === selectedAsaasDriver);

  return (
    <section aria-labelledby="drivers-heading">
      <h2 id="drivers-heading">Entregadores</h2>
      {drivers && <p role="status">{drivers.filter((driver) => driver.checked_in).length} com check-in ativo</p>}
      {loadError && <p className="error-message" role="alert">{loadError}</p>}
      <AdminDeliveryRates />
      <AdminDeliveryDispatch />
      {asaasDriver && <AdminStoreAsaas key={asaasDriver.id} accountId={asaasDriver.id} driverName={asaasDriver.full_name} />}
      {error && <p className="error-message" role="alert">{error}</p>}
      {!drivers && !loadError && <p role="status">Carregando entregadores…</p>}
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
                <p className={driver.checked_in ? 'admin-driver-checked-in' : undefined}>
                  {driver.checked_in ? 'Check-in ativo' : 'Sem check-in'}
                </p>
                <p>Acesso {statusLabels[driver.status].toLowerCase()}</p>
                {driver.delivery_rate_locked != null && (
                  <p>{driver.delivery_rate_locked ? 'Taxa individual bloqueada' :
                    driver.delivery_rate_cents == null ? 'Taxa individual em branco' :
                      'Taxa individual cadastrada: ' + currency.format(driver.delivery_rate_cents / 100) + '/km'}</p>
                )}
              </div>
              <div className="card-footer card-row-5 admin-driver-actions">
                <button type="button" className="btn-secondary" aria-expanded={selectedAsaasDriver === driver.id} onClick={() => setSelectedAsaasDriver((selected) => selected === driver.id ? undefined : driver.id)}>
                  {selectedAsaasDriver === driver.id ? 'Fechar cadastro Asaas' : 'Cadastro Asaas'}
                </button>
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
