// @flow
import type {
  AST,
  Dependency,
  Environment,
  FilePath,
  Transformer,
  PipelineAsset,
  TransformerMeta,
  CLIOptions,
  JSONObject
} from '@parcel/types';
import Cache from '@parcel/cache';
import fs from '@parcel/fs';
import Config from './Config';
import {moveBlobsToCache, addBlobsFromCache} from './AssetUtils';

export default class PipelineTransformation {
  initialAsset: PipelineAsset;
  config: Config;
  cliOpts: CLIOptions;
  cache: Cache;
  cacheId: string;
  loadedPipelines: {[FilePath]: TransformerPipeline};
  usedPipelines: {[FilePath]: TransformerPipeline};
  cacheEntry: CacheEntry;

  constructor(initialAsset: PipelineAsset, {cliOpts, config, loadedPipelines}) {
    let {filePath, env} = initialAsset;
    this.initialAsset = initialAsset;
    this.config = config;
    this.cliOpts = cliOpts;
    this.cache = new Cache({cliOpts});
    this.cacheId = JSON.stringify({type: 'transformation', filePath, env});
    this.loadedPipelines = loadedPipelines || {};
    this.usedPipelines = {};
  }

  async run(): Promise<CacheEntry> {
    if (await this.cacheEntryIsValid()) {
      return this.cacheEntry;
    }

    let {initialAsset} = this;
    let {filePath} = initialAsset;
    let initialPipeline = await this.loadPipeline(filePath);
    this.usedPipelines[filePath] = initialPipeline;
    let assets = await this.transform(initialAsset, initialPipeline.first);

    return await this.cacheResult(assets);
  }

  async cacheEntryIsValid() {
    this.cacheEntry = await this.cache.read(this.cacheId);

    if (!this.cacheEntry || this.cacheEntry.hash !== this.initialAsset.hash) {
      return false;
    }

    let pipelineInputPaths = Object.keys(this.cacheEntry.usedPipelineMeta);
    for (let inputPath of pipelineInputPaths) {
      let {meta: currentPipelineMeta} = await this.loadPipeline(inputPath);
      let lastPipelineMeta = this.cacheEntry.usedPipelinesMeta[inputPath];
      if (!pipelineMetaMatches(currentPipelineMeta, lastPipelineMeta)) {
        return false;
      }
    }

    return true;
  }

  async loadPipeline(inputPath: FilePath): Promise<TransformerPipeline> {
    if (this.loadedPipelines[inputPath]) {
      return this.loadedPipelines[inputPath];
    }

    let transformers = await this.config.getTransformers(inputPath);
    let linkedTransformers = await Promise.all(
      transformers.map(
        async (transformer, index) =>
          new LinkedTransformer(
            transformer,
            transformer.getConfig && (await transformer.getConfig(inputPath)),
            this.cliOpts,
            index
          )
      )
    );
    let pipeline = new TransformerPipeline(linkedTransformers);
    this.loadedPipelines[inputPath] = pipeline;

    return pipeline;
  }

  async cacheResult(assets: Array<PipelineAsset>) {
    assets.forEach(moveBlobsToCache);
    let usedPipelinesMeta: {[FilePath]: Array<TransformerMeta>} = {};
    for (let [inputPath, pipeline] of Object.entries(this.usedPipelines)) {
      usedPipelinesMeta[inputPath] = pipeline.meta;
    }
    let {hash} = this.initialAsset;
    let cacheEntry = {usedPipelinesMeta, assets, hash};
    this.cache.write(this.cacheId, cacheEntry);
    console.log('CACHE ENTRY', cacheEntry);
    return cacheEntry;
  }

  async transform(
    input: PipelineAsset,
    {prev, next, transformer}: TransformerPipelineNode
  ) {
    if (input.ast && !transformer.canReuseAST(input)) {
      input = await prev.transformer.generate(input);
      delete input.ast;
    }

    if (!input.ast) {
      input.ast = await transformer.parse(input);
    }

    let transformerOutputs = await transformer.transform(input);
    let pipelineOutputs = [];
    for (let output of transformerOutputs) {
      let nextOutputs;
      if (output.type === input.type) {
        if (next) {
          nextOutputs = await this.transform(output, next);
        } else {
          nextOutputs = transformer.generate(output);
          delete input.ast;
        }
      } else {
        nextOutputs = await this.transformWithNewPipeline(output);
      }
      pipelineOutputs = pipelineOutputs.concat(nextOutputs);
    }

    if (transformer.postProcess) {
      pipelineOutputs = transformer.postProcess(pipelineOutputs);
    }

    return pipelineOutputs;
  }

  async transformWithNewPipeline(asset: PipelineAsset) {
    let nextTransformation = new PipelineTransformation(asset, this);
    let nextResults = await nextTransformation.run();
    let nextOutputs = await Promise.all(
      nextResults.assets.forEach(addBlobsFromCache)
    );

    // merge used pipelines of child pipeline transformation
    for (let [inputPath, usedPipeline] of Object.entries(
      nextTransformation.usedPipelines
    )) {
      this.usedPipelines[inputPath] = usedPipeline;
    }

    return nextOutputs;
  }
}

type TransformerPipelineNode = {
  next?: TransformerPipelineNode,
  prev?: TransformerPipelineNode,
  transformer: LinkedTransformer
};

class TransformerPipeline {
  first: TransformerPipelineNode;
  last: TransformerPipelineNode;
  meta: Array<TransformerMeta>;

  constructor(transformers: Array<LinkedTransformer>) {
    this.meta = [];
    for (let transformer of transformers) {
      this.meta.push(transformer.meta);
      this.add({transformer});
    }
  }

  add(node: TransformerPipelineNode) {
    if (this.first && this.last) {
      this.last.next = node;
      node.prev = this.last;
      this.last = node;
    } else {
      this.first = node;
      this.last = node;
    }
  }
}

class LinkedTransformer {
  meta: TransformerMeta;
  transformer: Transformer;
  config: JSONObject;
  cliOpts: CLIOptions;

  constructor(transformer, config, cliOpts = {}, index) {
    this.index = index;
    this.meta = {
      name: transformer.name,
      version: transformer.version,
      config: config
        ? {
            files: config.files,
            hash: config.hash
          }
        : {files: []}
    };

    this.canReuseAST = transformer.canReuseAST
      ? input => transformer.canReuseAST(input, config, cliOpts)
      : () => false;
    this.parse = transformer.parse
      ? input => transformer.parse(input, config, cliOpts)
      : input => null;
    this.transform = transformer.transform
      ? input => transformer.transform(input, config, cliOpts)
      : input => input;
    this.generate = transformer.generate
      ? input => transformer.generate(input, config, cliOpts)
      : input => input;
    this.postProcess = transformer.postProcess
      ? input => transformer.postProcess(input, config, cliOpts)
      : input => input;
  }
}

type CacheEntry = {
  hash: string,
  usedPipelinesMeta: {[FilePath]: Array<TransformerMeta>},
  assets: Array<PipelineAsset>
};

// confirm that the same versions of the same transformers were run with the
// same configuration in the same order
function pipelineMetaMatches(pipelineMetaA, pipelineMetaB) {
  if (pipelineMetaA.length !== pipelineMetaB.length) {
    return false;
  }

  for (let i = 0; i < pipelineMetaA.length; i++) {
    let metaA = pipelineMetaA[i];
    let metaB = pipelineMetaB[i];
    if (
      metaA.name !== metaB.name ||
      metaA.version !== metaB.version ||
      metaA.config.hash !== metaB.config.hash
    ) {
      return false;
    }
  }

  return true;
}
