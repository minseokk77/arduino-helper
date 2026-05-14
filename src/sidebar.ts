import * as vscode from 'vscode';
import { getState } from './config';
import { onDidCompile } from './compiler';

export class ArduinoSidebarProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;

    constructor(private readonly _context: vscode.ExtensionContext) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        webviewContext: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._context.extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'execute':
                    vscode.commands.executeCommand(message.id);
                    break;
                case 'refreshState':
                    this.updateState();
                    break;
            }
        });

        // Initialize state
        this.updateState();

        // Listen for compile memory statistics
        this._context.subscriptions.push(
            onDidCompile.event(mem => {
                if (this._view) {
                    this._view.webview.postMessage({
                        command: 'updateMemory',
                        memory: mem
                    });
                }
            })
        );
    }

    public updateState() {
        if (!this._view) {
            return;
        }
        
        const state = getState();
        let fqbnLabel = vscode.l10n.t('No Board Selected');
        if (state.selectedBoardName) {
            fqbnLabel = state.selectedBoardName;
        }

        let portLabel = vscode.l10n.t('No Port Selected');
        if (state.selectedPort) {
            portLabel = state.selectedPort;
        }

        this._view.webview.postMessage({
            command: 'updateLabels',
            fqbn: fqbnLabel,
            port: portLabel,
            noBoardText: vscode.l10n.t('No Board Selected'),
            noPortText: vscode.l10n.t('No Port Selected')
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Localized Strings
        const titleDashboard = vscode.l10n.t('Arduino Dashboard');
        const lblCurrentBoard = vscode.l10n.t('Current Board');
        const lblCurrentPort = vscode.l10n.t('Current Port (Click to Auto-detect)');
        const lblActions = vscode.l10n.t('Actions');
        const lblCompile = vscode.l10n.t('Compile');
        const lblUpload = vscode.l10n.t('Upload');
        const lblSerialMon = vscode.l10n.t('Serial Mon');
        const lblSerialConsole = vscode.l10n.t('Console');
        const lblPlotter = vscode.l10n.t('Plotter');
        const lblManagement = vscode.l10n.t('Management');
        const lblManagerDesc = vscode.l10n.t('Arduino Manager (Libraries / Boards)');
        const lblCheckUpdates = vscode.l10n.t('Check for Updates');
        const lblBrowseExamples = vscode.l10n.t('Browse Examples');
        const lblNewSketch = vscode.l10n.t('New Sketch');
        const tltCompile = vscode.l10n.t('Verify/Compile Sketch');
        const tltUpload = vscode.l10n.t('Upload to Board');
        const tltSerial = vscode.l10n.t('Open Serial Monitor');
        const tltSerialConsole = vscode.l10n.t('Open Serial Console');
        const tltPlotter = vscode.l10n.t('Open Serial Plotter');
        const lblMemoryUsage = vscode.l10n.t('Memory Usage');
        const lblFlash = vscode.l10n.t('Flash');
        const lblRAM = vscode.l10n.t('RAM');

        // Modern Apple/Glassmorphism-inspired UI
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${titleDashboard}</title>
    <style>
        :root {
            --arduino-teal: #00979C;
            --arduino-teal-hover: #008184;
            --arduino-blue: #005C8F;
            --bg-glass: rgba(255, 255, 255, 0.05);
            --bg-glass-hover: rgba(255, 255, 255, 0.1);
            --border-glass: rgba(255, 255, 255, 0.1);
            --text-main: var(--vscode-foreground);
            --text-muted: var(--vscode-descriptionForeground);
        }

        body {
            font-family: var(--vscode-font-family), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            padding: 16px 12px;
            color: var(--text-main);
            margin: 0;
            display: flex;
            flex-direction: column;
            gap: 20px;
        }

        /* Status Card */
        .status-card {
            background: var(--bg-glass);
            border: 1px solid var(--border-glass);
            border-radius: 12px;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            backdrop-filter: blur(10px);
        }

        .status-row {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .status-label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-muted);
            font-weight: 600;
        }

        .status-value {
            font-size: 13px;
            font-weight: 500;
            word-break: break-all;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .status-indicator {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background-color: var(--text-muted);
        }

        .status-indicator.active {
            background-color: var(--arduino-teal);
            box-shadow: 0 0 8px rgba(0, 151, 156, 0.6);
        }

        /* Memory Bars */
        .memory-section {
            background: var(--bg-glass);
            border: 1px solid var(--border-glass);
            border-radius: 12px;
            padding: 16px;
            display: none; /* Hidden until compile finishes */
            flex-direction: column;
            gap: 12px;
        }

        .memory-row {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        
        .memory-header {
            display: flex;
            justify-content: space-between;
            font-size: 11px;
            font-weight: 600;
            color: var(--text-muted);
            letter-spacing: 0.5px;
        }

        .progress-track {
            width: 100%;
            height: 6px;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 3px;
            overflow: hidden;
        }

        .progress-fill {
            height: 100%;
            background: var(--arduino-teal);
            width: 0%;
            transition: width 0.5s ease-out, background-color 0.3s ease;
        }

        /* Action Buttons */
        .section-title {
            font-size: 12px;
            font-weight: 600;
            color: var(--text-muted);
            margin-bottom: -10px;
            text-transform: uppercase;
        }

        .btn-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
        }

        .btn {
            background: var(--bg-glass);
            border: 1px solid var(--border-glass);
            color: var(--text-main);
            padding: 12px;
            border-radius: 10px;
            cursor: pointer;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 8px;
            font-size: 12px;
            font-family: inherit;
            transition: all 0.2s ease;
        }

        .btn:hover {
            background: var(--bg-glass-hover);
            transform: translateY(-1px);
        }

        .btn:active {
            transform: translateY(1px);
        }

        .btn.primary {
            background: var(--arduino-teal);
            color: white;
            border: none;
        }

        .btn.primary:hover {
            background: var(--arduino-teal-hover);
            box-shadow: 0 4px 12px rgba(0, 151, 156, 0.3);
        }

        .btn svg {
            width: 20px;
            height: 20px;
            fill: currentColor;
        }

        .btn.full-width {
            grid-column: 1 / -1;
            flex-direction: row;
            justify-content: flex-start;
            padding: 12px 16px;
        }
    </style>
</head>
<body>
    <div class="status-card">
        <div class="status-row" style="cursor: pointer;" onclick="execute('arduino.selectBoardAndPort')">
            <span class="status-label">${lblCurrentBoard}</span>
            <div class="status-value">
                <div class="status-indicator" id="boardIndicator"></div>
                <span id="boardName">Loading...</span>
            </div>
        </div>
        <div class="status-row" style="cursor: pointer;" onclick="execute('arduino.autoDetect')">
            <span class="status-label">${lblCurrentPort}</span>
            <div class="status-value">
                <div class="status-indicator" id="portIndicator"></div>
                <span id="portName">Loading...</span>
            </div>
        </div>
    </div>

    <div class="memory-section" id="memorySection">
        <div class="section-title" style="margin-bottom: 0px;">${lblMemoryUsage}</div>
        <div class="memory-row">
            <div class="memory-header">
                <span>${lblFlash}</span>
                <span id="flashText">0%</span>
            </div>
            <div class="progress-track">
                <div class="progress-fill" id="flashBar"></div>
            </div>
        </div>
        <div class="memory-row">
            <div class="memory-header">
                <span>${lblRAM}</span>
                <span id="ramText">0%</span>
            </div>
            <div class="progress-track">
                <div class="progress-fill" id="ramBar"></div>
            </div>
        </div>
    </div>

    <div class="section-title">${lblActions}</div>
    <div class="btn-grid">
        <button class="btn primary" onclick="execute('arduino.compile')" title="${tltCompile}">
            <svg viewBox="0 0 16 16"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/></svg>
            ${lblCompile}
        </button>
        <button class="btn primary" onclick="execute('arduino.upload')" title="${tltUpload}">
            <svg viewBox="0 0 16 16"><path d="M8 14V3.56l-3.22 3.22a.75.75 0 0 1-1.06-1.06l4.5-4.5a.75.75 0 0 1 1.06 0l4.5 4.5a.75.75 0 0 1-1.06 1.06L9 3.56V14a.75.75 0 0 1-1.5 0z"/></svg>
            ${lblUpload}
        </button>
        <button class="btn" onclick="execute('arduino.serialConsole')" title="${tltSerialConsole}">
            <svg viewBox="0 0 16 16"><path d="M2.5 3h11c.82 0 1.5.68 1.5 1.5v7c0 .82-.68 1.5-1.5 1.5h-11A1.5 1.5 0 0 1 1 11.5v-7C1 3.68 1.68 3 2.5 3zm11 1.5h-11v5h11v-5zM2.5 11h11v.5h-11V11zM4 6.5l3 3 1.5-1.5M4 8.5h4"/></svg>
            ${lblSerialConsole}
        </button>
        <button class="btn" onclick="execute('arduino.serialMonitor')" title="${tltSerial}">
            <svg viewBox="0 0 16 16"><path d="M2 3h12v10H2V3zm1 1v8h10V4H3zm1 2h2v1H4V6zm3 0h5v1H7V6z"/></svg>
            ${lblSerialMon}
        </button>
        <button class="btn" onclick="execute('arduino.serialPlotter')" title="${tltPlotter}">
            <svg viewBox="0 0 16 16"><path d="M1 2v13h13V2H1zm12 12H2V3h11v11z"/><path d="M3 11l3-4 2 2 4-5v2l-4 5-2-2-3 4H3z"/></svg>
            ${lblPlotter}
        </button>
    </div>

    <div class="section-title">${lblManagement}</div>
    <div class="btn-grid">
        <button class="btn full-width" onclick="execute('arduino.managerGUI')" style="justify-content: center;">
            <svg viewBox="0 0 16 16" style="margin-right: 4px;"><path d="M2 1h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm0 1v12h12V2H2zm1 2h10v2H3V4zm0 4h10v2H3V8zm0 4h6v2H3v-2z"/></svg>
            ${lblManagerDesc}
        </button>
        <button class="btn full-width" onclick="execute('arduino.updateAll')" style="justify-content: center;">
            <svg viewBox="0 0 16 16" style="margin-right: 4px;"><path d="M8 1a7 7 0 1 0 7 7H14A6 6 0 1 1 8 2V1zm.5 2v4.25l3.19 3.19-.71.71L7.5 7.66V3h1z"/></svg>
            ${lblCheckUpdates}
        </button>
        <button class="btn full-width" onclick="execute('arduino.openExample')" style="justify-content: center;">
            <svg viewBox="0 0 16 16" style="margin-right: 4px;"><path d="M3 1v14h10V5l-4-4H3zm1 1h4v4h4v9H4V2zm5.5 1.21L11.79 5H9.5V3.21z"/></svg>
            ${lblBrowseExamples}
        </button>
        <button class="btn full-width" onclick="execute('arduino.newSketch')" style="justify-content: center;">
            <svg viewBox="0 0 16 16" style="margin-right: 4px;"><path d="M8 2v12m-6-6h12" stroke="currentColor" stroke-width="1.5"/></svg>
            ${lblNewSketch}
        </button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function execute(commandId) {
            vscode.postMessage({
                command: 'execute',
                id: commandId
            });
        }

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'updateLabels') {
                const boardName = document.getElementById('boardName');
                const portName = document.getElementById('portName');
                const boardInd = document.getElementById('boardIndicator');
                const portInd = document.getElementById('portIndicator');

                boardName.textContent = message.fqbn;
                portName.textContent = message.port;

                if (message.fqbn !== message.noBoardText) boardInd.classList.add('active');
                else boardInd.classList.remove('active');

                if (message.port !== message.noPortText) portInd.classList.add('active');
                else portInd.classList.remove('active');
            } else if (message.command === 'updateMemory') {
                const memSection = document.getElementById('memorySection');
                
                if (!message.memory) {
                    // Compilation failed or no metrics
                    memSection.style.display = 'none';
                    return;
                }

                memSection.style.display = 'flex';
                
                const m = message.memory;
                const flashPct = (m.flashCurrent / m.flashMax) * 100;
                const ramPct = (m.ramCurrent / m.ramMax) * 100;

                const flashBar = document.getElementById('flashBar');
                const ramBar = document.getElementById('ramBar');
                const flashText = document.getElementById('flashText');
                const ramText = document.getElementById('ramText');

                flashBar.style.width = flashPct + '%';
                ramBar.style.width = ramPct + '%';

                flashText.textContent = \`\${m.flashCurrent} / \${m.flashMax} bytes (\${flashPct.toFixed(1)}%)\`;
                ramText.textContent = \`\${m.ramCurrent} / \${m.ramMax} bytes (\${ramPct.toFixed(1)}%)\`;

                // Change color if approaching limits
                flashBar.style.backgroundColor = flashPct > 90 ? '#e06c75' : flashPct > 75 ? '#e5c07b' : 'var(--arduino-teal)';
                ramBar.style.backgroundColor = ramPct > 90 ? '#e06c75' : ramPct > 75 ? '#e5c07b' : 'var(--arduino-teal)';
            }
        });

        // Request initial state
        vscode.postMessage({ command: 'refreshState' });
    </script>
</body>
</html>`;
    }
}
