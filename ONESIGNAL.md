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

Clientes também podem ativar as notificações no Uniweb. Lojista e cliente recebem avisos de cancelamento, aceite da entrega e confirmação pelo código. O clique abre o pedido no painel correspondente à conta.

Para o UniEntregador, configure um app OneSignal separado com FCM para Android e APNs para iOS. O App ID público do app está em `app.json`, no campo `expo.extra.oneSignalAppId`. Configure `ONESIGNAL_APNS_MODE` no ambiente de build do Expo. No backend, use o mesmo App ID em `ONESIGNAL_DRIVER_APP_ID` e guarde a App API Key móvel em `ONESIGNAL_DRIVER_API_KEY`. O backend usa `JWT_SECRET` para gerar identificadores de push dos entregadores. Se esse segredo mudar, os entregadores precisarão abrir o app e autenticar novamente para vincular a inscrição ao identificador novo.

### Android

1. No Firebase, confira se o app Android usa o pacote `br.com.uniweb.unientregador` e habilite a API Firebase Cloud Messaging v1.
2. No app móvel do OneSignal, abra **Settings → Push & In-App → Google Android (FCM)** e carregue o JSON privado da conta de serviço desse projeto Firebase. O **Sender ID** deve corresponder ao número do projeto. Mantenha esse JSON privado no painel do OneSignal.
3. Se o build usar `google-services.json`, utilize o arquivo de configuração do cliente Android do mesmo projeto Firebase e confirme se o plugin Google Services é aplicado na build. O arquivo do cliente é diferente da chave privada da conta de serviço.
4. Abra o UniEntregador, entre na conta e confira em **Audience → Subscriptions** do OneSignal se o dispositivo aparece com uma inscrição Android ativa. Envie um teste a essa inscrição antes de testar uma oferta de corrida.

O log `Missing Google Project number!` indica que o SDK Android não recebeu o Sender ID. Confira a configuração FCM do app móvel e o App ID da build antes de investigar o pop-up de oferta. Consulte a [documentação de credenciais Android do OneSignal](https://documentation.onesignal.com/docs/en/android-firebase-credentials).

Gere um build nativo e entre como entregador para solicitar permissão. A confirmação do pagamento de um pedido de entrega e a recolocação na fila avisam os entregadores ativos. Se um pedido com entregador atribuído for cancelado ou entregue, o app notifica esse entregador. O clique abre a aba **Disponíveis** ou **Minhas entregas**.
