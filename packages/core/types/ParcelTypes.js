// @flow

export type JSONValue =
  | null
  | boolean
  | number
  | string
  | Array<JSONValue>
  | JSONObject;

export type JSONObject = {
  [key: string]: JSONValue
};

export type PackageName = string;
export type FilePath = string;
export type Glob = string;
type Semver = string;
type SemverRange = string;
type ModuleSpecifier = string;

export type ParcelConfig = {
  extends: Array<PackageName | FilePath>,
  resolvers: Array<PackageName>,
  transforms: {
    [Glob]: Array<PackageName>
  },
  loaders: {
    [Glob]: PackageName
  },
  bundler: PackageName,
  namers: Array<PackageName>,
  packagers: {
    [Glob]: PackageName
  },
  optimizers: {
    [Glob]: Array<PackageName>
  },
  reporters: Array<PackageName>
};

export type Engines = {
  node?: SemverRange,
  electron?: SemverRange,
  browsers?: Array<string>
};

export type Target = {
  distPath: FilePath,
  env: Environment
};

export type Environment = {
  context: 'browser' | 'worker' | 'service-worker' | 'node' | 'electron',
  engines: Engines,
  includeNodeModules?: boolean
};

export type PackageJSON = {
  name: PackageName,
  version: Semver,
  main?: FilePath,
  module?: FilePath,
  browser?: FilePath | {[FilePath]: FilePath},
  source?: FilePath | {[FilePath]: FilePath},
  alias?: {
    [PackageName | FilePath | Glob]: PackageName | FilePath
  },
  browserslist?: Array<string>,
  engines?: Engines,
  targets?: {
    [string]: Environment
  }
};

export type CLIOptions = {
  cacheDir?: FilePath,
  watch?: boolean,
  distDir?: FilePath
};

export type SourceLocation = {
  filePath: string,
  start: {line: number, column: number},
  end: {line: number, column: number}
};

export type Dependency = {
  sourcePath: FilePath,
  moduleSpecifier: ModuleSpecifier,
  isAsync?: boolean,
  isEntry?: boolean,
  isOptional?: boolean,
  isIncluded?: boolean,
  loc?: SourceLocation,
  env?: Environment,
  meta?: JSONObject
};

export type TransformationRequest = {
  filePath: FilePath,
  env: Environment
};

export type TransformerMeta = {
  name: string,
  version: SemverRange,
  config: {
    hash: string,
    files: Array<FilePath>
  }
};

export type PipelineAsset = {
  filePath: FilePath,
  type: string,
  hash?: string,
  ast?: AST,
  code: string,
  sourceMap?: SourceMap,
  dependencies: Array<Dependency>,
  connectedFiles: Array<File>,
  env: Environment,
  meta?: JSONObject
};

export type AST = {
  type: string,
  version: string,
  program: JSONObject
};

export type Config = JSONObject;
export type SourceMap = JSONObject;
export type Blob = string | Buffer;

export type ConfigOutput = {
  config: Config,
  hash: string,
  files: Array<File>
};

type Async<T> = T | Promise<T>;

export type Transformer = {
  getConfig?: (filePath: FilePath, opts: CLIOptions) => Async<ConfigOutput>,
  canReuseAST?: (ast: AST, opts: CLIOptions) => boolean,
  parse?: (
    asset: PipelineAsset,
    config: ?Config,
    opts: CLIOptions
  ) => Async<?AST>,
  transform(
    asset: PipelineAsset,
    config: ?Config,
    opts: CLIOptions
  ): Async<Array<PipelineAsset>>,
  generate?: (
    asset: PipelineAsset,
    config: ?Config,
    opts: CLIOptions
  ) => Async<AssetOutput>,
  postProcess?: (
    assets: Array<PipelineAsset>,
    config: ?Config,
    opts: CLIOptions
  ) => Async<Array<PipelineAsset>>
};

// TODO: what do we want to expose here?
interface AssetGraph {}

export type Bundle = {
  type: string,
  assets: Array<Asset>,
  filePath?: FilePath
};

export type Bundler = {
  bundle(graph: AssetGraph, opts: CLIOptions): Array<Bundle>
};

export type Namer = {
  name(bundle: Bundle, opts: CLIOptions): Async<FilePath>
};

export type Packager = {
  package(bundle: Bundle, opts: CLIOptions): Async<Blob>
};

export type Optimizer = {
  optimize(bundle: Bundle, contents: Blob, opts: CLIOptions): Async<Blob>
};

export type Resolver = {
  resolve(
    dependency: Dependency,
    opts: CLIOptions,
    rootDir: string
  ): FilePath | null
};

export type Reporter = {
  report(bundles: Array<Bundle>, opts: CLIOptions): void
};
