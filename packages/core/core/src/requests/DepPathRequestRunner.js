// @flow strict-local
import type ParcelConfig from '../ParcelConfig';
import type RequestTracker, {RequestRunnerAPI} from '../RequestTracker';
import type {AssetRequestDesc, Dependency, ParcelOptions} from '../types';

import {RequestRunner} from '../RequestTracker';
import ResolverRunner from '../ResolverRunner';

type DependencyResult = AssetRequestDesc | null | void;

export type DepPathRequest = {|
  id: string,
  +type: 'dep_path_request',
  request: Dependency,
  result?: DependencyResult,
|};

export default class DepPathRequestRunner extends RequestRunner<
  Dependency,
  DependencyResult,
> {
  resolverRunner: ResolverRunner;

  constructor(opts: {|
    tracker: RequestTracker,
    options: ParcelOptions,
    config: ParcelConfig,
  |}) {
    super(opts);
    this.type = 'dep_path_request';
    let {options, config} = opts;
    this.resolverRunner = new ResolverRunner({
      options,
      config,
    });
  }

  async run(request: Dependency, api: RequestRunnerAPI) {
    let assetGroup = await this.resolverRunner.resolve(request);

    // ? Should this happen if asset is deferred?
    if (assetGroup != null) {
      api.invalidateOnFileDelete(assetGroup.filePath);
    }

    return assetGroup;
  }
}
