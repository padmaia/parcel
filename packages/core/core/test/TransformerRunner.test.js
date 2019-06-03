// @flow
import TransformerRunner from '../src/TransformerRunner';
import Config from '../src/ParcelConfig';
import Environment from '../src/Environment';

const config = require('@parcel/config-default');

const EMPTY_OPTIONS = {
  cacheDir: '.parcel-cache',
  entries: [],
  logLevel: 'none',
  rootDir: __dirname,
  targets: [],
  projectRoot: ''
};

const runner = new TransformerRunner({
  config: new Config({
    ...config,
    filePath: require.resolve('@parcel/config-default')
  }),
  options: EMPTY_OPTIONS
});

const DEFAULT_ENV = new Environment({
  context: 'browser',
  engines: {
    browsers: ['> 1%']
  }
});
