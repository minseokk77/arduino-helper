/**
 * extension.ts — Arduino Helper 확장 진입점
 *
 * 모든 명령어를 등록하고 확장의 생명주기를 관리합니다.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { checkCliInstalled } from './arduino-cli';
import { selectBoard, selectPort, selectBoardAndPort, autoDetectBoardAndPort, getSerialPortOptions, selectPortByAddress } from './board-manager';
import { initCompiler, compile } from './compiler';
import { upload } from './uploader';
import { openSerialMonitor, closeSerialMonitor, sendDataToSerialMonitor, exportSerialLog, writeSerialInput, getSerialConnectionState } from './serial-monitor';
import { installLibrary, installCore } from './library-manager';
import { initStatusBar, updateStatusBar } from './status-bar';
import { updateState, loadWorkspaceState, getState } from './config';
import { ArduinoSidebarProvider } from './sidebar';
import { openExample } from './examples-manager';
import { installCliIfNeeded } from './auto-download';
import { ArduinoTaskProvider } from './task-provider';
import { openSerialPlotter } from './webviews/serial-plotter';
import { openSerialConsole } from './webviews/serial-console';
import { openManagerGUI } from './webviews/manager-gui';
import { generateDebugConfig } from './debugger';
import { updateAll } from './updater';
import { checkAndInstallDependencies } from './dependency-manager';
import { newSketch } from './sketch-manager';
import { ArduinoDocumentFormattingEditProvider } from './formatter';
import { initLibraryDetector } from './library-detector';

/**
 * 확장이 활성화될 때 호출됩니다.
 * @param context 확장 컨텍스트
 */
export async function activate(
    context: vscode.ExtensionContext
): Promise<void> {
    // arduino-cli 자동 다운로드 검사 및 수행
    let cliPath = await installCliIfNeeded(context);

    // 여전히 못 찾았다면, 기존 checkCliInstalled 로직으로 fallback 및 에러
    if (!cliPath) {
        const version = await checkCliInstalled();
        if (!version) {
            const action = await vscode.window.showErrorMessage(
                vscode.l10n.t('arduino-cli not found. Please install it and try again.'),
                vscode.l10n.t('Open Installation Guide')
            );
            if (action === vscode.l10n.t('Open Installation Guide')) {
                vscode.env.openExternal(
                    vscode.Uri.parse('https://arduino.github.io/arduino-cli/latest/installation/')
                );
            }
            return;
        }
    } else {
        // 우리가 직접 다운로드한 로컬 바이너리가 있다면 State에 강제 세팅 (config.ts가 이를 우선하도록 설계)
        updateState({ downloadedCliPath: cliPath });
    }

    // 작업 공간 설정 로딩
    loadWorkspaceState();

    // 설정: 자동 업데이트 체크
    const config = vscode.workspace.getConfiguration('arduino');
    if (config.get<boolean>('autoUpdate')) {
        // 비동기로 실행하여 확장의 빠른 활성화 방해 안 함
        updateAll().catch(e => console.error('Auto update failed:', e));
    }

    // arduino.json을 스캔하여 누락된 라이브러리 자동 설치
    checkAndInstallDependencies();

    // 컴파일러 및 상태바 초기화
    initCompiler(context);
    initStatusBar(context);

    // 포맷터 등록
    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider(
            'arduino', 
            new ArduinoDocumentFormattingEditProvider()
        )
    );

    // 누락 라이브러리 자동 감지 활성화
    initLibraryDetector(context);

    // 사이드바 등록 (Webview)
    const sidebarProvider = new ArduinoSidebarProvider(context);
    vscode.window.registerWebviewViewProvider('arduino-sidebar', sidebarProvider);

    // 환경설정(Board, Port)이 바뀔 때 사이드바 웹뷰도 업데이트
    vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('arduino.fqbn') || e.affectsConfiguration('arduino.port')) {
            sidebarProvider.updateState();
        }
    });

    // 태스크 제공자(TaskProvider) 등록 (Ctrl+Shift+B 연동)
    const taskProvider = vscode.tasks.registerTaskProvider(
        ArduinoTaskProvider.ArduinoType,
        new ArduinoTaskProvider()
    );
    context.subscriptions.push(taskProvider);

    // 명령어 등록
    const commands: Array<{
        id: string;
        handler: (...args: unknown[]) => unknown;
    }> = [
            {
                id: 'arduino.selectBoard',
                handler: async () => {
                    await selectBoard();
                    updateStatusBar();
                    sidebarProvider.updateState();
                },
            },
            {
                id: 'arduino.selectPort',
                handler: async () => {
                    await selectPort();
                    updateStatusBar();
                    sidebarProvider.updateState();
                },
            },
            {
                id: 'arduino.selectBoardAndPort',
                handler: async () => {
                    await selectBoardAndPort();
                    updateStatusBar();
                    sidebarProvider.updateState();
                },
            },

            {
                id: 'arduino.autoDetect',
                handler: async () => {
                    await autoDetectBoardAndPort();
                    updateStatusBar();
                    sidebarProvider.updateState();
                }
            },
            {
                id: 'arduino.compile',
                handler: compile,
            },
            {
                id: 'arduino.upload',
                handler: upload,
            },
            {
                "id": "arduino.serialMonitor",
                "handler": async (baudRate?: unknown) => {
                    await openSerialMonitor(typeof baudRate === 'number' ? baudRate : undefined);
                },
            },
            {
                "id": "arduino.serialPlotter",
                "handler": () => openSerialPlotter(context),
            },
            {
                "id": "arduino.serialConsole",
                "handler": () => openSerialConsole(
                    context,
                    writeSerialInput,
                    async (command, options) => {
                        if (command === 'openMonitor') {
                            if (options?.port) {
                                await selectPortByAddress(options.port);
                                updateStatusBar();
                                sidebarProvider.updateState();
                            }
                            await openSerialMonitor(options?.baudRate);
                        } else if (command === 'closeMonitor') {
                            closeSerialMonitor();
                        } else if (command === 'selectPort') {
                            await vscode.commands.executeCommand('arduino.selectPort');
                            updateStatusBar();
                            sidebarProvider.updateState();
                        } else if (command === 'selectPortAddress' && options?.port) {
                            await selectPortByAddress(options.port);
                            updateStatusBar();
                            sidebarProvider.updateState();
                        }
                    },
                    getSerialConnectionState,
                    getSerialPortOptions
                ),
            },
            {
                "id": "arduino.managerGUI",
                "handler": () => openManagerGUI(context),
            },
            {
                "id": "arduino.sendToSerial",
                handler: sendDataToSerialMonitor,
            },
            {
                "id": "arduino.generateDebugConfig",
                "handler": generateDebugConfig,
            },
            {
                id: 'arduino.exportSerialLog',
                handler: exportSerialLog,
            },
            {
                id: 'arduino.updateAll',
                handler: updateAll,
            },
            {
                id: 'arduino.installLibrary',
                handler: installLibrary,
            },
            {
                id: 'arduino.newSketch',
                handler: newSketch,
            },
            {
                id: 'arduino.installCore',
                handler: installCore,
            },
            {
                id: 'arduino.openExample',
                handler: openExample,
            }
        ];

    for (const cmd of commands) {
        const disposable = vscode.commands.registerCommand(cmd.id, cmd.handler);
        context.subscriptions.push(disposable);
    }
}

/**
 * 확장이 비활성화될 때 호출됩니다.
 */
export function deactivate(): void {
    closeSerialMonitor();
}
