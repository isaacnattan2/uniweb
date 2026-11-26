import type { StoreAsaasApproval } from '../services/api';

const labels: Record<string, string> = {
  APPROVED: 'Aprovado',
  PENDING: 'Pendente',
  AWAITING_APPROVAL: 'Aguardando análise',
  REJECTED: 'Rejeitado',
  NOT_SENT: 'Não enviado',
  EXPIRED: 'Expirado',
  IDENTIFICATION: 'Documento de identificação',
  SELFIE: 'Selfie',
};

const problemStatuses = new Set(['PENDING', 'REJECTED', 'NOT_SENT', 'EXPIRED', 'FAILED', 'BLOCKED']);

function ApprovalStatus({ code, technical }: { code?: string; technical: boolean }) {
  if (!code) return <span className="asaas-status asaas-status-neutral">Sem informação</span>;
  const tone = code === 'APPROVED' ? 'success' : problemStatuses.has(code) ? 'problem' : 'neutral';
  const symbol = tone === 'success' ? '✓' : tone === 'problem' ? '×' : '…';
  return (
    <span className={'asaas-status asaas-status-' + tone}>
      <span className="asaas-status-icon" aria-hidden="true">{symbol}</span>
      <span>{labels[code] ?? 'Status informado pelo Asaas'}</span>
      {technical && <code>{code}</code>}
    </span>
  );
}

export function StoreAsaasApprovalDetails({ approval, admin = false }: { approval: StoreAsaasApproval; admin?: boolean }) {
  return (
    <div>
      <h3>Situação cadastral no Asaas</h3>
      {admin && approval.id && <p>ID da subconta <code>{approval.id}</code></p>}
      <dl className="asaas-status-list list-panel list-panel-inset">
        <div><dt>Aprovação geral</dt><dd><ApprovalStatus code={approval.general} technical={admin} /></dd></div>
        <div><dt>Dados comerciais</dt><dd><ApprovalStatus code={approval.commercialInfo} technical={admin} /></dd></div>
        <div><dt>Dados bancários</dt><dd><ApprovalStatus code={approval.bankAccountInfo} technical={admin} /></dd></div>
        <div><dt>Documentação</dt><dd><ApprovalStatus code={approval.documentation} technical={admin} /></dd></div>
      </dl>
      {approval.commercialInfo === 'PENDING' && <p>Complete ou revise os dados comerciais do titular no Asaas.</p>}
      {approval.bankAccountInfo === 'PENDING' && <p>Informe os dados bancários do titular no Asaas.</p>}
      <h3>Documentos solicitados</h3>
      {approval.documentQuery === 'initializing' ? (
        <p>Aguarde 15 segundos após a criação da subconta e atualize a consulta.</p>
      ) : approval.documentQuery === 'unavailable' ? (
        <p>O Asaas deixou a consulta de documentos indisponível{approval.documentHttpStatus ? ' (HTTP ' + approval.documentHttpStatus + ')' : ''}. Tente novamente.</p>
      ) : approval.documents.length === 0 ? (
        <p>O Asaas ainda não listou documentos para esta conta.</p>
      ) : (
        <ul>
          {approval.documents.map((document, index) => (
            <li key={document.id ?? index}>
              <strong>{document.type ? labels[document.type] ?? 'Documento' : 'Documento'}</strong>{' · '}
              {admin && document.type && <><code>{document.type}</code>{' · '}</>}
              <ApprovalStatus code={document.status} technical={admin} />
              {admin && document.id && <div>ID <code>{document.id}</code></div>}
              {document.description && <div>{document.description}</div>}
              {document.onboardingUrl ? (
                <a href={document.onboardingUrl} target="_blank" rel="noreferrer">Abrir envio de documentos no Asaas</a>
              ) : !admin && (document.status === 'NOT_SENT' || document.status === 'REJECTED') && (
                <div>O Asaas não forneceu um link para este documento. Fale com a administração para orientar o envio.</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
