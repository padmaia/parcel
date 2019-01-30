// @flow
'use strict';
import AssetGraph from './AssetGraph';
import type {Bundle, BundleGraph, CLIOptions} from '@parcel/types';
import BundlerRunner from './BundlerRunner';
import Config from './Config';
import WorkerFarm from '@parcel/workers';
import TargetResolver from './TargetResolver';
import getRootDir from '@parcel/utils/getRootDir';
import loadEnv from './loadEnv';
import path from 'path';
import Cache from '@parcel/cache';
import AssetGraphBuilder from './AssetGraphBuilder';

// TODO: use custom config if present
const defaultConfig = require('@parcel/config-default');

const abortError = new Error('Build aborted');

type ParcelOpts = {
  entries: string | Array<string>,
  cwd?: string,
  cliOpts: CLIOptions,
  killWorkers?: boolean,
  env?: {[string]: ?string}
};

export default class Parcel {
  options: ParcelOpts;
  entries: Array<string>;
  rootDir: string;
  assetGraphBuilder: AssetGraphBuilder;
  bundlerRunner: BundlerRunner;
  farm: WorkerFarm;
  runPackage: (bundle: Bundle) => Promise<any>;

  constructor(options: ParcelOpts) {
    let {entries} = options;
    this.options = options;
    this.entries = Array.isArray(entries) ? entries : [entries];
    this.rootDir = getRootDir(this.entries);
  }

  async init() {
    await Cache.createCacheDir(this.options.cliOpts.cacheDir);

    if (!this.options.env) {
      await loadEnv(path.join(this.rootDir, 'index'));
      this.options.env = process.env;
    }

    this.farm = await WorkerFarm.getShared(
      {
        parcelConfig: defaultConfig,
        cliOpts: this.options.cliOpts,
        env: this.options.env
      },
      {
        workerPath: require.resolve('./worker')
      }
    );

    this.runPackage = this.farm.mkhandle('runPackage');
  }

  async run() {
    await this.init();

    // TODO: resolve config from filesystem
    let config = new Config(
      defaultConfig,
      require.resolve('@parcel/config-default')
    );

    this.bundlerRunner = new BundlerRunner({
      config,
      cliOpts: this.options.cliOpts,
      rootDir: this.rootDir
    });

    let targetResolver = new TargetResolver();
    let targets = await targetResolver.resolve(this.rootDir);

    this.assetGraphBuilder = new AssetGraphBuilder({
      cliOpts: this.options.cliOpts,
      config,
      entries: this.entries,
      targets,
      rootDir: this.rootDir
    });

    this.assetGraphBuilder.on('invalidate', () => {
      this.build();
    });

    return await this.build();
  }

  async build() {
    try {
      console.log('Starting build'); // eslint-disable-line no-console
      console.log('Building Graph');
      let assetGraph = await this.assetGraphBuilder.build();
      // await graph.dumpGraphViz();
      console.log('Bundling');
      let bundleGraph = await this.bundle(assetGraph);
      console.log('Packaging');
      await this.package(bundleGraph);

      if (!this.options.cliOpts.watch && this.options.killWorkers !== false) {
        await this.farm.end();
      }

      console.log('Finished build'); // eslint-disable-line no-console
      return bundleGraph;
    } catch (e) {
      console.log('BUILD ERROR');
      if (e !== abortError) {
        console.error(e); // eslint-disable-line no-console
      }
    }
  }

  bundle(assetGraph: AssetGraph) {
    return this.bundlerRunner.bundle(assetGraph);
  }

  package(bundleGraph: BundleGraph) {
    let promises = [];
    bundleGraph.traverseBundles(bundle => {
      promises.push(this.runPackage(bundle));
    });

    return Promise.all(promises);
  }
}

export {default as Asset} from './Asset';
export {default as Dependency} from './Dependency';
export {default as Environment} from './Environment';
