// // @flow
// import clone from 'clone';
// import {createReadStream} from 'fs';
// import path from 'path';

// import Cache from '@parcel/cache';
// // import type {
// //   AssetRequest,
// //   ConfigRequest,
// //   FilePath,
// //   GenerateOutput,
// //   MutableAsset as IMutableAsset,
// //   PackageName,
// //   ParcelOptions,
// //   Transformer,
// //   TransformerResult
// // } from '@parcel/types';
// import {
//   md5FromReadableStream,
//   md5FromString,
//   TapStream,
//   unique
// } from '@parcel/utils';

// import {MutableAsset, assetToInternalAsset} from './public/Asset';
// import InternalAsset from './Asset';
// import {report} from './ReporterRunner';

// const BUFFER_LIMIT = 5000000; // 5mb

// // type TransformationOpts = {|
// //   request: AssetRequest,
// //   loadConfig: (ConfigRequest, string) => Promise<mixed>, // TODO: this should probably specify Config
// //   requestId: string,
// //   options: ParcelOptions
// // |};

// export default class Transformation {
//   request: AssetRequest;
//   loadConfig: ConfigRequest => Promise<mixed>;
//   options: ParcelOptions;

//   constructor({request, loadConfig, requestId, options}: TransformationOpts) {
//     this.request = request;
//     this.loadConfig = configRequest => loadConfig(configRequest, requestId);
//     this.options = options;
//   }

//   async run() {
//     report({
//       type: 'buildProgress',
//       phase: 'transforming',
//       request: this.request
//     });

//     let asset = await this.loadAsset();

//     return this.runPipeline(asset);
//   }

//   async runPipeline(initialAsset: InternalAsset) {
//     let {pipeline, configs} = await this.loadPipeline(initialAsset.filePath);

//     let cacheKey = this.getCacheKey(initialAsset, configs);
//     // console.log('CACHE KEY', cacheKey);
//     let cacheEntry = await Cache.get(cacheKey);

//     // if (cacheEntry) console.log('CACHE ENTRY FOUND', cacheEntry);
//     // else console.log('TRANSFORMING');

//     let assets = cacheEntry || (await pipeline.transform(initialAsset));

//     let finalAssets = [];
//     for (let asset of assets) {
//       if (asset.type !== initialAsset.type) {
//         let nextPipelineAssets = this.runPipeline(asset);
//         finalAssets = finalAssets.concat(nextPipelineAssets);
//       } else {
//         finalAssets.push(asset);
//       }
//     }

//     let processedFinalAssets = pipeline.postProcess
//       ? await pipeline.postProcess(assets)
//       : finalAssets;

//     // console.log('PROCESSED ASSETS', processedFinalAssets);

//     await Promise.all(
//       unique(processedFinalAssets).map(asset => asset.commit())
//     );
//     Cache.set(cacheKey, processedFinalAssets);

//     return processedFinalAssets;
//   }

//   getCacheKey(asset: InternalAsset, configs: Map<string, any>) {
//     let {filePath, content} = asset;
//     return md5FromString(JSON.stringify({filePath, content, configs}));
//   }

//   async loadAsset() {
//     let {filePath, env, code, sideEffects} = this.request;
//     let {content, size, hash} = await summarizeRequest(this.request);

//     return new InternalAsset({
//       // If the transformer request passed code rather than a filename,
//       // use a hash as the base for the id to ensure it is unique.
//       idBase: code ? hash : filePath,
//       filePath: filePath,
//       type: path.extname(filePath).slice(1),
//       ast: null,
//       content,
//       hash,
//       env,
//       stats: {
//         time: 0,
//         size
//       },
//       sideEffects
//     });
//   }

//   async loadPipeline(filePath: FilePath) {
//     let configRequest = {
//       filePath,
//       meta: {
//         actionType: 'transformation'
//       }
//     };

//     let parcelConfig = await this.loadConfig(configRequest);
//     let configs = {parcel: parcelConfig.result.getTransformerNames(filePath)};

//     for (let [moduleName] of parcelConfig.devDeps) {
//       let plugin = await parcelConfig.result.loadPlugin(moduleName);
//       // TODO: implement loadPlugin in existing plugins that require config
//       if (plugin.loadConfig) {
//         configs[moduleName] = await this.loadTransformerConfig(
//           filePath,
//           moduleName,
//           parcelConfig.resolvedPath
//         ).result;
//       }
//     }

//     let pipeline = new Pipeline(
//       await parcelConfig.result.getTransformers(filePath),
//       configs,
//       this.options
//     );

//     return {pipeline, configs};
//   }

//   async loadTransformerConfig(
//     filePath: FilePath,
//     plugin: PackageName,
//     parcelConfigPath
//   ) {
//     let configRequest = {
//       filePath,
//       plugin,
//       meta: {
//         parcelConfigPath
//       }
//     };
//     return this.loadConfig(configRequest);
//   }
// }

