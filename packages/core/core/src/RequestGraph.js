// @flow strict-local
import nullthrows from 'nullthrows';

import {PromiseQueue, md5FromString} from '@parcel/utils';
import type {
  AssetRequest,
  Config,
  ConfigRequest,
  FilePath,
  ParcelOptions
} from '@parcel/types';
import type {Event} from '@parcel/watcher';
import WorkerFarm from '@parcel/workers';

import ConfigLoader from './ConfigLoader';
import Dependency from './Dependency';
import Graph, {type GraphOpts} from './Graph';
import ResolverRunner from './ResolverRunner';
import type {
  AssetRequestNode,
  CacheEntry,
  DepPathRequestNode,
  NodeId,
  RequestGraphNode,
  RequestNode,
  RequestResult,
  SubRequestNode
} from './types';

type RequestGraphOpts = {|
  ...GraphOpts<RequestGraphNode>,
  config: Config,
  options: ParcelOptions,
  onAssetRequestComplete: (AssetRequestNode, CacheEntry) => mixed,
  onDepPathRequestComplete: (DepPathRequestNode, AssetRequest | null) => mixed
|};

const hashObject = obj => {
  return md5FromString(JSON.stringify(obj));
};

const nodeFromDepPathRequest = (dep: Dependency) => ({
  id: dep.id,
  type: 'dep_path_request',
  value: dep
});

const nodeFromAssetRequest = (assetRequest: AssetRequest) => ({
  id: hashObject(assetRequest),
  type: 'asset_request',
  value: assetRequest
});

const nodeFromConfigRequest = (configRequest: ConfigRequest) => ({
  id: md5FromString(`${configRequest.filePath}:${configRequest.plugin}`),
  type: 'config_request',
  value: configRequest
});

const nodeFromFilePath = (filePath: string) => ({
  id: filePath,
  type: 'file',
  value: {filePath}
});

export default class RequestGraph extends Graph<RequestGraphNode> {
  inProgress: Map<NodeId, Promise<RequestResult>> = new Map();
  invalidNodes: Map<NodeId, RequestNode> = new Map();
  runTransform: (
    file: AssetRequest,
    loadConfig: () => Promise<Config>,
    parentNodeId: NodeId
  ) => Promise<CacheEntry>;
  loadConfigHandle: () => Promise<Config>;
  resolverRunner: ResolverRunner;
  configLoader: ConfigLoader;
  onAssetRequestComplete: (AssetRequestNode, CacheEntry) => mixed;
  onDepPathRequestComplete: (DepPathRequestNode, AssetRequest | null) => mixed;
  queue: PromiseQueue;
  farm: WorkerFarm;

  constructor({
    onAssetRequestComplete,
    onDepPathRequestComplete,
    config,
    options,
    ...graphOpts
  }: RequestGraphOpts) {
    super(graphOpts);
    this.queue = new PromiseQueue();
    this.onAssetRequestComplete = onAssetRequestComplete;
    this.onDepPathRequestComplete = onDepPathRequestComplete;

    this.resolverRunner = new ResolverRunner({
      config,
      options
    });

    this.configLoader = new ConfigLoader(options);
  }

  async initFarm() {
    // This expects the worker farm to already be initialized by Parcel prior to calling
    // AssetGraphBuilder, which avoids needing to pass the options through here.
    this.farm = await WorkerFarm.getShared();
    this.runTransform = this.farm.createHandle('runTransform');
    this.loadConfigHandle = WorkerFarm.createReverseHandle(
      this.loadConfig.bind(this)
    );
  }

  async completeRequests() {
    if (!this.farm) {
      await this.initFarm();
    }

    for (let [, node] of this.invalidNodes) {
      this.processNode(node);
    }

    await this.queue.run();
  }

  addNode(node: RequestGraphNode) {
    this.processNode(node);
    return super.addNode(node);
  }

  addDepPathRequest(dep: Dependency) {
    let requestNode = nodeFromDepPathRequest(dep);
    if (!this.hasNode(requestNode.id)) {
      this.addNode(requestNode);
    }
  }

  addAssetRequest(request: AssetRequest) {
    let requestNode = nodeFromAssetRequest(request);
    if (!this.hasNode(requestNode.id)) {
      this.addNode(requestNode);
    }

    this.connectFile(requestNode, request.filePath);
  }

