// @flow
import type {
  EnvironmentContext,
  FilePath,
  Glob,
  PackageName,
  ParcelConfigFile
} from '@parcel/types';

export type ResolvedParcelConfig = {|
  resolvedPath: FilePath,
  extendedPaths: Array<FilePath>
|} & ParcelConfig;

export default class ParcelConfig {
  resolvers: Array<PackageName>;
  transforms: {
    [Glob]: Array<PackageName>
  };
  bundler: PackageName;
  namers: Array<PackageName>;
  runtimes: {
    [EnvironmentContext]: Array<PackageName>
  };
  packagers: {
    [Glob]: PackageName
  };
  optimizers: {
    [Glob]: Array<PackageName>
  };
  reporters: Array<PackageName>;

  constructor(config: ParcelConfigFile) {
    this.resolvers = config.resolvers || [];
    this.transforms = config.transforms || {};
    this.runtimes = config.runtimes || {};
    this.bundler = config.bundler || '';
    this.namers = config.namers || [];
    this.packagers = config.packagers || {};
    this.optimizers = config.optimizers || {};
    this.reporters = config.reporters || [];
  }
}
