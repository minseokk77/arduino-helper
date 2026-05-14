import * as vscode from 'vscode';

let currentPanel: vscode.WebviewPanel | undefined;
let sendHandler: ((text: string, lineEnding: 'none' | 'lf' | 'cr' | 'crlf') => boolean) | undefined;
type ConsoleCommand = 'openMonitor' | 'closeMonitor' | 'selectPort' | 'selectPortAddress' | 'refreshPorts';

interface SerialPortViewModel {
    address: string;
    label: string;
    boardName?: string;
    protocol?: string;
}

let commandHandler: ((command: ConsoleCommand, options?: { baudRate?: number; port?: string }) => void | Promise<void>) | undefined;
let statusProvider: (() => { connected: boolean; port?: string; baudRate?: number }) | undefined;
let portsProvider: (() => Promise<SerialPortViewModel[]>) | undefined;

export function openSerialConsole(
    context: vscode.ExtensionContext,
    onSend?: (text: string, lineEnding: 'none' | 'lf' | 'cr' | 'crlf') => boolean,
    onCommand?: (command: ConsoleCommand, options?: { baudRate?: number; port?: string }) => void | Promise<void>,
    getStatus?: () => { connected: boolean; port?: string; baudRate?: number },
    getPorts?: () => Promise<SerialPortViewModel[]>
): void {
    sendHandler = onSend;
    commandHandler = onCommand;
    statusProvider = getStatus;
    portsProvider = getPorts;

        if (currentPanel) {
        currentPanel.reveal(vscode.ViewColumn.Beside);
        postCurrentStatus();
        void postPorts();
        return;
    }

    currentPanel = vscode.window.createWebviewPanel(
        'arduinoSerialConsole',
        vscode.l10n.t('Arduino Serial Console'),
        vscode.ViewColumn.Beside,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
        }
    );

    currentPanel.onDidDispose(
        () => {
            currentPanel = undefined;
        },
        undefined,
        context.subscriptions
    );

    currentPanel.webview.html = getWebviewContent();
    currentPanel.webview.onDidReceiveMessage(async (message) => {
        if (message.type === 'ready') {
            postCurrentStatus();
            await postPorts();
            return;
        }

        if (message.type === 'exportLog' && typeof message.text === 'string') {
            await exportConsoleLog(message.text);
            return;
        }

        if (message.type === 'command' && commandHandler) {
            await commandHandler(message.command, {
                baudRate: message.baudRate,
                port: message.port,
            });
            postCurrentStatus();
            if (
                message.command === 'refreshPorts' ||
                message.command === 'selectPort' ||
                message.command === 'selectPortAddress'
            ) {
                await postPorts();
            }
            return;
        }

        if (message.type !== 'send' || typeof message.text !== 'string') {
            return;
        }

        const sent = sendHandler?.(message.text, message.lineEnding) ?? false;
        if (!sent) {
            vscode.window.showWarningMessage(vscode.l10n.t('Serial Monitor process is not running.'));
        }
    }, undefined, context.subscriptions);
}

function postCurrentStatus(): void {
    const status = statusProvider?.();
    if (status) {
        updateConsoleConnection(status.connected, status.port, status.baudRate);
    }
}

async function postPorts(): Promise<void> {
    const ports = await portsProvider?.();
    if (ports) {
        currentPanel?.webview.postMessage({ type: 'ports', ports });
    }
}

async function exportConsoleLog(text: string): Promise<void> {
    if (!text.trim()) {
        vscode.window.showInformationMessage(vscode.l10n.t('Serial log is empty.'));
        return;
    }

    const uri = await vscode.window.showSaveDialog({
        saveLabel: vscode.l10n.t('Export'),
        filters: {
            'Text Files': ['txt', 'log'],
            'All Files': ['*'],
        },
        defaultUri: vscode.Uri.file('arduino_serial_console.txt'),
    });

    if (!uri) {
        return;
    }

    await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
    vscode.window.showInformationMessage(vscode.l10n.t('Serial log exported successfully!'));
}

