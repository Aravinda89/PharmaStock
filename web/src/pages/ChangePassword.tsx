import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { PageHeader, Card, Banner } from '../components/ui';

/**
 * `forced` renders the page standalone (no navigation) after a pharmacist has
 * reset someone's password - they cannot reach the rest of the app until they
 * have chosen their own.
 */
export function ChangePasswordPage({ forced = false }: { forced?: boolean }) {
  const { refresh, signOut, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError('The two new passwords do not match.');
      return;
    }
    if (newPassword.length < 6) {
      setError('Your new password must be at least 6 characters.');
      return;
    }

    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      await refresh();
      toast.success('Your password has been changed.');
      if (!forced) navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change your password.');
    } finally {
      setBusy(false);
    }
  };

  const form = (
    <form onSubmit={submit}>
      {error && (
        <div className="banner red" role="alert">
          <span aria-hidden="true">⚠️</span>
          <div className="banner-body">{error}</div>
        </div>
      )}

      <div className="field">
        <label htmlFor="current">Current password</label>
        <input
          id="current"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          autoFocus
        />
      </div>

      <div className="field">
        <label htmlFor="new">New password</label>
        <input
          id="new"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
        />
        <div className="hint">At least 6 characters.</div>
      </div>

      <div className="field">
        <label htmlFor="confirm">Repeat new password</label>
        <input
          id="confirm"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
        />
      </div>

      <div className="btn-row">
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Change password'}
        </button>
        {forced && (
          <button className="btn ghost" type="button" onClick={() => void signOut()}>
            Sign out instead
          </button>
        )}
      </div>
    </form>
  );

  if (forced) {
    return (
      <div className="login-page">
        <div className="login-card" style={{ maxWidth: 420 }}>
          <div className="logo" aria-hidden="true">🔑</div>
          <h1>Choose a password</h1>
          <div className="tagline">
            Hello {user?.fullName}. Please set your own password before continuing.
          </div>
          {form}
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Change password" subtitle="Update the password you use to sign in" />
      <div className="page-body" style={{ maxWidth: 520 }}>
        <Banner tone="blue" icon="🔐">
          Your password protects the stock records that carry your name.
        </Banner>
        <Card>{form}</Card>
      </div>
    </>
  );
}
