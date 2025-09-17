import { createContext, useContext, useState, useCallback } from "react";

const ToastCtx = createContext(null);

export function ToasterProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, type = "info") => {
    const id = crypto.randomUUID();
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 space-y-2 z-50">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-lg px-3 py-2 text-sm shadow
                 ${
                   t.type === "error"
                     ? "bg-rose-600 text-white"
                     : t.type === "success"
                     ? "bg-emerald-600 text-white"
                     : "bg-black/80 text-white"
                 }`}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
