const assert = require('assert');
const path = require('path');
const {
  bundle,
  bundler,
  getNextBuild,
  removeDistDirectory,
  run,
  ncp,
  inputFS: fs,
  outputFS,
  distDir,
  sleep
} = require('@parcel/test-utils');
const {symlinkSync, copyFileSync} = require('fs');

const inputDir = path.join(__dirname, '/input');
const utimes = require('@ronomon/utimes');

describe.only('babel', function() {
  let subscription;
  beforeEach(async function() {
    // TODO maybe don't do this for all tests
    await sleep(100);
    await fs.rimraf(inputDir);
    await sleep(100);
  });

  afterEach(async () => {
    await removeDistDirectory();
    if (subscription) {
      await subscription.unsubscribe();
      subscription = null;
    }
  });

  it.skip('should auto install @babel/core v7', async function() {
    let originalPkg = await fs.readFile(
      __dirname + '/integration/babel-7-autoinstall/package.json'
    );
    let b = await bundle(
      __dirname + '/integration/babel-7-autoinstall/index.js'
    );

    let output = await run(b);
    assert.equal(typeof output, 'object');
    assert.equal(typeof output.default, 'function');
    assert.equal(output.default(), 3);

    let pkg = await fs.readFile(
      __dirname + '/integration/babel-7-autoinstall/package.json'
    );
    assert(JSON.parse(pkg).devDependencies['@babel/core']);
    await fs.writeFile(
      __dirname + '/integration/babel-7-autoinstall/package.json',
      originalPkg
    );
  });

  it.skip('should auto install babel plugins', async function() {
    let originalPkg = await fs.readFile(
      __dirname + '/integration/babel-plugin-autoinstall/package.json'
    );
    let b = await bundle(
      __dirname + '/integration/babel-plugin-autoinstall/index.js'
    );

    let output = await run(b);
    assert.equal(typeof output, 'object');
    assert.equal(typeof output.default, 'function');
    assert.equal(output.default(), 3);

    let pkg = await fs.readFile(
      __dirname + '/integration/babel-plugin-autoinstall/package.json'
    );
    assert(JSON.parse(pkg).devDependencies['@babel/core']);
    assert(
      JSON.parse(pkg).devDependencies['@babel/plugin-proposal-class-properties']
    );
    await fs.writeFile(
      __dirname + '/integration/babel-plugin-autoinstall/package.json',
      originalPkg
    );
  });

  it('should support compiling with babel using .babelrc config', async function() {
    await bundle(path.join(__dirname, '/integration/babel-custom/index.js'));

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(!file.includes('REPLACE_ME'));
    assert(file.includes('hello there'));
  });

  it('should compile with babel with default engines if no config', async function() {
    await bundle(path.join(__dirname, '/integration/babel-default/index.js'));

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(file.includes('function Foo'));
    assert(file.includes('function Bar'));
  });

  it('should support compiling with babel using browserlist', async function() {
    await bundle(
      path.join(__dirname, '/integration/babel-browserslist/index.js')
    );

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(file.includes('function Foo'));
    assert(file.includes('function Bar'));
  });

  // TODO: rework this test ?
  it('should support splitting core-js using browserlist', async function() {
    await bundle(path.join(__dirname, '/integration/babel-core-js/index.js'));

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(file.includes('async function'));
    assert(!file.includes('regenerator'));
  });

  it.skip('should support compiling with babel using browserslist for different environments', async function() {
    async function testBrowserListMultipleEnv(projectBasePath) {
      // Transpiled destructuring, like r = p.prop1, o = p.prop2, a = p.prop3;
      const prodRegExp = /\S+ ?= ?\S+\.prop1,\s*?\S+ ?= ?\S+\.prop2,\s*?\S+ ?= ?\S+\.prop3;/;
      // ES6 Destructuring, like in the source;
      const devRegExp = /const ?{\s*prop1(:.+)?,\s*prop2(:.+)?,\s*prop3(:.+)?\s*} ?= ?.*/;
      let file;
      // Dev build test
      await bundle(path.join(__dirname, projectBasePath, '/index.js'));
      file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
      assert.equal(devRegExp.test(file), true);
      assert.equal(prodRegExp.test(file), false);
      // Prod build test
      await bundle(path.join(__dirname, projectBasePath, '/index.js'), {
        minify: false,
        production: true
      });
      file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
      assert.equal(prodRegExp.test(file), true);
      assert.equal(devRegExp.test(file), false);
    }

    await testBrowserListMultipleEnv(
      '/integration/babel-browserslist-multiple-env'
    );
    await testBrowserListMultipleEnv(
      '/integration/babel-browserslist-multiple-env-as-string'
    );
  });

  it('can build using @babel/preset-env when engines have semver ranges', async () => {
    let fixtureDir = path.join(__dirname, '/integration/babel-semver-engine');
    await bundle(path.join(fixtureDir, 'index.js'));

    let legacy = await outputFS.readFile(
      path.join(fixtureDir, 'dist', 'legacy.js'),
      'utf8'
    );
    assert(legacy.includes('function Foo'));
    assert(legacy.includes('function Bar'));

    let modern = await outputFS.readFile(
      path.join(fixtureDir, 'dist', 'modern.js'),
      'utf8'
    );
    assert(modern.includes('class Foo'));
    assert(modern.includes('class Bar'));
  });

  it('should not compile node_modules by default', async function() {
    await bundle(
      path.join(__dirname, '/integration/babel-node-modules/index.js')
    );

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(/class \S+ \{\}/.test(file));
    assert(file.includes('function Bar'));
  });

  it('should compile node_modules with browserslist to app target', async function() {
    await bundle(
      path.join(
        __dirname,
        '/integration/babel-node-modules-browserslist/index.js'
      )
    );

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(file.includes('function Foo'));
    assert(file.includes('function Bar'));
  });

  it('should compile node_modules when symlinked with a source field in package.json', async function() {
    await fs.rimraf(inputDir);
    await fs.mkdirp(path.join(inputDir, 'node_modules'));
    await ncp(
      path.join(path.join(__dirname, '/integration/babel-node-modules-source')),
      inputDir
    );

    // Create the symlink here to prevent cross platform and git issues
    symlinkSync(
      path.join(inputDir, 'packages/foo'),
      path.join(inputDir, 'node_modules/foo'),
      'dir'
    );

    await bundle(inputDir + '/index.js', {outputFS: fs});

    let file = await fs.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(file.includes('function Foo'));
    assert(file.includes('function Bar'));
  });

  it('should not compile node_modules with a source field in package.json when not symlinked', async function() {
    await bundle(
      path.join(
        __dirname,
        '/integration/babel-node-modules-source-unlinked/index.js'
      )
    );

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(!file.includes('function Foo'));
    assert(file.includes('function Bar'));
  });

  it('should support compiling JSX', async function() {
    await bundle(path.join(__dirname, '/integration/jsx/index.jsx'));

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(file.includes('React.createElement("div"'));
  });

  it('should support compiling JSX in JS files with React dependency', async function() {
    await bundle(path.join(__dirname, '/integration/jsx-react/index.js'));

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(file.includes('React.createElement("div"'));
  });

  it('should support compiling JSX in JS files with Preact dependency', async function() {
    await bundle(path.join(__dirname, '/integration/jsx-preact/index.js'));

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(file.includes('h("div"'));
  });

  it('should support compiling JSX in JS files with Nerv dependency', async function() {
    await bundle(path.join(__dirname, '/integration/jsx-nervjs/index.js'));

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(file.includes('Nerv.createElement("div"'));
  });

  it('should support compiling JSX in JS files with Hyperapp dependency', async function() {
    await bundle(path.join(__dirname, '/integration/jsx-hyperapp/index.js'));

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(file.includes('h("div"'));
  });

  it('should strip away flow types of node modules', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/babel-strip-flow-types/index.js')
    );

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 'hello world');

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(!file.includes('OptionsType'));
  });

  it('should support compiling with babel using babel.config.js config', async function() {
    await bundle(
      path.join(__dirname, '/integration/babel-config-js/src/index.js')
    );

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(!file.includes('REPLACE_ME'));
    assert(file.includes('hello there'));
  });

  it.only('should rebuild when babel config changes', async function() {
    let differentPath = path.join(inputDir, 'differentConfig');
    let configPath = path.join(inputDir, '.babelrc');

    await ncp(path.join(__dirname, 'integration/babel-custom'), inputDir);

    let file = await fs.readFile(configPath, 'utf8');
    console.log('CONFIG FILE BEFORE', file);

    let stats = await fs.stat(configPath);
    console.log('STATS', stats);
    let firstMtime = stats.mtime;

    let b = bundler(path.join(inputDir, 'index.js'), {
      outputFS: fs,
      targets: {
        main: {
          engines: {
            node: '^4.0.0'
          },
          distDir
        }
      }
    });

    subscription = await b.watch();
    await getNextBuild(b);
    let distFile = await fs.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(distFile.includes('hello there'));
    copyFileSync(differentPath, configPath);
    await new Promise((resolve, reject) => {
      utimes.utimes(
        configPath,
        447775200000,
        447775200000,
        447775200000,
        err => {
          if (err) return reject(err);
          return resolve();
        }
      );
    });
    stats = await fs.stat(configPath);
    let sencondMtime = stats.mtime;
    console.log('MTIMES', firstMtime, sencondMtime);
    file = await fs.readFile(configPath, 'utf8');
    console.log('CONFIG FILE AFTER', file);
    console.log('UPDATED CONFIG');
    await getNextBuild(b);
    distFile = await fs.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(!distFile.includes('hello there'));
    assert(distFile.includes('something different'));
  });
});
