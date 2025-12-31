# Mangyomi Extensions

Official extension repository for [Mangyomi](https://github.com/Mangyomi/mangyomi-app) manga reader.

## Available Extensions

| Extension | Language | NSFW |
|-----------|----------|------|
| Mangakakalot | English | ❌ |
| Toonily | English | ✅ |
| HentaiForce | English | ✅ |

## Installation

Extensions can be installed directly from Mangyomi:

1. Open Mangyomi
2. Go to **Extensions** page
3. Enter the GitHub repository URL
4. Browse and install your desired extensions

## Extension Structure

Each extension folder contains:
- `manifest.json` - Extension metadata (id, name, version, baseUrl, etc.)
- `index.js` - Extension logic for fetching manga/chapters

## Creating Extensions

To create your own extension, follow this structure:

```
your-extension/
├── manifest.json
└── index.js
```

### manifest.json

```json
{
    "id": "your-extension-id",
    "name": "Extension Name",
    "version": "1.0.0",
    "baseUrl": "https://example.com",
    "icon": "icon.png",
    "language": "en",
    "nsfw": false
}
```

## License

Apache 2.0
