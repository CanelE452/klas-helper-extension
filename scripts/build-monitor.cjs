const fs = require('node:fs');
const path = require('node:path');
const webpack = require('webpack');

const root = path.resolve(__dirname, '..');
webpack({
  mode: 'production',
  entry: path.join(root, 'src/monitor/main.js'),
  output: { path: path.join(root, 'dist-monitor'), filename: 'monitor.js', clean: true },
  devtool: false,
  performance: { hints: 'error', maxAssetSize: 100000, maxEntrypointSize: 100000 },
}, (error, stats) => {
  if (error || stats.hasErrors()) {
    process.stderr.write('Monitor build failed.\n');
    if (stats) process.stderr.write(stats.toString({ all: false, errors: true }));
    process.exitCode = 1;
    return;
  }
  fs.copyFileSync(path.join(root, 'monitor.manifest.json'), path.join(root, 'dist-monitor/manifest.json'));
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(root, 'dist-monitor/LICENSE'));
  process.stdout.write(stats.toString({ colors: false, all: false, assets: true }) + '\nRead-only monitor: dist-monitor\n');
});
