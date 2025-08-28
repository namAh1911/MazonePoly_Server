# 🔄 MazonePoly_Server Fork Workflow Guide

## 📋 **Prerequisites**
- GitHub account: `zzbalita`
- Local repository already exists

## 🚀 **Step 1: Fork on GitHub**
1. Visit: https://github.com/namAh1911/MazonePoly_Server
2. Click **"Fork"** button (top-right)
3. Select your account (`zzbalita`)
4. Wait for fork completion

## 🔧 **Step 2: Update Local Remotes**
```bash
# Current setup (already done):
origin    -> https://github.com/zzbalita/MazonePoly_Server.git (YOUR FORK)
upstream  -> https://github.com/namAh1911/MazonePoly_Server.git (ORIGINAL)
```

## 📥 **Step 3: Pull Latest Code**
```bash
# Fetch latest from original repository
git fetch upstream

# Pull latest changes
git pull upstream main

# Push to your fork
git push origin main
```

## 🔄 **Step 4: Regular Workflow**
```bash
# Get latest from original
git fetch upstream
git pull upstream main

# Push to your fork
git push origin main

# Create feature branches from your fork
git checkout -b feature-name
git push origin feature-name
```

## 📤 **Step 5: Submit Pull Request**
1. Go to your fork: https://github.com/zzbalita/MazonePoly_Server
2. Click **"Pull Request"**
3. Select **base: namAh1911/main** ← **compare: zzbalita/feature-name**
4. Submit PR

## 🎯 **Benefits of This Setup**
- ✅ **Your fork** = Your working copy
- ✅ **Upstream** = Original repository
- ✅ **Easy sync** with original
- ✅ **Safe development** in your fork
- ✅ **Simple PR submission**

## 🚨 **Important Notes**
- **ALWAYS** pull from `upstream` (original)
- **NEVER** push directly to `upstream`
- **ALWAYS** push to `origin` (your fork)
- Use feature branches for development
