import { useSpinner } from '../utils/useSpinner';
import { testPlugin } from './plugin/tests';
import { Task, TaskRunner } from './task';
import rimrafCallback from 'rimraf';
import { resolve as resolvePath } from 'path';
import { promisify } from 'util';
import globby from 'globby';
import execa from 'execa';
import { constants as fsConstants, promises as fs } from 'fs';
import { CLIEngine } from 'eslint';
import { bundlePlugin as bundleFn, PluginBundleOptions } from './plugin/bundle';

const { copyFile, readFile, writeFile } = fs;
const { COPYFILE_EXCL, F_OK } = fsConstants;
const rimraf = promisify(rimrafCallback);

interface PluginBuildOptions {
  coverage: boolean;
}

interface Fixable {
  fix?: boolean;
}

export const bundlePlugin = useSpinner<PluginBundleOptions>('Compiling...', async options => await bundleFn(options));

// @ts-ignore
export const clean = useSpinner<void>('Cleaning', async () => await rimraf(`${process.cwd()}/dist`));

const copyIfNonExistent = (srcPath, destPath) =>
  copyFile(srcPath, destPath, COPYFILE_EXCL)
    .then(() => console.log(`Created: ${destPath}`))
    .catch(error => {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    });

export const prepare = useSpinner<void>('Preparing', async () => {
  await Promise.all([
    // Copy only if local tsconfig does not exist.  Otherwise this will work, but have odd behavior
    copyIfNonExistent(
      resolvePath(process.cwd(), 'tsconfig.json'),
      resolvePath(__dirname, '../../config/tsconfig.plugin.local.json')
    ),
    // Copy only if local prettierrc does not exist.  Otherwise this will work, but have odd behavior
    copyIfNonExistent(
      resolvePath(process.cwd(), '.prettierrc.js'),
      resolvePath(__dirname, '../../config/prettier.plugin.rc.js')
    ),
  ]);

  // Nothing is returned
});

const typecheckPlugin = useSpinner<void>('Typechecking', async () => {
  await execa('tsc', ['--noEmit']);
});

const getTypescriptSources = () => globby(resolvePath(process.cwd(), 'src/**/*.+(ts|tsx)'));

const getStylesSources = () => globby(resolvePath(process.cwd(), 'src/**/*.+(scss|css)'));

export const lintPlugin = useSpinner<Fixable>('Linting', async ({ fix }) => {
  // @todo should remove this because the config file could be in a parent dir or within package.json
  const configFile = await globby(resolvePath(process.cwd(), '.eslintrc?(.cjs|.js|.json|.yaml|.yml)')).then(
    filePaths => {
      if (filePaths.length > 0) {
        return filePaths[0];
      } else {
        return resolvePath(__dirname, '../../config/eslint.plugin.json');
      }
    }
  );

  const cli = new CLIEngine({
    configFile,
    fix,
  });

  const { errorCount, results, warningCount } = cli.executeOnFiles(await getTypescriptSources());

  if (errorCount > 0 || warningCount > 0) {
    const formatter = cli.getFormatter();
    console.log('\n');
    console.log(formatter(results));
    console.log('\n');
    throw new Error(`${errorCount + warningCount} linting errors found in ${results.length} files`);
  }
});

export const pluginBuildRunner: TaskRunner<PluginBuildOptions> = async ({ coverage }) => {
  await clean();
  await prepare();
  await lintPlugin({ fix: false });
  await testPlugin({ updateSnapshot: false, coverage, watch: false });
  await bundlePlugin({ watch: false, production: true });
};

export const pluginBuildTask = new Task<PluginBuildOptions>('Build plugin', pluginBuildRunner);
