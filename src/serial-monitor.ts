/**
 * serial-monitor.ts — 시리얼 모니터
 *
 * VS Code Terminal API를 사용하여 arduino-cli monitor 를 실행합니다.
 */
import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import { getConfig, getState } from './config';
import { sendDataToPlotter } from './webviews/serial-plotter';
import { sendDataToConsole, sendTxToConsole, updateConsoleConnection } from './webviews/serial-console';

/** 활성 시리얼 모니터 터미널 탭 (export 하여 외부에서도 닫을 수 있게) */
export let monitorTerminal: vscode.Terminal | undefined;
/** 내부 arduino-cli 프로세스 */
let monitorProcess: ChildProcess | undefined;
let activePort: string | undefined;
let activeBaudRate: number | undefined;

/** 내보내기용 시리얼 로그 버퍼 (최대 5000 청크 유지) */
export const serialLogBuffer: string[] = [];

const serialInputHistory: string[] = [];
const maxSerialInputHistory = 20;

export type SerialLineEnding = 'none' | 'lf' | 'cr' | 'crlf';

function appendSerialLineEnding(input: string, lineEnding?: SerialLineEnding): string {
    const ending = lineEnding ?? getConfig().serialLineEnding;

    switch (ending) {
        case 'none':
            return input;
        case 'cr':
            return `${input}\r`;
        case 'crlf':
            return `${input}\r\n`;
        case 'lf':
        default:
            return `${input}\n`;
    }
}

function rememberSerialInput(input: string): void {
    const trimmed = input.trim();
    if (!trimmed) {
        return;
    }

    const existingIndex = serialInputHistory.indexOf(input);
    if (existingIndex >= 0) {
        serialInputHistory.splice(existingIndex, 1);
    }

    serialInputHistory.unshift(input);
    if (serialInputHistory.length > maxSerialInputHistory) {
        serialInputHistory.pop();
    }
}

async function pickSerialInput(): Promise<string | undefined> {
    if (serialInputHistory.length === 0) {
        return vscode.window.showInputBox({
            prompt: vscode.l10n.t('Enter text to send to the Serial Monitor'),
            placeHolder: vscode.l10n.t('e.g.: AT, HELLO...'),
        });
    }

    const selected = await vscode.window.showQuickPick(
        [
            {
                label: `$(edit) ${vscode.l10n.t('Type new serial input')}`,
                value: undefined,
            },
            ...serialInputHistory.map((value) => ({
                label: value,
                description: vscode.l10n.t('Recent serial input'),
                value,
            })),
        ],
        {
            placeHolder: vscode.l10n.t('Send text/data to the connected Serial Monitor.'),
            matchOnDescription: true,
        }
    );

    if (!selected) {
        return undefined;
    }

    if (selected.value !== undefined) {
        return selected.value;
    }

    return vscode.window.showInputBox({
        prompt: vscode.l10n.t('Enter text to send to the Serial Monitor'),
        placeHolder: vscode.l10n.t('e.g.: AT, HELLO...'),
        value: serialInputHistory[0] ?? '',
        valueSelection: [0, serialInputHistory[0]?.length ?? 0],
    });
}

export function isSerialMonitorRunning(): boolean {
    return Boolean(monitorProcess?.stdin);
}

export function getSerialConnectionState(): { connected: boolean; port?: string; baudRate?: number } {
    return {
        connected: isSerialMonitorRunning(),
        port: activePort,
        baudRate: activeBaudRate,
    };
}

export function writeSerialInput(input: string, lineEnding?: SerialLineEnding): boolean {
    if (!monitorProcess?.stdin) {
        return false;
    }

    rememberSerialInput(input);
    monitorProcess.stdin.write(appendSerialLineEnding(input, lineEnding));
    sendTxToConsole(input);
    return true;
}


/**
 * 시리얼 모니터를 엽니다.
 * 이미 열려있으면 기존 터미널을 활성화합니다.
 */
