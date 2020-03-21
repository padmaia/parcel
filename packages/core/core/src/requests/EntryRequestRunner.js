// @flow strict-local
import type {FilePath} from '@parcel/types';
import type {EntryResult} from '../EntryResolver';
import type RequestTracker, {RequestRunnerAPI} from '../RequestTracker';
import type {ParcelOptions} from '../types';

import {isGlob} from '@parcel/utils';
import {RequestRunner} from '../RequestTracker';
import {EntryResolver} from '../EntryResolver';

export type EntryRequest = {|
  id: string,
  +type: 'entry_request',
  request: FilePath,
  result?: EntryResult,
|};

export default class EntryRequestRunner extends RequestRunner<
  FilePath,
  EntryResult,
> {
  entryResolver: EntryResolver;

  constructor(opts: {|tracker: RequestTracker, options: ParcelOptions|}) {
    super(opts);
    this.type = 'entry_request';
    this.entryResolver = new EntryResolver(opts.options);
  }

  async run(request: FilePath, api: RequestRunnerAPI) {
    let result = await this.entryResolver.resolveEntry(request);

    // Connect files like package.json that affect the entry
    // resolution so we invalidate when they change.
    for (let file of result.files) {
      api.invalidateOnFileUpdate(file.filePath);
    }

    // If the entry specifier is a glob, add a glob node so
    // we invalidate when a new file matches.
    if (isGlob(request)) {
      api.invalidateOnFileCreate(request);
    }

    return result;
  }
}