export function sendDataToConsole(data: string): void {
    currentPanel?.webview.postMessage({ type: 'rx', text: data });
}

export function sendTxToConsole(data: string): void {
    currentPanel?.webview.postMessage({ type: 'tx', text: data });
}

export function updateConsoleConnection(connected: boolean, port?: string, baudRate?: number): void {
    currentPanel?.webview.postMessage({ type: 'status', connected, port, baudRate });
}

function getWebviewContent(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Serial Console</title>
    <style>
        :root {
            color-scheme: light dark;
            --border: var(--vscode-panel-border);
            --muted: var(--vscode-descriptionForeground);
            --rx: var(--vscode-terminal-ansiGreen);
            --tx: var(--vscode-terminal-ansiCyan);
        }
        body {
            margin: 0;
            height: 100vh;
            display: grid;
            grid-template-rows: auto 1fr auto;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            font-family: var(--vscode-font-family);
        }
        .toolbar, .composer {
            display: flex;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
            padding: 10px;
            border-bottom: 1px solid var(--border);
        }
        .composer {
            border-top: 1px solid var(--border);
            border-bottom: 0;
        }
        .status {
            color: var(--muted);
            font-size: 12px;
            flex: 1 1 220px;
        }
        .log {
            overflow: auto;
            padding: 10px;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            white-space: pre-wrap;
            word-break: break-word;
        }
        .line {
            display: block;
            margin: 0 0 2px;
        }
        .rx::before { content: "RX "; color: var(--rx); font-weight: 700; }
        .tx::before { content: "TX "; color: var(--tx); font-weight: 700; }
        .hide-rx .rx, .hide-tx .tx { display: none; }
        input, select, button {
            font: inherit;
            color: var(--vscode-input-foreground);
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border, transparent);
            border-radius: 4px;
            padding: 6px 8px;
        }
        button {
            color: var(--vscode-button-foreground);
            background: var(--vscode-button-background);
            border: 0;
            cursor: pointer;
        }
        button:hover { background: var(--vscode-button-hoverBackground); }
        input { flex: 1; min-width: 80px; }
        .port-select { min-width: 220px; max-width: 360px; }
        label { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); font-size: 12px; }
    </style>