export async function openSerialMonitor(baudRateOverride?: number): Promise<void> {
    let state = getState();
    const config = getConfig();

    if (!state.selectedPort) {
        const action = await vscode.window.showWarningMessage(
            vscode.l10n.t('No port selected.'),
            vscode.l10n.t('Select Port')
        );
        if (action === vscode.l10n.t('Select Port')) {
            await vscode.commands.executeCommand('arduino.selectPort');
            state = getState();
            if (!state.selectedPort) {
                return;
            }
        } else {
            return;
        }
    }

    // 보드레이트 선택 (QuickPick)
    const baudRates = [
        '9600',
        '19200',
        '38400',
        '57600',
        '115200',
        '230400',
        '460800',
        '921600',
    ];

    const selectedBaud = baudRateOverride
        ? String(baudRateOverride)
        : await vscode.window.showQuickPick(baudRates, {
            placeHolder: vscode.l10n.t('Select baud rate (default: {0})', config.defaultBaudRate),
        });

    const baudRate = selectedBaud ? parseInt(selectedBaud, 10) : config.defaultBaudRate;

    // 기존 시리얼 모니터 터미널이 있으면 종료
    if (monitorTerminal) {
        closeSerialMonitor();
    }

    const cliPath = config.cliPath;
    const args = [
        'monitor',
        '-p',
        state.selectedPort,
        '--config',
        `baudrate=${baudRate}`,
    ];

    // 가상 터미널 (Pseudoterminal)을 생성하여 arduino-cli 출력 가로채기
    const pty = new SerialMonitorPty(cliPath, args, state.selectedPort);

    monitorTerminal = vscode.window.createTerminal({
        name: vscode.l10n.t('Serial ({0})', state.selectedPort),
        pty: pty,
        iconPath: new vscode.ThemeIcon('plug'),
    });

    monitorTerminal.show();
    activePort = state.selectedPort;
    activeBaudRate = baudRate;
    updateConsoleConnection(true, state.selectedPort, baudRate);

    // 터미널이 닫히면 정리
    vscode.window.onDidCloseTerminal((terminal) => {
        if (terminal === monitorTerminal) {
            monitorTerminal = undefined;
            if (monitorProcess) {
                monitorProcess.kill();
                monitorProcess = undefined;
            }
            activePort = undefined;
            activeBaudRate = undefined;
            updateConsoleConnection(false);
        }
    });
}

/**
 * 시리얼 모니터를 강제 종료합니다.
 */
export function closeSerialMonitor(): void {
    if (monitorProcess) {
        monitorProcess.kill();
        monitorProcess = undefined;
    }
    activePort = undefined;
    activeBaudRate = undefined;
    if (monitorTerminal) {
        monitorTerminal.dispose();
        monitorTerminal = undefined;
    }
    updateConsoleConnection(false);
}

/**
 * 시리얼 모니터가 열려있을 때 보드로 데이터를 보냅니다 (TX).
 */
export async function sendDataToSerialMonitor(): Promise<void> {
    if (!monitorProcess) {
        vscode.window.showWarningMessage(vscode.l10n.t('Serial Monitor process is not running.'));
        return;
    }

    const input = await pickSerialInput();

    if (input !== undefined) {
        // stdin으로 데이터 밀어넣기 (아두이노의 경우 주로 LF 또는 CRLF를 끝에 요구)
        writeSerialInput(input);
    }
}

/**
 * 시리얼 로그를 파일로 내보냅니다.
 */
export async function exportSerialLog(): Promise<void> {
    if (serialLogBuffer.length === 0) {
        vscode.window.showInformationMessage(vscode.l10n.t('Serial log is empty.'));
        return;
    }

    const uri = await vscode.window.showSaveDialog({
        saveLabel: vscode.l10n.t('Export'),
        filters: {
            'Text Files': ['txt', 'csv', 'log'],
            'All Files': ['*']
        },
        defaultUri: vscode.Uri.file('arduino_serial_log.txt')
    });

    if (uri) {
        const content = serialLogBuffer.join('');
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
        vscode.window.showInformationMessage(vscode.l10n.t('Serial log exported successfully!'));
    }
}

/**
 * Pseudoterminal (가상 터미널) 제어 객체
 * VS Code의 터미널 UI와 Node.js의 ChildProcess 연결
 */
