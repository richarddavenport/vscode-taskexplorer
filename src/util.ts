import { logOutputChannel } from './extension';
import { workspace, RelativePattern, WorkspaceFolder, window, commands } from 'vscode';
import { accessSync } from 'original-fs';
import * as fs from 'fs';
import * as path from 'path';
import * as minimatch from 'minimatch';
import { configuration } from './common/configuration';

const logValueWhiteSpace = 40;

export interface IDisposable 
{
    dispose(): void;
}

export function done<T>(promise: Promise<T>): Promise<void> 
{
    return promise.then<void>(() => void 0);
}

export function dispose(disposables: any[]): any[] 
{
    disposables.forEach(disposable => disposable.dispose());
  
    return [];
}
  
export function combinedDisposable(disposables: IDisposable[]): IDisposable 
{
    return toDisposable(() => dispose(disposables));
}
  
export function toDisposable(dispose: () => void): IDisposable
{
    return { dispose };
}

export function isDescendant(parent: string, descendant: string): boolean 
{
    parent = parent.replace(/[\\\/]/g, path.sep);
    descendant = descendant.replace(/[\\\/]/g, path.sep);
  
    // IF Windows
    if (path.sep === "\\") {
      parent = parent.replace(/^\\/, "").toLowerCase();
      descendant = descendant.replace(/^\\/, "").toLowerCase();
    }
  
    if (parent === descendant) {
      return true;
    }
  
    if (parent.charAt(parent.length - 1) !== path.sep) {
      parent += path.sep;
    }
  
    return descendant.startsWith(parent);
}


export function camelCase(name: string, indexUpper: number) 
{
    if (!name) {
      return name;
    }

    return name
        .replace(/(?:^\w|[A-Za-z]|\b\w)/g, (letter, index) => {
            return index !== indexUpper ? letter.toLowerCase() : letter.toUpperCase();
        })
        .replace(/[\s\-]+/g, '');
}


export function properCase(name: string) 
{
    if (!name) {
      return name;
    }

    return name
        .replace(/(?:^\w|[A-Z]|\b\w)/g, (letter, index) => {
            return index !== 0 ? letter.toLowerCase() : letter.toUpperCase();
        })
        .replace(/[\s\-]+/g, '');
}


export function getExcludesGlob(folder: string | WorkspaceFolder) : RelativePattern
{
    let relativePattern = new RelativePattern(folder, '**/node_modules/**');
    let excludes: string[] = configuration.get('exclude');

    if (excludes && excludes.length > 0) {
        let multiFilePattern: string = '{**/node_modules/**';
        if (Array.isArray(excludes)) 
        {
            for (var i in excludes) {
                multiFilePattern += ',';
                multiFilePattern += excludes[i];
            }
        }
        else {
            multiFilePattern += ',';
            multiFilePattern += excludes;
        }
        multiFilePattern += '}';
        relativePattern = new RelativePattern(folder, multiFilePattern);
    }

    return relativePattern;
}


export function isExcluded(uriPath: string) 
{
    function testForExclusionPattern(path: string, pattern: string): boolean 
    {
        return minimatch(path, pattern, { dot: true, nocase: true });
    }

    let exclude = configuration.get<string | string[]>('exclude');

    this.log('', 2);
    this.log('Check exclusion', 2);
    this.logValue('   path', uriPath, 2);

    if (exclude) 
    {
        if (Array.isArray(exclude)) 
        {
            for (let pattern of exclude) {
                this.logValue('   checking pattern', pattern, 3);
                if (testForExclusionPattern(uriPath, pattern)) {
                    this.log('   Excluded!', 2);
                    return true;
                }
            }
        } 
        else {
            this.logValue('   checking pattern', exclude, 3);
            if (testForExclusionPattern(uriPath, exclude)) {
              this.log('   Excluded!', 2);
              return true;
            }
        }
    }

    this.log('   Not excluded', 2);
    return false;
}


export function timeout(ms: number) 
{
    return new Promise(resolve => setTimeout(resolve, ms));
}


export function pathExists(path: string) 
{
    try {
        accessSync(path);
    } catch (err) {
        return false;
    }
    return true;
}


export async function readFile(file: string): Promise<string> 
{
    return new Promise<string>((resolve, reject) => {
        fs.readFile(file, (err, data) => {
            if (err) {
                reject(err);
            }
            resolve(data.toString());
        });
    });
}


export function readFileSync(file: string)
{
    return fs.readFileSync(file).toString();
}


export async function removeFromArray(arr: any[], item: any)
{
    let idx: number = -1;
	let idx2: number = -1;

	arr.forEach(each => {
		idx++;
		if (item === each) {
			idx2 = idx;
		}
	});

	if (idx2 !== -1 && idx2 < arr.length) {
		arr.splice(idx2, 1);
	}
}


let hasDecorationProvider = false;
export function hasSupportToDecorationProvider() {
  return hasDecorationProvider;
}

try {
  const fake = {
    onDidChangeDecorations: (value: any): any => toDisposable(() => {}),
    provideDecoration: (uri: any, token: any): any => {}
  };
  const disposable = window.registerDecorationProvider(fake);
  hasDecorationProvider = true;
  // disposable.dispose(); // Not dispose to prevent: Cannot read property 'provideDecoration' of undefined
} catch (error) {}

let hasRegisterDiffCommand = false;
export function hasSupportToRegisterDiffCommand() {
  return hasRegisterDiffCommand;
}

try {
  const disposable = commands.registerDiffInformationCommand(
    "svn.testDiff",
    () => {}
  );
  hasRegisterDiffCommand = true;
  disposable.dispose();
} catch (error) {}


export async function log(msg: string, level?: number) 
{
    if (level && level > configuration.get<number>('debugLevel')) {
        return;
    }

    if (workspace.getConfiguration('taskExplorer').get('debug') === true) 
    {
        logOutputChannel.appendLine(msg);
    }
}


export async function logValue(msg: string, value: any, level?: number) 
{
    var logMsg = msg;

    if (level && level > configuration.get<number>('debugLevel')) {
        return;
    }

    for (var i = msg.length; i < logValueWhiteSpace; i++) {
        logMsg += ' ';
    }

    if (value || value === 0 || value === '') {
        logMsg += ': ';
        logMsg += value.toString();
    } 
    else if (value === undefined) {
        logMsg += ': undefined';
    } 
    else if (value === null) {
        logMsg += ': null';
    }

    if (workspace.getConfiguration('taskExplorer').get('debug') === true) {
        logOutputChannel.appendLine(logMsg);
    }
}
