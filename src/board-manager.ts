/**
 * board-manager.ts — 보드 감지 및 선택 UI
 *
 * USB 연결된 보드를 자동 감지하고 QuickPick으로 보드/포트를 선택합니다.
 */
import * as vscode from 'vscode';
import { runCliJson } from './arduino-cli';
import { updateState, getState } from './config';

/** arduino-cli board list 의 JSON 응답 항목 */
interface DetectedPort {
    port: {
        address: string;
        label: string;
        protocol: string;
        protocol_label: string;
    };
    matching_boards?: Array<{
        name: string;
        fqbn: string;
    }>;
}

/** arduino-cli board listall 의 JSON 응답 항목 */
interface BoardListAllItem {
    name: string;
    fqbn: string;
    platform: {
        id: string;
        installed: string;
        name: string;
    };
}

interface PortQuickPickItem extends vscode.QuickPickItem {
    portAddress: string;
    boardName?: string;
    fqbn?: string;
}

export interface SerialPortOption {
    address: string;
    label: string;
    boardName?: string;
    fqbn?: string;
    protocol?: string;
}

/**
 * 현재 USB로 연결된 보드/포트 목록을 가져옵니다.
 * @returns 감지된 포트 목록
 */
export async function getConnectedBoards(): Promise<DetectedPort[]> {
    try {
        const result = await runCliJson<{ detected_ports: DetectedPort[] }>([
            'board',
            'list',
        ]);
        return result.data.detected_ports ?? [];
    } catch (error) {
        const message =
            error instanceof Error ? error.message : vscode.l10n.t('Unknown error');
        vscode.window.showErrorMessage(vscode.l10n.t('Failed to get board list: {0}', message));
        return [];
    }
}

/**
 * 설치된 모든 보드 목록을 가져옵니다.
 * @returns 전체 보드 목록
 */
export async function getAllBoards(): Promise<BoardListAllItem[]> {
    try {
        const result = await runCliJson<{ boards: BoardListAllItem[] }>([
            'board',
            'listall',
        ]);
        return result.data.boards ?? [];
    } catch (error) {
        const message =
            error instanceof Error ? error.message : vscode.l10n.t('Unknown error');
        vscode.window.showErrorMessage(vscode.l10n.t('Failed to get all boards: {0}', message));
        return [];
    }
}

/**
 * QuickPick으로 보드를 선택합니다.
 * 연결된 보드가 있으면 상단에 표시합니다.
 */
export async function selectBoard(): Promise<void> {
    const quickPick = vscode.window.createQuickPick();
    quickPick.placeholder = vscode.l10n.t('Select a board (searchable)');
    quickPick.busy = true;
    quickPick.show();

    try {
        // 연결된 보드 + 전체 보드 목록을 함께 로드
        const [connectedPorts, allBoards] = await Promise.all([
            getConnectedBoards(),
            getAllBoards(),
        ]);

        const items: vscode.QuickPickItem[] = [];

        // 연결된 보드 우선 표시
        const connectedBoards = connectedPorts.filter(
            (p) => p.matching_boards && p.matching_boards.length > 0
        );

        if (connectedBoards.length > 0) {
            items.push({
                label: `$(plug) ${vscode.l10n.t('Connected Boards')}`,
                kind: vscode.QuickPickItemKind.Separator,
            });
            for (const port of connectedBoards) {
                for (const board of port.matching_boards!) {
                    items.push({
                        label: `$(circuit-board) ${board.name}`,
                        description: board.fqbn,
                        detail: vscode.l10n.t('Port: {0}', port.port.address),
                    });
                }
            }
        }

        // 전체 보드 목록
        if (allBoards.length > 0) {
            items.push({
                label: `$(list-unordered) ${vscode.l10n.t('All Boards')}`,
                kind: vscode.QuickPickItemKind.Separator,
            });
            for (const board of allBoards) {
                items.push({
                    label: `$(circuit-board) ${board.name}`,
                    description: board.fqbn,
                    detail: vscode.l10n.t('Platform: {0}', board.platform.name),
                });
            }
        }

        quickPick.busy = false;
        quickPick.items = items;

        quickPick.onDidAccept(async () => {
            const selected = quickPick.selectedItems[0];
            if (selected?.description) {

                // 해당 보드에 맞는 포트 자동 검색
                const matchingPortObj = connectedPorts.find(p =>
                    p.matching_boards?.some(b => b.fqbn === selected.description)
                );
                const matchingPort = matchingPortObj ? matchingPortObj.port.address : undefined;

                updateState({
                    selectedFqbn: selected.description,
                    selectedBoardName: selected.label.replace('$(circuit-board) ', ''),
                    selectedPort: matchingPort
                });

                // IntelliSense 업데이트 호출
                const { updateIntelliSense } = await import('./intellisense');
                await updateIntelliSense();

                if (matchingPort) {
                    vscode.window.showInformationMessage(
                        vscode.l10n.t('Board & Port auto-selected: {0} ({1}) on {2}', selected.label.replace('$(circuit-board) ', ''), selected.description, matchingPort)
                    );
                } else {
                    vscode.window.showInformationMessage(
                        vscode.l10n.t('Board selected: {0} ({1}). Note: No matching port detected.', selected.label.replace('$(circuit-board) ', ''), selected.description)
                    );
                }
            }
            quickPick.dispose();
        });

        quickPick.onDidHide(() => quickPick.dispose());
    } catch (error) {
        quickPick.dispose();
        const message =
            error instanceof Error ? error.message : vscode.l10n.t('Unknown error');
        vscode.window.showErrorMessage(vscode.l10n.t('Board selection failed: {0}', message));
    }
}

