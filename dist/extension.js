module.exports =
/******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};
/******/
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/
/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId]) {
/******/ 			return installedModules[moduleId].exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			i: moduleId,
/******/ 			l: false,
/******/ 			exports: {}
/******/ 		};
/******/
/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/
/******/ 		// Flag the module as loaded
/******/ 		module.l = true;
/******/
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/
/******/
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;
/******/
/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;
/******/
/******/ 	// define getter function for harmony exports
/******/ 	__webpack_require__.d = function(exports, name, getter) {
/******/ 		if(!__webpack_require__.o(exports, name)) {
/******/ 			Object.defineProperty(exports, name, { enumerable: true, get: getter });
/******/ 		}
/******/ 	};
/******/
/******/ 	// define __esModule on exports
/******/ 	__webpack_require__.r = function(exports) {
/******/ 		if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 			Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 		}
/******/ 		Object.defineProperty(exports, '__esModule', { value: true });
/******/ 	};
/******/
/******/ 	// create a fake namespace object
/******/ 	// mode & 1: value is a module id, require it
/******/ 	// mode & 2: merge all properties of value into the ns
/******/ 	// mode & 4: return value when already ns object
/******/ 	// mode & 8|1: behave like require
/******/ 	__webpack_require__.t = function(value, mode) {
/******/ 		if(mode & 1) value = __webpack_require__(value);
/******/ 		if(mode & 8) return value;
/******/ 		if((mode & 4) && typeof value === 'object' && value && value.__esModule) return value;
/******/ 		var ns = Object.create(null);
/******/ 		__webpack_require__.r(ns);
/******/ 		Object.defineProperty(ns, 'default', { enumerable: true, value: value });
/******/ 		if(mode & 2 && typeof value != 'string') for(var key in value) __webpack_require__.d(ns, key, function(key) { return value[key]; }.bind(null, key));
/******/ 		return ns;
/******/ 	};
/******/
/******/ 	// getDefaultExport function for compatibility with non-harmony modules
/******/ 	__webpack_require__.n = function(module) {
/******/ 		var getter = module && module.__esModule ?
/******/ 			function getDefault() { return module['default']; } :
/******/ 			function getModuleExports() { return module; };
/******/ 		__webpack_require__.d(getter, 'a', getter);
/******/ 		return getter;
/******/ 	};
/******/
/******/ 	// Object.prototype.hasOwnProperty.call
/******/ 	__webpack_require__.o = function(object, property) { return Object.prototype.hasOwnProperty.call(object, property); };
/******/
/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "";
/******/
/******/
/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(__webpack_require__.s = 0);
/******/ })
/************************************************************************/
/******/ ([
/* 0 */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = void 0;
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = __webpack_require__(1);
//import * as builder from './build'; //removed until language server build starts
const fs = __webpack_require__(2);
const cp = __webpack_require__(3);
// import { commands, Disposable, ExtensionContext, TextEditor, window } from 'vscode';
// import { ActiveEditorTracker } from './activeEditorTracker';
// import { TextEditorComparer } from './comparers';
// import { WorkspaceState } from './constants';
// import { Logger } from './logger';
// import { ISavedEditor, SavedEditor } from './savedEditor';
var opener = __webpack_require__(4);
var iRiteChannel = vscode.window.createOutputChannel("iRite Information");
// The iRite build engine (Revolution's iRite_preprocessor.exe) only ships for Windows.
// On Linux/macOS we run it through Wine instead of exec'ing the .exe directly.
function engineInvocation(enginePath, args) {
    if (process.platform === "win32") {
        return { command: enginePath, args };
    }
    return { command: "wine", args: [enginePath, ...args] };
}
function isWineMissing(error) {
    return process.platform !== "win32" && error.code === "ENOENT";
}
// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
function activate(context) {
    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log("Congratulations, iRite is now active!");
    //check to see if the .exe is in specified path, if not display message to download revolution
    let enginePath = vscode.workspace
        .getConfiguration("irite")
        .get("build.enginePath", "");
    var optionRev = { title: "Get Revolution" };
    fs.stat(enginePath, function (err, stat) {
        if (err == null) {
            console.log("Revolution exists");
        }
        else if (err.code == "ENOENT") {
            // file does not exist
            vscode.window
                .showInformationMessage("Revolution can not be located, would you like to download it?", optionRev)
                .then(option => {
                if (typeof option == "undefined") {
                    return;
                }
                switch (option.title) {
                    case optionRev.title:
                        opener("https://www.ricelake.com/en-us/products/product-details/revolution-scale-software#/resources-downloads");
                        break;
                    default:
                        break;
                }
            });
        }
        else {
            console.log("Revolution Checker: ", err.code);
        }
    });
    //registercommands takes reference from package.json, alter that file for more/different commands
    vscode.commands.registerCommand("irite.build", () => {
        iRiteChannel.clear();
        vscode.workspace.saveAll().then(success => {
            if (success) {
                iRiteChannel.appendLine("All Files Saved");
                var openTextDoc;
                // async function save () {
                //   try {
                //     const editorTracker = new ActiveEditorTracker();
                //     let active = window.activeTextEditor;
                //     let editor = active;
                //     const openEditors: TextEditor[] = [];
                //     do {
                //         if (editor != null) {
                //             // If we didn't start with a valid editor, set one once we find it
                //             if (active === undefined) {
                //                 active = editor;
                //             }
                //             openEditors.push(editor);
                //         }
                //         editor = await editorTracker.awaitNext(500);
                //         if (editor !== undefined && openEditors.some(_ => TextEditorComparer.equals(_, editor, { useId: true, usePosition: true }))) break;
                //     } while ((active === undefined && editor === undefined) || !TextEditorComparer.equals(active, editor, { useId: true, usePosition: true }));
                //       editorTracker.dispose();
                //       const editors = openEditors
                //           .filter(_ => _.document !== undefined)
                //           .map(_ => {
                //               return {
                //                   uri: _.document.uri,
                //                   viewColumn: _.viewColumnnp
                //               } as ISavedEditor;
                //           });
                //       this.context.workspaceState.update(WorkspaceState.SavedDocuments, editors);
                //   }
                //   catch (ex) {
                //       Logger.error(ex, 'DocumentManager.save');
                //   }
                // }
                openTextDoc = vscode.window.activeTextEditor.document;
                iRiteChannel.appendLine("Open File: " + openTextDoc.fileName);
                iRiteChannel.show();
                vscode.window.showTextDocument(openTextDoc).then(srcEditor => {
                    checkEngineDefined().then(engineType => {
                        checkEnginePathDefined(engineType.toString()).then(engineParameters => {
                            //got engine path and compiler from config, now init active window and push to iRiteProcessor
                            //iRiteProcessor takes argument of desired .src file path
                            let enginePath = vscode.workspace
                                .getConfiguration("irite")
                                .get("build.enginePath", "");
                            let compilerPath = vscode.workspace
                                .getConfiguration("irite")
                                .get("build.compilerPath", "");
                            let filepath = openTextDoc.fileName;
                            iRiteChannel.appendLine("Building: " + filepath);
                            let invocation = engineInvocation(enginePath, [filepath, compilerPath, "build"]);
                            cp.execFile(invocation.command, invocation.args, function (error, data, stderr) {
                                if (error != null) {
                                    if (isWineMissing(error)) {
                                        iRiteChannel.appendLine("Compile Function ERROR: 'wine' was not found. Install Wine to run the iRite compiler on Linux/macOS (e.g. `sudo apt install wine`).");
                                    }
                                    iRiteChannel.appendLine("Compile Function ERROR: " + error + "  stderr:" + stderr + "|");
                                    console.log(error);
                                    console.log(stderr);
                                }
                                else {
                                    iRiteChannel.appendLine(data);
                                }
                            });
                        })
                            .catch(error => {
                            vscode.window.setStatusBarMessage("Error 112: " + error, 5000);
                            vscode.window.showErrorMessage("Open Folder to Build Properly");
                            iRiteChannel.appendLine("Error 114:  checkEnginePathDefined: " + error);
                        });
                    })
                        .catch(error => {
                        vscode.window.showErrorMessage("Error 118: " + error);
                        vscode.window.setStatusBarMessage("Error 119:  + checkEngineDefined: " + error, 5000);
                        iRiteChannel.appendLine("Error 120: checkEngineDefined: " + error);
                    });
                }, err => {
                    vscode.window.showErrorMessage("Error 124: " + err);
                    vscode.window.setStatusBarMessage("Error 125: " + err, 5000);
                    iRiteChannel.appendLine("Error 126: " + err);
                });
            }
            else {
                vscode.window.setStatusBarMessage("Error Saving Files SBMsg", 5000);
                vscode.window.showErrorMessage("Error Saving Files EM");
                iRiteChannel.append("\n\n*************************************\nError Saving Files.  Rectify and rebuild.\n*************************************\n\n");
            }
        }, reason => {
            vscode.window.showErrorMessage(reason + "\nUnable to Save!\n\n");
            vscode.window.setStatusBarMessage(reason + "\nUnable to Save!\n\n");
            iRiteChannel.append("*************************************\n" +
                "*************************************\n" +
                "Unable to Save!" +
                "*************************************\n" +
                "*************************************\n");
            iRiteChannel.append("\nError 171: Please open folder(workspace).\n");
        });
    });
    //registercommands takes reference from package.json, alter that file for more/different commands
    vscode.commands.registerCommand("irite.deploy", () => {
        // vscode.commands.executeCommand("irite.build");  // WOrry about this later :)
        checkEngineDefined()
            .then(engineType => {
            checkEnginePathDefined(engineType.toString())
                .then(engineParameters => {
                //got engine path and compiler from config, now init active window and push to iRiteProcessor
                //iRiteProcessor takes argument of desired .src file path
                let enginePath = vscode.workspace
                    .getConfiguration("irite")
                    .get("build.enginePath", "");
                let compilerPath = vscode.workspace
                    .getConfiguration("irite")
                    .get("build.compilerPath", "");
                let textEditor = vscode.window.activeTextEditor;
                iRiteChannel.append("*************************************\n" +
                    "*************************************\n" +
                    "iRite Deploying: " +
                    textEditor.document.fileName +
                    "\n");
                let filepath = textEditor.document.fileName;
                let invocation = engineInvocation(enginePath, [filepath, compilerPath, "deploy"]);
                cp.execFile(invocation.command, invocation.args, function (error, data, stderr) {
                    if (error != null && isWineMissing(error)) {
                        iRiteChannel.appendLine("Deploy Function ERROR: 'wine' was not found. Install Wine to run the iRite compiler on Linux/macOS (e.g. `sudo apt install wine`).");
                    }
                    if (stderr != null) {
                        console.log(error);
                        console.log(stderr);
                    }
                    iRiteChannel.append(data);
                });
            })
                .catch(error => {
                vscode.window.showErrorMessage(error);
                iRiteChannel.appendLine(error);
            });
        })
            .catch(error => {
            vscode.window.setStatusBarMessage("checkEngineDefined: " + error, 5000);
            iRiteChannel.appendLine("checkEngineDefined: " + error);
        });
    });
    function checkEngineDefined() {
        return new Promise((resolve, reject) => {
            let engineType = vscode.workspace
                .getConfiguration("irite")
                .get("build.engine", "");
            if (engineType == "") {
                var optionRev = {
                    title: "revolution"
                };
                var optionTest = {
                    title: "Test"
                };
                vscode.window
                    .showErrorMessage('The "irite.build.engine" setting is not defined. Do you want to download Revolution?', optionRev, optionTest)
                    .then(option => {
                    // nothing selected
                    if (typeof option == "undefined") {
                        reject("undefined");
                        return;
                    }
                    switch (option.title) {
                        case optionRev.title:
                            opener("https://www.ricelake.com/en-us/products/product-details/revolution-scale-software#/resources-downloads");
                            break;
                        case optionTest.title:
                            opener("http://www.ricelake.com");
                            break;
                        default:
                            break;
                    }
                    reject("hyperlink");
                });
            }
            else {
                resolve(engineType);
            }
        });
    }
    function checkEnginePathDefined(engine) {
        return new Promise((resolve, reject) => {
            let enginePath = vscode.workspace
                .getConfiguration("irite")
                .get("build.enginePath", "");
            if (enginePath == "") {
                reject('The "irite.build.enginePath" setting is not defined. Please configure.');
                return;
            }
            resolve(enginePath);
        });
    }
}
exports.activate = activate;


/***/ }),
/* 1 */
/***/ (function(module, exports) {

module.exports = require("vscode");

/***/ }),
/* 2 */
/***/ (function(module, exports) {

module.exports = require("fs");

/***/ }),
/* 3 */
/***/ (function(module, exports) {

module.exports = require("child_process");

/***/ }),
/* 4 */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

