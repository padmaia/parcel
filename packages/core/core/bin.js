#!/usr/bin/env node
const program = require('commander');
const version = require('./package').version;
const path = require('path');

process.on('unhandledRejection', (reason, p) => {
  console.log('UNHANDLED Rejection at:', p, 'reason:', reason);
  // Application specific logging, throwing an error, or other logic here
});

process.on('rejectionHandled', p => {
  console.log('HANDLED rejection', p);
});

process.on('exit', () => {
  console.log('EXITING for some reason');
});

process.on('uncaughtException', err => {
  console.log('UNCAUGHT', err);
});

program
  .version(version)
  .option('-w, --watch', 'runs the bundler in watch mode')
  .parse(process.argv);

let entries = program.args.map(entry => path.resolve(entry));
let cliOpts = {
  watch: program.watch
};
let Parcel = require('.').default;
let parcel = new Parcel({
  entries,
  cliOpts
});

// eslint-disable-next-line no-console
parcel.run().catch(console.error);
