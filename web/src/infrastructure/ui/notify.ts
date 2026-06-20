// Notificaciones de escritorio (Web Notifications API) para avisos de "el agente
// necesita atención". Best-effort: si no hay permiso, simplemente no hace nada.

export function requestNotifyPermission(): void {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  } catch {
    // API no disponible (navegador sin soporte / contexto no seguro)
  }
}

export function notify(title: string, body: string): void {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const n = new Notification(title, { body });
      // Al hacer clic, enfoca la ventana de la app.
      n.onclick = () => {
        window.focus();
        n.close();
      };
    }
  } catch {
    // Ignorar fallos de notificación: nunca deben romper el flujo.
  }
}
