// @flow

import type {
  Bundle,
  CLIOptions,
  TransformationRequest,
  ParcelConfig
} from '@parcel/types';
import TransformationRunner from './TransformationRunner';
import PackagerRunner from './PackagerRunner';
import Config from './Config';

type Options = {
  parcelConfig: ParcelConfig,
  cliOpts: CLIOptions
};

let transformationRunner: TransformationRunner | null = null;
let packagerRunner: PackagerRunner | null = null;

export function init({parcelConfig, cliOpts}: Options) {
  let config = new Config(
    parcelConfig,
    require.resolve('@parcel/config-default')
  );
  transformationRunner = new TransformationRunner({
    config,
    cliOpts
  });
  packagerRunner = new PackagerRunner({
    config,
    cliOpts
  });
}

export function runTransformation(req: TransformationRequest) {
  return transformationRunner.runTransformation(req);
}

export function runPackage(bundle: Bundle) {
  if (!packagerRunner) {
    throw new Error('.runPackage() called before .init()');
  }

  return packagerRunner.writeBundle(bundle);
}