  async processNode(requestNode: RequestGraphNode) {
    let promise;
    switch (requestNode.type) {
      case 'asset_request':
        promise = this.queue.add(() =>
          this.transform(requestNode).then(result => {
            this.onAssetRequestComplete(requestNode, result);
            return result;
          })
        );
        break;
      case 'dep_path_request':
        promise = this.queue.add(() =>
          this.resolvePath(requestNode.value).then(result => {
            this.onDepPathRequestComplete(requestNode, result);
            return result;
          })
        );
        break;
      case 'config_request':
        promise = this.runConfigRequest(requestNode.value);
        break;
      default:
      // Do nothing
    }

    if (promise) {
      this.inProgress.set(requestNode.id, promise);
      await promise;
      // ? Should these be updated before it comes off the queue?
      this.invalidNodes.delete(requestNode.id);
      this.inProgress.delete(requestNode.id);
    }
  }

  async transform(requestNode: AssetRequestNode) {
    try {
      let start = Date.now();
      let request = requestNode.value;
      let cacheEntry = await this.runTransform(
        request,
        this.loadConfigHandle,
        requestNode.id
      );

      let time = Date.now() - start;
      for (let asset of cacheEntry.assets) {
        asset.stats.time = time;
      }

      return cacheEntry;
    } catch (e) {
      // TODO: add connectedFiles even if it failed so we can try a rebuild if those files change
      throw e;
    }
  }

  async resolvePath(dep: Dependency) {
    try {
      let assetRequest = await this.resolverRunner.resolve(dep);

      this.connectFile(nodeFromDepPathRequest(dep), assetRequest.filePath);
      return assetRequest;
    } catch (err) {
      if (err.code === 'MODULE_NOT_FOUND' && dep.isOptional) {
        return null;
      }

      throw err;
    }
  }

  async loadConfig(configRequest: ConfigRequest, parentNodeId: NodeId) {
    let configRequestNode = nodeFromConfigRequest(configRequest);
    if (!this.hasNode(configRequestNode.id)) this.addNode(configRequestNode);
    if (!this.hasEdge(parentNodeId, configRequestNode.id))
      this.addEdge(parentNodeId, configRequestNode.id);

    let config = await this.getSubTaskResult(configRequestNode);

    // await Promise.all(
    //   config.getDevDepRequests().map(async devDepRequest => {
    //     let devDepRequestNode = nodeFromDevDepRequest(devDepRequest);
    //     let {version} = await this.getSubTaskResult(devDepRequestNode);
    //     config.setDevDep(devDepRequest.moduleSpecifier, version);
    //   })
    // );

    return config;
  }

  async runConfigRequest(configRequest: ConfigRequest) {
    let result = await this.configLoader.load(configRequest);
    configRequest.result = result;
    //this.addConfigResultToGraph(requestNode, result);
    return result;
  }

  addSubRequest(subRequestNode: SubRequestNode, nodeId: NodeId) {
    if (!this.nodes.has(subRequestNode.id)) {
      this.addNode(subRequestNode);
      this.processNode(subRequestNode);
    }

    if (!this.hasEdge(nodeId, subRequestNode.id)) {
      this.addEdge(nodeId, subRequestNode.id);
    }

    return subRequestNode;
  }

  async getSubTaskResult(node: SubRequestNode) {
    let result;
    if (this.inProgress.has(node.id)) {
      result = await this.inProgress.get(node.id);
    } else {
      result = this.getResultFromGraph(node);
    }

    return result;
  }

  getResultFromGraph(subRequestNode: SubRequestNode) {
    let node = nullthrows(this.getNode(subRequestNode.id));
    let result = nullthrows(node.value.result);

    return result;
  }

  connectFile(requestNode: RequestNode, filePath: FilePath) {
    let fileNode = nodeFromFilePath(filePath);
    if (!this.hasNode(fileNode.id)) {
      this.addNode(fileNode);
    }

    if (!this.hasEdge(requestNode.id, fileNode.id)) {
      this.addEdge(requestNode.id, fileNode.id);
    }
  }

  invalidateNode(node: RequestNode) {
    this.invalidNodes.set(node.id, node);
  }

  respondToFSEvents(events: Array<Event>) {
    for (let {path, type} of events) {
      let node = this.getNode(path);
      let connectedNodes = node ? this.getNodesConnectedTo(node) : [];

      if (type === 'create' && !this.hasNode(path)) {
        // TODO: invalidate dep path requests that have failed and this creation may fulfill the request
        // TODO: invalidate glob modules
      } else if (type === 'create' || type === 'update') {
        // sometimes mac reports update events as create events
        for (let connectedNode of connectedNodes) {
          if (connectedNode.type === 'asset_request') {
            this.invalidateNode(connectedNode);
          }
        }
      } else if (type === 'delete') {
        for (let connectedNode of connectedNodes) {
          if (connectedNode.type === 'dep_path_request') {
            this.invalidateNode(connectedNode);
          }
        }
      }
    }
  }

  isInvalid() {
    return this.invalidNodes.size > 0;
  }
}