export async function selectPort(): Promise<void> {
    try {
        const connectedPorts = await getConnectedBoards();

        if (connectedPorts.length === 0) {
            vscode.window.showWarningMessage(vscode.l10n.t('No boards connected. Check the USB cable.'));
            return;
        }

        const items: PortQuickPickItem[] = connectedPorts.map((detected) => {
            const primaryBoard = detected.matching_boards?.[0];
            const labelParts = ['$(plug)', detected.port.address];
            if (detected.port.label && detected.port.label !== detected.port.address) {
                labelParts.push(`- ${detected.port.label}`);
            }

            return {
                label: labelParts.join(' '),
                description: primaryBoard?.name ?? vscode.l10n.t('Unknown board'),
                detail: vscode.l10n.t(
                    'Board: {0} | Protocol: {1}',
                    primaryBoard?.fqbn ?? vscode.l10n.t('Unknown board'),
                    detected.port.protocol_label || detected.port.protocol || 'unknown'
                ),
                portAddress: detected.port.address,
                boardName: primaryBoard?.name,
                fqbn: primaryBoard?.fqbn,
            };
        });

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: vscode.l10n.t('Select a port'),
            matchOnDescription: true,
            matchOnDetail: true,
        });

        if (!selected) {
            return;
        }

        const previousState = getState();
        updateState({
            selectedPort: selected.portAddress,
            selectedFqbn: selected.fqbn ?? previousState.selectedFqbn,
            selectedBoardName: selected.boardName ?? previousState.selectedBoardName,
        });

        vscode.window.showInformationMessage(vscode.l10n.t('Port selected: {0}', selected.portAddress));
    } catch (error) {
        const message =
            error instanceof Error ? error.message : vscode.l10n.t('Unknown error');
        vscode.window.showErrorMessage(vscode.l10n.t('Port selection failed: {0}', message));
    }
}

export async function getSerialPortOptions(): Promise<SerialPortOption[]> {
    const connectedPorts = await getConnectedBoards();
    return connectedPorts.map((detected) => {
        const primaryBoard = detected.matching_boards?.[0];
        return {
            address: detected.port.address,
            label: detected.port.label || detected.port.address,
            boardName: primaryBoard?.name,
            fqbn: primaryBoard?.fqbn,
            protocol: detected.port.protocol_label || detected.port.protocol,
        };
    });
}

export async function selectPortByAddress(portAddress: string): Promise<boolean> {
    const connectedPorts = await getConnectedBoards();
    const detected = connectedPorts.find((port) => port.port.address === portAddress);

    if (!detected) {
        return false;
    }

    const primaryBoard = detected.matching_boards?.[0];
    const previousState = getState();
    updateState({
        selectedPort: detected.port.address,
        selectedFqbn: primaryBoard?.fqbn ?? previousState.selectedFqbn,
        selectedBoardName: primaryBoard?.name ?? previousState.selectedBoardName,
    });

    return true;
}

export async function selectBoardAndPort(): Promise<void> {
    const selected = await vscode.window.showQuickPick(
        [
            {
                label: `$(circuit-board) ${vscode.l10n.t('Select Board')}`,
                description: vscode.l10n.t('Select the Arduino board type.'),
                action: 'board',
            },
            {
                label: `$(plug) ${vscode.l10n.t('Select Port')}`,
                description: vscode.l10n.t('Select the connected USB port.'),
                action: 'port',
            },
            {
                label: `$(zap) ${vscode.l10n.t('Auto-detect Board/Port')}`,
                description: vscode.l10n.t('Finds a single board connected via USB and sets it automatically.'),
                action: 'auto',
            },
        ],
        {
            placeHolder: vscode.l10n.t('Select an item to change or configure board/port'),
        }
    );

    if (selected?.action === 'board') {
        await selectBoard();
    } else if (selected?.action === 'port') {
        await selectPort();
    } else if (selected?.action === 'auto') {
        await autoDetectBoardAndPort();
    }
}



/**
 * 연결된 보드와 포트를 자동으로 감지하여 설정합니다.
 */
export async function autoDetectBoardAndPort(): Promise<void> {
    try {
        const connectedPorts = await getConnectedBoards();

        // matching_boards가 있는 포트만 필터링
        const validPorts = connectedPorts.filter(
            (p) => p.matching_boards && p.matching_boards.length > 0
        );

        if (validPorts.length === 0) {
            if (connectedPorts.length === 1) {
                const port = connectedPorts[0];
                updateState({ selectedPort: port.port.address });
                vscode.window.showInformationMessage(vscode.l10n.t('Port selected: {0}', port.port.address));
                return;
            }

            if (connectedPorts.length > 1) {
                vscode.window.showInformationMessage(vscode.l10n.t('Multiple boards connected. Please select manually.'));
                await selectPort();
                return;
            }

            vscode.window.showWarningMessage(vscode.l10n.t('Auto-detect failed: No compatible boards connected.'));
            return;
        }

        if (validPorts.length > 1) {
            vscode.window.showInformationMessage(vscode.l10n.t('Multiple boards connected. Please select manually.'));
            await selectBoardAndPort();
            return;
        }

        // 정확히 1개의 보드가 감지된 경우
        const port = validPorts[0];
        const board = port.matching_boards![0];

        updateState({
            selectedPort: port.port.address,
            selectedFqbn: board.fqbn,
            selectedBoardName: board.name,
        });

        vscode.window.showInformationMessage(
            vscode.l10n.t('Auto-detect complete: {0} ({1})', board.name, port.port.address)
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : vscode.l10n.t('Unknown error');
        vscode.window.showErrorMessage(vscode.l10n.t('Error during auto-detection: {0}', message));
    }
}
