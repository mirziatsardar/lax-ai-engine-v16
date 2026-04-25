import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, fork } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let serverProcess;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    backgroundColor: '#050505',
    title: "LAX AI Engine V16",
    autoHideMenuBar: true
  });

  // Start the server logic
  if (app.isPackaged) {
    process.env.NODE_ENV = 'production';
    // Use fork instead of spawn node to avoid ENOENT errors on systems without node in PATH
    const serverPath = path.join(__dirname, 'dist-server', 'server.js');
    
    serverProcess = fork(serverPath, [], {
      env: { ...process.env, NODE_ENV: 'production' },
      stdio: 'pipe'
    });

    serverProcess.stdout.on('data', (data) => {
      console.log(`Server: ${data}`);
      if (data.toString().includes('LAX AI ENGINE running')) {
        mainWindow.loadURL('http://localhost:3000');
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error(`Server Error: ${data}`);
    });

    // Fallback if log doesn't match
    setTimeout(() => {
      if (mainWindow && (mainWindow.webContents.getURL() === '' || mainWindow.webContents.getURL() === 'about:blank')) {
        mainWindow.loadURL('http://localhost:3000').catch(() => {
          console.log("Retrying server connection...");
        });
      }
    }, 3000);
    
  } else {
    // In development, we assume npm run dev is running
    mainWindow.loadURL('http://localhost:3000');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (serverProcess) serverProcess.kill();
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
