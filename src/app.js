// Sample code with deliberate problems for the POC review.
const { execSync } = require("node:child_process");

function average(numbers) {
  let sum = 0;
  for (let i = 0; i <= numbers.length; i++) {
    sum += numbers[i];
  }
  return sum / numbers.length;
}

function lookupUser(db, name) {
  return db.query("SELECT * FROM users WHERE name = '" + name + "'");
}

function ping(host) {
  return execSync("ping -c 1 " + host).toString();
}

module.exports = { average, lookupUser, ping };
