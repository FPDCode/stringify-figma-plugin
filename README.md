# Stringify - Figma Plugin

A Figma plugin that automatically converts text layers to string variables, streamlining your design system workflow.

## Features

- 🔍 **Scan Text Layers**: Automatically finds all text layers on the current page
- 🔄 **Create Variables**: Converts text content to string variables (camelCase format)
- 🔗 **Auto-Connect**: Binds text layers to their corresponding variables
- ♻️ **Smart Duplicates**: Connects to existing variables instead of creating duplicates
- 📊 **Progress Feedback**: Shows detailed information about the conversion process
- ⚠️ **Error Handling**: Gracefully handles errors and provides helpful feedback

## Installation

### For Development

1. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/stringify-figma-plugin.git
   cd stringify-figma-plugin
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the plugin:
   ```bash
   npm run build
   ```

4. Load the plugin in Figma:
   - Open Figma Desktop App
   - Go to Plugins → Development → Import plugin from manifest
   - Select the `manifest.json` file from this repository

### For Production

1. Download the latest release from the [Releases page](https://github.com/yourusername/stringify-figma-plugin/releases)
2. Follow Figma's plugin installation instructions

## Usage

1. **Open a Figma file** with text layers that you want to convert to variables
2. **Create a Variable Collection** (if you don't have one):
   - Go to the Variables panel (right sidebar)
   - Click the "+" button to create a new collection
3. **Run the Plugin**:
   - Go to Plugins → Stringify
   - Select your variable collection from the dropdown
   - Click "Scan Text Layers" to see how many text layers are found
   - Click "Create Variables" to convert text layers to variables

## How It Works

1. **Text Layer Detection**: The plugin scans all text layers on the current page
2. **Content Processing**: Text content is converted to camelCase for variable names
3. **Variable Creation**: New string variables are created in your selected collection
4. **Auto-Binding**: Text layers are automatically connected to their variables
5. **Duplicate Handling**: If a variable with the same name and value exists, it connects instead of creating a duplicate

## Text Processing

The plugin converts text content to camelCase variable names:
- `"Hello World"` → `helloWorld`
- `"User Name"` → `userName`
- `"API Key"` → `apiKey`
- `"Error Message!"` → `errorMessage`

## Requirements

- Figma Desktop App (latest version)
- A Figma file with text layers
- A Variable Collection (created in Figma)

## Development

### Scripts

- `npm run build` - Compile TypeScript to JavaScript
- `npm run watch` - Watch for changes and rebuild automatically
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint errors automatically

### Project Structure

```
stringify-figma-plugin/
├── code.ts              # Main plugin logic
├── ui.html              # Plugin UI
├── manifest.json        # Plugin manifest
├── package.json         # Dependencies and scripts
├── tsconfig.json        # TypeScript configuration
└── README.md           # This file
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes
4. Commit your changes: `git commit -m 'Add some feature'`
5. Push to the branch: `git push origin feature-name`
6. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Changelog

### V1.0.0
- Initial release
- Text layer scanning functionality
- Variable creation and binding
- Error handling and user feedback
- Smart duplicate detection

## Support

If you encounter any issues or have questions:

1. Check the [Issues page](https://github.com/yourusername/stringify-figma-plugin/issues) for known problems
2. Create a new issue with detailed information about your problem
3. Include Figma version, plugin version, and steps to reproduce

## Acknowledgments

- Built with [Figma Plugin API](https://www.figma.com/plugin-docs/)
- TypeScript support via [@figma/plugin-typings](https://www.npmjs.com/package/@figma/plugin-typings)