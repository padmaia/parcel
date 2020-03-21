// @flow strict-local
import type RequestTracker, {RequestRunnerAPI} from '../RequestTracker';
import type {TargetResolveResult} from '../TargetResolver';
import type {Entry, ParcelOptions} from '../types';

import {RequestRunner} from '../RequestTracker';
import TargetResolver from '../TargetResolver';

export type TargetRequest = {|
  id: string,
  +type: 'target_request',
  request: Entry,
  result?: TargetResolveResult,
|};

export default class TargetRequestRunner extends RequestRunner<
  Entry,
  TargetResolveResult,
> {
  targetResolver: TargetResolver;

  constructor(opts: {|tracker: RequestTracker, options: ParcelOptions|}) {
    super(opts);
    this.type = 'target_request';
    this.targetResolver = new TargetResolver(opts.options);
  }

  async run(request: Entry, api: RequestRunnerAPI) {
    let result = await this.targetResolver.resolve(request.packagePath);

    // Connect files like package.json that affect the target
    // resolution so we invalidate when they change.
    for (let file of result.files) {
      api.invalidateOnFileUpdate(file.filePath);
    }

    return result;
  }
}
