// @flow
import type {
  AST,
  Environment,
  FilePath,
  CLIOptions,
  TransformationRequest
} from '@parcel/types';
import fs from '@parcel/fs';
import Path from 'path';
import PipelineTransformation from './PipelineTransformation';
import Config from './Config';

type Opts = {
  config: Config,
  cliOpts: CLIOptions
};

export default class TransformationRunner {
  cliOpts: CLIOptions;
  config: Config;

  constructor(opts: Opts) {
    this.cliOpts = opts.cliOpts;
    this.config = opts.config;
  }

  async runTransformation({filePath, env}: TransformationRequest) {
    let code = await fs.readFile(filePath, 'utf8');
    let type = Path.extname(filePath).slice(1);
    let initialAsset = {filePath, env, code, type};
    let transformation = new PipelineTransformation(initialAsset, {
      cliOpts: this.cliOpts,
      config: this.config
    });

    let transformationResult = await transformation.run();
    let {assets} = transformationResult;

    let connectedFiles = this.gatherTransformerConnectedFiles(
      transformationResult
    );
    return {connectedFiles, assets};
  }

  gatherTransformerConnectedFiles({usedPipelinesMeta}) {
    let connectedFiles = [];
    for (let pipelineMeta of Object.values(usedPipelinesMeta)) {
      for (let transformerMeta of pipelineMeta) {
        connectedFiles = connectedFiles.concat(transformerMeta.config.files);
      }
    }
    return connectedFiles;
  }
}
