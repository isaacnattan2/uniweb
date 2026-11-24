import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../context/store';
import { getStorePushIdentity } from '../services/api';
import '../styles/store-push.css';

type ForegroundListener = (event: {
  notification: { notificationId: string; title?: string; body?: string; launchURL?: string };
  preventDefault(): void;
}) => void;

type OrderNotice = { id: string; path: string; title: string; body?: string };

type PushSDK = {
  init(options: { appId: string; serviceWorkerPath: string }): Promise<void>;
  login(id: string, token: string): Promise<void>;
  logout(): Promise<void>;
  updateUserJwt(id: string, token: string): Promise<void>;
  Notifications: {
    permission: boolean;
    addEventListener(name: 'foregroundWillDisplay', listener: ForegroundListener): void;
    removeEventListener(name: 'foregroundWillDisplay', listener: ForegroundListener): void;
  };
  User: {
    PushSubscription: {
      optedIn: boolean;
      optIn(): Promise<void>;
      optOut(): Promise<void>;
      addEventListener(event: 'change', listener: () => void): void;
      removeEventListener(event: 'change', listener: () => void): void;
    };
    addEventListener(event: 'userJwtInvalidated', listener: (event: { externalId: string }) => void): void;
  };
};

const appId = import.meta.env.VITE_ONESIGNAL_APP_ID;
const preferenceKey = 'uniweb:push-preference-seen';
let sdk: Promise<PushSDK> | undefined;
let sessionUpdate = Promise.resolve();

function loadSdk() {
  if (!sdk) {
    sdk = new Promise<PushSDK>((resolve, reject) => {
      const browser = window as Window & { OneSignalDeferred?: Array<(instance: PushSDK) => void> };
      browser.OneSignalDeferred ??= [];
      browser.OneSignalDeferred.push((instance) => {
        void instance.init({ appId, serviceWorkerPath: 'OneSignalSDKWorker.js' }).then(() => {
          instance.User.addEventListener('userJwtInvalidated', ({ externalId }) => {
            const session = useAuthStore.getState();
            if (!session.token || session.userId !== externalId) return;
            void getStorePushIdentity().then((identity) => {
              if (identity.externalId === externalId && useAuthStore.getState().token === session.token) {
                return instance.updateUserJwt(externalId, identity.token);
              }
            }).catch(console.warn);
          });
          resolve(instance);
        }).catch(reject);
      });
      const script = document.createElement('script');
      script.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
      script.onerror = reject;
      document.head.append(script);
    });
  }
  return sdk;
}

