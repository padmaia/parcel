const {promisify} = require('@parcel/utils');
const rimraf = promisify(require('rimraf'));
const ncp = promisify(require('ncp'));

const chalk = new (require('chalk')).constructor({enabled: true});
const warning = chalk.keyword('orange');
// eslint-disable-next-line no-console
console.warn = (...args) => {
  // eslint-disable-next-line no-console
  console.error(warning(...args));
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

exports.sleep = sleep;
exports.rimraf = rimraf;
exports.ncp = ncp;
