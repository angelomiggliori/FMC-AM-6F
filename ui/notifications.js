/**
 * ui/notifications.js
 * Sistema de notificações toast da interface
 */

let _timer = null;
let _el    = null;

function _getEl() {
  if (!_el) _el = document.getElementById('notif');
  return _el;
}

/**
 * Exibe uma notificação toast.
 * @param {string} message
 * @param {'ok'|'err'|'info'} type
 * @param {number} duration - ms antes de esconder (default 2800)
 */
export function notify(message, type = 'info', duration = 2800) {
  const el = _getEl();
  if (!el) { console.log(`[notify:${type}] ${message}`); return; }

  el.textContent = message;
  el.className   = `notif show ${type}`;

  clearTimeout(_timer);
  _timer = setTimeout(() => el.classList.remove('show'), duration);
}
