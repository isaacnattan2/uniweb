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

function statusLabel(code?: string) {
  return code ? <>{labels[code] ?? 'Status informado pelo Asaas'} (<code>{code}</code>)</> : 'Sem informação do Asaas';
}

export function StoreAsaasApprovalDetails({ approval, admin = false }: { approval: StoreAsaasApproval; admin?: boolean }) {
  return (
    <div>
      <h3>Situação cadastral no Asaas</h3>
      {admin && approval.id && <p>ID da subconta <code>{approval.id}</code></p>}
      <dl>
        <dt>Aprovação geral</dt><dd>{statusLabel(approval.general)}</dd>
        <dt>Dados comerciais</dt><dd>{statusLabel(approval.commercialInfo)}</dd>
        <dt>Dados bancários</dt><dd>{statusLabel(approval.bankAccountInfo)}</dd>
        <dt>Documentação</dt><dd>{statusLabel(approval.documentation)}</dd>
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
              <strong>{document.type ? labels[document.type] ?? 'Documento' : 'Documento'}</strong>{' '}
              {document.type && <code>{document.type}</code>}{' · '}{statusLabel(document.status)}
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