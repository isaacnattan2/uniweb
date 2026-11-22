import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../context/store';
import { getStorePushIdentity } from '../services/api';

type PushSDK = {
  init(options: { appId: string; serviceWorkerPath: string }): Promise<void>;
  login(id: string, token: string): Promise<void>;
  logout(): Promise<void>;
  updateUserJwt(id: string, token: string): Promise<void>;
  Notifications: { permission: boolean; requestPermission(): Promise<void> };
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
            if (session.userType !== 'business' || session.userId !== externalId) return;
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
  const seller = !!token && userType === 'business';
  const [ready, setReady] = useState<PushSDK | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!appId || !window.isSecureContext || !('Notification' in window) || !('serviceWorker' in navigator)) return;
    let current = true;
    setReady(null);
    setNotice('');
    sessionUpdate = sessionUpdate.then(async () => {
      if (!current) return;
      if (!seller) {
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
      if (current && seller) setNotice('Não foi possível conectar as notificações.');
    });
    return () => { current = false; };
  }, [seller, token]);

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

  return seller && appId && (ready || notice) ? (
    <div className="container">
      {ready && <button type="button" className="btn-secondary" onClick={() => void enable()}>Ativar notificações de pedidos</button>}
      {notice && <span role="status"> {notice}</span>}
    </div>
  ) : null;
}
