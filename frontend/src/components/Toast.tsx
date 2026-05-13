import React, { useState, useEffect, useCallback } from 'react';

// Simple toast notification system
interface Toast {
  id: number;
  message: string;
  type: 'info' | 'error' | 'success';
}

let toastId = 0;
let addToastFn: ((msg: string, type: Toast['type']) => void) | null = null;

export function showToast(message: string, type: Toast['type'] = 'info') {
  addToastFn?.(message, type);
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: Toast['type']) => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  }, []);

  useEffect(() => {
    addToastFn = addToast;
    return () => { addToastFn = null; };
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`toast toast-${t.type}`}
          onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
