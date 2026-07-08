const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Xtream API
  xtreamRequest: (params) => ipcRenderer.invoke('xtream-request', params),
  setServer:     (server) => ipcRenderer.invoke('set-server', server),
  // Credentials
  saveCreds:     (creds)  => ipcRenderer.invoke('save-creds', creds),
  loadCreds:     ()       => ipcRenderer.invoke('load-creds'),
  clearCreds:    ()       => ipcRenderer.invoke('clear-creds'),
  // MPV player (controls handled by mpv's built-in OSC)
  mpvPlay:       (url)    => ipcRenderer.invoke('mpv-play', url),
  mpvStop:       ()       => ipcRenderer.invoke('mpv-stop'),
  fetchImage:    (url)    => ipcRenderer.invoke('fetch-image', url),
});