class SerialMonitorPty implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    private closeEmitter = new vscode.EventEmitter<number>();
    private isNewLine = true;

    onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    onDidClose?: vscode.Event<number> = this.closeEmitter.event;

    constructor(private cliPath: string, private args: string[], private port: string) { }

    open(initialDimensions: vscode.TerminalDimensions | undefined): void {
        this.writeEmitter.fire(`\x1b[32m[Arduino Helper] Connecting to ${this.port}...\x1b[0m\r\n`);

        monitorProcess = spawn(this.cliPath, this.args, {
            env: { ...process.env },
            windowsHide: true,
        });

        monitorProcess.stdout?.on('data', (data: Buffer) => {
            const vscodeConfig = vscode.workspace.getConfiguration('arduino');
            const useHex = vscodeConfig.get<boolean>('serialHexView', false);
            const useTimestamps = vscodeConfig.get<boolean>('serialTimestamps', false);

            let outputStr = '';

            if (useHex) {
                // Hex 뷰: 0A 1F 2B 형식
                outputStr = Array.from(data).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ') + ' ';
            } else {
                const str = data.toString();
                if (useTimestamps) {
                    const now = new Date();
                    const ts = `\x1b[90m[${now.toISOString().replace('T', ' ').replace('Z', '')}]\x1b[0m `;
                    
                    // 청크 단위 데이터에서 줄바꿈 이후에만 타임스탬프가 붙도록 처리
                    for (let i = 0; i < str.length; i++) {
                        if (this.isNewLine) {
                            outputStr += ts;
                            this.isNewLine = false;
                        }
                        outputStr += str[i];
                        if (str[i] === '\n') {
                            this.isNewLine = true;
                        }
                    }
                } else {
                    outputStr = str;
                }
            }

            // 저장용 버퍼에 추가 (ANSI 컬러 코드 제거)
            const plainText = outputStr.replace(/\x1b\[[0-9;]*m/g, '');
            serialLogBuffer.push(plainText);
            if (serialLogBuffer.length > 5000) {
                serialLogBuffer.shift();
            }

            // 터미널에는 줄바꿈 보정을 위해 LF를 CRLF로 변경하여 출력
            this.writeEmitter.fire(outputStr.replace(/\r?\n/g, '\r\n'));

            // 시리얼 플로터로 데이터 브로드캐스트 (기존 문자열 그대로)
            sendDataToPlotter(data.toString());
            sendDataToConsole(data.toString());
        });

        monitorProcess.stderr?.on('data', (data: Buffer) => {
            const str = data.toString();
            this.writeEmitter.fire(`\x1b[31m${str.replace(/\r?\n/g, '\r\n')}\x1b[0m`);
        });

        monitorProcess.on('close', (code) => {
            this.writeEmitter.fire(`\r\n\x1b[31m[Arduino Helper] Disconnected (Exit Code: ${code})\x1b[0m\r\n`);
            monitorProcess = undefined;
            activePort = undefined;
            activeBaudRate = undefined;
            updateConsoleConnection(false, this.port);
        });

        monitorProcess.on('error', (err) => {
            this.writeEmitter.fire(`\r\n\x1b[31m[Error] Failed to start monitor: ${err.message}\x1b[0m\r\n`);
            monitorProcess = undefined;
            activePort = undefined;
            activeBaudRate = undefined;
            updateConsoleConnection(false, this.port);
        });
    }

    close(): void {
        // 터미널 탭이 닫히면 프로세스 강제 킬
        if (monitorProcess) {
            monitorProcess.kill();
            monitorProcess = undefined;
        }
    }

    private inputBuffer = '';

    handleInput(data: string): void {
        if (!monitorProcess || !monitorProcess.stdin) {
            return;
        }

        // 터미널 에코 (사용자 입력을 화면에 표시)
        if (data === '\r') {
            this.writeEmitter.fire('\r\n');
            // 엔터 입력 시 버퍼 내용을 시리얼로 전송 (아두이노의 경우 주로 LF로 끝남)
            writeSerialInput(this.inputBuffer);
            this.inputBuffer = '';
        } else if (data === '\x7f') { // 백스페이스(Backspace) 처리
            if (this.inputBuffer.length > 0) {
                this.inputBuffer = this.inputBuffer.slice(0, -1);
                this.writeEmitter.fire('\b \b');
            }
        } else {
            this.inputBuffer += data;
            this.writeEmitter.fire(data);
        }
    }
}
