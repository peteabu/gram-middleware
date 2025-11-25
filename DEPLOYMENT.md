# Deployment Guide

## Publishing gram-middleware to npm

### Prerequisites
- npm account (create at https://www.npmjs.com/signup)
- Git repository set up
- All tests passing

### Steps

1. **Update package.json metadata:**
   - Replace `author` with your name/email
   - Replace `repository.url` with your GitHub repo URL
   - Update `homepage` and `bugs.url` accordingly

2. **Build the package:**
   ```bash
   npm run build
   ```

3. **Run tests:**
   ```bash
   npm test
   ```

4. **Login to npm:**
   ```bash
   npm login
   ```

5. **Publish:**
   ```bash
   npm publish
   ```

   The `prepublishOnly` script will automatically:
   - Clean dist folder
   - Build ESM and CJS versions
   - Run tests

### Version Updates

For subsequent releases:

```bash
# Patch release (0.1.0 -> 0.1.1)
npm version patch

# Minor release (0.1.0 -> 0.2.0)
npm version minor

# Major release (0.1.0 -> 1.0.0)
npm version major

# Then publish
npm publish
```

---

## Deploying Demo to Cloudflare Pages

### Prerequisites
- gram-middleware published to npm
- GitHub repository
- Cloudflare account

### Steps

1. **Update demo to use published package:**
   
   Edit `demo/package.json`:
   ```json
   {
     "dependencies": {
       "gram-middleware": "^0.1.0"  // Change from "file:.."
     }
   }
   ```

2. **Test locally:**
   ```bash
   cd demo
   npm install
   npm run build
   npm run start
   ```

3. **Push to GitHub:**
   ```bash
   git add .
   git commit -m "Prepare for deployment"
   git push origin main
   ```

4. **Configure Cloudflare Pages:**
   
   - Go to Cloudflare Dashboard → Pages
   - Click "Create a project"
   - Connect your GitHub repository
   - Configure build settings:
     - **Framework preset**: Next.js
     - **Build command**: `cd demo && npm install && npm run build`
     - **Build output directory**: `demo/.next`
     - **Root directory**: `/`
   
5. **Add environment variables:**
   
   In Cloudflare Pages → Settings → Environment variables:
   - `OPENAI_API_KEY`: Your OpenAI API key
   - `NODE_VERSION`: `18` (or higher)

6. **Deploy:**
   
   Click "Save and Deploy"

### Custom Domain (Optional)

1. Go to Cloudflare Pages → Custom domains
2. Add your domain (e.g., `akagon.yourdomain.com`)
3. Follow DNS configuration instructions

### Continuous Deployment

Once set up, every push to your main branch will automatically:
1. Trigger a new build on Cloudflare Pages
2. Deploy if build succeeds
3. Update your live site

---

## Troubleshooting

### npm publish fails with "package already exists"
- You need to choose a unique package name
- Or scope it: `@yourusername/gram-middleware`

### Cloudflare build fails
- Check build logs in Cloudflare dashboard
- Verify `OPENAI_API_KEY` is set
- Ensure `demo/package.json` has correct `gram-middleware` version

### Demo can't find gram-middleware
- Verify package is published: `npm view gram-middleware`
- Check version in `demo/package.json` matches published version
- Clear npm cache: `npm cache clean --force`

---

## Post-Deployment Checklist

- [ ] Package published to npm
- [ ] Demo deployed to Cloudflare Pages
- [ ] Environment variables configured
- [ ] Custom domain set up (if applicable)
- [ ] Test all features in production
- [ ] Update README with live demo link
- [ ] Share on Twitter/LinkedIn/HN
