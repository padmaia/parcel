// @flow strict-local

import type {GraphVisitor} from '@parcel/types';
import type {
  Asset,
  AssetGraphNode,
  AssetGroup,
  AssetGroupNode,
  AssetNode,
  Dependency,
  DependencyNode,
  Entry,
  NodeId,
  Target,
} from './types';

import invariant from 'assert';
import crypto from 'crypto';
import {md5FromObject} from '@parcel/utils';
import Graph, {type GraphOpts} from './Graph';
import {createDependency} from './Dependency';

type AssetGraphOpts = {|
  ...GraphOpts<AssetGraphNode>,
  onIncompleteNode?: (node: AssetGraphNode) => mixed,
  onNodeAdded?: (node: AssetGraphNode) => mixed,
  onNodeRemoved?: (node: AssetGraphNode) => mixed,
|};

type InitOpts = {|
  entries?: Array<string>,
  targets?: Array<Target>,
  assetGroups?: Array<AssetGroup>,
|};

type SerializedAssetGraph = {|
  ...GraphOpts<AssetGraphNode>,
  hash: ?string,
|};

export function nodeFromDep(dep: Dependency): DependencyNode {
  return {
    id: dep.id,
    type: 'dependency',
    value: dep,
  };
}

export function nodeFromAssetGroup(
  assetGroup: AssetGroup,
  deferred: boolean = false,
) {
  return {
    id: md5FromObject(assetGroup),
    type: 'asset_group',
    value: assetGroup,
    deferred,
  };
}

export function nodeFromAsset(asset: Asset) {
  return {
    id: asset.id,
    type: 'asset',
    value: asset,
  };
}

export function nodeFromEntrySpecifier(entry: string) {
  return {
    id: 'entry_specifier:' + entry,
    type: 'entry_specifier',
    value: entry,
  };
}

export function nodeFromEntryFile(entry: Entry) {
  return {
    id: 'entry_file:' + md5FromObject(entry),
    type: 'entry_file',
    value: entry,
  };
}

const invertMap = <K, V>(map: Map<K, V>): Map<V, K> =>
  new Map([...map].map(([key, val]) => [val, key]));

// Types that are considered incomplete when they don't have a child node
const INCOMPLETE_TYPES = [
  'entry_specifier',
  'entry_file',
  'dependency',
  'asset_group',
];

export default class AssetGraph extends Graph<AssetGraphNode> {
  onNodeAdded: ?(node: AssetGraphNode) => mixed;
  onNodeRemoved: ?(node: AssetGraphNode) => mixed;
  onIncompleteNode: ?(node: AssetGraphNode) => mixed;
  incompleteNodeIds: Set<NodeId> = new Set();
  hash: ?string;

  // $FlowFixMe
  static deserialize(opts: SerializedAssetGraph): AssetGraph {
    let res = new AssetGraph(opts);
    res.incompleteNodeIds = opts.incompleteNodeIds;
    res.hash = opts.hash;
    return res;
  }

  // $FlowFixMe
  serialize(): SerializedAssetGraph {
    return {
      ...super.serialize(),
      incompleteNodeIds: this.incompleteNodeIds,
      hash: this.hash,
    };
  }

  initOptions({
    onNodeAdded,
    onNodeRemoved,
    onIncompleteNode,
  }: AssetGraphOpts = {}) {
    this.onNodeAdded = onNodeAdded;
    this.onNodeRemoved = onNodeRemoved;
    this.onIncompleteNode = onIncompleteNode;
  }

  initialize({entries, assetGroups}: InitOpts) {
    let rootNode = {id: '@@root', type: 'root', value: null};
    this.setRootNode(rootNode);

    let nodes = [];
    if (entries) {
      for (let entry of entries) {
        let node = nodeFromEntrySpecifier(entry);
        nodes.push(node);
      }
    } else if (assetGroups) {
      nodes.push(
        ...assetGroups.map(assetGroup => nodeFromAssetGroup(assetGroup)),
      );
    }
    this.replaceNodesConnectedTo(rootNode, nodes);
  }

  addNode(node: AssetGraphNode) {
    this.hash = null;
    let existingNode = this.getNode(node.id);
    if (
      INCOMPLETE_TYPES.includes(node.type) &&
      !node.complete &&
      !node.deferred &&
      (!existingNode || existingNode.deferred)
    ) {
      this.markIncomplete(node);
    }
    this.onNodeAdded && this.onNodeAdded(node);
    return super.addNode(node);
  }

