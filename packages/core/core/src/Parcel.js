// @flow
'use strict';
import {AbortController} from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import Watcher from '@parcel/watcher';
import PromiseQueue from './PromiseQueue';
import AssetGraph from './AssetGraph';
import {Node} from './Graph';
import type {
  Bundle,
  CLIOptions,
  Dependency,
  File,
  Target,
  TransformationRequest
} from '@parcel/types';
import ResolverRunner from './ResolverRunner';
import BundlerRunner from './BundlerRunner';
import Config from './Config';
import WorkerFarm from '@parcel/workers';
import TargetResolver from './TargetResolver';

// TODO: use custom config if present
const defaultConfig = require('@parcel/config-default');

const abortError = new Error('Build aborted');

type ParcelOpts = {
  entries: Array<string>,
  cwd?: string,
  cliOpts: CLIOptions
};

type Signal = {
  aborted: boolean,
  addEventListener?: Function
};

type BuildOpts = {
  signal: Signal,
  shallow?: boolean
};

export default class Parcel {
  entries: Array<string>;
  rootDir: string;
  graph: AssetGraph;
  watcher: Watcher;
  queue: PromiseQueue;
  resolverRunner: ResolverRunner;
  bundlerRunner: BundlerRunner;
  farm: WorkerFarm;
  targetResolver: TargetResolver;
  targets: Array<Target>;
  runTransformation: (req: TransformationRequest) => Promise<any>;
  runPackage: (bundle: Bundle) => Promise<any>;

  constructor({entries, cliOpts = {}}: ParcelOpts) {
    this.entries = entries;
    this.rootDir = process.cwd();

    this.graph = new AssetGraph();
    this.watcher = cliOpts.watch ? new Watcher() : null;
    this.queue = new PromiseQueue();

    let config = new Config(
      defaultConfig,
      require.resolve('@parcel/config-default')
    );
    this.resolverRunner = new ResolverRunner({
      config,
      cliOpts,
      rootDir: this.rootDir
    });
    this.bundlerRunner = new BundlerRunner({
      config,
      cliOpts
    });
    this.farm = new WorkerFarm(
      {
        parcelConfig: defaultConfig,
        cliOpts
      },
      {
        workerPath: require.resolve('./worker')
      }
    );

    this.targetResolver = new TargetResolver();
    this.targets = [];

    this.runTransformation = this.farm.mkhandle('runTransformation');
    this.runPackage = this.farm.mkhandle('runPackage');
  }

  async run() {
    let controller = new AbortController();
    let signal = controller.signal;

    this.targets = await this.targetResolver.resolve(this.rootDir);
    this.graph.initializeGraph({
      entries: this.entries,
      targets: this.targets,
      rootDir: this.rootDir
    });

    let buildPromise = this.build({signal});

    if (this.watcher) {
      this.watcher.on('change', filePath => {
        if (this.graph.hasNode(filePath)) {
          controller.abort();
          this.graph.invalidateFile(filePath);

          controller = new AbortController();
          signal = controller.signal;

          this.build({signal});
        }
      });
    }

    await buildPromise;
  }

  async build({signal}: BuildOpts) {
    try {
      console.log('Starting build'); // eslint-disable-line no-console
      await this.updateGraph({signal});
      await this.completeGraph({signal});
      await this.graph.dumpGraphViz();
      let bundles = await this.bundle();
      await this.package(bundles);

      if (!this.watcher) {
        await this.farm.end();
      }

      console.log('Finished build'); // eslint-disable-line no-console
    } catch (e) {
      if (e !== abortError) {
        console.error(e); // eslint-disable-line no-console
      }
    }
  }

  async updateGraph({signal}: BuildOpts) {
    for (let [, node] of this.graph.invalidNodes) {
      this.queue.add(() => this.processNode(node, {signal, shallow: true}));
    }
    await this.queue.run();
  }

  async completeGraph({signal}: BuildOpts) {
    for (let [, node] of this.graph.incompleteNodes) {
      this.queue.add(() => this.processNode(node, {signal}));
    }

    await this.queue.run();
  }

  processNode(node: Node, {signal}: BuildOpts) {
    switch (node.type) {
      case 'dependency':
        return this.resolve(node.value, {signal});
      case 'transformer_request':
        return this.transform(node.value, {signal});
      default:
        throw new Error(
          `Cannot process graph node with type ${node.type || 'undefined'}`
        );
    }
  }

  async resolve(dep: Dependency, {signal}: BuildOpts) {
    let resolvedPath = await this.resolverRunner.resolve(dep);

    if (signal.aborted) throw abortError;

    let req = {filePath: resolvedPath, env: dep.env};
    dep.resolvedPath = resolvedPath;
    let {newRequest} = this.graph.resolveDependency(dep, req);

    if (newRequest) {
      this.queue.add(() => this.transform(newRequest, {signal}));
      if (this.watcher) this.watcher.watch(newRequest.filePath);
    }
  }

  async transform(req: TransformationRequest, {signal, shallow}: BuildOpts) {
    let cacheEntry = await this.runTransformation(req);

    if (signal.aborted) throw abortError;
    let {
      addedFiles,
      removedFiles,
      newDeps
    } = this.graph.resolveTransformationRequest(req, cacheEntry);

    if (this.watcher) {
      for (let file of addedFiles) {
        this.watcher.watch(file.filePath);
      }

      for (let file of removedFiles) {
        this.watcher.unwatch(file.filePath);
      }
    }

    // The shallow option is used during the update phase
    if (!shallow) {
      for (let dep of newDeps) {
        this.queue.add(() => this.resolve(dep, {signal}));
      }
    }
  }

  bundle() {
    return this.bundlerRunner.bundle(this.graph);
  }

  // TODO: implement bundle types
  package(bundles: any[]) {
    return Promise.all(bundles.map(bundle => this.runPackage(bundle)));
  }
}
