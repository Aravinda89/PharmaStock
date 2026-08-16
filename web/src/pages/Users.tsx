import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ROLE_LABELS, useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Banner, Card, ConfirmDialog, Loading, Modal, PageHeader } from '../components/ui';
import { formatDateTime } from '../lib/format';

interface ManagedUser {
  id: number;
  username: string;
  full_name: string;
  role: 'DOCTOR' | 'PHARMACIST' | 'ASSISTANT';
  can_receive_stock: number;
  is_active: number;
  must_change_password: number;
  last_login_at: string | null;
}

const ROLE_SUMMARY: Record<string, string> = {
  DOCTOR: 'View inventory and reports only',
  PHARMACIST: 'Full access, including users and settings',
  ASSISTANT: 'Search, dispense, and receive stock if allowed',
};

export function UsersPage() {
  const { user: me } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<ManagedUser | null>(null);
  const [deactivating, setDeactivating] = useState<ManagedUser | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ items: ManagedUser[] }>('/users'),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  const create = useMutation({
    mutationFn: (values: Record<string, unknown>) => api.post('/users', values),
    onSuccess: () => {
      toast.success('User created. They must change the password at first sign-in.');
      setCreating(false);
      void invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Record<string, unknown> }) => api.put(`/users/${id}`, patch),
    onSuccess: () => {
      toast.success('User updated.');
      setDeactivating(null);
      void invalidate();
    },
    onError: (err: Error) => {
      setDeactivating(null);
      toast.error(err.message);
    },
  });

  const reset = useMutation({
    mutationFn: ({ id, newPassword }: { id: number; newPassword: string }) =>
      api.post(`/users/${id}/reset-password`, { newPassword }),
    onSuccess: () => {
      toast.success('Password reset. Tell them the temporary password — they must change it at sign-in.');
      setResetting(null);
      void invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Who can sign in, and what they are allowed to do"
        actions={<button className="btn primary" type="button" onClick={() => setCreating(true)}>＋ Add user</button>}
      />

      <div className="page-body">
        <Banner tone="blue" icon="🔐" title="Three roles, kept deliberately simple">
          <strong style={{ display: 'inline' }}>Doctor</strong> — {ROLE_SUMMARY.DOCTOR}.{' '}
          <strong style={{ display: 'inline' }}>Pharmacist</strong> — {ROLE_SUMMARY.PHARMACIST}.{' '}
          <strong style={{ display: 'inline' }}>Assistant</strong> — {ROLE_SUMMARY.ASSISTANT}.
        </Banner>

        <Card tight>
          {isLoading && <Loading />}
          {data && (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Username</th>
                    <th>Role</th>
                    <th>Can receive stock</th>
                    <th>Status</th>
                    <th>Last sign-in</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((user) => (
                    <tr key={user.id}>
                      <td className="strong">
                        {user.full_name}
                        {user.id === me?.id && <span className="chip blue" style={{ marginLeft: 6 }}>You</span>}
                      </td>
                      <td className="mono muted">{user.username}</td>
                      <td>
                        <select
                          value={user.role}
                          onChange={(e) => update.mutate({ id: user.id, patch: { role: e.target.value } })}
                          disabled={user.id === me?.id}
                          aria-label={`Role for ${user.full_name}`}
                          style={{ maxWidth: 180 }}
                        >
                          {Object.entries(ROLE_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {user.role === 'ASSISTANT' ? (
                          <label className="checkbox">
                            <input
                              type="checkbox"
                              checked={Boolean(user.can_receive_stock)}
                              onChange={(e) =>
                                update.mutate({ id: user.id, patch: { canReceiveStock: e.target.checked } })
                              }
                            />
                            Allowed
                          </label>
                        ) : (
                          <span className="faint">{user.role === 'PHARMACIST' ? 'Always' : 'No'}</span>
                        )}
                      </td>
                      <td>
                        {user.is_active ? (
                          <span className="chip green">🟢 Active</span>
                        ) : (
                          <span className="chip grey">Deactivated</span>
                        )}
                        {Boolean(user.must_change_password) && (
                          <div className="faint" style={{ fontSize: '0.76rem', marginTop: 2 }}>must set password</div>
                        )}
                      </td>
                      <td className="muted nowrap">{formatDateTime(user.last_login_at)}</td>
                      <td className="nowrap">
                        <button className="btn small ghost" type="button" onClick={() => setResetting(user)}>
                          Reset password
                        </button>
                        {user.id !== me?.id && (
                          <button
                            className="btn small ghost"
                            type="button"
                            onClick={() =>
                              user.is_active
                                ? setDeactivating(user)
                                : update.mutate({ id: user.id, patch: { isActive: true } })
                            }
                          >
                            {user.is_active ? 'Deactivate' : 'Reactivate'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {creating && (
        <Modal title="Add a user" onClose={() => setCreating(false)}>
          <NewUserForm busy={create.isPending} onCancel={() => setCreating(false)} onSubmit={(v) => create.mutate(v)} />
        </Modal>
      )}

      {resetting && (
        <Modal title={`Reset password for ${resetting.full_name}`} onClose={() => setResetting(null)}>
          <ResetPasswordForm
            busy={reset.isPending}
            onCancel={() => setResetting(null)}
            onSubmit={(newPassword) => reset.mutate({ id: resetting.id, newPassword })}
          />
        </Modal>
      )}

      {deactivating && (
        <ConfirmDialog
          title={`Deactivate ${deactivating.full_name}?`}
          tone="danger"
          confirmLabel="Deactivate"
          busy={update.isPending}
          onCancel={() => setDeactivating(null)}
          onConfirm={() => update.mutate({ id: deactivating.id, patch: { isActive: false } })}
          message={
            <p>
              They will not be able to sign in. All the stock records carrying their name are kept,
              and the account can be reactivated at any time.
            </p>
          }
        />
      )}
    </>
  );
}

function NewUserForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (values: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState({
    fullName: '',
    username: '',
    password: '',
    role: 'ASSISTANT',
    canReceiveStock: true,
  });

  const set = (key: keyof typeof values, value: string | boolean) =>
    setValues((current) => ({ ...current, [key]: value }));

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(values); }}>
      <div className="field">
        <label htmlFor="u-name">Full name *</label>
        <input id="u-name" value={values.fullName} onChange={(e) => set('fullName', e.target.value)} required autoFocus />
      </div>

      <div className="form-row">
        <div className="field">
          <label htmlFor="u-username">Username *</label>
          <input id="u-username" value={values.username} onChange={(e) => set('username', e.target.value)} required />
          <div className="hint">Letters, numbers, dot, dash, underscore.</div>
        </div>
        <div className="field">
          <label htmlFor="u-role">Role *</label>
          <select id="u-role" value={values.role} onChange={(e) => set('role', e.target.value)}>
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <div className="hint">{ROLE_SUMMARY[values.role]}</div>
        </div>
      </div>

      <div className="field">
        <label htmlFor="u-password">Temporary password *</label>
        <input
          id="u-password"
          type="text"
          value={values.password}
          onChange={(e) => set('password', e.target.value)}
          required
          minLength={6}
        />
        <div className="hint">
          At least 6 characters. Tell it to them directly — they must choose their own at first sign-in.
        </div>
      </div>

      {values.role === 'ASSISTANT' && (
        <label className="checkbox" style={{ marginBottom: 16 }}>
          <input
            type="checkbox"
            checked={values.canReceiveStock}
            onChange={(e) => set('canReceiveStock', e.target.checked)}
          />
          <span>
            Allowed to record received stock
            <div className="hint" style={{ marginTop: 2 }}>
              Assistants can always dispense and search. This controls deliveries only.
            </div>
          </span>
        </label>
      )}

      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create user'}</button>
      </div>
    </form>
  );
}

function ResetPasswordForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(password); }}>
      <div className="field">
        <label htmlFor="rp-password">Temporary password *</label>
        <input
          id="rp-password"
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          autoFocus
        />
        <div className="hint">
          At least 6 characters. They will be asked to choose their own password when they sign in.
        </div>
      </div>

      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Resetting…' : 'Reset password'}</button>
      </div>
    </form>
  );
}
