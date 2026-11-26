import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '../context/store';
import { getDriverRegistration, getMyBusinesses } from '../services/api';
import { Header } from './Header';
import './profile-navigation.css';

type MenuItem = { label: string; to: string; active?: boolean; children?: MenuItem[]; defaultExpanded?: boolean };
type MenuGroup = { label: string; items: MenuItem[] };

export function ProfileNavigation({ children }: { children: ReactNode }) {
  const { token, userType } = useAuthStore();
  const { pathname, search } = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [branches, setBranches] = useState<Record<string, boolean>>({});
  const [storeMenu, setStoreMenu] = useState<{ token: string; stores: { id: string; name: string }[]; failed?: boolean }>();
  const [driverDownload, setDriverDownload] = useState<{ token: string; url?: string }>();
  const [storeRetry, retryStores] = useState(0);
  const mobileToggle = useRef<HTMLButtonElement>(null);
  const mobileClose = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (mobileOpen) mobileClose.current?.focus();
  }, [mobileOpen]);
  useEffect(() => {
    if (!token || userType !== 'business') return;
    const request = new AbortController();
    void getMyBusinesses(request.signal).then((stores) => {
      if (!request.signal.aborted) setStoreMenu({ token, stores });
    }).catch(() => {
      if (!request.signal.aborted) setStoreMenu((previous) => ({
        token, stores: previous?.token === token ? previous.stores : [], failed: true,
      }));
    });
    return () => request.abort();
  }, [token, userType, pathname, storeRetry]);

  useEffect(() => {
    if (!token || userType !== 'driver') return;
    const request = new AbortController();
    void getDriverRegistration(request.signal).then((profile) => {
      if (!request.signal.aborted) setDriverDownload({ token, url: profile.app_download_url ?? undefined });
    }).catch(() => {
      if (!request.signal.aborted) setDriverDownload({ token });
    });
    return () => request.abort();
  }, [token, userType]);

  if (!token || !userType || userType === 'customer' || ['/login', '/register', '/register/driver'].includes(pathname)) return <><Header />{children}</>;

  const query = new URLSearchParams(search);
  const section = query.get('aba');
  const storePath = pathname.match(/^\/business\/([^/]+)(?:\/|$)/)?.[0]?.replace(/\/$/, '');
  const storeSection = pathname !== storePath ? 'produtos' : query.has('order') ? 'pedidos' : section ?? 'dados';
  const stores = storeMenu?.token === token ? storeMenu.stores : [];
  const storeItems: MenuItem[] = stores.map(({ id, name }) => {
    const path = '/business/' + encodeURIComponent(id);
    const sections = [
      { key: 'dados', label: 'Dados da loja' },
      { key: 'pedidos', label: 'Pedidos' },
      { key: 'produtos', label: 'Produtos' },
      { key: 'cupons', label: 'Cupons' },
      { key: 'pagamentos', label: 'Pagamentos' },
      { key: 'asaas', label: userType === 'admin' ? 'Cadastro Asaas' : 'Saques Asaas' },
    ];
    return {
      to: path, label: name, active: false,
      defaultExpanded: stores.length === 1 || storePath === path,
      children: sections.map(({ key, label }) => ({
        to: path + '?aba=' + key, label, active: storePath === path && key === storeSection,
      })),
    };
  });

  const groups: MenuGroup[] = userType === 'admin' ? [
    { label: 'Marketplace', items: [
      { to: '/admin/lojistas', label: 'Lojistas', active: !!storePath || pathname.startsWith('/admin/lojistas') || pathname === '/new-business' },
      { to: '/admin/categorias', label: 'Categorias' },
      { to: '/admin/anuncios', label: 'Anúncios' },
    ] },
    { label: 'Entregas', items: [{ to: '/admin/entregadores', label: 'Entregadores', children: [
      { to: '/admin/entregadores/tarifas', label: 'Tarifas de entrega' },
      { to: '/admin/entregadores/alocacao', label: 'Regras de alocação' },
      { to: '/admin/entregadores/ocorrencias', label: 'Ocorrências e estornos' },
      { to: '/admin/entregadores/auditoria', label: 'Auditoria de entregas' },
    ] }] },
    { label: 'Financeiro', items: [
      { to: '/admin/financeiro', label: 'Saldo da plataforma' },
      { to: '/admin/simulador-split', label: 'Simulador de split' },
    ] },
    { label: 'Aplicativo', items: [{ to: '/admin/cores-do-app', label: 'Cores do app' }] },
  ] : userType === 'business' ? [
    { label: 'Lojista', items: [{ to: '/dashboard', label: 'Minhas lojas', children: storeItems }] },
  ] : [
    { label: 'Entregador', items: [
      { to: '/driver', label: 'Meu cadastro', active: pathname === '/driver' && section !== 'saques' },
      { to: '/driver?aba=saques', label: 'Saques Asaas', active: pathname === '/driver' && section === 'saques' },
    ] },
  ];

  function renderItem(item: MenuItem) {
    const active = item.active ?? pathname === item.to;
    const hasChildren = Boolean(item.children?.length);
    const expanded = branches[item.to] ?? item.defaultExpanded ?? true;
    const submenuId = 'profile-submenu-' + encodeURIComponent(item.to);
    return (
      <li key={item.to}>
        <div className="profile-menu-row">
          <Link to={item.to} aria-current={active ? 'page' : undefined} onClick={() => setMobileOpen(false)}>{item.label}</Link>
          {hasChildren && (
            <button type="button" className="profile-submenu-toggle" aria-expanded={expanded}
              aria-controls={submenuId} aria-label={(expanded ? 'Recolher ' : 'Expandir ') + item.label}
              onClick={() => setBranches((current) => ({ ...current, [item.to]: !expanded }))}>
              <span aria-hidden="true" />
            </button>
          )}
        </div>
        {hasChildren && <ul id={submenuId} hidden={!expanded}>{item.children?.map(renderItem)}</ul>}
      </li>
    );
  }

  const home = userType === 'admin' ? '/admin' : userType === 'business' ? '/dashboard'
    : userType === 'driver' ? '/driver' : '/shop';
  const downloadUrl = driverDownload?.token === token ? driverDownload.url : undefined;
  function closeMobile() {
    setMobileOpen(false);
    mobileToggle.current?.focus();
  }

  return (
    <div className={['profile-shell', collapsed && 'is-collapsed', mobileOpen && 'is-mobile-open'].filter(Boolean).join(' ')}
      onKeyDown={(event) => { if (mobileOpen && event.key === 'Escape') closeMobile(); }}>
      {mobileOpen && <button type="button" className="profile-menu-backdrop" tabIndex={-1} aria-label="Fechar menu" onClick={closeMobile} />}
      <aside className="profile-sidebar" aria-label="Navegação do perfil">
        <div className="profile-sidebar-top">
          <Link to={home} className="profile-brand" aria-label="UniWeb — início" onClick={() => setMobileOpen(false)}>
            <img src="/unientregador-icon.png" width="36" height="36" alt="" />
            <span>UniWeb</span>
          </Link>
          <button type="button" className="profile-menu-toggle profile-desktop-toggle" aria-expanded={!collapsed}
            aria-controls="profile-menu" aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            title={collapsed ? 'Expandir menu' : 'Recolher menu'} onClick={() => setCollapsed(!collapsed)}>
            <span aria-hidden="true">{collapsed ? '›' : '‹'}</span>
          </button>
          <button type="button" ref={mobileClose} className="profile-menu-toggle profile-mobile-close"
            aria-label="Fechar menu" onClick={closeMobile}><span aria-hidden="true">×</span></button>
        </div>
        <nav id="profile-menu" className="profile-menu" aria-label="Menu do perfil">
          {userType === 'business' && storeMenu?.token !== token && (
            <p className="profile-menu-label" role="status">Carregando lojas…</p>
          )}
          {userType === 'business' && storeMenu?.token === token && storeMenu.failed && (
            <button type="button" className="profile-menu-retry" onClick={() => retryStores((value) => value + 1)}>Recarregar lojas</button>
          )}
          {groups.map((group) => (
            <div key={group.label}>
              <p className="profile-menu-label">{group.label}</p>
              <ul>{group.items.map(renderItem)}</ul>
            </div>
          ))}
        </nav>
        {userType === 'driver' && (
          <div className="profile-sidebar-footer">
            {downloadUrl ? (
              <a href={downloadUrl} referrerPolicy="no-referrer" className="btn-primary profile-download"
                aria-label="Baixar aplicativo" title="Baixar aplicativo">
                <span className="profile-download-icon" aria-hidden="true">↓</span>
                <span className="profile-download-label">Baixar aplicativo</span>
              </a>
            ) : (
              <button type="button" disabled className="btn-primary profile-download"
                aria-label="Download do aplicativo indisponível" title="Download do aplicativo indisponível">
                <span className="profile-download-icon" aria-hidden="true">↓</span>
                <span className="profile-download-label">{driverDownload?.token === token ? 'Download indisponível' : 'Carregando…'}</span>
              </button>
            )}
          </div>
        )}
      </aside>
      <div className="profile-content">
        <Header compact leading={
          <button type="button" ref={mobileToggle} className="profile-menu-toggle profile-mobile-toggle"
            aria-expanded={mobileOpen} aria-controls="profile-menu" aria-label="Abrir menu"
            onClick={() => setMobileOpen(true)}><span aria-hidden="true">☰</span></button>
        } />
        {children}
      </div>
    </div>
  );
}
