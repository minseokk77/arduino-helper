import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export async function newSketch(): Promise<void> {
    const sketchName = await vscode.window.showInputBox({
        prompt: vscode.l10n.t('Enter sketch name'),
        placeHolder: vscode.l10n.t('e.g.: Blink, ServoTest, SensorReader'),
        validateInput: (value) => {
            if (!value) {
                return vscode.l10n.t('Please enter a sketch name');
            }
            if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(value)) {
                return vscode.l10n.t('Only letters, numbers, underscores allowed (must start with a letter)');
            }
            return null;
        },
    });

    if (!sketchName) {
        return;
    }

    const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    const targetFolder = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: vscode.l10n.t('Select sketch creation location'),
        defaultUri,
    });

    if (!targetFolder || targetFolder.length === 0) {
        return;
    }

    const sketchDir = path.join(targetFolder[0].fsPath, sketchName);
    const sketchFile = path.join(sketchDir, `${sketchName}.ino`);

    try {
        fs.mkdirSync(sketchDir, { recursive: true });
    } catch (error) {
        const message =
            error instanceof Error ? error.message : vscode.l10n.t('Unknown error');
        vscode.window.showErrorMessage(vscode.l10n.t('Failed to create sketch folder: {0}', message));
        return;
    }

    const template = `/**
 * ${sketchName} Arduino sketch
 * Created: ${new Date().toISOString().split('T')[0]}
 */

void setup() {
  Serial.begin(9600);
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.println("Sketch ready");
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  delay(500);

  Serial.println("tick");
}
`;

    try {
        fs.writeFileSync(sketchFile, template, 'utf8');

        const doc = await vscode.workspace.openTextDocument(sketchFile);
        await vscode.languages.setTextDocumentLanguage(doc, 'arduino');
        await vscode.window.showTextDocument(doc, { preview: false });

        vscode.window.showInformationMessage(
            vscode.l10n.t('New sketch "{0}" created!', sketchName)
        );
    } catch (error) {
        const message =
            error instanceof Error ? error.message : vscode.l10n.t('Unknown error');
        vscode.window.showErrorMessage(vscode.l10n.t('Failed to create sketch file: {0}', message));
    }
}
