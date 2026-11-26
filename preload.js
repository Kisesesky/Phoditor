const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Stage 1
  getCatalog: () => ipcRenderer.invoke('get-catalog'),
  getPreviewFonts: () => ipcRenderer.invoke('get-preview-fonts'),
  // 작업 저장·열기·자동 저장
  projectSave: (payload) => ipcRenderer.invoke('project-save', payload),
  projectOpen: (filePath) => ipcRenderer.invoke('project-open', filePath),
  projectRecent: () => ipcRenderer.invoke('project-recent'),
  myTemplatesList: () => ipcRenderer.invoke('mytemplates-list'),
  myTemplatesSave: (payload) => ipcRenderer.invoke('mytemplates-save', payload),
  myTemplatesRead: (id) => ipcRenderer.invoke('mytemplates-read', id),
  myTemplatesDelete: (id) => ipcRenderer.invoke('mytemplates-delete', id),
  myTemplatesRename: (payload) => ipcRenderer.invoke('mytemplates-rename', payload),
  autosaveWrite: (data) => ipcRenderer.invoke('autosave-write', data),
  autosaveRead: () => ipcRenderer.invoke('autosave-read'),
  autosaveClear: () => ipcRenderer.invoke('autosave-clear'),
  setDirty: (d) => ipcRenderer.invoke('set-dirty', d),
  closeNow: () => ipcRenderer.invoke('close-now'),
  makeThumbs: (paths) => ipcRenderer.invoke('make-thumbs', paths),
  filesExist: (paths) => ipcRenderer.invoke('files-exist', paths),
  transformPhoto: (payload) => ipcRenderer.invoke('transform-photo', payload),
  exportPdf: (payload) => ipcRenderer.invoke('export-pdf', payload),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, cmd) => cb(cmd)),
  onThumbReady: (cb) => ipcRenderer.on('thumb-ready', (_e, info) => cb(info)),
  installFont: (family) => ipcRenderer.invoke('install-font', family),
  openTemplate: (templateId) => ipcRenderer.invoke('open-template', templateId),
  selectPhotoFolder: () => ipcRenderer.invoke('select-photo-folder'),
  refreshPhotoFolder: (folderPath) => ipcRenderer.invoke('refresh-photo-folder', folderPath),
  estimateExportSize: (payload) => ipcRenderer.invoke('estimate-export-size', payload),
  exportXlsx: (payload) => ipcRenderer.invoke('export-xlsx', payload),
  // Stage 2 A — Pre-placement Crop
  preparePhotoForCrop: (filePath) => ipcRenderer.invoke('prepare-photo-for-crop', filePath),
  cropPhoto: (payload) => ipcRenderer.invoke('crop-photo', payload),
  getSlotPreview: (filePath) => ipcRenderer.invoke('get-slot-preview', filePath),
  // Stage 2 B — MYBOX
  myboxGetStatus: () => ipcRenderer.invoke('mybox-get-status'),
  myboxSaveToken: (token, period) => ipcRenderer.invoke('mybox-save-token', token, period),
  myboxSavePeriod: (period) => ipcRenderer.invoke('mybox-save-period', period),
  myboxClearToken: () => ipcRenderer.invoke('mybox-clear-token'),
  myboxTestConnection: (candidateToken) => ipcRenderer.invoke('mybox-test-connection', candidateToken),
  myboxListFolder: (folderId) => ipcRenderer.invoke('mybox-list-folder', folderId),
  myboxDownloadPhoto: (fileInfo) => ipcRenderer.invoke('mybox-download-photo', fileInfo)
});
