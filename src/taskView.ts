/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import * as util from './util';

import {
	Event, EventEmitter, ExtensionContext, Task,
	TextDocument, ThemeIcon, TreeDataProvider, TreeItem, TreeItemCollapsibleState, Uri,
	WorkspaceFolder, commands, window, workspace, tasks, Selection, TaskGroup
} from 'vscode';
import { visit, JSONVisitor } from 'jsonc-parser';
import {
	NpmTaskDefinition, getPackageJsonUriFromTask, getScripts,
	isWorkspaceFolder, getTaskName, createTask, extractDebugArgFromScript, startDebugging
} from './tasks';
import * as nls from 'vscode-nls';

const localize = nls.loadMessageBundle();

class Folder extends TreeItem 
{
	packages: PackageJSON[] = [];
	tasks: TasksJSON[] = [];
	workspaceFolder: WorkspaceFolder;

	constructor(folder: WorkspaceFolder) {
		super(folder.name, TreeItemCollapsibleState.Expanded);
		this.contextValue = 'folder';
		this.resourceUri = folder.uri;
		this.workspaceFolder = folder;
		this.iconPath = ThemeIcon.Folder;
	}

	addPackage(packageJson: PackageJSON) {
		this.packages.push(packageJson);
	}

	addTasks(tasksJson: TasksJSON) {
		this.tasks.push(tasksJson);
	}
}

const packageName = 'package.json';

class PackageJSON extends TreeItem 
{
	path: string;
	folder: Folder;
	scripts: NpmScript[] = [];

	static getLabel(_folderName: string, relativePath: string): string {
		if (relativePath.length > 0) {
			return path.join(relativePath, packageName);
		}
		return packageName;
	}

	constructor(folder: Folder, relativePath: string) {
		super(PackageJSON.getLabel(folder.label!, relativePath), TreeItemCollapsibleState.Expanded);
		this.folder = folder;
		this.path = relativePath;
		this.contextValue = 'packageJSON';
		if (relativePath) {
			this.resourceUri = Uri.file(path.join(folder!.resourceUri!.fsPath, relativePath, packageName));
		} else {
			this.resourceUri = Uri.file(path.join(folder!.resourceUri!.fsPath, packageName));
		}
		this.iconPath = ThemeIcon.File;
	}

	addScript(script: NpmScript) {
		this.scripts.push(script);
	}
}

const tasksName = 'tasks.json';

class TasksJSON extends TreeItem 
{
	path: string;
	folder: Folder;
	scripts: TasksScript[] = [];

	static getLabel(_folderName: string, relativePath: string): string {
		if (relativePath.length > 0 && relativePath !== '.vscode') {
			return path.join(relativePath, tasksName);
		}
		return tasksName;
	}

	constructor(folder: Folder, relativePath: string) {
		super(TasksJSON.getLabel(folder.label!, relativePath), TreeItemCollapsibleState.Expanded);
		this.folder = folder;
		this.path = relativePath;
		this.contextValue = 'tasksJSON';
		if (relativePath) {
			this.resourceUri = Uri.file(path.join(folder!.resourceUri!.fsPath, relativePath, tasksName));
		} else {
			this.resourceUri = Uri.file(path.join(folder!.resourceUri!.fsPath, tasksName));
		}
		this.iconPath = ThemeIcon.File;
	}

	addScript(script: TasksScript) {
		this.scripts.push(script);
	}
}

type ExplorerCommands = 'open' | 'run';

class NpmScript extends TreeItem 
{
	task: Task;
	package: PackageJSON;
	
