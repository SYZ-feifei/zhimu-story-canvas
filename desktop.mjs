import { app, BrowserWindow, dialog, Menu, protocol, screen, session } from 'electron';
import { basename, join } from 'node:path';
import { createService, loadLocalModel } from './lib/service.mjs';
import { createAccounts } from './lib/accounts.mjs';

const scheme = 'zhimu';
const origin = `${scheme}://app`;
const appName = '枝幕';
app.setName(appName);
app.setPath('userData', app.commandLine.getSwitchValue('user-data-dir') || join(app.getPath('appData'), 'ZhimuStoryCanvas'));
app.setAppUserModelId('app.zhimu.storycanvas');
protocol.registerSchemesAsPrivileged([{ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

let window;

function openWindow(root) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  window = new BrowserWindow({
    title: `${appName} · 剧本创作画布`, width: Math.min(1440, width), height: Math.min(930, height),
    minWidth: Math.min(1000, width), minHeight: Math.min(620, height),
    show: false, backgroundColor: '#f8f8fd', icon: join(root, 'public', 'assets', 'syz.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: !app.isPackaged },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(`${origin}/`)) event.preventDefault(); });
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => { window = null; });
  return window.loadURL(`${origin}/`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.whenReady().then(async () => {
    const root = app.getAppPath();
    const envPath = app.isPackaged ? join(app.getPath('userData'), 'model.env') : join(root, '.env');
    const service = createService(root, loadLocalModel(envPath), createAccounts(app.getPath('userData')));
    protocol.handle(scheme, (request) => new URL(request.url).host === 'app' ? service(request) : new Response(null, { status: 404 }));
    Menu.setApplicationMenu(null);
    session.defaultSession.on('will-download', (_event, item) => {
      item.setSaveDialogOptions({ title: '导出枝幕文件', defaultPath: join(app.getPath('documents'), basename(item.getFilename())) });
    });
    app.on('activate', () => { if (!window) void openWindow(root); });
    await openWindow(root);
  }).catch(() => {
    dialog.showErrorBox('枝幕启动失败', '请重新打开枝幕，或检查本机模型配置文件。');
    app.quit();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
