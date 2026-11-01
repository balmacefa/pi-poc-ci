"use strict";
// App de ejemplo con DOS problemas de seguridad:
//  1) CODIGO: command injection en listFiles() (requiere editar fuente, no basta bumpear).
//  2) DEPENDENCIA: lodash 4.17.11 con prototype pollution (se cierra con un bump).

const { exec } = require("child_process");
const _ = require("lodash");

// VULN-CODE-01 (command injection):
// userDir viene del usuario y se concatena directo en un comando de shell.
// Un valor como "; rm -rf /" ejecutaria comandos arbitrarios.
function listFiles(userDir, cb) {
  exec("ls -la " + userDir, (err, stdout) => cb(err, stdout));
}

// Usa lodash merge para combinar config del usuario (relacionado a la vuln de dep).
function buildConfig(defaults, userConfig) {
  return _.merge({}, defaults, userConfig);
}

module.exports = { listFiles, buildConfig };
