# Push de pedidos com OneSignal

Crie um app Web Push para o Uniweb no OneSignal. Configure o domínio HTTPS do frontend e habilite **Token Identity Verification**. Gere a chave privada ES256 em **Settings → Keys & IDs**.

No ambiente do backend, configure:

```dotenv
ONESIGNAL_WEB_APP_ID=
ONESIGNAL_WEB_API_KEY=
ONESIGNAL_WEB_IDENTITY_PRIVATE_KEY=
ONESIGNAL_WEB_ORIGIN=
```

Use o App ID e a App API Key do app Web Push. A chave privada PEM pode ser armazenada em uma só linha com `\n` entre as linhas. Em `ONESIGNAL_WEB_ORIGIN` use a origem pública do frontend, incluindo `https://`. Mantenha as duas chaves somente no backend.

No ambiente de build do frontend, configure `VITE_ONESIGNAL_APP_ID` com o mesmo App ID. Sirva `/OneSignalSDKWorker.js` diretamente como JavaScript e configure o fallback do frontend para `/business/*`.

Entre como lojista, clique em **Ativar notificações de pedidos** e conceda a permissão. Faça um pedido com uma conta de cliente e abra o push para conferir o pedido específico no painel da loja. O evento ocorre quando o pedido é criado e aparece como pendente se aguarda pagamento. O envio é feito após a gravação do pedido e falhas do provedor são registradas no backend.

Para o UniEntregador, configure um app OneSignal separado com FCM para Android e APNs para iOS. No ambiente Expo, defina `EXPO_PUBLIC_ONESIGNAL_APP_ID` e `ONESIGNAL_APNS_MODE`. Gere um build nativo e entre como entregador para solicitar permissão. O app pode receber pushes de teste desse app OneSignal. O evento de novo pedido tem como destinatário o lojista no Uniweb.
