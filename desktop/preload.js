// Gives the game page one safe function: start hosting the live office on this computer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('officeHost', {
  start: () => ipcRenderer.invoke('host-start'),
  config: ipcRenderer.sendSync('get-config'), // office names from config.yaml next to the .exe
});
