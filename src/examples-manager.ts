/**
 * examples-manager.ts — 예제 스케치 탐색 및 열기
 *
 * arduino-cli lib examples 명령어를 통해
 * 설치된 라이브러리/코어의 예제를 계층형(2단계) QuickPick으로 탐색합니다.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { runCliJson } from './arduino-cli';

/** arduino-cli lib examples 의 JSON 응답 항목 */
interface LibraryExample {
    library: {
        name: string;
        location: string;
    };
    examples: string[];
}

/**
 * 설치된 라이브러리/코어의 예제 목록을 가져옵니다.
 * @returns 라이브러리별 예제 목록
 */
export async function getExamples(): Promise<LibraryExample[]> {
    let examplesData: LibraryExample[] = [];

    // 1. arduino-cli 를 통한 예제 목록 가져오기
    try {
        const result = await runCliJson<{ examples: LibraryExample[] }>([
            'lib',
            'examples',
        ]);
        if (result.data.examples) {
            examplesData = examplesData.concat(result.data.examples);
        }
    } catch (error) {
        // CLI 에러는 그냥 무시하고 경고만 로그로 남깁니다.
    }

    // 2. Arduino IDE 내장 예제(Built-in Examples) 가져오기
    // Windows 기본 설치 경로
    const builtinPath = 'C:\\Program Files\\Arduino IDE\\resources\\app\\lib\\backend\\resources\\Examples';

    try {
        if (fs.existsSync(builtinPath)) {
            const categories = fs.readdirSync(builtinPath, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            const builtinLibs: LibraryExample[] = categories.map(category => {
                const categoryPath = path.join(builtinPath, category);
                const exampleDirs = fs.readdirSync(categoryPath, { withFileTypes: true })
                    .filter(dirent => dirent.isDirectory())
                    .map(dirent => path.join(categoryPath, dirent.name));

                return {
                    library: {
                        name: category,
                        location: 'builtin',
                    },
                    examples: exampleDirs,
                };
            });

            examplesData = builtinLibs.concat(examplesData);
        }
    } catch {
        // 내장 예제 폴더 읽기 실패 시 무시
    }

    return examplesData;
}

/**
 * 경로에서 마지막 폴더/파일 이름만 추출합니다.
 * @param fullPath 전체 경로
 * @returns 파일/폴더 이름
 */
function basename(fullPath: string): string {
    return fullPath.split(/[\/\\]/).pop() || fullPath;
}

function sanitizeFolderName(name: string): string {
    return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'ArduinoExample';
}

function getUniqueFolderPath(parent: string, folderName: string): string {
    const basePath = path.join(parent, folderName);
    if (!fs.existsSync(basePath)) {
        return basePath;
    }

    for (let i = 2; i < 100; i++) {
        const candidate = path.join(parent, `${folderName}_${i}`);
        if (!fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return path.join(parent, `${folderName}_${Date.now()}`);
}

function findFirstInoFile(folderPath: string): string | undefined {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    const inoFile = entries.find((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.ino'));
    if (inoFile) {
        return path.join(folderPath, inoFile.name);
    }

    for (const entry of entries) {
        if (entry.isDirectory()) {
            const nested = findFirstInoFile(path.join(folderPath, entry.name));
            if (nested) {
                return nested;
            }
        }
    }

    return undefined;
}

async function copyExampleToEditableWorkspace(examplePath: string, exampleName: string): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let targetParent = workspaceFolder;

    if (!targetParent) {
        const selectedFolder = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: vscode.l10n.t('Select example copy location'),
        });
        targetParent = selectedFolder?.[0]?.fsPath;
    }

    if (!targetParent) {
        return;
    }

    const targetFolder = getUniqueFolderPath(targetParent, sanitizeFolderName(exampleName));
    fs.cpSync(examplePath, targetFolder, { recursive: true });

    const inoFile = findFirstInoFile(targetFolder);
    if (inoFile) {
        const doc = await vscode.workspace.openTextDocument(inoFile);
        const arduinoDoc = await vscode.languages.setTextDocumentLanguage(doc, 'arduino');
        await vscode.window.showTextDocument(arduinoDoc, { preview: false });
    } else {
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(targetFolder), false);
    }

    vscode.window.showInformationMessage(
        vscode.l10n.t('Example copied for editing: {0}', targetFolder)
    );
}

interface LibraryQuickPickItem extends vscode.QuickPickItem {
    libData?: LibraryExample;
}

/**
 * 계층형 QuickPick으로 예제를 탐색하고 엽니다.
 *
 * 1단계: 라이브러리/코어 목록(분류별 그룹) 선택
 * 2단계: 선택한 라이브러리의 예제 목록 선택
 * 3단계: 선택한 예제를 새 창 또는 현재 창으로 열기
 */
export async function openExample(): Promise<void> {
    // --- 1단계: 라이브러리/코어 목록 ---
    const step1 = vscode.window.createQuickPick();
    step1.placeholder = vscode.l10n.t('Select a library or core (searchable)');
    step1.busy = true;
    step1.show();

    try {
        const libsWithExamples = (await getExamples()).filter(
            (lib) => lib.examples.length > 0
        );

        if (libsWithExamples.length === 0) {
            step1.dispose();
            vscode.window.showInformationMessage(vscode.l10n.t('No installed examples.'));
            return;
        }

        // 카테고리별로 라이브러리 목록 분류
        const builtinLibs = libsWithExamples.filter(l => l.library.location === 'builtin');
        const platformLibs = libsWithExamples.filter(l => l.library.location === 'platform');
        const customLibs = libsWithExamples.filter(l => l.library.location !== 'builtin' && l.library.location !== 'platform');

        const libItems: LibraryQuickPickItem[] = [];

        // 1. 포함된 예제들 (Built-in)
        if (builtinLibs.length > 0) {
            libItems.push({
                label: vscode.l10n.t('Built-in Examples'),
                kind: vscode.QuickPickItemKind.Separator
            });
            for (const lib of builtinLibs) {
                libItems.push({
                    label: `$(file-code) ${lib.library.name}`,
                    description: vscode.l10n.t('{0} examples', lib.examples.length),
                    detail: vscode.l10n.t('Basic examples'),
                    libData: lib
                });
            }
        }

        // 2. 내장 코어 예제 (Platform)
        if (platformLibs.length > 0) {
            libItems.push({
                label: vscode.l10n.t('Core Examples'),
                kind: vscode.QuickPickItemKind.Separator
            });
            for (const lib of platformLibs) {
                libItems.push({
                    label: `$(circuit-board) ${lib.library.name}`,
                    description: vscode.l10n.t('{0} examples', lib.examples.length),
                    detail: vscode.l10n.t('Examples for the currently selected board\'s core'),
                    libData: lib
                });
            }
        }

        // 3. 사용자 정의 라이브러리
        if (customLibs.length > 0) {
            libItems.push({
                label: vscode.l10n.t('User Library Examples'),
                kind: vscode.QuickPickItemKind.Separator
            });
            for (const lib of customLibs) {
                libItems.push({
                    label: `$(library) ${lib.library.name}`,
                    description: vscode.l10n.t('{0} examples', lib.examples.length),
                    detail: vscode.l10n.t('Installed external library'),
                    libData: lib
                });
            }
        }

        step1.busy = false;
        step1.items = libItems;

        step1.onDidAccept(async () => {
            const selectedLib = step1.selectedItems[0] as LibraryQuickPickItem;
            step1.dispose();

            // 사용자가 Separator를 클릭했거나 예제가 없는 아이템인 경우 무시
            if (!selectedLib || !selectedLib.libData || selectedLib.libData.examples.length === 0) {
                return;
            }

            // --- 2단계: 예제 목록 ---
            await showExamplePicker(selectedLib.libData.library.name, selectedLib.libData.examples);
        });

        step1.onDidHide(() => step1.dispose());
    } catch (error) {
        step1.dispose();
        const message = error instanceof Error ? error.message : vscode.l10n.t('Unknown error');
        vscode.window.showErrorMessage(vscode.l10n.t('Example browsing failed: {0}', message));
    }
}

/**
 * 특정 라이브러리의 예제 목록을 QuickPick으로 보여주고 선택된 예제를 엽니다.
 * @param libName 라이브러리 이름
 * @param examplePaths 예제 폴더 경로 목록
 */
async function showExamplePicker(
    libName: string,
    examplePaths: string[]
): Promise<void> {
    const step2 = vscode.window.createQuickPick();
    step2.placeholder = vscode.l10n.t('{0} — Select an example', libName);
    step2.items = examplePaths.map((exPath) => ({
        label: `$(file-code) ${basename(exPath)}`,
        detail: exPath,
    }));
    step2.show();

    step2.onDidAccept(async () => {
        const selected = step2.selectedItems[0];
        step2.dispose();

        if (!selected || !selected.detail) {
            return;
        }

        const exampleName = selected.label.replace('$(file-code) ', '');

        const action = await vscode.window.showInformationMessage(
            vscode.l10n.t('How would you like to open the "{0}" example?', exampleName),
            vscode.l10n.t('Copy to Workspace'),
            vscode.l10n.t('Open Original in New Window'),
            vscode.l10n.t('Open Original in Current Window')
        );

        if (action === vscode.l10n.t('Copy to Workspace')) {
            await copyExampleToEditableWorkspace(selected.detail, exampleName);
            return;
        }

        const folderUri = vscode.Uri.file(selected.detail);
        if (action === vscode.l10n.t('Open Original in New Window')) {
            vscode.commands.executeCommand('vscode.openFolder', folderUri, true);
        } else if (action === vscode.l10n.t('Open Original in Current Window')) {
            vscode.commands.executeCommand('vscode.openFolder', folderUri, false);
        }
    });

    step2.onDidHide(() => step2.dispose());
}
