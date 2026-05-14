# Arduino Helper

Arduino CLI-based VS Code and VSCodium extension for compiling, uploading, serial communication, and board/library management directly from the editor.

## Features

- **Auto-Download CLI**: Automatically downloads `arduino-cli` if it is not found.
- **Board Selection**: Select from installed Arduino-compatible boards.
- **Port Selection**: Pick connected serial ports, including ports whose board type is unknown.
- **Compile & Upload**: Compile and upload sketches from VS Code.
- **Serial Console**: Webview console with RX/TX log, port selection, baud rate selection, line ending selection, pause, autoscroll, clear, export, and input history.
- **Serial Monitor**: Terminal-based `arduino-cli monitor` integration.
- **Serial Plotter**: Visualize real-time numeric telemetry with Chart.js.
- **Manager GUI**: Search and install libraries and board cores from a webview.
- **IntelliSense & Clangd**: Generates `c_cpp_properties.json` and `compile_commands.json`.
- **Code Snippets**: Built-in Arduino snippets such as `setup`, `loop`, and `pm`.
- **Hardware Debugging**: Generate `launch.json` for Cortex-Debug.
- **Example Sketches**: Browse and open examples from installed libraries and cores.

## Requirements

- `arduino-cli` installed and available in `PATH`, or let the extension download it automatically.
- On Linux, your user may need serial-port permission, for example membership in the `dialout` group.

## Serial Console

Open `Arduino: Serial Console` from the Command Palette or the Arduino dashboard.

1. Press **Refresh** to load available ports.
2. Select a port.
3. Choose a baud rate and line ending.
4. Press **Open**.
5. Send text from the input box.

The console shows TX and RX separately and can export the visible log.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `arduino.cliPath` | `arduino-cli` | Path to the Arduino CLI executable |
| `arduino.defaultBaudRate` | `9600` | Default serial monitor baud rate |
| `arduino.autoDetectBoard` | `true` | Auto-detect board on USB connection |
| `arduino.serialTimestamps` | `false` | Add timestamps to received serial lines |
| `arduino.serialHexView` | `false` | Display received serial bytes as hex |
| `arduino.serialLineEnding` | `lf` | Line ending for serial input: `none`, `lf`, `cr`, or `crlf` |

## Development

This repository uses `pnpm`.

```powershell
pnpm install
pnpm run compile
pnpm run package
```

If `pnpm` is not installed directly, use Node's Corepack:

```powershell
corepack pnpm install
corepack pnpm run compile
corepack pnpm run package
```

## License

[MIT](LICENSE)