export function StorePush() {
  const { token, userType } = useAuthStore();
  const subscribedRole = !!token && !!userType;
  const [ready, setReady] = useState<PushSDK | null>(null);
  const [notice, setNotice] = useState('');
  const [orders, setOrders] = useState<OrderNotice[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [preferenceSeen, setPreferenceSeen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const gear = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!appId || !window.isSecureContext || !('Notification' in window) || !('serviceWorker' in navigator)) return;
    let current = true;
    setReady(null);
    setNotice('');
    setOrders([]);
    setSettingsOpen(false);
    sessionUpdate = sessionUpdate.then(async () => {
      if (!current) return;
      if (!subscribedRole) {
        if (sdk || Notification.permission === 'granted') await (await loadSdk()).logout();
        return;
      }
      const instance = await loadSdk();
      if (!current) return;
      const identity = await getStorePushIdentity();
      if (!current) return;
      await instance.login(identity.externalId, identity.token);
      // The SDK can be a class, which React would otherwise call as a state updater.
      if (current) setReady(() => instance);
    }).catch(() => {
      if (current && subscribedRole) setNotice('Não foi possível conectar as notificações.');
    });
    return () => { current = false; };
  }, [subscribedRole, token]);

  useEffect(() => {
    if (!ready) return;
    const subscription = ready.User.PushSubscription;
    function sync() {
      setEnabled(subscription.optedIn);
      if (!subscription.optedIn) setOrders([]);
      if (subscription.optedIn || Notification.permission !== 'default') setPreferenceSeen(true);
    }
    try {
      if (localStorage.getItem(preferenceKey)) setPreferenceSeen(true);
    } catch {
      // Browser storage may be disabled.
    }
    sync();
    subscription.addEventListener('change', sync);
    return () => subscription.removeEventListener('change', sync);
  }, [ready]);

  useEffect(() => {
    if (!ready || !subscribedRole) return;
    const onOrder: ForegroundListener = (event) => {
      const { notificationId: id, launchURL, title, body } = event.notification;
      if (!ready.User.PushSubscription.optedIn || document.visibilityState !== 'visible' || !document.hasFocus() || !launchURL ||
          useAuthStore.getState().token !== token) return;
      const url = URL.parse(launchURL, window.location.origin);
      if (!url || url.origin !== window.location.origin) return;
      const path = url.pathname + url.search;
      const orderPath = userType === 'business' ? /^\/business\/[\da-f-]{36}\?order=[\da-f-]{36}$/i : /^\/order\/[\da-f-]{36}$/i;
      if (!orderPath.test(path)) return;
      event.preventDefault();
      setOrders((previous) => previous.some((order) => order.id === id)
        ? previous : [{ id, path, title: title || 'Atualização do pedido', body }, ...previous]);
    };
    ready.Notifications.addEventListener('foregroundWillDisplay', onOrder);
    return () => ready.Notifications.removeEventListener('foregroundWillDisplay', onOrder);
  }, [ready, subscribedRole, token, userType]);

  function dismissOrder(id: string) {
    setOrders((previous) => previous.filter((order) => order.id !== id));
  }

  function closeSettings() {
    setSettingsOpen(false);
    gear.current?.focus();
  }

  async function changeSubscription(next: boolean) {
    if (!ready || changing) return;
    setChanging(true);
    setNotice('');
    try {
      const subscription = ready.User.PushSubscription;
      if (next) await subscription.optIn();
      else await subscription.optOut();
      if (useAuthStore.getState().token !== token) return;
      setEnabled(subscription.optedIn);
      setPreferenceSeen(true);
      try { localStorage.setItem(preferenceKey, '1'); } catch { /* Storage is optional. */ }
      if (!next) setOrders([]);
      if (next && !ready.Notifications.permission) {
        setSettingsOpen(true);
      } else {
        closeSettings();
      }
    } catch {
      if (useAuthStore.getState().token === token) {
        setNotice(next ? 'Não foi possível ativar as notificações.' : 'Não foi possível desativar as notificações.');
      }
    } finally {
      setChanging(false);
    }
  }

  const showGear = ready && (enabled || preferenceSeen || Notification.permission !== 'default');
  const header = showGear ? document.getElementById('header-push-settings') : null;
  return subscribedRole && appId && (ready || notice) ? (
    <div className="container">
      {ready && !showGear && (
        <button type="button" className="btn-secondary" disabled={changing} onClick={() => void changeSubscription(true)}>Ativar notificações</button>
      )}
      {header && createPortal(
        <div className="push-settings" onKeyDown={(event) => { if (event.key === 'Escape' && settingsOpen) closeSettings(); }}>
          <button ref={gear} type="button" className="push-settings-trigger" aria-label="Configurar notificações"
            title="Configurar notificações" aria-expanded={settingsOpen} aria-controls="web-push-preferences"
            onClick={() => setSettingsOpen((open) => !open)}><span aria-hidden="true">⚙</span></button>
          {settingsOpen && (
            <div id="web-push-preferences" className="push-settings-panel">
              <strong>Notificações</strong>
              <p>{enabled ? 'Ativadas neste navegador' : 'Desativadas neste navegador'}</p>
              {Notification.permission === 'denied' && <p>Para ativar, permita notificações nas configurações do navegador.</p>}
              {notice && <p role="status">{notice}</p>}
              <button type="button" className="btn-secondary" disabled={changing || (!enabled && Notification.permission === 'denied')}
                onClick={() => void changeSubscription(!enabled)}>{enabled ? 'Desativar notificações' : 'Ativar notificações'}</button>
            </div>
          )}
        </div>,
        header
      )}
      {notice && !showGear && <span role="status"> {notice}</span>}
      <section className="store-push-stack" aria-label="Notificações de pedidos" aria-live="polite">
        {orders.map((order) => (
          <article className="store-push-card" key={order.id}>
            <Link className="store-push-link" to={order.path} onClick={() => dismissOrder(order.id)}>
              <strong>{order.title}</strong>
              {order.body && <span>{order.body}</span>}
              <span className="store-push-action">Ver pedido</span>
            </Link>
            <button type="button" className="store-push-close" aria-label="Dispensar notificação"
              onClick={() => dismissOrder(order.id)}>×</button>
          </article>
        ))}
      </section>
    </div>
  ) : null;
}
