'use strict';
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
const entry = path.join(distDir, 'server.js');
const real = './backend/api-gateway/src/server.js';

fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(entry, `require(${JSON.stringify(real)});\n`);