// class Pipeline {
//   transformers: Array<Transformer>;
//   options: ParcelOptions;
//   configs: Map<string, any>; // TODO
//   generate: (input: IMutableAsset) => Promise<GenerateOutput>;
//   postProcess: (Array<InternalAsset>) => Promise<Array<InternalAsset> | null>;

//   constructor(
//     transformers: Array<Transformer>,
//     configs: Map<string, any>,
//     options: ParcelOptions
//   ) {
//     this.transformers = transformers;
//     this.options = options;
//     this.configs = configs;
//   }

//   async transform(initialAsset: IMutableAsset) {
//     let inputAssets = [initialAsset];
//     let resultingAssets;
//     let finalAssets = [];
//     for (let transformer of this.transformers) {
//       resultingAssets = [];
//       for (let asset of inputAssets) {
//         if (asset.type !== initialAsset.type) {
//           finalAssets.push(asset);
//         } else {
//           resultingAssets = resultingAssets.concat(
//             await this.runTransformer(asset, transformer)
//           );
//         }
//       }

//       inputAssets = resultingAssets;
//     }

//     finalAssets = finalAssets.concat(resultingAssets);

//     return finalAssets;
//   }

//   async runTransformer(asset: IMutableAsset, transformer: Transformer) {
//     // Load config for the transformer.
//     let config = null;
//     if (transformer.getConfig) {
//       config = await transformer.getConfig(asset, this.options);
//     }

//     // If an ast exists on the asset, but we cannot reuse it,
//     // use the previous transform to generate code that we can re-parse.
//     if (
//       asset.ast &&
//       (!transformer.canReuseAST ||
//         (!transformer.canReuseAST({ast: asset.ast, options: this.options}) &&
//           this.generate))
//     ) {
//       let output = await this.generate(asset);
//       asset.content = output.code;
//       asset.ast = null;
//     }

//     // Parse if there is no AST available from a previous transform.
//     if (!asset.ast && transformer.parse) {
//       asset.ast = await transformer.parse(asset, config, this.options);
//     }

//     // Transform.
//     let results = await transformer.transform(asset, config, this.options);

//     // Create generate and postProcess functions that can be called later
//     this.generate = async (input: IMutableAsset): Promise<GenerateOutput> => {
//       if (transformer.generate) {
//         return transformer.generate({
//           asset: input,
//           config,
//           options: this.options
//         });
//       }

//       throw new Error(
//         'Asset has an AST but no generate method is available on the transform'
//       );
//     };

//     this.postProcess = async (
//       assets: Array<InternalAsset>
//     ): Promise<Array<InternalAsset> | null> => {
//       let {postProcess} = transformer;
//       if (postProcess) {
//         let results = await postProcess({
//           assets: assets.map(asset => new MutableAsset(asset)),
//           config,
//           options: this.options
//         });

//         return Promise.all(
//           results.map(result => input.createChildAsset(result))
//         );
//       }

//       return null;
//     };

//     return results;
//   }
// }

// async function summarizeRequest(
//   req: AssetRequest
// ): Promise<{|content: Blob, hash: string, size: number|}> {
//   let code = req.code;
//   let content: Blob;
//   let hash: string;
//   let size: number;
//   if (code == null) {
//     // As an optimization for the common case of source code, while we read in
//     // data to compute its md5 and size, buffer its contents in memory.
//     // This avoids reading the data now, and then again during transformation.
//     // If it exceeds BUFFER_LIMIT, throw it out and replace it with a stream to
//     // lazily read it at a later point.
//     content = Buffer.from([]);
//     size = 0;
//     hash = await md5FromReadableStream(
//       createReadStream(req.filePath).pipe(
//         new TapStream(buf => {
//           size += buf.length;
//           if (content instanceof Buffer) {
//             if (size > BUFFER_LIMIT) {
//               // if buffering this content would put this over BUFFER_LIMIT, replace
//               // it with a stream
//               content = createReadStream(req.filePath);
//             } else {
//               content = Buffer.concat([content, buf]);
//             }
//           }
//         })
//       )
//     );
//   } else {
//     content = code;
//     hash = md5FromString(code);
//     size = Buffer.from(code).length;
//   }

//   return {content, hash, size};
// }

// function normalizeAssets(
//   results: Array<TransformerResult | MutableAsset>
// ): Array<TransformerResult> {
//   return results.map(result => {
//     return result instanceof MutableAsset
//       ? {
//           type: result.type,
//           content: assetToInternalAsset(result).content,
//           ast: result.ast,
//           // $FlowFixMe
//           dependencies: result.getDependencies(),
//           connectedFiles: result.getConnectedFiles(),
//           // $FlowFixMe
//           env: result.env,
//           isIsolated: result.isIsolated,
//           meta: result.meta
//         }
//       : result;
//   });
// }