  removeNode(node: AssetGraphNode) {
    this.hash = null;
    this.incompleteNodeIds.delete(node.id);
    this.onNodeRemoved && this.onNodeRemoved(node);
    return super.removeNode(node);
  }

  markIncomplete(node: AssetGraphNode) {
    this.incompleteNodeIds.add(node.id);
    if (this.onIncompleteNode) {
      this.onIncompleteNode(node);
    }
  }

  hasIncompleteNodes() {
    return this.incompleteNodeIds.size > 0;
  }

  resolveEntry(entry: string, resolved: Array<Entry>) {
    let entrySpecifierNode = nodeFromEntrySpecifier(entry);
    let entryFileNodes = resolved.map(file => nodeFromEntryFile(file));
    this.replaceNodesConnectedTo(entrySpecifierNode, entryFileNodes);
    this.incompleteNodeIds.delete(entrySpecifierNode.id);
  }

  resolveTargets(entry: Entry, targets: Array<Target>) {
    let depNodes = targets.map(target =>
      nodeFromDep(
        createDependency({
          moduleSpecifier: entry.filePath,
          pipeline: target.name,
          target: target,
          env: target.env,
          isEntry: true,
        }),
      ),
    );

    let entryNode = nodeFromEntryFile(entry);
    if (this.hasNode(entryNode.id)) {
      this.replaceNodesConnectedTo(entryNode, depNodes);
      this.incompleteNodeIds.delete(entryNode.id);
    }
  }

  resolveDependency(
    dependency: Dependency,
    assetGroup: AssetGroup | null | void,
  ) {
    let depNode = this.nodes.get(dependency.id);
    if (!depNode) return;
    this.incompleteNodeIds.delete(depNode.id);

    if (!assetGroup) {
      return;
    }

    let defer = this.shouldDeferDependency(dependency, assetGroup.sideEffects);
    dependency.isDeferred = defer;

    let assetGroupNode = nodeFromAssetGroup(assetGroup, defer);
    let existingAssetGroupNode = this.getNode(assetGroupNode.id);
    if (existingAssetGroupNode) {
      // Don't overwrite non-deferred asset groups with deferred ones
      invariant(existingAssetGroupNode.type === 'asset_group');
      assetGroupNode.deferred = existingAssetGroupNode.deferred && defer;
    }

    if (existingAssetGroupNode) {
      // Node already existed, that asset might have deferred dependencies,
      // recheck all dependencies of all assets of this asset group
      this.traverse((node, parent, actions) => {
        if (node == assetGroupNode) {
          return;
        }

        if (node.type === 'dependency' && !node.value.isDeferred) {
          actions.skipChildren();
          return;
        }

        if (node.type == 'asset_group') {
          invariant(parent && parent.type === 'dependency');
          if (
            node.deferred &&
            !this.shouldDeferDependency(parent.value, node.value.sideEffects)
          ) {
            parent.value.isDeferred = false;
            node.deferred = false;
            this.markIncomplete(node);
          }

          actions.skipChildren();
        }

        return node;
      }, assetGroupNode);
    }

    // ?Does this need to go further up?
    this.replaceNodesConnectedTo(depNode, [assetGroupNode]);
  }

  // Defer transforming this dependency if it is marked as weak, there are no side effects,
  // no re-exported symbols are used by ancestor dependencies and the re-exporting asset isn't
  // using a wildcard and isn't an entry (in library mode).
  // This helps with performance building large libraries like `lodash-es`, which re-exports
  // a huge number of functions since we can avoid even transforming the files that aren't used.
  shouldDeferDependency(dependency: Dependency, sideEffects: ?boolean) {
    let defer = false;
    if (
      dependency.isWeak &&
      sideEffects === false &&
      !dependency.symbols.has('*')
    ) {
      let depNode = this.getNode(dependency.id);
      invariant(depNode);

      let assets = this.getNodesConnectedTo(depNode);
      let symbols = invertMap(dependency.symbols);
      invariant(assets.length === 1);
      let firstAsset = assets[0];
      invariant(firstAsset.type === 'asset');
      let resolvedAsset = firstAsset.value;
      let deps = this.getIncomingDependencies(resolvedAsset);
      defer = deps.every(
        d =>
          !(d.env.isLibrary && d.isEntry) &&
          !d.symbols.has('*') &&
          ![...d.symbols.keys()].some(symbol => {
            let assetSymbol = resolvedAsset.symbols.get(symbol);
            return assetSymbol != null && symbols.has(assetSymbol);
          }),
      );
    }
    return defer;
  }