</head>
<body>
    <div class="toolbar">
        <div id="status" class="status">Disconnected</div>
        <select id="portSelect" class="port-select" title="Serial port">
            <option value="">No ports loaded</option>
        </select>
        <button id="refreshPorts">Refresh</button>
        <select id="baud" title="Baud rate">
            <option value="9600" selected>9600</option>
            <option value="19200">19200</option>
            <option value="38400">38400</option>
            <option value="57600">57600</option>
            <option value="115200">115200</option>
            <option value="230400">230400</option>
            <option value="460800">460800</option>
            <option value="921600">921600</option>
        </select>
        <button id="open">Open</button>
        <button id="close">Close</button>
        <button id="port">Port</button>
        <label><input id="pause" type="checkbox"> Pause</label>
        <label><input id="showRx" type="checkbox" checked> RX</label>
        <label><input id="showTx" type="checkbox" checked> TX</label>
        <label><input id="autoscroll" type="checkbox" checked> Autoscroll</label>
        <button id="clear">Clear</button>
        <button id="export">Export</button>
    </div>
    <main id="log" class="log"></main>
    <div class="composer">
        <input id="input" type="text" placeholder="Type serial input" />
        <select id="ending" title="Line ending">
            <option value="none">None</option>
            <option value="lf" selected>LF</option>
            <option value="cr">CR</option>
            <option value="crlf">CRLF</option>
        </select>
        <button id="send">Send</button>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const log = document.getElementById('log');
        const statusEl = document.getElementById('status');
        const portSelect = document.getElementById('portSelect');
        const input = document.getElementById('input');
        const ending = document.getElementById('ending');
        const baud = document.getElementById('baud');
        const pause = document.getElementById('pause');
        const showRx = document.getElementById('showRx');
        const showTx = document.getElementById('showTx');
        const autoscroll = document.getElementById('autoscroll');
        const history = [];
        let historyIndex = -1;

        function append(kind, text) {
            if (pause.checked && kind === 'rx') return;
            const line = document.createElement('span');
            line.className = 'line ' + kind;
            line.textContent = text.endsWith('\\n') ? text : text + '\\n';
            log.appendChild(line);
            while (log.childElementCount > 2000) log.firstElementChild.remove();
            if (autoscroll.checked) log.scrollTop = log.scrollHeight;
        }

        function send() {
            const text = input.value;
            if (!text) return;
            vscode.postMessage({ type: 'send', text, lineEnding: ending.value });
            history.unshift(text);
            history.splice(30);
            historyIndex = -1;
            input.value = '';
        }

        document.getElementById('send').addEventListener('click', send);
        document.getElementById('clear').addEventListener('click', () => log.textContent = '');
        document.getElementById('export').addEventListener('click', () => {
            const lines = Array.from(log.children).map((line) => line.textContent || '');
            vscode.postMessage({ type: 'exportLog', text: lines.join('') });
        });
        function selectedPort() {
            return portSelect.value || undefined;
        }

        document.getElementById('open').addEventListener('click', () => vscode.postMessage({ type: 'command', command: 'openMonitor', baudRate: Number(baud.value), port: selectedPort() }));
        document.getElementById('close').addEventListener('click', () => vscode.postMessage({ type: 'command', command: 'closeMonitor' }));
        document.getElementById('port').addEventListener('click', () => vscode.postMessage({ type: 'command', command: 'selectPort' }));
        document.getElementById('refreshPorts').addEventListener('click', () => vscode.postMessage({ type: 'command', command: 'refreshPorts' }));
        portSelect.addEventListener('change', () => {
            if (portSelect.value) {
                vscode.postMessage({ type: 'command', command: 'selectPortAddress', port: portSelect.value });
            }
        });
        showRx.addEventListener('change', () => log.classList.toggle('hide-rx', !showRx.checked));
        showTx.addEventListener('change', () => log.classList.toggle('hide-tx', !showTx.checked));
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                send();
            } else if (event.key === 'ArrowUp' && history.length) {
                event.preventDefault();
                historyIndex = Math.min(historyIndex + 1, history.length - 1);
                input.value = history[historyIndex];
            } else if (event.key === 'ArrowDown' && history.length) {
                event.preventDefault();
                historyIndex = Math.max(historyIndex - 1, -1);
                input.value = historyIndex >= 0 ? history[historyIndex] : '';
            }
        });

        window.addEventListener('message', (event) => {
            const message = event.data;
            if (message.type === 'rx' || message.type === 'tx') {
                append(message.type, message.text);
            } else if (message.type === 'ports') {
                const current = portSelect.value;
                portSelect.textContent = '';
                if (!message.ports.length) {
                    const option = document.createElement('option');
                    option.value = '';
                    option.textContent = 'No ports found';
                    portSelect.appendChild(option);
                    return;
                }

                for (const port of message.ports) {
                    const option = document.createElement('option');
                    option.value = port.address;
                    option.textContent = port.address + ' - ' + (port.boardName || port.label || 'Unknown board');
                    if (port.protocol) option.title = port.protocol;
                    portSelect.appendChild(option);
                }

                if (current && Array.from(portSelect.options).some((option) => option.value === current)) {
                    portSelect.value = current;
                }
            } else if (message.type === 'status') {
                statusEl.textContent = message.connected
                    ? 'Connected: ' + message.port + (message.baudRate ? ' @ ' + message.baudRate : '')
                    : 'Disconnected' + (message.port ? ': ' + message.port : '');
                if (message.baudRate) baud.value = String(message.baudRate);
                if (message.port) portSelect.value = message.port;
            }
        });

        vscode.postMessage({ type: 'ready' });
    </script>
</body>
</html>`;
}
