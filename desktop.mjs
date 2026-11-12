import { app, BrowserWindow, dialog, Menu, nativeTheme, protocol, safeStorage, screen, session, shell } from 'electron';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createService, loadLocalModel } from './lib/service.mjs';
import { createAccounts } from './lib/accounts.mjs';
import { createModelSettings } from './lib/model-settings.mjs';
import { createDirectModels } from './lib/direct-models.mjs';
import { createCommerceClient } from './lib/commerce-client.mjs';
import { secureAccountStore } from './lib/secure-store.mjs';
import { normalizeGuide } from './public/methods.js';

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
    show: false, backgroundColor: '#141318', icon: join(root, 'public', 'assets', 'syz.png'),
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
    nativeTheme.themeSource = 'dark';
    const root = app.getAppPath();
    const envPath = app.isPackaged ? join(app.getPath('userData'), 'model.env') : join(root, '.env');
    const serverModel = loadLocalModel(envPath);
    const userData = app.getPath('userData');
    const protector = {
      protect: async key => {
        const insecureLinuxBackend = process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text';
        if (insecureLinuxBackend || !await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Encryption unavailable');
        return (await safeStorage.encryptStringAsync(key)).toString('base64');
      },
      unprotect: async data => (await safeStorage.decryptStringAsync(Buffer.from(data, 'base64'))).result,
    };
    const modelSettings = createModelSettings({ directory: join(userData, 'api-profiles'), ...protector });
    const open = url => shell.openExternal(url);
    const checkoutOrigin = process.env.ZHIMU_COMMERCE_ORIGIN;
    const previewPath = app.commandLine.getSwitchValue('guide-preview');
    let authorGuide = null;
    if (!checkoutOrigin && previewPath) {
      try { authorGuide = normalizeGuide(JSON.parse(await readFile(previewPath, 'utf8'))); }
      catch { console.warn('作者预览引导无法读取'); }
    }
    const paymentStore = checkoutOrigin ? createHash('sha256').update(new URL(checkoutOrigin).origin).digest('hex').slice(0, 20) : 'local';
    const commerce = createCommerceClient({ origin: checkoutOrigin, authorGuide, open,
      vault: secureAccountStore(join(userData, 'commerce', paymentStore), protector) });
    const googleConfig = process.env.ZHIMU_GOOGLE_CLIENT_ID ? { project: process.env.ZHIMU_GOOGLE_PROJECT,
      client: { client_id: process.env.ZHIMU_GOOGLE_CLIENT_ID, client_secret: process.env.ZHIMU_GOOGLE_CLIENT_SECRET } } : null;
    const directModels = createDirectModels({ vault: secureAccountStore(join(userData, 'account-connections'), protector), open,
      allowChatgpt: !commerce.configured, googleConfig });
    const service = createService(root, serverModel, createAccounts(userData), modelSettings, { directModels, commerce });
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