  resolveAssetGroup(assetGroup: AssetGroup, assets: Array<Asset>) {
    let assetGroupNode = nodeFromAssetGroup(assetGroup);
    this.incompleteNodeIds.delete(assetGroupNode.id);
    if (!this.hasNode(assetGroupNode.id)) {
      return;
    }

    let dependentAssetKeys = [];
    let assetObjects: Array<{|
      assetNode: AssetNode,
      dependentAssets: Array<Asset>,
      isDirect: boolean,
    |}> = [];
    for (let asset of assets) {
      let isDirect = !dependentAssetKeys.includes(asset.uniqueKey);

      let dependentAssets = [];
      for (let dep of asset.dependencies.values()) {
        let dependentAsset = assets.find(
          a => a.uniqueKey === dep.moduleSpecifier,
        );
        if (dependentAsset) {
          dependentAssetKeys.push(dependentAsset.uniqueKey);
          dependentAssets.push(dependentAsset);
        }
      }
      assetObjects.push({
        assetNode: nodeFromAsset(asset),
        dependentAssets,
        isDirect,
      });
    }

    this.replaceNodesConnectedTo(
      assetGroupNode,
      assetObjects.filter(a => a.isDirect).map(a => a.assetNode),
    );
    for (let {assetNode, dependentAssets} of assetObjects) {
      this.resolveAsset(assetNode, dependentAssets);
    }
  }

  resolveAsset(assetNode: AssetNode, dependentAssets: Array<Asset>) {
    let depNodes = [];
    let depNodesWithAssets = [];
    for (let dep of assetNode.value.dependencies.values()) {
      let depNode = nodeFromDep(dep);
      depNodes.push(this.nodes.get(depNode.id) ?? depNode);
      let dependentAsset = dependentAssets.find(
        a => a.uniqueKey === dep.moduleSpecifier,
      );
      if (dependentAsset) {
        depNode.complete = true;
        depNodesWithAssets.push([depNode, nodeFromAsset(dependentAsset)]);
      }
    }
    this.replaceNodesConnectedTo(assetNode, depNodes);

    for (let [depNode, dependentAssetNode] of depNodesWithAssets) {
      this.replaceNodesConnectedTo(depNode, [dependentAssetNode]);
    }
  }

  getIncomingDependencies(asset: Asset): Array<Dependency> {
    let node = this.getNode(asset.id);
    if (!node) {
      return [];
    }

    return this.findAncestors(node, node => node.type === 'dependency').map(
      node => {
        invariant(node.type === 'dependency');
        return node.value;
      },
    );
  }

  traverseAssets<TContext>(
    visit: GraphVisitor<Asset, TContext>,
    startNode: ?AssetGraphNode,
  ): ?TContext {
    return this.filteredTraverse(
      node => (node.type === 'asset' ? node.value : null),
      visit,
      startNode,
    );
  }

  getEntryAssetGroupNodes(): Array<AssetGroupNode> {
    let entryNodes = [];
    this.traverse((node, _, actions) => {
      if (node.type === 'asset_group') {
        entryNodes.push(node);
        actions.skipChildren();
      }
    });
    return entryNodes;
  }

  getEntryAssets(): Array<Asset> {
    let entries = [];
    this.traverseAssets((asset, ctx, traversal) => {
      entries.push(asset);
      traversal.skipChildren();
    });

    return entries;
  }

  getHash() {
    if (this.hash != null) {
      return this.hash;
    }

    let hash = crypto.createHash('md5');
    // TODO: sort??
    this.traverse(node => {
      if (node.type === 'asset') {
        hash.update(node.value.outputHash);
      } else if (node.type === 'dependency' && node.value.target) {
        hash.update(JSON.stringify(node.value.target));
      }
    });

    this.hash = hash.digest('hex');
    return this.hash;
  }
}
