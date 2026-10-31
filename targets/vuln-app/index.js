// Fixture app: merges user-supplied options into defaults and parses CLI arguments.
const _ = require("lodash");
const minimist = require("minimist");

const defaults = { verbose: false, retries: 3 };

function loadOptions(userJson) {
  return _.merge({}, defaults, JSON.parse(userJson));
}

function parseArgs(argv) {
  return minimist(argv.slice(2));
}

module.exports = { loadOptions, parseArgs };