	constructor(context: ExtensionContext, packageJson: PackageJSON, task: Task) {
		super(task.name, TreeItemCollapsibleState.None);
		const command: ExplorerCommands = workspace.getConfiguration('taskView').get<ExplorerCommands>('tasksExplorerAction') || 'open';

		//{ 
		//	command: 'taskView.executeTask', 
		//	title: "Execute", arguments: [tasks[i]] 
	    //}

		const commandList = {
			'open': {
				title: 'Edit Script',
				command: 'taskView.openScript',
				arguments: [this]
			},
			'run': {
				title: 'Run Script',
				command: 'taskView.runScript',
				arguments: [this]
			}
		};
		this.contextValue = 'script';
		if (task.group && task.group === TaskGroup.Rebuild) {
			this.contextValue = 'debugScript';
		}
		this.package = packageJson;
		this.task = task;
		this.command = commandList[command];

		if (task.group && task.group === TaskGroup.Clean) {
			this.iconPath = {
				light: context.asAbsolutePath(path.join('res', 'light', 'prepostscript.svg')),
				dark: context.asAbsolutePath(path.join('res', 'dark', 'prepostscript.svg'))
			};
		} else {
			this.iconPath = {
				light: context.asAbsolutePath(path.join('res', 'light', 'script.svg')),
				dark: context.asAbsolutePath(path.join('res', 'dark', 'script.svg'))
			};
		}

		let uri = getPackageJsonUriFromTask(task);
		getScripts(uri!).then(scripts => {
			if (scripts && scripts[task.definition['script']]) {
				this.tooltip = scripts[task.definition['script']];
			}
		});
	}

	getFolder(): WorkspaceFolder {
		return this.package.folder.workspaceFolder;
	}
}


class TasksScript extends TreeItem 
{
	task: Task;
	package: TasksJSON;

	constructor(context: ExtensionContext, packageJson: TasksJSON, task: Task) 
	{
		super(task.name, TreeItemCollapsibleState.None);
		const command: ExplorerCommands = workspace.getConfiguration('taskView').get<ExplorerCommands>('tasksExplorerAction') || 'open';

		const commandList = {
			'open': {
				title: 'Edit Script',
				command: 'taskView.openScript',
				arguments: [this]
			},
			'run': {
				title: 'Run Script',
				command: 'taskView.runScript',
				arguments: [this]
			}
		};
		this.contextValue = 'script';
		if (task.group && task.group === TaskGroup.Rebuild) {
			this.contextValue = 'debugScript';
		}
		this.package = packageJson;
		this.task = task;
		this.command = commandList[command];

		if (task.group && task.group === TaskGroup.Clean) {
			this.iconPath = {
				light: context.asAbsolutePath(path.join('res', 'light', 'prepostscript.svg')),
				dark: context.asAbsolutePath(path.join('res', 'dark', 'prepostscript.svg'))
			};
		} else {
			this.iconPath = {
				light: context.asAbsolutePath(path.join('res', 'light', 'script.svg')),
				dark: context.asAbsolutePath(path.join('res', 'dark', 'script.svg'))
			};
		}

		let uri = getPackageJsonUriFromTask(task);
		getScripts(uri!).then(scripts => {
			if (scripts && scripts[task.definition['script']]) {
				this.tooltip = scripts[task.definition['script']];
			}
		});
	}

	getFolder(): WorkspaceFolder {
		return this.package.folder.workspaceFolder;
	}
}


class NoScripts extends TreeItem 
{
	constructor() {
		super(localize('noScripts', 'No scripts found'), TreeItemCollapsibleState.None);
		this.contextValue = 'noscripts';
	}
}


