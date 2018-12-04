// @flow
import fs from '@parcel/fs';
import pkg from '../package.json';
import Path from 'path';
import md5 from '@parcel/utils/md5';
import objectHash from '@parcel/utils/objectHash';
import logger from '@parcel/logger';
import type {
  FilePath,
  CLIOptions,
  JSONObject,
  CacheEntry,
  Asset,
  Environment
} from '@parcel/types';

// These keys can affect the output, so if they differ, the cache should not match
const OPTION_KEYS = ['publicURL', 'minify', 'hmr', 'target', 'scopeHoist'];

export default class Cache {
  dir: FilePath;
  dirExists: boolean;
  invalidated: Set<FilePath>;
  optionsHash: string;

  constructor(options: CLIOptions) {
    this.dir = Path.resolve(options.cacheDir || '.parcel-cache');
    this.dirExists = false;
    this.invalidated = new Set();
    this.optionsHash = objectHash(
      OPTION_KEYS.reduce((p: JSONObject, k) => ((p[k] = options[k]), p), {
        version: pkg.version
      })
    );
  }

  async ensureDirExists() {
    if (this.dirExists) {
      return;
    }

    await fs.mkdirp(this.dir);

    // Create sub-directories for every possible hex value
    // This speeds up large caches on many file systems since there are fewer files in a single directory.
    for (let i = 0; i < 256; i++) {
      await fs.mkdirp(Path.join(this.dir, ('00' + i.toString(16)).slice(-2)));
    }

    this.dirExists = true;
  }

  getCacheId(appendedData: string, env: Environment) {
    return md5(this.optionsHash + appendedData + JSON.stringify(env));
  }

  getCachePath(cacheId: string, extension: string = '.json'): FilePath {
    return Path.join(
      this.dir,
      cacheId.slice(0, 2),
      cacheId.slice(2) + extension
    );
  }

  async writeBlob(type: string, cacheId: string, data: any) {
    let blobPath = this.getCachePath(cacheId, '.' + type);
    if (typeof data === 'object') {
      if (Buffer.isBuffer(data)) {
        blobPath += '.bin';
      } else {
        data = JSON.stringify(data);
        if (type !== 'json') {
          blobPath += '.json';
        }
      }
    }

    await fs.writeFile(blobPath, data);
    return Path.relative(this.dir, blobPath);
  }

  async _writeBlobs(assets: Array<Asset>) {
    return await Promise.all(
      assets.map(async asset => {
        let assetCacheId = this.getCacheId(asset.hash, asset.env);
        for (let blobKey in asset.output) {
          asset.output[blobKey] = await this.writeBlob(
            blobKey,
            assetCacheId,
            asset.output[blobKey]
          );
        }
        return asset;
      })
    );
  }

  async writeBlobs(cacheEntry: CacheEntry) {
    cacheEntry.assets = await this._writeBlobs(cacheEntry.assets);
    if (cacheEntry.initialAssets) {
      cacheEntry.initialAssets = await this._writeBlobs(
        cacheEntry.initialAssets
      );
    }

    return cacheEntry;
  }

  async write(cacheEntry: CacheEntry) {
    try {
      await this.ensureDirExists();
      let cacheId = this.getCacheId(cacheEntry.filePath, cacheEntry.env);
      await this.writeBlobs(cacheEntry);
      await this.writeBlob('json', cacheId, cacheEntry);
      this.invalidated.delete(cacheEntry.filePath);
    } catch (err) {
      logger.error(`Error writing to cache: ${err.message}`);
    }
  }

  async readBlob(blobKey: FilePath) {
    console.log('BLOBKEY', blobKey);
    let extension = Path.extname(blobKey);
    let data = await fs.readFile(Path.resolve(this.dir, blobKey), {
      encoding: extension === '.bin' ? null : 'utf8'
    });

    if (extension === '.json') {
      data = JSON.parse(data);
    }

    return data;
  }

  async readBlobs(asset: Asset) {
    await Promise.all(
      Object.keys(asset.output).map(async blobKey => {
        asset.output[blobKey] = await this.readBlob(asset.output[blobKey]);
      })
    );
  }

  async read(filePath: FilePath, env: Environment): Promise<CacheEntry | null> {
    if (this.invalidated.has(filePath)) {
      return null;
    }

    let cacheId = this.getCacheId(filePath, env);
    try {
      return await this.readBlob(this.getCachePath(cacheId));
    } catch (err) {
      return null;
    }
  }

  invalidate(filePath: FilePath) {
    this.invalidated.add(filePath);
  }

  async delete(filePath: FilePath, env: Environment) {
    try {
      let cacheId = this.getCacheId(filePath, env);
      // TODO: delete blobs
      await fs.unlink(this.getCachePath(cacheId));
      this.invalidated.delete(filePath);
    } catch (err) {
      // Fail silently
    }
  }
}
