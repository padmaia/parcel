const path = require('path');
const {sleep, rimraf} = require('@parcel/test-utils');

async function removeDistDirectory(count = 0) {
  try {
    await rimraf(path.join(__dirname, 'dist'));
  } catch (e) {
    if (count > 8) {
      // eslint-disable-next-line no-console
      console.warn('WARNING: Unable to remove dist directory:', e.message);
      return;
    }

    await sleep(250);
    await removeDistDirectory(count + 1);
  }
}

beforeEach(async function() {
  await removeDistDirectory();
});
