import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './lib/auth';
import { AppShell } from './components/AppShell';
import { Loading, PageHeader, EmptyState } from './components/ui';

import { LoginPage } from './pages/Login';
import { ChangePasswordPage } from './pages/ChangePassword';
import { DashboardPage } from './pages/Dashboard';
import { InventoryPage } from './pages/Inventory';
import { DrugDetailPage } from './pages/DrugDetail';
import { ReceivePage } from './pages/Receive';
import { DispensePage } from './pages/Dispense';
import { AdjustmentsPage } from './pages/Adjustments';
import { AlertsPage } from './pages/Alerts';
import { HistoryPage } from './pages/History';
import { ReportsPage } from './pages/Reports';
import { SuppliersPage } from './pages/Suppliers';
import { UsersPage } from './pages/Users';
import { SettingsPage } from './pages/Settings';

function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(permission)) {
    return (
      <>
        <PageHeader title="Not available" />
        <div className="page-body">
          <EmptyState
            icon="🔒"
            title="You do not have access to this screen"
            message="Ask the pharmacist if you need this permission."
          />
        </div>
      </>
    );
  }
  return <>{children}</>;
}

export function App() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div style={{ paddingTop: '25vh' }}><Loading label="Starting PharmaStock…" /></div>;
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" state={{ from: location.pathname }} replace />} />
      </Routes>
    );
  }

  // A password reset by the pharmacist must be completed before anything else.
  if (user.mustChangePassword) {
    return <ChangePasswordPage forced />;
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/inventory/:id" element={<DrugDetailPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/history" element={<HistoryPage />} />

        <Route
          path="/receive"
          element={<RequirePermission permission="stock.receive"><ReceivePage /></RequirePermission>}
        />
        <Route
          path="/dispense"
          element={<RequirePermission permission="stock.dispense"><DispensePage /></RequirePermission>}
        />
        <Route
          path="/adjustments"
          element={<RequirePermission permission="stock.adjust"><AdjustmentsPage /></RequirePermission>}
        />
        <Route
          path="/reports"
          element={<RequirePermission permission="reports.view"><ReportsPage /></RequirePermission>}
        />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route
          path="/users"
          element={<RequirePermission permission="users.manage"><UsersPage /></RequirePermission>}
        />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
