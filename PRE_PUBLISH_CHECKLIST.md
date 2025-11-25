# Pre-Publish Checklist for npm

Before running `npm publish`, verify:

## Required Files
- [x] `package.json` - Configured with correct metadata
- [x] `README.md` - Documentation exists
- [x] `LICENSE` - MIT license file created
- [x] `.npmignore` - Excludes unnecessary files
- [x] `dist/` - Built files exist

## package.json Verification

### Must Update Before Publishing:
- [ ] `author`: Replace "Your Name <your.email@example.com>" with your actual info
- [ ] `repository.url`: Replace with your actual GitHub repo URL
- [ ] `homepage`: Update with your repo URL
- [ ] `bugs.url`: Update with your repo URL

### Already Configured:
- [x] `name`: "gram-middleware"
- [x] `version`: "0.1.0"
- [x] `description`: Present
- [x] `main`: Points to CJS build
- [x] `module`: Points to ESM build
- [x] `types`: Points to TypeScript definitions
- [x] `exports`: Dual package (ESM + CJS)
- [x] `files`: Includes dist, README, LICENSE
- [x] `keywords`: SEO-friendly keywords
- [x] `license`: "MIT"
- [x] `engines`: Node >= 18
- [x] `peerDependencies`: gram-library specified

## Build Verification

Run these commands:

```bash
# Clean previous builds
npm run clean

# Build fresh
npm run build

# Verify dist structure
ls -la dist/
ls -la dist/esm/
ls -la dist/cjs/

# Check for required files
test -f dist/esm/index.js && echo "✓ ESM build exists"
test -f dist/cjs/index.js && echo "✓ CJS build exists"
test -f dist/esm/index.d.ts && echo "✓ Type definitions exist"
```

Expected output:
```
dist/
├── cjs/
│   ├── index.js
│   ├── index.d.ts
│   ├── package.json (type: commonjs)
│   └── ... (other files)
├── esm/
│   ├── index.js
│   ├── index.d.ts
│   ├── package.json (type: module)
│   └── ... (other files)
```

## Test Verification

```bash
# Run all tests
npm test

# Should see:
# ✓ All tests passing
# ✓ No errors
```

## Dry Run

Test the publish without actually publishing:

```bash
npm pack

# This creates gram-middleware-0.1.0.tgz
# Extract and inspect:
tar -xzf gram-middleware-0.1.0.tgz
ls -la package/

# Verify only dist/, README.md, LICENSE, and package.json are included
# No src/, tests/, demo/, or config files
```

## GitHub Repository Setup

**CRITICAL: Do this BEFORE publishing to npm!**

1. **Create GitHub repository:**
   ```bash
   # On GitHub, create a new repository named "gram-middleware"
   # Then initialize locally:
   git init
   git add .
   git commit -m "Initial commit: gram-middleware v0.1.0"
   git branch -M main
   git remote add origin https://github.com/yourusername/gram-middleware.git
   git push -u origin main
   ```

2. **Update package.json with actual repo URL:**
   - Replace `yourusername` with your GitHub username
   - Update `repository.url`
   - Update `homepage`
   - Update `bugs.url`

3. **Verify repo is public:**
   - Go to your GitHub repo
   - Ensure it's set to "Public" (not Private)
   - npm requires public repos for package links

## Final Checks

- [ ] GitHub repo created and pushed
- [ ] package.json has correct GitHub URLs
- [ ] All tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] No uncommitted changes (`git status`)
- [ ] README is up to date
- [ ] Version number is correct (0.1.0 for first release)
- [ ] You're logged into npm (`npm whoami`)

## Ready to Publish?

If all checks pass:

```bash
npm publish
```

## After Publishing

1. Verify on npm: https://www.npmjs.com/package/gram-middleware
2. Test installation: `npm install gram-middleware`
3. Update demo/package.json to use published version
4. Tag the release in git:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

## Troubleshooting

**"You do not have permission to publish"**
- Run `npm login` first
- Verify with `npm whoami`

**"Package name already taken"**
- Choose a different name, or
- Use a scoped package: `@yourusername/gram-middleware`

**"prepublishOnly script failed"**
- Check build errors: `npm run build`
- Check test errors: `npm test`
- Fix issues and try again