export class TaskTreeDataProvider implements TreeDataProvider<TreeItem>
 {
	private taskTree: Folder[] | PackageJSON[] | NoScripts[] | null = null;
	private extensionContext: ExtensionContext;
	private _onDidChangeTreeData: EventEmitter<TreeItem | null> = new EventEmitter<TreeItem | null>();
	readonly onDidChangeTreeData: Event<TreeItem | null> = this._onDidChangeTreeData.event;

	constructor(context: ExtensionContext) 
	{
		const subscriptions = context.subscriptions;
		this.extensionContext = context;
		subscriptions.push(commands.registerCommand('taskView.runScript', this.runScript, this));
		subscriptions.push(commands.registerCommand('taskView.debugScript', this.debugScript, this));
		subscriptions.push(commands.registerCommand('taskView.openScript', this.openScript, this));
		subscriptions.push(commands.registerCommand('taskView.refresh', this.refresh, this));
		subscriptions.push(commands.registerCommand('taskView.runInstall', this.runInstall, this));
	}


	private scriptIsValid(scripts: any, task: Task): boolean 
	{
		util.log('');
		util.log('Checking script validity');
		util.log('   task name = ' + task.name);

		for (const script in scripts) 
		{
			let label = getTaskName(script, task.definition.path);
			util.log('   label = ' + label);
			if (task.name === label) 
			{
				util.log('   found!');
				return true;
			}
		}

		util.log('   not found!');
		
		return false;
	}


	private async runScript(script: NpmScript) 
	{
		let task = script.task;
		let pkg = script.package;
		let uri = getPackageJsonUriFromTask(task);
		let scripts = await getScripts(uri!);

		if (!this.scriptIsValid(scripts, task)) {
			this.scriptNotValid(task);
			return;
		}
		tasks.executeTask(script.task);
	}

	
	private extractDebugArg(scripts: any, task: Task): [string, number] | undefined 
	{
		return extractDebugArgFromScript(scripts[task.name]);
	}

	private async debugScript(script: NpmScript) 
	{
		let task = script.task;
		let uri = getPackageJsonUriFromTask(task);
		let scripts = await getScripts(uri!);

		if (!this.scriptIsValid(scripts, task)) {
			this.scriptNotValid(task);
			return;
		}

		let debugArg = this.extractDebugArg(scripts, task);
		if (!debugArg) {
			let message = localize('noDebugOptions', 'Could not launch "{0}" for debugging because the scripts lacks a node debug option, e.g. "--inspect-brk".', task.name);
			let learnMore = localize('learnMore', 'Learn More');
			let ok = localize('ok', 'OK');
			let result = await window.showErrorMessage(message, { modal: true }, ok, learnMore);
			if (result === learnMore) {
				commands.executeCommand('vscode.open', Uri.parse('https://code.visualstudio.com/docs/nodejs/nodejs-debugging#_launch-configuration-support-for-npm-and-other-tools'));
			}
			return;
		}
		startDebugging(task.name, debugArg[0], debugArg[1], script.getFolder());
	}

	private scriptNotValid(task: Task) {
		let message = localize('scriptInvalid', 'Could not find the script "{0}". Try to refresh the view.', task.name);
		window.showErrorMessage(message);
	}

	private findScript(document: TextDocument, script?: NpmScript): number {
		let scriptOffset = 0;
		let inScripts = false;

		let visitor: JSONVisitor = {
			onError() {
				return scriptOffset;
			},
			onObjectEnd() {
				if (inScripts) {
					inScripts = false;
				}
			},
			onObjectProperty(property: string, offset: number, _length: number) {
				if (property === 'scripts') {
					inScripts = true;
					if (!script) { // select the script section
						scriptOffset = offset;
					}
				}
				else if (inScripts && script) {
					let label = getTaskName(property, script.task.definition.path);
					if (script.task.name === label) {
						scriptOffset = offset;
					}
				}
			}
		};
		visit(document.getText(), visitor);
		return scriptOffset;

	}


	private async runInstall(selection: PackageJSON) 
	{
		let uri: Uri | undefined = undefined;
		if (selection instanceof PackageJSON) {
			uri = selection.resourceUri;
		}
		if (!uri) {
			return;
		}
		let task = createTask('install', 'install', selection.folder.workspaceFolder, uri, []);
		tasks.executeTask(task);
	}


	private async openScript(selection: PackageJSON | NpmScript) 
	{
		let uri: Uri | undefined = undefined;
		if (selection instanceof PackageJSON) {
			uri = selection.resourceUri!;
		} else if (selection instanceof NpmScript) {
			uri = selection.package.resourceUri;
		}
		if (!uri) {
			return;
		}
		let document: TextDocument = await workspace.openTextDocument(uri);
		let offset = this.findScript(document, selection instanceof NpmScript ? selection : undefined);
		let position = document.positionAt(offset);
		await window.showTextDocument(document, { selection: new Selection(position, position) });
	}


	public refresh() 
	{
		this.taskTree = null;
		this._onDidChangeTreeData.fire();
	}


	getTreeItem(element: TreeItem): TreeItem 
	{
		return element;
	}


	getParent(element: TreeItem): TreeItem | null 
	{
		if (element instanceof Folder) {
			return null;
		}
		if (element instanceof PackageJSON || element instanceof TasksJSON) {
			return element.folder;
		}
		if (element instanceof NpmScript || element instanceof TasksScript) {
			return element.package;
		}
		if (element instanceof NoScripts) {
			return null;
		}
		return null;
	}


	async getChildren(element?: TreeItem): Promise<TreeItem[]> 
	{
		if (!this.taskTree) {
			//let taskItems = await tasks.fetchTasks({ type: 'npm' });
			let taskItems = await tasks.fetchTasks();
			if (taskItems) {
				this.taskTree = this.buildTaskTree(taskItems);
				if (this.taskTree.length === 0) {
					this.taskTree = [new NoScripts()];
				}
			}
		}
		if (element instanceof Folder) {
			return element.packages;
		}
		if (element instanceof PackageJSON || element instanceof TasksJSON) {
			return element.scripts;
		}
		if (element instanceof NpmScript || element instanceof TasksScript) {
			return [];
		}
		if (element instanceof NoScripts) {
			return [];
		}
		if (!element) {
			if (this.taskTree) {
				return this.taskTree;
			}
		}
		return [];
	}


	private isInstallTask(task: Task): boolean 
	{
		let fullName = getTaskName('install', task.definition.path);
		return fullName === task.name;
	}


	private buildTaskTree(tasks: Task[]): Folder[] | PackageJSON[] | NoScripts[] 
	{
		var taskCt = 0;
		let folders: Map<String, Folder> = new Map();
		let packages: Map<String, PackageJSON> = new Map();
		let vsctasks: Map<String, TasksJSON> = new Map();

		let folder = null;
		let packageJson = null;
		let tasksJson = null;
		
		tasks.forEach(each => 
		{
			if (isWorkspaceFolder(each.scope) && !this.isInstallTask(each)) 
			{
				taskCt++;

				folder = folders.get(each.scope.name);
				if (!folder) {
					folder = new Folder(each.scope);
					folders.set(each.scope.name, folder);
				}
				let definition: NpmTaskDefinition = <NpmTaskDefinition>each.definition;

				util.log('');
				util.log('Processing task ' + taskCt.toString() + ' of ' + tasks.length.toString());
				util.log('   type = ' + each.definition.type);	
				util.log('   source = ' + each.source);
				util.log('   scope.name = ' + each.scope.name);
				util.log('   scope.uri.path = ' + each.scope.uri.path);
				util.log('   scope.uri.fsPath = ' + each.scope.uri.fsPath);

				if (each.source === 'npm' && vscode.workspace.getConfiguration('taskView').get('enableNpmScripts') === true)
				{
					let relativePath = definition.path ? definition.path : '';
					let fullPath = path.join(each.scope.name, relativePath);

					packageJson = packages.get(fullPath);
					if (!packageJson) 
					{
						packageJson = new PackageJSON(folder, relativePath);
						folder.addPackage(packageJson);
						packages.set(fullPath, packageJson);
						util.log('   Added npm package file container');
					}
					let script = new NpmScript(this.extensionContext, packageJson, each);
					packageJson.addScript(script);
				}
				else if (each.source === 'Workspace' && each.definition.type === 'shell')
				{
					let relativePath = definition.path ? definition.path : '.vscode';
					let fullPath = path.join(each.scope.name, relativePath);

					packageJson = vsctasks.get(fullPath);
					if (!packageJson) 
					{
						packageJson = new TasksJSON(folder, relativePath);
						folder.addPackage(packageJson);
						vsctasks.set(fullPath, packageJson);
						util.log('   Added vscode tasks file container');
					}
					let script = new TasksScript(this.extensionContext, packageJson, each);
					packageJson.addScript(script);
				}
			}
		});

		//if (folders.size === 1) {
		//	return [...packages.values()];
		//}
		return [...folders.values()];
	}
}