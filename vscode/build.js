'use strict';

/* Prepares vscode/media by copying the shared renderer and engine from the repo,
   plus the shim and icons. Run before packaging: node build.js */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const media = path.join(__dirname, 'media');

fs.rmSync(media, { recursive: true, force: true });
fs.mkdirSync(media, { recursive: true });
fs.cpSync(path.join(root, 'src', 'renderer'), path.join(media, 'renderer'), { recursive: true });
fs.cpSync(path.join(root, 'src', 'core'), path.join(media, 'core'), { recursive: true });
fs.copyFileSync(path.join(__dirname, 'shim.js'), path.join(media, 'shim.js'));
fs.copyFileSync(path.join(root, 'build', 'icon.png'), path.join(__dirname, 'icon.png'));
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(__dirname, 'LICENSE'));

console.log('vscode/media prepared');
