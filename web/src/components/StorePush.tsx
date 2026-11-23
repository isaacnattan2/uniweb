import React, { useEffect, useState } from 'react';
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
    requestPermission(): Promise<void>;
    addEventListener(name: 'foregroundWillDisplay', listener: ForegroundListener): void;
    removeEventListener(name: 'foregroundWillDisplay', listener: ForegroundListener): void;
  };
  User: {
    PushSubscription: { optIn(): Promise<void> };
    addEventListener(event: 'userJwtInvalidated', listener: (event: { externalId: string }) => void): void;
  };
};

const appId = import.meta.env.VITE_ONESIGNAL_APP_ID;
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
  const subscribedRole = !!token && (userType === 'business' || userType === 'customer');
  const [ready, setReady] = useState<PushSDK | null>(null);
  const [notice, setNotice] = useState('');
  const [orders, setOrders] = useState<OrderNotice[]>([]);

  useEffect(() => {
    if (!appId || !window.isSecureContext || !('Notification' in window) || !('serviceWorker' in navigator)) return;
    let current = true;
    setReady(null);
    setNotice('');
    setOrders([]);
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
    if (!ready || !subscribedRole) return;
    const onOrder: ForegroundListener = (event) => {
      const { notificationId: id, launchURL, title, body } = event.notification;
      if (document.visibilityState !== 'visible' || !document.hasFocus() || !launchURL ||
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

  async function enable() {
    if (!ready) return;
    try {
      await ready.Notifications.requestPermission();
      if (ready.Notifications.permission) await ready.User.PushSubscription.optIn();
      setNotice(ready.Notifications.permission ? 'Notificações ativadas.' : 'Permita notificações nas configurações do navegador.');
    } catch {
      setNotice('Não foi possível ativar as notificações.');
    }
  }

  return subscribedRole && appId && (ready || notice) ? (
    <div className="container">
      {ready && <button type="button" className="btn-secondary" onClick={() => void enable()}>Ativar notificações de pedidos</button>}
      {notice && <span role="status"> {notice}</span>}
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