var childProcess = __webpack_require__(3);
var os = __webpack_require__(5);

module.exports = function opener(args, options, callback) {
    var platform = process.platform;

    // Attempt to detect Windows Subystem for Linux (WSL). WSL  itself as Linux (which works in most cases), but in
    // this specific case we need to treat it as actually being Windows. The "Windows-way" of opening things through
    // cmd.exe works just fine here, whereas using xdg-open does not, since there is no X Windows in WSL.
    if (platform === "linux" && os.release().indexOf("Microsoft") !== -1) {
        platform = "win32";
    }

    // http://stackoverflow.com/q/1480971/3191, but see below for Windows.
    var command;
    switch (platform) {
        case "win32": {
            command = "cmd.exe";
            break;
        }
        case "darwin": {
            command = "open";
            break;
        }
        default: {
            command = "xdg-open";
            break;
        }
    }

    if (typeof args === "string") {
        args = [args];
    }

    if (typeof options === "function") {
        callback = options;
        options = {};
    }

    if (options && typeof options === "object" && options.command) {
        if (platform === "win32") {
            // *always* use cmd on windows
            args = [options.command].concat(args);
        } else {
            command = options.command;
        }
    }

    if (platform === "win32") {
        // On Windows, we really want to use the "start" command. But, the rules regarding arguments with spaces, and
        // escaping them with quotes, can get really arcane. So the easiest way to deal with this is to pass off the
        // responsibility to "cmd /c", which has that logic built in.
        //
        // Furthermore, if "cmd /c" double-quoted the first parameter, then "start" will interpret it as a window title,
        // so we need to add a dummy empty-string window title: http://stackoverflow.com/a/154090/3191
        //
        // Additionally, on Windows ampersand and caret need to be escaped when passed to "start"
        args = args.map(function (value) {
            return value.replace(/[&^]/g, "^$&");
        });
        args = ["/c", "start", "\"\""].concat(args);
    }

    return childProcess.execFile(command, args, options, callback);
};


/***/ }),
/* 5 */
/***/ (function(module, exports) {

module.exports = require("os");

/***/ })
/******/ ]);
//# sourceMappingURL=extension.js.map