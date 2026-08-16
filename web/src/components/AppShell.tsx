import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PERMISSIONS, ROLE_LABELS, useAuth } from '../lib/auth';
import { api } from '../lib/api';
import type { DashboardSummary } from '../lib/types';

interface NavEntry {
  to: string;
  label: string;
  icon: string;
  permission?: string;
  badge?: number;
}

export function AppShell() {
  const { user, settings, signOut, can } = useAuth();
  const navigate = useNavigate();

  // Alert counts sit in the navigation so a problem is visible from any screen,
  // not only when someone happens to open the dashboard.
  const { data: summary } = useQuery({
    queryKey: ['alert-summary'],
    queryFn: () => api.get<{ summary: DashboardSummary }>('/dashboard?limit=1').then((d) => d.summary),
    refetchInterval: 120_000,
    enabled: Boolean(user),
  });

  const alertCount = (summary?.expired ?? 0) + (summary?.expiring_soon ?? 0) + (summary?.low_stock ?? 0);

  const groups: { heading?: string; items: NavEntry[] }[] = [
    {
      items: [
        { to: '/', label: 'Dashboard', icon: '🏠' },
        { to: '/inventory', label: 'Inventory', icon: '💊' },
        { to: '/alerts', label: 'Alerts', icon: '🔔', badge: alertCount },
      ],
    },
    {
      heading: 'Daily work',
      items: [
        { to: '/dispense', label: 'Dispense', icon: '📤', permission: PERMISSIONS.STOCK_DISPENSE },
        { to: '/receive', label: 'Receive stock', icon: '📦', permission: PERMISSIONS.STOCK_RECEIVE },
        { to: '/adjustments', label: 'Adjustments', icon: '⚖️', permission: PERMISSIONS.STOCK_ADJUST },
        { to: '/history', label: 'History', icon: '🕑' },
      ],
    },
    {
      heading: 'Records',
      items: [
        { to: '/reports', label: 'Reports', icon: '📊', permission: PERMISSIONS.REPORTS_VIEW },
        { to: '/suppliers', label: 'Suppliers', icon: '🚚' },
        { to: '/users', label: 'Users', icon: '👥', permission: PERMISSIONS.USERS_MANAGE },
        { to: '/settings', label: 'Settings', icon: '⚙️' },
      ],
    },
  ];

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span aria-hidden="true" style={{ fontSize: '1.5rem' }}>💊</span>
          <div>
            <strong>PharmaStock</strong>
            <small>{settings?.pharmacy_name ?? 'Pharmacy inventory'}</small>
          </div>
        </div>

        <nav className="sidebar-nav">
          {groups.map((group, i) => {
            const visible = group.items.filter((item) => !item.permission || can(item.permission));
            if (visible.length === 0) return null;
            return (
              <div key={i}>
                {group.heading && <div className="nav-section">{group.heading}</div>}
                {visible.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                  >
                    <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                    {item.label}
                    {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-user">
          <div className="who">{user?.fullName}</div>
          <div className="role">{user ? ROLE_LABELS[user.role] : ''}</div>
          <button type="button" onClick={handleSignOut}>Sign out</button>
        </div>
      </aside>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
