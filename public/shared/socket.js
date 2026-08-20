export const PROTOCOL_VERSION = 1;
export const socket = io({ autoConnect: true });

export function emitAck(event, payload = {}) {
  return new Promise((resolve) => {
    socket.emit(event, { protocolVersion: PROTOCOL_VERSION, ...payload }, (result) => resolve(result));
  });
}

export function roomFromQuery() {
  return new URLSearchParams(location.search).get('room')?.trim().toUpperCase() || '';
}

export function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value ?? '';
}
