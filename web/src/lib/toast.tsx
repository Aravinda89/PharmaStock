import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

type ToastTone = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  /** Extra lines - used to spell out resulting stock levels after a change. */
  lines?: string[];
}

interface ToastApi {
  show: (tone: ToastTone, title: string, lines?: string[]) => void;
  success: (title: string, lines?: string[]) => void;
  error: (title: string, lines?: string[]) => void;
  warning: (title: string, lines?: string[]) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (tone: ToastTone, title: string, lines?: string[]) => {
      const id = nextId++;
      setToasts((current) => [...current, { id, tone, title, lines }]);
      // Errors stay longer - the user probably needs to read and act on them.
      window.setTimeout(() => dismiss(id), tone === 'error' ? 9000 : 5500);
    },
    [dismiss]
  );

  const value = useMemo<ToastApi>(
    () => ({
      show,
      success: (title, lines) => show('success', title, lines),
      error: (title, lines) => show('error', title, lines),
      warning: (title, lines) => show('warning', title, lines),
    }),
    [show]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.tone}`} onClick={() => dismiss(toast.id)}>
            <strong>{toast.title}</strong>
            {toast.lines && toast.lines.length > 0 && (
              <div className="toast-lines">
                {toast.lines.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
