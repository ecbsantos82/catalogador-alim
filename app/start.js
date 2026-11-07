const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const localNodeModules = path.join(__dirname, 'node_modules');
const cacheNodeModules = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'alim-catalogador-deps', 'node_modules')
  : '';

let electronExe = path.join(localNodeModules, 'electron', 'dist', 'electron.exe');
if (!fs.existsSync(electronExe) && cacheNodeModules) {
  electronExe = path.join(cacheNodeModules, 'electron', 'dist', 'electron.exe');
}

if (!fs.existsSync(electronExe)) {
  console.error('Electron não encontrado. Execute npm run setup-deps primeiro.');
  process.exit(1);
}

const env = { ...process.env };
if (cacheNodeModules && fs.existsSync(cacheNodeModules)) {
  env.NODE_PATH = env.NODE_PATH
    ? `${env.NODE_PATH}${path.delimiter}${cacheNodeModules}`
    : cacheNodeModules;
}

const child = spawn(electronExe, [__dirname], {
  stdio: 'inherit',
  env
});

child.on('close', (code) => {
  process.exit(code || 0);
});
