
import {
    Task, TaskGroup, WorkspaceFolder, RelativePattern, ShellExecution, Uri,
    workspace, TaskProvider, TaskDefinition
} from 'vscode';
import * as path from 'path';
import * as util from './util';
import { visit, JSONVisitor } from 'jsonc-parser';
import { TaskItem } from './taskItem';
type StringMap = { [s: string]: string; };

let cachedTasks: Task[] = undefined;


interface YarnTaskDefinition extends TaskDefinition 
{
	script?: string;
	path?: string;
	fileName?: string;
	uri?: Uri;
	treeItem?: TaskItem;
}

export class YarnTaskProvider implements TaskProvider 
{
	constructor() {
	}

	public provideTasks() {
		return provideYarnfiles();
	}

	public resolveTask(_task: Task): Task | undefined {
		return undefined;
	}
}


export async function invalidateTasksCacheYarn(opt?: Uri) : Promise<void> 
{
	util.log('');
	util.log('invalidateTasksCacheYarn');

	if (opt && cachedTasks) 
	{
		let rmvTasks: Task[] = [];
		let uri: Uri = opt as Uri;

		cachedTasks.forEach(each => {
			let cstDef: YarnTaskDefinition = each.definition;
			if (cstDef.uri.fsPath === opt.fsPath) {
				rmvTasks.push(each);
			}
		});

		rmvTasks.forEach(each => {
			util.log('   removing old task ' + each.name);
			util.removeFromArray(cachedTasks, each);
		});

		if (util.pathExists(opt.fsPath))
		{
			let tasks = await readYarnfile(opt);
			cachedTasks.push(...tasks);
		}

		if (cachedTasks.length > 0) {
			return;
		}
	}

	cachedTasks = undefined;
}


async function provideYarnfiles(): Promise<Task[]> 
{
	if (!cachedTasks) {
		cachedTasks = await detectYarnfiles();
	}
	return cachedTasks;
}


async function detectYarnfiles(): Promise<Task[]> 
{

	let emptyTasks: Task[] = [];
	let allTasks: Task[] = [];
	let visitedFiles: Set<string> = new Set();

	let folders = workspace.workspaceFolders;
	if (!folders) {
		return emptyTasks;
	}
	try {
		for (const folder of folders) 
		{
			//
			// Note - pattern will ignore Yarnfiles in root project dir, which would be picked
			// up by VSCoces internal Yarn task provider
			//
			let relativePattern = new RelativePattern(folder, '**/[Pp][Aa][Cc][Kk][Aa][Gg][Ee].[Jj][Ss][Oo][Nn]');
			let paths = await workspace.findFiles(relativePattern, util.getExcludesGlob(folder));
			for (const fpath of paths) 
			{
				if (!util.isExcluded(fpath.path) && !visitedFiles.has(fpath.fsPath)) {
					let tasks = await readYarnfile(fpath);
					visitedFiles.add(fpath.fsPath);
					allTasks.push(...tasks);
				}
			}
		}
		return allTasks;
	} catch (error) {
		return Promise.reject(error);
	}
}


async function readYarnfile(uri: Uri): Promise<Task[]> 
{
	let emptyTasks: Task[] = [];

	let folder = workspace.getWorkspaceFolder(uri);
	if (!folder) {
		return emptyTasks;
    }
    
    let scripts = await findTargets(uri.fsPath);
	if (!scripts) {
		return emptyTasks;
	}

	const result: Task[] = [];

	Object.keys(scripts).forEach(each => {
		const task = createYarnTask(each, `${each}`, folder!, uri);
		if (task) {
			task.group = TaskGroup.Build;
			result.push(task);
		}
	});

	return result;
}


async function findTargets(fsPath: string): Promise<StringMap> 
{
	let scriptOffset = 0;
	let inScripts = false;
	let inTasks = false;
	let inTaskLabel = undefined;
	let documentText = await util.readFile(fsPath);
	let scripts: StringMap = {};
	let script: string;

	util.log('');
	util.log('Find Yarnfile targets');

	let visitor: JSONVisitor = {
		onError() 
		{
			return scriptOffset;
		},
		onObjectEnd() 
		{
			if (inScripts) {
				inScripts = false;
			}
		},
		onLiteralValue(value: any, offset: number, _length: number) 
		{
			if (inScripts) {
				scripts[script] = value;
			}
			else if (inTaskLabel) {
				if (typeof value === 'string') {
					if (inTaskLabel === 'label') {
						scripts[script] = value;
					}
				}
				inTaskLabel = undefined;
			}
		},
		onObjectProperty(property: string, offset: number, _length: number) 
		{
			if (property === 'scripts') {
				inScripts = true;
			}
			else if (inScripts) {
				script = property;
			}
			else if (property === 'tasks') {
				inTasks = true;
				if (!inTaskLabel) { // select the script section
					scriptOffset = offset;
				}
			}
			else if (property === 'label' && inTasks && !inTaskLabel) {
				inTaskLabel = 'label';
				if (!inTaskLabel) { // select the script section
					scriptOffset = offset;
				}
			}
			else { // nested object which is invalid, ignore the script
				inTaskLabel = undefined;
			}
		}
	};

	visit(documentText, visitor);

	util.log('   done');

	return scripts;
}


function createYarnTask(target: string, cmd: string, folder: WorkspaceFolder, uri: Uri): Task 
{
	function getCommand(folder: WorkspaceFolder, relativePath: string, cmd: string): string 
	{
		let yarn = 'yarn';
		//let yarn = folder.uri.fsPath + "/node_modules/.bin/Yarn";
		//if (process.platform === 'win32') {
		//	yarn = folder.uri.fsPath + "\\node_modules\\.bin\\Yarn.cmd";
		//}
		//if (relativePath) {
		//	yarn += (' --yarnfile ' + path.join(relativePath, 'Yarnfile.js'));
		//}

		//if (workspace.getConfiguration('taskExplorer').get('pathToYarn')) {
		//	yarn = workspace.getConfiguration('taskExplorer').get('pathToYarn');
		//}
 
		return yarn; 
	}

	function getRelativePath(folder: WorkspaceFolder, uri: Uri): string 
	{
		if (folder) {
			let rootUri = folder.uri;
			let absolutePath = uri.path.substring(0, uri.path.lastIndexOf('/') + 1);
			return absolutePath.substring(rootUri.path.length + 1);
		}
		return '';
	}
	
	let kind: YarnTaskDefinition = {
		type: 'yarn',
		script: target,
		path: '',
		fileName: path.basename(uri.path),
		uri: uri
	};

	let relativePath = getRelativePath(folder, uri);
	if (relativePath.length) {
		kind.path = relativePath;
	}
	let cwd = path.dirname(uri.fsPath);

	let args = [ getCommand(folder, relativePath, cmd), target ];
	let options = {
		"cwd": cwd
	};

	let execution = new ShellExecution('npx', args, options);

	return new Task(kind, folder, target, 'yarn', execution, undefined);
}
