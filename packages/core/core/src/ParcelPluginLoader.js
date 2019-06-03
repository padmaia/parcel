// @flow
import {isMatch} from 'micromatch';
import {basename} from 'path';
import semver from 'semver';

import {localResolve} from '@parcel/local-require';
import logger from '@parcel/logger';
import {CONFIG} from '@parcel/plugin';
import type {
  Bundler,
  EnvironmentContext,
  FilePath,
  Glob,
  Namer,
  Optimizer,
  PackageName,
  Packager,
  Reporter,
  Runtime,
  Transformer,
  Resolver
} from '@parcel/types';

import type {ResolvedParcelConfig} from './NewParcelConfig';

type Pipeline = Array<PackageName>;

const PARCEL_VERSION = require('../package.json').version;

export default class ParcelPluginLoader {
  parcelConfig: ResolvedParcelConfig;
  pluginCache: Map<PackageName, any>;

  constructor(parcelConfig: ResolvedParcelConfig) {
    this.parcelConfig = parcelConfig;
  }

  async loadPlugin(pluginName: PackageName) {
    let cached = this.pluginCache.get(pluginName);
    if (cached) {
      return cached;
    }

    let [resolved, pkg] = await localResolve(
      pluginName,
      this.parcelConfig.resolvedPath
    );

    // Validate the engines.parcel field in the plugin's package.json
    let parcelVersionRange = pkg && pkg.engines && pkg.engines.parcel;
    if (!parcelVersionRange) {
      logger.warn(
        `The plugin "${pluginName}" needs to specify a \`package.json#engines.parcel\` field with the supported Parcel version range.`
      );
    }

    if (
      parcelVersionRange &&
      !semver.satisfies(PARCEL_VERSION, parcelVersionRange)
    ) {
      throw new Error(
        `The plugin "${pluginName}" is not compatible with the current version of Parcel. Requires "${parcelVersionRange}" but the current version is "${PARCEL_VERSION}".`
      );
    }

    // $FlowFixMe
    let plugin = require(resolved);
    plugin = plugin.default ? plugin.default : plugin;
    plugin = plugin[CONFIG];
    this.pluginCache.set(pluginName, plugin);
    return plugin;
  }

  async loadPlugins(plugins: Pipeline) {
    return Promise.all(plugins.map(pluginName => this.loadPlugin(pluginName)));
  }

  async getResolvers(): Promise<Array<Resolver>> {
    if (this.parcelConfig.resolvers.length === 0) {
      throw new Error('No resolver plugins specified in .parcelrc config');
    }

    return this.loadPlugins(this.parcelConfig.resolvers);
  }

  async getTransformers(filePath: FilePath): Promise<Array<Transformer>> {
    let transformers: Pipeline | null = this.matchGlobMapPipelines(
      filePath,
      this.parcelConfig.transforms
    );
    if (!transformers || transformers.length === 0) {
      throw new Error(`No transformers found for "${filePath}".`);
    }

    return this.loadPlugins(transformers);
  }

  async getBundler(): Promise<Bundler> {
    if (!this.parcelConfig.bundler) {
      throw new Error('No bundler specified in .parcelrc config');
    }

    return this.loadPlugin(this.parcelConfig.bundler);
  }

  async getNamers(): Promise<Array<Namer>> {
    if (this.parcelConfig.namers.length === 0) {
      throw new Error('No namer plugins specified in .parcelrc config');
    }

    return this.loadPlugins(this.parcelConfig.namers);
  }

  async getRuntimes(context: EnvironmentContext): Promise<Array<Runtime>> {
    let runtimes = this.parcelConfig.runtimes[context];
    if (!runtimes) {
      return [];
    }

    return this.loadPlugins(runtimes);
  }

  async getPackager(filePath: FilePath): Promise<Packager> {
    let packagerName: ?PackageName = this.matchGlobMap(
      filePath,
      this.parcelConfig.packagers
    );
    if (!packagerName) {
      throw new Error(`No packager found for "${filePath}".`);
    }

    return this.loadPlugin(packagerName);
  }

  async getOptimizers(filePath: FilePath): Promise<Array<Optimizer>> {
    let optimizers: ?Pipeline = this.matchGlobMapPipelines(
      filePath,
      this.parcelConfig.optimizers
    );
    if (!optimizers) {
      return [];
    }

    return this.loadPlugins(optimizers);
  }

  async getReporters(): Promise<Array<Reporter>> {
    return this.loadPlugins(this.parcelConfig.reporters);
  }

  isGlobMatch(filePath: FilePath, pattern: Glob) {
    return isMatch(filePath, pattern) || isMatch(basename(filePath), pattern);
  }

  matchGlobMap(filePath: FilePath, globMap: {[Glob]: any}) {
    for (let pattern in globMap) {
      if (this.isGlobMatch(filePath, pattern)) {
        return globMap[pattern];
      }
    }

    return null;
  }

  matchGlobMapPipelines(filePath: FilePath, globMap: {[Glob]: Pipeline}) {
    let matches = [];
    for (let pattern in globMap) {
      if (this.isGlobMatch(filePath, pattern)) {
        matches.push(globMap[pattern]);
      }
    }

    let flatten = () => {
      let pipeline = matches.shift() || [];
      let spreadIndex = pipeline.indexOf('...');
      if (spreadIndex >= 0) {
        pipeline = [
          ...pipeline.slice(0, spreadIndex),
          ...flatten(),
          ...pipeline.slice(spreadIndex + 1)
        ];
      }

      if (pipeline.includes('...')) {
        throw new Error(
          'Only one spread parameter can be included in a config pipeline'
        );
      }

      return pipeline;
    };

    let res = flatten();
    return res;
  }
}
