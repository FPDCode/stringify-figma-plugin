# Stringify - Figma Plugin

A robust Figma plugin that automatically converts text layers to string variables with enhanced UX, accessibility, and professional-grade features.

## 🚀 Features

### Core Functionality
- **Text Layer Scanning**: Automatically scans and identifies eligible text layers
- **Variable Creation**: Converts text layers to Figma string variables
- **Smart Naming**: Intelligent variable naming with conflict resolution
- **Batch Processing**: Efficient processing of large numbers of text layers
- **Duplicate Detection**: Prevents duplicate variables and connects to existing ones

### Enhanced User Experience
- **Dynamic UI**: Smart button behavior that adapts to user context
- **Real-time Progress**: Live progress tracking with remaining count
- **Auto-rescan**: Automatic page refresh after processing completion
- **Status Messages**: Comprehensive feedback with success, error, and warning states
- **Processing States**: Clean, locked interface during operations

### Accessibility & Quality
- **WCAG Compliant**: Full screen reader and keyboard navigation support
- **ARIA Labels**: Comprehensive labeling for all interactive elements
- **Type Safety**: Full TypeScript integration with comprehensive interfaces
- **Error Handling**: Robust error management with detailed context
- **Performance**: Variable caching and optimized batch processing

## 📦 Installation

### For Development
1. Clone the repository:
   ```bash
   git clone https://github.com/FPDCode/stringify-figma-plugin.git
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
   - Open Figma Desktop
   - Go to Plugins → Development → Import plugin from manifest
   - Select the `manifest.json` file from the project root

### For Production
The plugin is ready for distribution through Figma's plugin marketplace.

## 🛠️ Development

### Available Scripts

- `npm run build` - Build the plugin for production
- `npm run dev` - Start development mode with file watching
- `npm run watch` - Watch for file changes and rebuild automatically
- `npm run lint` - Run ESLint to check code quality
- `npm run lint:fix` - Fix ESLint issues automatically
- `npm run type-check` - Run TypeScript type checking
- `npm run validate` - Run both linting and type checking
- `npm run clean` - Clean the build directory

### Development Workflow

1. **Start Development**:
   ```bash
   npm run dev
   ```

2. **Make Changes**: Edit TypeScript files in the `lib/` directory or `code.ts`

3. **Auto-rebuild**: Files are automatically watched and rebuilt

4. **Test in Figma**: Reload the plugin in Figma to see changes

### Project Structure

```
stringify-figma-plugin/
├── lib/                    # Modular architecture
│   ├── types.ts           # TypeScript interfaces
│   ├── constants.ts       # Configuration constants
│   ├── textProcessor.ts   # Text processing logic
│   └── variableManager.ts # Variable operations
├── code.ts                # Main plugin controller
├── ui.html               # Plugin user interface
├── manifest.json         # Plugin manifest
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
├── dist/                 # Build output directory
└── README.md            # This file
```

## 🎯 Usage

### Basic Workflow

1. **Open Plugin**: Launch Stringify from the Figma plugins menu
2. **Select Collection**: Choose a variable collection or create a new one
3. **Scan Layers**: Click "Rescan Text Layers" to find eligible text layers
4. **Process**: Click "Process X Text Layers" to convert them to variables
5. **Review**: Check the success message and updated layer count

### Smart Button Behavior

- **No Collection Selected**: Shows green "Create New Collection" button
- **Collection Selected**: Shows blue "Process X Text Layers" button
- **During Processing**: Only "Stop Processing" button is visible
- **After Processing**: Auto-rescans to show remaining layers

### Text Layer Eligibility

Text layers are eligible for variable creation if they:
- Start with alphanumeric characters
- Are not already bound to variables
- Are not locked or hidden
- Contain valid text content

## 🔧 Configuration

### Plugin Settings

The plugin can be configured through constants in `lib/constants.ts`:

```typescript
const PLUGIN_CONFIG = {
  BATCH_SIZE: 10,                    // Items processed per batch
  MAX_VARIABLE_NAME_LENGTH: 50,      // Maximum variable name length
  DEFAULT_COLLECTION_NAME: "Text to String", // Default collection name
  PROGRESS_UPDATE_DELAY: 10,         // Delay between progress updates
  UI_DIMENSIONS: {
    width: 380,                       // Plugin window width
    height: 560                       // Plugin window height
  }
}
```

## 🐛 Troubleshooting

### Common Issues

1. **Plugin Not Loading**: Ensure all dependencies are installed and the build is successful
2. **No Text Layers Found**: Check that text layers start with alphanumeric characters
3. **Processing Errors**: Verify that the selected collection exists and is accessible
4. **Performance Issues**: Reduce batch size in configuration for large datasets

### Debug Mode

Enable debug logging by opening the browser console in Figma:
1. Right-click in Figma → Inspect Element
2. Go to Console tab
3. Look for Stringify plugin logs

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes and test thoroughly
4. Run the build process: `npm run build`
5. Commit your changes: `git commit -m "Add feature"`
6. Push to the branch: `git push origin feature-name`
7. Submit a pull request

### Code Quality Standards

- All code must pass ESLint checks: `npm run lint`
- TypeScript types must be valid: `npm run type-check`
- Follow the existing code style and patterns
- Add appropriate error handling and user feedback
- Include accessibility features for new UI elements

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built for the Figma plugin ecosystem
- Designed with accessibility and user experience in mind
- Inspired by modern development practices and clean architecture

## 📞 Support

For issues, feature requests, or questions:
- Create an issue on [GitHub](https://github.com/FPDCode/stringify-figma-plugin/issues)
- Check the troubleshooting section above
- Review the development documentation

---

**Version**: 2.0.0  
**Author**: FPDCode  
**License**: MIT