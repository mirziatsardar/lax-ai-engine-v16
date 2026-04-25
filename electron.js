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
      const output = data.toString();
      console.log(`Server: ${output}`);
      if (output.includes('LAX AI ENGINE running') || output.includes('READY_TO_CONNECT')) {
        console.log("Server ready signal received. Loading URL...");
        mainWindow.loadURL('http://localhost:3000').catch(err => {
          console.error("Failed to load URL initially:", err);
        });
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error(`Server Error: ${data}`);
    });

    serverProcess.on('exit', (code) => {
      console.log(`Server process exited with code ${code}`);
      if (mainWindow) {
        mainWindow.webContents.executeJavaScript(`document.body.innerHTML = '<div style="background:#050505;color:red;padding:50px;font-family:monospace;"><h1>BACKEND CRASH</h1><p>The DMX engine server exited with code ${code}. Check logs.</p></div>'`);
      }
    });

    // Fallback if log doesn't match
    setTimeout(() => {
      if (mainWindow && (mainWindow.webContents.getURL() === '' || mainWindow.webContents.getURL() === 'about:blank')) {
        console.log("Timeout waiting for server signal. Attempting fallback load...");
        mainWindow.loadURL('http://localhost:3000').catch((err) => {
          console.error("Fallback load failed:", err);
          mainWindow.webContents.executeJavaScript(`document.body.innerHTML = '<div style="background:#050505;color:red;padding:50px;font-family:monospace;"><h1>CONNECTION FAILURE</h1><p>Could not connect to DMX engine at localhost:3000.</p><p>Error: ${err.message}</p></div>'`);
        });
      }
    }, 5000);
    
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

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
