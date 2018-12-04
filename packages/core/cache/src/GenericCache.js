// @flow
import fs from '@parcel/fs';
import pkg from '../package.json';
import Path from 'path';
import md5 from '@parcel/utils/md5';
import objectHash from '@parcel/utils/objectHash';
import logger from '@parcel/logger';
import type {FilePath, CLIOptions, JSONObject} from '@parcel/types';

export default class Cache {
  dir: FilePath;
  dirExists: boolean;
  optionsHash: string;

  constructor(options: CLIOptions) {
    this.dir = Path.resolve(options.cacheDir || '.parcel-cache');
    this.dirExists = false;
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

  resolveCachePath(id: string) {
    let cacheKey = md5(id);
    return Path.join(this.dir, cacheKey.slice(0, 2), cacheKey.slice(2));
  }

  async read(id: string) {
    try {
      let cachePath = await this.resolveCachePath(id);
      let extension = Path.extname(cachePath);
      let data = await fs.readFile(cachePath, {
        encoding: extension === '.bin' ? null : 'utf8'
      });

      if (extension === '.json') {
        data = JSON.parse(data);
      }

      return data;
    } catch (e) {
      return null;
    }
  }

  async readFile(filePath: FilePath) {
    try {
      let extension = Path.extname(filePath);
      let data = await fs.readFile(Path.join(this.dir), {
        encoding: extension === '.bin' ? null : 'utf8'
      });

      if (extension === '.json') {
        data = JSON.parse(data);
      }

      return data;
    } catch (e) {
      return null;
    }
  }

  async write(id: string, data: JSONObject | Blob) {
    try {
      await this.ensureDirExists();

      let cachePath = this.resolveCachePath(id);
      if (typeof data === 'object') {
        if (Buffer.isBuffer(data)) {
          cachePath += '.bin';
        } else {
          data = JSON.stringify(data);
          cachePath += '.json';
        }
      }

      await fs.writeFile(cachePath, data);
      return Path.relative(this.dir, cachePath);
    } catch (err) {
      logger.error(`Error writing to cache: ${err.message}`);
    }
  }
}
