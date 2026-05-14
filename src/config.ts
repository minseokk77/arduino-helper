/**
 * config.ts — Arduino Helper 확장 설정 관리 모듈
 *
 * VS Code 설정에서 arduino-cli 경로, 보드레이트 등을 읽어오고
 * 워크스페이스별 보드/포트 상태를 관리합니다.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/** 확장의 전체 설정 구조 */
export interface ArduinoConfig {
    /** arduino-cli 실행 파일 경로 */
    cliPath: string;
    /** 시리얼 모니터 기본 보드레이트 */
    defaultBaudRate: number;
    /** USB 연결 시 보드 자동 감지 여부 */
    autoDetectBoard: boolean;
    serialLineEnding: 'none' | 'lf' | 'cr' | 'crlf';
}

/** 런타임 상태 (현재 선택된 보드/포트) */
export interface ArduinoState {
    /** 현재 선택된 FQBN (Fully Qualified Board Name) */
    selectedFqbn: string | undefined;
    /** 현재 선택된 포트 (예: COM3) */
    selectedPort: string | undefined;
    /** 현재 선택된 보드 이름 (표시용) */
    selectedBoardName: string | undefined;
    /** 런타임에 다운로드한 arduino-cli 경로 (설정보다 우선함) */
    downloadedCliPath: string | undefined;
}

/** 전역 런타임 상태 */
const state: ArduinoState = {
    selectedFqbn: undefined,
    selectedPort: undefined,
    selectedBoardName: undefined,
    downloadedCliPath: undefined,
};

/**
 * VS Code 설정에서 Arduino 확장 설정을 읽어옵니다.
 * @returns 현재 설정 값
 */
export function getConfig(): ArduinoConfig {
    const config = vscode.workspace.getConfiguration('arduino');
    return {
        cliPath: state.downloadedCliPath || config.get<string>('cliPath', 'arduino-cli'),
        defaultBaudRate: config.get<number>('defaultBaudRate', 9600),
        autoDetectBoard: config.get<boolean>('autoDetectBoard', true),
        serialLineEnding: config.get<'none' | 'lf' | 'cr' | 'crlf'>('serialLineEnding', 'lf'),
    };
}

/**
 * 현재 런타임 상태를 반환합니다.
 */
export function getState(): ArduinoState {
    return { ...state };
}

/**
 * Sidebar 대시보드 표시를 위해 저장된 보드 및 포트 설정을 반환합니다.
 */
export function getBoardState(): { fqbn: string | undefined; port: string | undefined; boardName: string | undefined } {
    const config = vscode.workspace.getConfiguration('arduino');
    return {
        fqbn: config.get<string>('fqbn'),
        port: config.get<string>('port'),
        boardName: config.get<string>('boardName')
    };
}

/**
 * 런타임 상태를 업데이트합니다.
 * @param updates 변경할 필드들
 */
export function updateState(updates: Partial<ArduinoState>): void {
    Object.assign(state, updates);
    saveWorkspaceState();
}

/**
 * 워크스페이스에서 로컬 설정(.vscode/arduino-helper.json)을 로드합니다.
 */
export function loadWorkspaceState(): void {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return;
    }

    const vscodeDir = path.join(workspaceFolders[0].uri.fsPath, '.vscode');
    const settingsFile = path.join(vscodeDir, 'arduino-helper.json');

    if (fs.existsSync(settingsFile)) {
        try {
            const data = fs.readFileSync(settingsFile, 'utf8');
            const parsed = JSON.parse(data) as Partial<ArduinoState>;
            Object.assign(state, parsed);
        } catch (e) {
            console.error('Failed to parse workspace arduino-helper.json:', e);
        }
    }
}

/**
 * 현재 상태를 로컬 설정(.vscode/arduino-helper.json)에 저장합니다.
 */
export function saveWorkspaceState(): void {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return;
    }

    const vscodeDir = path.join(workspaceFolders[0].uri.fsPath, '.vscode');
    const settingsFile = path.join(vscodeDir, 'arduino-helper.json');

    try {
        if (!fs.existsSync(vscodeDir)) {
            fs.mkdirSync(vscodeDir, { recursive: true });
        }

        // 민감하지 않은 정보만 저장
        const stateToSave = {
            selectedFqbn: state.selectedFqbn,
            selectedPort: state.selectedPort,
            selectedBoardName: state.selectedBoardName
        };

        fs.writeFileSync(settingsFile, JSON.stringify(stateToSave, null, 4), 'utf8');
    } catch (e) {
        console.error('Failed to save workspace arduino-helper.json:', e);
    }
}
